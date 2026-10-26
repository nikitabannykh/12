import "server-only";
import { and, eq, gte, inArray, sql, ne } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { Business, Campaign } from "../db/schema";
import { clientFor } from "../platforms";
import { demoNow } from "../platforms/demo";
import { addDays, errorText, isoDay, uid } from "../util";

/**
 * Забираем статистику и статусы модерации со всех площадок.
 * Кроме работающих кампаний берём и «error»/«creating»/«ready» с ID на площадке: такая кампания могла остаться
 * включённой (не удалась уборка после прерванного запуска) — её расход должен попасть в stats_daily,
 * иначе защита бюджета его не увидит.
 */
export async function syncBusiness(b: Business) {
  const db = await getDb();
  const camps = await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, b.id), inArray(schema.campaigns.status, ["active", "paused", "error", "creating", "ready"])));
  const errors: string[] = [];
  const byAccount = new Map<string, Campaign[]>();
  for (const c of camps) if (c.externalId) byAccount.set(c.accountId, [...(byAccount.get(c.accountId) ?? []), c]);

  for (const [accountId, list] of byAccount) {
    const [acc] = await db.select().from(schema.adAccounts).where(eq(schema.adAccounts.id, accountId));
    if (!acc) continue;
    try {
      const client = await clientFor(acc);
      const now = acc.platform === "demo" ? await demoNow({ accountId: acc.id }) : new Date();
      const to = isoDay(now);
      const from = isoDay(addDays(now, -29));
      const ads = await db.select().from(schema.ads).where(inArray(schema.ads.campaignId, list.map((c) => c.id)));
      const adByExt = new Map(ads.filter((a) => a.externalId).map((a) => [a.externalId!, a]));
      const campByExt = new Map(list.map((c) => [c.externalId!, c]));

      // Статистика
      const goalIds = Object.values(b.goalIds ?? {}).length ? [b.goalIds.lead].filter(Boolean) as number[] : [];
      const rows = await client.getStats(list.map((c) => c.externalId!), from, to, goalIds);

      // Обращения с нашего счётчика по объявлениям (utm_content = ID объявления на площадке).
      // День — московский, как в статистике площадок
      const mskDay = sql<string>`to_char(${schema.leads.createdAt} AT TIME ZONE 'Europe/Moscow', 'YYYY-MM-DD')`;
      const tracked = await db
        .select({ adExt: schema.leads.adExt, day: mskDay, n: sql<number>`count(*)::int` })
        .from(schema.leads)
        .where(and(eq(schema.leads.businessId, b.id), ne(schema.leads.kind, "suspect"), gte(schema.leads.createdAt, new Date(from))))
        .groupBy(schema.leads.adExt, mskDay);
      const trackedMap = new Map(tracked.filter((t) => t.adExt).map((t) => [`${t.adExt}|${t.day}`, Number(t.n)]));

      const agg = new Map<string, { campaignId: string; adId: string; day: string; impressions: number; clicks: number; cost: number; conversions: number; tvWeighted: number; posWeighted: number }>();
      for (const r of rows) {
        const camp = campByExt.get(r.campaignExt);
        if (!camp) continue;
        const ad = r.adExt ? adByExt.get(r.adExt) : undefined;
        const key = `${camp.id}|${ad?.id ?? ""}|${r.day}`;
        const cur = agg.get(key) ?? { campaignId: camp.id, adId: ad?.id ?? "", day: r.day, impressions: 0, clicks: 0, cost: 0, conversions: 0, tvWeighted: 0, posWeighted: 0 };
        if (r.trafficVolume) cur.tvWeighted += r.trafficVolume * r.impressions;
        if (r.position) cur.posWeighted += r.position * r.impressions;
        cur.impressions += r.impressions;
        cur.clicks += r.clicks;
        cur.cost += r.cost;
        cur.conversions += r.conversions;
        agg.set(key, cur);
      }
      for (const v of agg.values()) {
        const ad = ads.find((a) => a.id === v.adId);
        const t = ad?.externalId ? trackedMap.get(`${ad.externalId}|${v.day}`) ?? 0 : 0;
        const conversions = Math.max(v.conversions, t);
        await db
          .insert(schema.statsDaily)
          .values({ id: uid("s_"), businessId: b.id, ...v, conversions })
          .onConflictDoUpdate({
            target: [schema.statsDaily.campaignId, schema.statsDaily.adId, schema.statsDaily.day],
            set: { impressions: v.impressions, clicks: v.clicks, cost: v.cost, conversions, tvWeighted: v.tvWeighted, posWeighted: v.posWeighted },
          });
      }

      // Аукцион на поиске: сколько стоит каждое место в выдаче (раз в сутки)
      if (client.getAuction) {
        const groups = await db.select().from(schema.adGroups).where(inArray(schema.adGroups.campaignId, list.map((c) => c.id)));
        for (const camp of list.filter((c) => c.channel === "search" && c.status === "active")) {
          const prev = (camp.meta as any)?.auction?.at as string | undefined;
          if (prev && Date.now() - new Date(prev).getTime() < 20 * 3600_000 && acc.platform !== "demo") continue;
          try {
            const rows = await client.getAuction(camp.externalId!);
            const mapped = rows
              .map((r) => ({ groupId: groups.find((g) => g.externalId === r.groupExt)?.id ?? null, keywords: r.keywords, tiers: r.tiers }))
              .filter((r) => r.groupId);
            await db.update(schema.campaigns).set({ meta: { ...(camp.meta ?? {}), auction: { at: new Date().toISOString(), groups: mapped } } }).where(eq(schema.campaigns.id, camp.id));
          } catch (e) {
            errors.push(`Аукцион: ${errorText(e)}`);
          }
        }
      }

      // Статусы модерации
      const live = ads.filter((a) => a.externalId && !["archived", "error"].includes(a.status));
      if (live.length) {
        const states = await client.getAdStates(live.map((a) => a.externalId!));
        for (const a of live) {
          const s = states[a.externalId!];
          if (!s) continue;
          // Площадка — источник правды: «paused» она отдаёт только для объявлений, остановленных вручную или роботом
          // (Директ: State SUSPENDED, VK: blocked). Если остановленное у нас объявление площадка показывает как активное,
          // значит его включили в кабинете — переводим в active, иначе оно навсегда выпадает из оптимизации.
          let next = s.status as string;
          if (s.status === "moderation" && a.status === "paused") next = "paused";
          if (next !== a.status || (s.note ?? null) !== a.statusNote) {
            await db.update(schema.ads).set({ status: next, statusNote: s.note ?? null }).where(eq(schema.ads.id, a.id));
          }
        }
      }
      if (acc.status !== "ok") await db.update(schema.adAccounts).set({ status: "ok", statusNote: null }).where(eq(schema.adAccounts.id, acc.id));
    } catch (e) {
      const msg = errorText(e);
      errors.push(msg);
      if (/токен|token|доступ|401|авториз/i.test(msg)) {
        await db.update(schema.adAccounts).set({ status: "error", statusNote: msg }).where(eq(schema.adAccounts.id, accountId));
      }
    }
  }
  return { errors };
}

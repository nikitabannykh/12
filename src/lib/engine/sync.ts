import "server-only";
import { and, eq, gte, inArray, isNull, or, sql, ne } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { Business, Campaign } from "../db/schema";
import { clientFor } from "../platforms";
import { PlatformError } from "../platforms/types";
import { demoNow } from "../platforms/demo";
import { addDays, errorText, isoDay, uid } from "../util";

/**
 * Доступ к кабинету потерян (токен отозван/истёк, нет прав), а не временный сбой: по кодам площадок, а не по тексту —
 * иначе «сервер недоступен» превращал кабинет в «ошибку доступа».
 * Директ: 53 — ошибка авторизации, 54 — нет прав, 58 — регистрация не закончена, 513 — логин не подключён к Директу
 * (52 — сервер авторизации временно недоступен — не наш случай). VK: 401/403 после обновления токена.
 */
const YANDEX_AUTH_CODES = new Set([53, 54, 58, 513]);
function isAuthError(e: unknown) {
  if (e instanceof PlatformError) {
    const code = Number((e.detail as { error_code?: unknown } | null | undefined)?.error_code);
    if (e.platform === "yandex" && YANDEX_AUTH_CODES.has(code)) return true;
    if (e.platform === "vk" && (e.httpStatus === 401 || e.httpStatus === 403)) return true;
  }
  const msg = errorText(e);
  // Без «доступ»: оно совпадает с «недоступен»
  return /invalid[_ ]token|не выдала доступ|доступ\S* к [^.]* истёк|подключите [^.]*заново|(^|[^а-яё])токен/i.test(msg);
}

/**
 * Забираем статистику и статусы модерации со всех площадок.
 * Кроме работающих кампаний берём и «error»/«creating»/«ready» с ID на площадке: такая кампания могла остаться
 * включённой (не удалась уборка после прерванного запуска) — её расход должен попасть в stats_daily,
 * иначе защита бюджета его не увидит.
 */
/** only: "states" — только статусы модерации (быстро: для проверки при открытии кабинета, без отчётов) */
export async function syncBusiness(b: Business, opts: { only?: "states" } = {}) {
  const statesOnly = opts.only === "states";
  const db = await getDb();
  const camps = await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, b.id), inArray(schema.campaigns.status, ["active", "paused", "error", "creating", "ready"])));
  const errors: string[] = [];
  // Кабинеты, где расход мог идти, а статистику получить не удалось: робот не должен поднимать лимиты «вслепую»
  const failedAccounts: string[] = [];
  const byAccount = new Map<string, Campaign[]>();
  for (const c of camps) if (c.externalId) byAccount.set(c.accountId, [...(byAccount.get(c.accountId) ?? []), c]);

  for (const [accountId, list] of byAccount) {
    const [acc] = await db.select().from(schema.adAccounts).where(eq(schema.adAccounts.id, accountId));
    if (!acc) continue;
    let client: Awaited<ReturnType<typeof clientFor>>;
    try {
      client = await clientFor(acc);
    } catch (e) {
      errors.push(errorText(e));
      if (list.some((c) => c.status === "active")) failedAccounts.push(accountId);
      if (isAuthError(e)) await db.update(schema.adAccounts).set({ status: "error", statusNote: errorText(e) }).where(eq(schema.adAccounts.id, accountId));
      continue;
    }
    // Шаги независимы: сбой аукциона или доставки не должен оставлять без статистики и статусов модерации
    let authErr: string | null = null;
    let reached = false; // статистика с площадки пришла — доступ точно есть
    const step = async (label: string, fn: () => Promise<void>) => {
      try {
        await fn();
        if (label === "Статистика") reached = true;
      } catch (e) {
        if (label === "Статистика" && list.some((c) => c.status === "active")) failedAccounts.push(accountId);
        const msg = errorText(e);
        errors.push(`${label}: ${msg}`);
        if (isAuthError(e)) authErr ??= msg;
      }
    };
    const now = acc.platform === "demo" ? await demoNow({ accountId: acc.id }) : new Date();
    // Площадки считают сутки по Москве: в 00:00–03:00 MSK UTC-дата ещё вчерашняя, и сегодняшний расход терялся
    const to = acc.platform === "demo" ? isoDay(now) : isoDay(new Date(now.getTime() + 3 * 3600e3));
    const from = isoDay(addDays(now, -29));
    const ads = await db.select().from(schema.ads).where(inArray(schema.ads.campaignId, list.map((c) => c.id)));
    const adByExt = new Map(ads.filter((a) => a.externalId).map((a) => [a.externalId!, a]));
    const campByExt = new Map(list.map((c) => [c.externalId!, c]));

    // Статистика
    if (!statesOnly) await step("Статистика", async () => {
      const goalIds = Object.values(b.goalIds ?? {}).length ? [b.goalIds.lead].filter(Boolean) as number[] : [];
      const rows = await client.getStats(list.map((c) => c.externalId!), from, to, goalIds);
      // Обращения с нашего счётчика по объявлениям (utm_content = ID объявления на площадке).
      // День — московский, как в статистике площадок
      const mskDay = sql<string>`to_char(${schema.leads.createdAt} AT TIME ZONE 'Europe/Moscow', 'YYYY-MM-DD')`;
      const tracked = await db
        .select({ adExt: schema.leads.adExt, day: mskDay, n: sql<number>`count(*)::int` })
        .from(schema.leads)
        .where(and(eq(schema.leads.businessId, b.id), ne(schema.leads.kind, "suspect"), or(isNull(schema.leads.status), ne(schema.leads.status, "spam")), gte(schema.leads.createdAt, new Date(from))))
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
    });

    // Аукцион на поиске: сколько стоит каждое место в выдаче (раз в сутки)
    if (client.getAuction && !statesOnly) {
      const getAuction = client.getAuction.bind(client);
      await step("Аукцион", async () => {
        const groups = await db.select().from(schema.adGroups).where(inArray(schema.adGroups.campaignId, list.map((c) => c.id)));
        for (const camp of list.filter((c) => c.channel === "search" && c.status === "active")) {
          const prev = (camp.meta as any)?.auction?.at as string | undefined;
          if (prev && Date.now() - new Date(prev).getTime() < 20 * 3600_000 && acc.platform !== "demo") continue;
          try {
            const rows = await getAuction(camp.externalId!);
            const mapped = rows
              .map((r) => ({ groupId: groups.find((g) => g.externalId === r.groupExt)?.id ?? null, keywords: r.keywords, tiers: r.tiers }))
              .filter((r) => r.groupId);
            await db.update(schema.campaigns).set({ meta: { ...(camp.meta ?? {}), auction: { at: new Date().toISOString(), groups: mapped } } }).where(eq(schema.campaigns.id, camp.id));
          } catch (e) {
            errors.push(`Аукцион: ${errorText(e)}`);
            if (isAuthError(e)) authErr ??= errorText(e);
          }
        }
      });
    }

    // Идёт ли показ на самом деле: включённая кампания может стоять (нет денег, модерация, лимит)
    if (client.getCampaignDelivery && !statesOnly) {
      const getDelivery = client.getCampaignDelivery.bind(client);
      await step("Состояние показа", async () => {
        const active = list.filter((c) => c.status === "active" && c.externalId);
        if (!active.length) return;
        const d = await getDelivery(active.map((c) => c.externalId!));
        for (const c of active) {
          const x = d[c.externalId!];
          if (!x) continue;
          const prev = (c.meta as { delivery?: { ok: boolean; note?: string } } | null)?.delivery;
          if (prev?.ok === x.ok && prev?.note === x.note) continue;
          const [fresh] = await db.select({ meta: schema.campaigns.meta }).from(schema.campaigns).where(eq(schema.campaigns.id, c.id));
          await db.update(schema.campaigns).set({ meta: { ...(fresh?.meta ?? {}), delivery: { ...x, at: new Date().toISOString() } } }).where(eq(schema.campaigns.id, c.id));
        }
      });
    }

    // Статусы модерации
    await step("Статусы объявлений", async () => {
      const live = ads.filter((a) => a.externalId && !["archived", "error"].includes(a.status));
      if (!live.length) return;
      const states = await client.getAdStates(live.map((a) => a.externalId!));
      const drafts: string[] = [];
      for (const a of live) {
        const s = states[a.externalId!];
        if (!s) continue;
        // Черновик (Директ) в работающей кампании: отправка на модерацию не прошла — отправляем снова.
        // В создающихся кампаниях черновики — норма: их отправит activateCampaign в конце запуска
        const camp = list.find((c) => c.id === a.campaignId);
        if (s.draft && camp?.status === "active" && a.status !== "paused") drafts.push(a.externalId!);
        // Площадка — источник правды: «paused» она отдаёт только для объявлений, остановленных вручную или роботом
        // (Директ: State SUSPENDED, VK: blocked). Если остановленное у нас объявление площадка показывает как активное,
        // значит его включили в кабинете — переводим в active, иначе оно навсегда выпадает из оптимизации.
        let next = s.status as string;
        if (s.status === "moderation" && a.status === "paused") next = "paused";
        if (next !== a.status || (s.note ?? null) !== a.statusNote) {
          await db.update(schema.ads).set({ status: next, statusNote: s.note ?? null }).where(eq(schema.ads.id, a.id));
        }
      }
      if (drafts.length && client.moderateAds) {
        for (const w of await client.moderateAds(drafts)) errors.push(`Модерация: ${w}`);
      }
    });

    if (authErr) await db.update(schema.adAccounts).set({ status: "error", statusNote: authErr }).where(eq(schema.adAccounts.id, accountId));
    else if (reached && acc.status !== "ok") await db.update(schema.adAccounts).set({ status: "ok", statusNote: null }).where(eq(schema.adAccounts.id, acc.id));
  }
  return { errors, failedAccounts };
}

/**
 * Офлайн-конверсии в Метрику: заявки, которые владелец отметил «Записался» и у которых есть ClientID Метрики или yclid.
 * Пачкой, раз в проход робота; уже загруженные помним в kv (mo:<бизнес>), чтобы не грузить дважды.
 * Без счётчика или без подключённого Директа (токен с правом metrika:write) — тихо пропускаем.
 * Цель pz_booked создаём при первой загрузке, если её нет (счётчики, созданные до её появления).
 */
const OFFLINE_DAYS = 21;
export async function syncOfflineConversions(b: Business): Promise<{ uploaded: number; skipped?: string; error?: string }> {
  if (!b.counterId) return { uploaded: 0, skipped: "нет счётчика Метрики" };
  const db = await getDb();
  const [acc] = await db.select().from(schema.adAccounts).where(and(eq(schema.adAccounts.userId, b.userId), eq(schema.adAccounts.platform, "yandex"), eq(schema.adAccounts.status, "ok")));
  if (!acc) return { uploaded: 0, skipped: "нет доступа к Яндексу (Метрике)" };
  const key = `mo:${b.id}`;
  const [kvRow] = await db.select().from(schema.kv).where(eq(schema.kv.key, key));
  const done = new Set(((kvRow?.value as { ids?: string[] } | null)?.ids ?? []));
  const rows = await db
    .select({ id: schema.leads.id, cid: schema.leads.metrikaClientId, yclid: schema.leads.yclid, statusAt: schema.leads.statusAt })
    .from(schema.leads)
    .where(and(eq(schema.leads.businessId, b.id), eq(schema.leads.status, "booked"), gte(schema.leads.statusAt, new Date(Date.now() - OFFLINE_DAYS * 864e5)), or(sql`${schema.leads.metrikaClientId} is not null`, sql`${schema.leads.yclid} is not null`)));
  const todo = rows.filter((r) => !done.has(r.id) && r.statusAt).slice(0, 500);
  if (!todo.length) return { uploaded: 0 };
  try {
    const { BOOKED_GOAL, ensureGoal, uploadOffline } = await import("../platforms/metrica");
    const { decrypt } = await import("../crypto");
    const token = decrypt(acc.accessToken);
    if (!b.goalIds?.booked) {
      const goalId = await ensureGoal(token, b.counterId, BOOKED_GOAL);
      const goalIds = { ...(b.goalIds ?? {}), booked: goalId };
      await db.update(schema.businesses).set({ goalIds }).where(eq(schema.businesses.id, b.id));
      b.goalIds = goalIds;
    }
    const r = await uploadOffline(token, b.counterId, BOOKED_GOAL.action, todo.map((x) => ({ clientId: x.cid, yclid: x.yclid, at: x.statusAt! })));
    const ids = [...done, ...todo.map((x) => x.id)].slice(-2000);
    await db.insert(schema.kv).values({ key, value: { ids, at: new Date().toISOString() } }).onConflictDoUpdate({ target: schema.kv.key, set: { value: { ids, at: new Date().toISOString() }, updatedAt: new Date() } });
    return { uploaded: r.uploaded };
  } catch (e) {
    return { uploaded: 0, error: errorText(e) };
  }
}

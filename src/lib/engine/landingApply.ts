import "server-only";
import { and, eq, inArray, isNotNull, notInArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { Business } from "../db/schema";
import { clientFor, CHANNEL_NAME } from "../platforms";
import { landingUrl, withUtm } from "./launch";
import { appUrl } from "../util";
import { logChange } from "./ops";
import { isMessenger } from "./landing";

/**
 * Новая ссылка «куда ведёт реклама» для уже идущих кампаний: меняем Href у объявлений на площадке
 * (Директ отправит их на повторную модерацию, VK — тоже может). Кампании, где ссылка не поменялась, не трогаем.
 */
export async function applyLanding(b: Business, prev?: Business, only?: (raw: string, oldHref: string | undefined) => boolean): Promise<{ updated: number; warnings: string[] }> {
  const db = await getDb();
  const camps = await db
    .select()
    .from(schema.campaigns)
    .where(and(eq(schema.campaigns.businessId, b.id), inArray(schema.campaigns.status, ["active", "paused"]), isNotNull(schema.campaigns.externalId)));
  const warnings: string[] = [];
  let updated = 0;
  for (const camp of camps) {
    const name = CHANNEL_NAME[camp.channel];
    const raw = landingUrl(b, camp.channel);
    const href = withUtm(raw, camp.platform);
    const meta = (camp.meta ?? {}) as { href?: string };
    if (meta.href === href) continue;
    if (only && !only(raw, meta.href)) continue;
    // Ссылку кампании ещё не запоминали — сравниваем с тем, куда реклама вела до изменения
    if (!meta.href && prev && withUtm(landingUrl(prev, camp.channel), camp.platform) === href) continue;
    try {
      const [acc] = await db.select().from(schema.adAccounts).where(eq(schema.adAccounts.id, camp.accountId));
      if (!acc) continue;
      const client = await clientFor(acc);
      if (!client.updateAdsHref) continue;
      const ads = await db
        .select({ ext: schema.ads.externalId })
        .from(schema.ads)
        .where(and(eq(schema.ads.campaignId, camp.id), isNotNull(schema.ads.externalId), notInArray(schema.ads.status, ["archived", "error"])));
      const exts = ads.map((a) => a.ext!).filter(Boolean);
      if (acc.platform === "yandex" && isMessenger(raw)) warnings.push(`${name}: Директ обычно не принимает ссылки на мессенджеры и соцсети как адрес объявления — объявления могут не пройти модерацию`);
      const w = exts.length ? await client.updateAdsHref(exts, href) : [];
      warnings.push(...w.map((x) => `${name}: ${x}`));
      await db.update(schema.campaigns).set({ meta: { ...(camp.meta ?? {}), href } }).where(eq(schema.campaigns.id, camp.id));
      updated++;
    } catch (e) {
      warnings.push(`${name}: ${(e as Error).message}`);
    }
  }
  return { updated, warnings };
}

/**
 * После переезда на новый адрес: объявления, которые ведут на страницу записи по старому адресу (LEGACY_ORIGINS),
 * переводим на новый. Только кампании, где реклама ведёт на нашу страницу записи (сайт владельца не трогаем) и где
 * ссылка старая или ещё не запоминалась. Один раз на бизнес (kv relink:<id>); площадки отправят объявления на модерацию.
 */
export async function relinkLegacy(): Promise<{ businesses: number; updated: number; warnings: string[] }> {
  const legacy = (process.env.LEGACY_ORIGINS ?? "").split(",").map((x) => x.trim().replace(/\/$/, "")).filter(Boolean);
  const out = { businesses: 0, updated: 0, warnings: [] as string[] };
  if (!legacy.length) return out;
  const db = await getDb();
  const bs = await db.select().from(schema.businesses).where(inArray(schema.businesses.status, ["active", "paused"]));
  const own = appUrl();
  for (const b of bs) {
    const key = `relink:${b.id}`;
    if ((await db.select({ k: schema.kv.key }).from(schema.kv).where(eq(schema.kv.key, key))).length) continue;
    try {
      const r = await applyLanding(b, undefined, (raw, old) => raw.startsWith(own) && (!old || legacy.some((o) => old.startsWith(o))));
      out.businesses++;
      out.updated += r.updated;
      out.warnings.push(...r.warnings);
      await db.insert(schema.kv).values({ key, value: { at: new Date().toISOString(), updated: r.updated } }).onConflictDoNothing();
      if (r.updated) {
        await logChange({
          businessId: b.id, actor: "robot", kind: "landing",
          title: "Ссылки объявлений перевели на новый адрес сервиса",
          reason: `Сервис переехал на серверы в России. Страница записи теперь открывается по адресу ${own}, и объявления ведут прямо туда — ${r.updated} ${r.updated === 1 ? "кампания" : "кампаний"}. Площадки заново проверят объявления — обычно это несколько часов.`,
        }).catch(() => null);
      }
    } catch (e) {
      out.warnings.push(`${b.name}: ${(e as Error).message}`);
    }
  }
  return out;
}

import { and, eq, inArray } from "drizzle-orm";
import { route, json, needBusiness } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { syncBusiness } from "@/lib/engine/sync";
import { hit } from "@/lib/ratelimit";
import { isLaunched } from "@/lib/util";

export const maxDuration = 30;

async function counts(businessId: string) {
  const db = await getDb();
  const rows = await db.select({ status: schema.ads.status, note: schema.ads.statusNote }).from(schema.ads)
    .where(and(eq(schema.ads.businessId, businessId), inArray(schema.ads.status, ["moderation", "rejected", "active"])));
  const n = (s: string) => rows.filter((r) => r.status === s).length;
  const blocked = rows.filter((r) => r.status === "active" && /^Не показывается/.test(r.note ?? "")).length;
  const camps = await db.select({ status: schema.campaigns.status, meta: schema.campaigns.meta }).from(schema.campaigns).where(eq(schema.campaigns.businessId, businessId));
  const notServing = camps.filter((c) => c.status === "active" && (c.meta as { delivery?: { ok?: boolean } } | null)?.delivery?.ok !== true).length;
  return { moderation: n("moderation"), active: n("active"), rejected: n("rejected"), blocked, notServing };
}

/**
 * Проверка модерации при открытии кабинета: пока есть объявления на проверке — забираем только их статусы
 * с площадок (без отчётов статистики), не чаще раза в 10 минут на бизнес. changed — статусы поменялись, страницу надо обновить.
 */
export const POST = route(async ({ business }) => {
  needBusiness(business);
  const before = await counts(business.id);
  // Проверяем, пока есть что ждать: модерация, «прошло, но не показывается» или кампании без подтверждённых показов
  if (!isLaunched(business.status) || !(before.moderation || before.blocked || before.notServing)) return json({ checked: false, changed: false, ...before });
  if (!(await hit(`modcheck:${business.id}`, 1, 600)).ok) return json({ checked: false, changed: false, ...before });
  await syncBusiness(business, { only: "states" }).catch((e) => console.error("modcheck", e));
  const after = await counts(business.id);
  const changed = after.moderation !== before.moderation || after.rejected !== before.rejected || after.active !== before.active || after.blocked !== before.blocked || after.notServing !== before.notServing;
  return json({ checked: true, changed, ...after });
});

import { and, eq, inArray } from "drizzle-orm";
import { route, json, needBusiness } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { syncBusiness } from "@/lib/engine/sync";
import { checkBalances } from "@/lib/engine/balance";
import { siteGuard } from "@/lib/engine/site-guard";
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
  // Только кампании, про которые площадка вообще сообщает состояние показа (Директ); демо и VK без этого — не считаем,
  // иначе страница опрашивала бы сервер каждые 30 секунд бесконечно
  const notServing = camps.filter((c) => { const d = (c.meta as { delivery?: { ok?: boolean } } | null)?.delivery; return c.status === "active" && d && d.ok !== true; }).length;
  // Подпись состояния показа: поменялась причина (пополнили счёт, проверили лицензию) — странице надо обновиться
  const sig = camps.map((c) => JSON.stringify((c.meta as { delivery?: { ok?: boolean; note?: string } } | null)?.delivery ?? null)).join("|");
  return { moderation: n("moderation"), active: n("active"), rejected: n("rejected"), blocked, notServing, sig };
}

/**
 * Проверка модерации при открытии кабинета: пока есть объявления на проверке — забираем только их статусы
 * с площадок (без отчётов статистики), не чаще раза в 10 минут на бизнес. changed — статусы поменялись, страницу надо обновить.
 */
export const POST = route(async ({ business }) => {
  needBusiness(business);
  // Пока кабинет открыт — проверяем, открывается ли сайт, куда ведёт реклама (не чаще раза в 3 минуты, см. site-guard)
  const sg = isLaunched(business.status) ? await siteGuard(business).catch(() => null) : null;
  const before = await counts(business.id);
  // Проверяем, пока есть что ждать: модерация, «прошло, но не показывается» или кампании без подтверждённых показов
  if (!isLaunched(business.status) || !(before.moderation || before.blocked || before.notServing)) return json({ checked: false, changed: false, fast: false, ...before, sig: undefined });
  // Реклама стоит (нет денег, ждёт лицензию) — клиент сейчас это чинит в кабинете площадки: проверяем каждые 20 секунд,
  // иначе (только модерация) — раз в 5 минут. Вебхуков о пополнении у Директа нет, поэтому опрашиваем сами
  const fast = before.notServing > 0 || before.blocked > 0;
  if (!(await hit(fast ? `modcheck-fast:${business.id}` : `modcheck:${business.id}`, 1, fast ? 20 : 300)).ok) return json({ checked: false, changed: false, fast, ...before, sig: undefined });
  await syncBusiness(business, { only: "states" }).catch((e) => console.error("modcheck", e));
  if (fast) await checkBalances(business, { force: true }).catch(() => null);
  const after = await counts(business.id);
  const changed = Boolean(sg && (sg.paused || sg.resumed)) || after.moderation !== before.moderation || after.rejected !== before.rejected || after.active !== before.active || after.blocked !== before.blocked || after.notServing !== before.notServing || after.sig !== before.sig;
  return json({ checked: true, changed, fast, ...after, sig: undefined });
});

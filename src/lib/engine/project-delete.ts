import "server-only";
import { and, eq, inArray, isNotNull, like } from "drizzle-orm";
import { getDb, schema } from "../db";
import { clientFor } from "../platforms";
import { listProjects, NEW_PROJECT, setCurrentProject } from "./launch";
import { tryLock, releaseLock, ROBOT_LOCK } from "./run";

/**
 * Удаление проекта (бизнеса) владельцем. Сначала останавливаем его кампании в кабинетах — чтобы реклама не тратила
 * деньги без присмотра робота. Сами кампании в Директе и VK не удаляем: там история и статистика владельца,
 * удалить их он может сам в кабинете. Потом стираем всё, что сервис хранил по проекту.
 * Возвращает предупреждения (кампании, которые не удалось остановить) и куда перейти дальше.
 */
export async function deleteProject(userId: string, businessId: string): Promise<{ warnings: string[]; next: string }> {
  const db = await getDb();
  const [b] = await db.select().from(schema.businesses).where(and(eq(schema.businesses.id, businessId), eq(schema.businesses.userId, userId)));
  if (!b) throw new Error("Такого проекта нет");
  // Берём блокировку робота: иначе параллельный проход мог бы снова включить кампанию или записать данные удаляемого проекта.
  // Блокировку не снимаем — строки jobs проекта удаляются вместе с ним
  if (!(await tryLock(b.id, ROBOT_LOCK, 5 * 60e3))) throw new Error("Робот сейчас работает с этим проектом — попробуйте удалить через пару минут");
  const warnings: string[] = [];
  const camps = await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, b.id), isNotNull(schema.campaigns.externalId)));
  for (const c of camps.filter((x) => x.status === "active" || x.status === "paused" || x.status === "creating")) {
    try {
      const [acc] = await db.select().from(schema.adAccounts).where(eq(schema.adAccounts.id, c.accountId));
      if (!acc || acc.platform === "demo") continue;
      await (await clientFor(acc)).setCampaignActive(c.externalId!, false);
    } catch (e) {
      warnings.push(`${c.name}: не удалось остановить (${(e as Error).message}) — остановите её в кабинете площадки`);
    }
  }
  // Хоть одну кампанию не удалось остановить — проект не стираем: без него робот не следил бы за тратами, а владелец
  // не видел бы, что реклама ещё идёт. Пусть остановит её в кабинете площадки и повторит удаление
  if (warnings.length) {
    await releaseLock(b.id, ROBOT_LOCK);
    throw new Error(`Проект не удалён: ${warnings.join("; ")}. Остановите кампании в кабинете площадки и удалите проект ещё раз.`);
  }
  const campIds = camps.map((c) => c.id).concat((await db.select({ id: schema.campaigns.id }).from(schema.campaigns).where(eq(schema.campaigns.businessId, b.id))).map((c) => c.id));
  if (campIds.length) await db.delete(schema.adGroups).where(inArray(schema.adGroups.campaignId, [...new Set(campIds)]));
  for (const t of [schema.ads, schema.campaigns, schema.images, schema.statsDaily, schema.metricaDaily, schema.metricaSlices, schema.experiments, schema.changes, schema.leads, schema.clientMarks, schema.jobs, schema.notifySettings]) {
    await db.delete(t).where(eq(t.businessId, b.id));
  }
  await db.delete(schema.kv).where(like(schema.kv.key, `%:${b.id.replace(/[\\%_]/g, "\\$&")}%`));
  await db.delete(schema.businesses).where(eq(schema.businesses.id, b.id));
  const rest = await listProjects(userId);
  await setCurrentProject(userId, rest[0]?.id ?? NEW_PROJECT);
  return { warnings, next: rest.length ? "/app" : "/app/start" };
}

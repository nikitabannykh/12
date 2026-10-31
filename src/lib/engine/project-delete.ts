import "server-only";
import { and, eq, inArray, isNotNull, like } from "drizzle-orm";
import { getDb, schema } from "../db";
import { clientFor } from "../platforms";
import { listProjects, NEW_PROJECT, setCurrentProject } from "./launch";

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

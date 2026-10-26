import "server-only";
import { and, eq, gte, inArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { Campaign } from "../db/schema";
import { demoNow } from "../platforms/demo";
import { isoDay, startOfMonth } from "../util";
import { daysLeftInMonth, monthKey, spendModel, type BudgetMeta, type SpendModel } from "./budget-plan";

/** Кампании бизнеса, которые ещё живы (не в архиве) */
export async function liveCampaigns(businessId: string) {
  const db = await getDb();
  return db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, businessId), inArray(schema.campaigns.status, ["active", "paused"])));
}

export const isDemo = (campaigns: Pick<Campaign, "platform">[]) => campaigns.some((c) => c.platform === "demo");

/** «Сейчас» для бизнеса: в демо — по его демо-часам */
export async function businessNow(businessId: string, campaigns?: Pick<Campaign, "platform">[]) {
  const camps = campaigns ?? (await liveCampaigns(businessId));
  return isDemo(camps) ? demoNow({ businessId }) : new Date();
}

export type BudgetState = { spent: number; remaining: number; daysLeft: number; model: SpendModel; month: string; demo: boolean };

/**
 * Сколько потрачено в этом месяце (включая сегодняшние траты, известные на сейчас) и сколько осталось.
 * Сегодняшний день считаем и в тратах, и в оставшихся днях — с запасом: его статистика ещё может вырасти.
 */
export async function budgetState(businessId: string, monthly: number, now: Date, campaigns: Pick<Campaign, "platform">[]): Promise<BudgetState> {
  const db = await getDb();
  const demo = isDemo(campaigns);
  const rows = await db
    .select({ cost: schema.statsDaily.cost })
    .from(schema.statsDaily)
    .where(and(eq(schema.statsDaily.businessId, businessId), gte(schema.statsDaily.day, isoDay(startOfMonth(now)))));
  const spent = rows.reduce((s, r) => s + r.cost, 0);
  return { spent, remaining: monthly - spent, daysLeft: daysLeftInMonth(now), model: spendModel(demo), month: monthKey(now), demo };
}

/** Дописать служебные пометки бюджета в meta кампании (читаем свежую строку — её могли поменять операции) */
export async function patchBudgetMeta(campaignId: string, patch: BudgetMeta) {
  const db = await getDb();
  const [row] = await db.select({ meta: schema.campaigns.meta }).from(schema.campaigns).where(eq(schema.campaigns.id, campaignId));
  if (!row) return null;
  const meta = { ...(row.meta ?? {}), ...patch };
  await db.update(schema.campaigns).set({ meta }).where(eq(schema.campaigns.id, campaignId));
  return meta;
}

/** Кампания стоит из-за бюджета (а не по решению владельца) — её можно включить, когда деньги появятся */
export function pausedForBudget(c: Pick<Campaign, "status" | "meta">) {
  const m = (c.meta ?? {}) as BudgetMeta;
  return c.status === "paused" && !!m.pausedByGuard && m.pausedBy !== "owner";
}

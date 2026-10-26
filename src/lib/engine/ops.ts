import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema, type DB } from "../db";
import type { Campaign, UndoOp } from "../db/schema";
import { clientFor } from "../platforms";
import { uid } from "../util";
import type { PlatformClient } from "../platforms/types";

/**
 * Любое изменение рекламы — это набор операций. Каждая операция, применяясь, возвращает обратную.
 * Обратные операции сохраняются в истории — по ним работает кнопка «Отменить».
 */
type Ctx = { db: DB; clients: Map<string, PlatformClient> };

async function ctx(): Promise<Ctx> {
  return { db: await getDb(), clients: new Map() };
}

async function platformFor(c: Ctx, campaign: Campaign): Promise<PlatformClient> {
  const cached = c.clients.get(campaign.accountId);
  if (cached) return cached;
  const [acc] = await c.db.select().from(schema.adAccounts).where(eq(schema.adAccounts.id, campaign.accountId));
  if (!acc) throw new Error("Рекламный кабинет отключён — подключите его снова в настройках");
  const cl = await clientFor(acc);
  c.clients.set(campaign.accountId, cl);
  return cl;
}

async function campaignById(c: Ctx, id: string) {
  const [row] = await c.db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id));
  if (!row) throw new Error("Кампания не найдена");
  return row;
}

async function goalFor(c: Ctx, campaign: Campaign) {
  const [b] = await c.db.select().from(schema.businesses).where(eq(schema.businesses.id, campaign.businessId));
  return b?.goalIds?.lead ?? null;
}

export async function applyOp(op: UndoOp, cx?: Ctx): Promise<UndoOp> {
  const c = cx ?? (await ctx());
  const db = c.db;
  switch (op.op) {
    case "campaignStatus": {
      const camp = await campaignById(c, op.campaignId);
      const prev = camp.status === "active" ? "active" : "paused";
      if (camp.externalId) await (await platformFor(c, camp)).setCampaignActive(camp.externalId, op.status === "active");
      await db.update(schema.campaigns).set({ status: op.status }).where(eq(schema.campaigns.id, camp.id));
      return { op: "campaignStatus", campaignId: camp.id, status: prev };
    }
    case "adStatus": {
      const [ad] = await db.select().from(schema.ads).where(eq(schema.ads.id, op.adId));
      if (!ad) throw new Error("Объявление не найдено");
      const camp = await campaignById(c, ad.campaignId);
      const prev = ad.status === "active" || ad.status === "moderation" ? "active" : "paused";
      if (ad.externalId) await (await platformFor(c, camp)).setAdsActive([ad.externalId], op.status === "active");
      const next = op.status === "active" ? (ad.status === "paused" ? "active" : ad.status === "archived" ? "active" : ad.status) : "paused";
      await db.update(schema.ads).set({ status: next }).where(eq(schema.ads.id, ad.id));
      return { op: "adStatus", adId: ad.id, status: prev };
    }
    case "groupStatus": {
      const [g] = await db.select().from(schema.adGroups).where(eq(schema.adGroups.id, op.groupId));
      if (!g) throw new Error("Группа не найдена");
      const camp = await campaignById(c, g.campaignId);
      const ads = op.adIds.length ? await db.select().from(schema.ads).where(inArray(schema.ads.id, op.adIds)) : [];
      const ext = ads.map((a) => a.externalId).filter(Boolean) as string[];
      if (ext.length) await (await platformFor(c, camp)).setAdsActive(ext, op.status === "active");
      if (ads.length) await db.update(schema.ads).set({ status: op.status }).where(inArray(schema.ads.id, ads.map((a) => a.id)));
      const prev = g.status === "active" ? "active" : "paused";
      await db.update(schema.adGroups).set({ status: op.status }).where(eq(schema.adGroups.id, g.id));
      return { op: "groupStatus", groupId: g.id, status: prev, adIds: op.adIds };
    }
    case "campaignBudget":
    case "campaignStrategy": {
      const camp = await campaignById(c, op.campaignId);
      const weeklyBudget = op.op === "campaignBudget" ? op.weeklyBudget : camp.weeklyBudget;
      const strategy = op.op === "campaignStrategy" ? op.strategy : (camp.strategy as "clicks" | "conversions");
      if (camp.externalId) {
        await (await platformFor(c, camp)).setBudget(camp.externalId, { channel: camp.channel as any, weeklyBudget, strategy, goalId: await goalFor(c, camp), bidCeiling: ceilingOf(camp) });
      }
      await db.update(schema.campaigns).set({ weeklyBudget, strategy }).where(eq(schema.campaigns.id, camp.id));
      return op.op === "campaignBudget"
        ? { op: "campaignBudget", campaignId: camp.id, weeklyBudget: camp.weeklyBudget }
        : { op: "campaignStrategy", campaignId: camp.id, strategy: camp.strategy as "clicks" | "conversions" };
    }
    case "bidCeiling": {
      const camp = await campaignById(c, op.campaignId);
      const prev = ceilingOf(camp);
      if (camp.externalId) {
        await (await platformFor(c, camp)).setBudget(camp.externalId, { channel: camp.channel as any, weeklyBudget: camp.weeklyBudget, strategy: camp.strategy as "clicks" | "conversions", goalId: await goalFor(c, camp), bidCeiling: op.value });
      }
      await db.update(schema.campaigns).set({ meta: { ...(camp.meta ?? {}), bidCeiling: op.value } }).where(eq(schema.campaigns.id, camp.id));
      return { op: "bidCeiling", campaignId: camp.id, value: prev };
    }
    case "addNegatives":
    case "removeNegatives": {
      const camp = await campaignById(c, op.campaignId);
      const cur = camp.negativeKeywords ?? [];
      const next = op.op === "addNegatives" ? [...new Set([...cur, ...op.words])] : cur.filter((w) => !op.words.includes(w));
      if (camp.externalId) await (await platformFor(c, camp)).setNegativeKeywords(camp.externalId, next);
      await db.update(schema.campaigns).set({ negativeKeywords: next }).where(eq(schema.campaigns.id, camp.id));
      const changed = op.op === "addNegatives" ? op.words.filter((w) => !cur.includes(w)) : op.words.filter((w) => cur.includes(w));
      return op.op === "addNegatives" ? { op: "removeNegatives", campaignId: camp.id, words: changed } : { op: "addNegatives", campaignId: camp.id, words: changed };
    }
    case "adText": {
      const [ad] = await db.select().from(schema.ads).where(eq(schema.ads.id, op.adId));
      if (!ad) throw new Error("Объявление не найдено");
      const camp = await campaignById(c, ad.campaignId);
      if (ad.externalId) await (await platformFor(c, camp)).updateAdText(ad.externalId, { title: op.title, title2: op.title2, text: op.text });
      await db.update(schema.ads).set({ title: op.title, title2: op.title2, text: op.text, status: ad.status === "rejected" ? "moderation" : ad.status }).where(eq(schema.ads.id, ad.id));
      return { op: "adText", adId: ad.id, title: ad.title, title2: ad.title2, text: ad.text };
    }
    case "monthlyBudget": {
      const [b] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, op.businessId));
      await db.update(schema.businesses).set({ monthlyBudget: op.monthlyBudget, updatedAt: new Date() }).where(eq(schema.businesses.id, op.businessId));
      return { op: "monthlyBudget", businessId: op.businessId, monthlyBudget: b?.monthlyBudget ?? op.monthlyBudget };
    }
  }
}

/** Применить набор операций; при ошибке — откатить уже применённые */
export async function applyOps(ops: UndoOp[]): Promise<UndoOp[]> {
  const c = await ctx();
  const inverse: UndoOp[] = [];
  try {
    for (const op of ops) inverse.unshift(await applyOp(op, c));
  } catch (e) {
    for (const inv of inverse) {
      try {
        await applyOp(inv, c);
      } catch {
        /* лучшее, что можем */
      }
    }
    throw e;
  }
  return inverse;
}

export type ChangeInput = {
  businessId: string;
  actor: "robot" | "owner";
  kind: string;
  title: string;
  reason: string;
  details?: Record<string, unknown>;
  undo?: UndoOp[] | null;
};

export async function logChange(ch: ChangeInput) {
  const db = await getDb();
  const id = uid("ch_");
  await db.insert(schema.changes).values({
    id,
    businessId: ch.businessId,
    actor: ch.actor,
    kind: ch.kind,
    title: ch.title,
    reason: ch.reason,
    details: ch.details ?? {},
    undo: ch.undo && ch.undo.length ? ch.undo : null,
  });
  return id;
}

/** Применить операции и записать в историю одним действием */
export async function act(ch: Omit<ChangeInput, "undo">, ops: UndoOp[]) {
  const inverse = await applyOps(ops);
  return logChange({ ...ch, undo: inverse });
}

export async function revertChange(businessId: string, changeId: string, actor: "owner" | "robot" = "owner") {
  const db = await getDb();
  const [ch] = await db.select().from(schema.changes).where(and(eq(schema.changes.id, changeId), eq(schema.changes.businessId, businessId)));
  if (!ch) throw new Error("Изменение не найдено");
  if (ch.revertedAt) throw new Error("Это изменение уже отменено");
  if (!ch.undo?.length) throw new Error("Это изменение нельзя отменить автоматически");
  const inverse = await applyOps(ch.undo);
  await db.update(schema.changes).set({ revertedAt: new Date() }).where(eq(schema.changes.id, ch.id));
  if (ch.kind === "test_start") {
    await db.update(schema.experiments).set({ status: "draw", result: "Тест отменён владельцем", finishedAt: new Date() }).where(eq(schema.experiments.id, String(ch.details?.experimentId ?? "")));
  }
  return logChange({
    businessId,
    actor,
    kind: "revert",
    title: `Отменено: ${ch.title.charAt(0).toLowerCase()}${ch.title.slice(1)}`,
    reason: "Вернули как было по вашей команде. Если передумаете — эту отмену тоже можно отменить.",
    details: { revertOf: ch.id },
    undo: inverse,
  });
}

export async function recentChanges(businessId: string, limit = 50) {
  const db = await getDb();
  return db.select().from(schema.changes).where(eq(schema.changes.businessId, businessId)).orderBy(desc(schema.changes.at)).limit(limit);
}

/** Потолок ставки на поиске, ₽ (null — без ограничения) */
export function ceilingOf(camp: { meta?: Record<string, unknown> | null }) {
  const v = camp.meta?.bidCeiling;
  return typeof v === "number" && v > 0 ? v : null;
}

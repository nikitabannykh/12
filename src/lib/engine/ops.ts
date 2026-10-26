import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema, type DB } from "../db";
import type { Campaign, Change, UndoOp } from "../db/schema";
import { clientFor } from "../platforms";
import { rub, uid } from "../util";
import type { PlatformClient } from "../platforms/types";
import { businessNow, budgetState, liveCampaigns } from "./budget-guard";
import { reserveFor } from "./budget-plan";
import { weeklyFromMonthly } from "./budget";

/**
 * Любое изменение рекламы — это набор операций. Каждая операция, применяясь, возвращает обратную.
 * Обратные операции сохраняются в истории — по ним работает кнопка «Отменить».
 */
type Who = "owner" | "robot";
type Ctx = { db: DB; clients: Map<string, PlatformClient>; who: Who };

async function ctx(who: Who = "robot"): Promise<Ctx> {
  return { db: await getDb(), clients: new Map(), who };
}

/** Ошибка, которую можно показать владельцу как есть (с HTTP-статусом) */
export const userError = (message: string, status = 400) => Object.assign(new Error(message), { status });

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
      // Запоминаем, кто поставил паузу: паузу владельца робот не снимает. Пометку «стоит из-за бюджета»
      // сбрасываем при любой смене статуса — робот ставит её заново сам, когда останавливает кампанию из-за бюджета.
      const meta = { ...(camp.meta ?? {}), pausedBy: op.status === "paused" ? c.who : null, pausedByGuard: null };
      await db.update(schema.campaigns).set({ status: op.status, meta }).where(eq(schema.campaigns.id, camp.id));
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
export async function applyOps(ops: UndoOp[], who: Who = "robot"): Promise<UndoOp[]> {
  const c = await ctx(who);
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
  actor: Who;
  kind: string;
  title: string;
  reason: string;
  details?: Record<string, unknown>;
  undo?: UndoOp[] | null;
  /** Какое изменение отменяет эта запись */
  revertOf?: string | null;
};

export async function logChange(ch: ChangeInput) {
  const db = await getDb();
  const id = uid("ch_");
  await db.insert(schema.changes).values({
    id,
    businessId: ch.businessId,
    // В демо время идёт по демо-часам бизнеса — иначе история и «защита решений владельца» живут в другом времени, чем статистика
    at: await businessNow(ch.businessId),
    actor: ch.actor,
    kind: ch.kind,
    title: ch.title,
    reason: ch.reason,
    details: ch.revertOf ? { ...(ch.details ?? {}), revertOf: ch.revertOf } : (ch.details ?? {}),
    undo: ch.undo && ch.undo.length ? ch.undo : null,
    revertOf: ch.revertOf ?? null,
  });
  return id;
}

/** Применить операции и записать в историю одним действием */
export async function act(ch: Omit<ChangeInput, "undo">, ops: UndoOp[]) {
  const inverse = await applyOps(ops, ch.actor);
  return logChange({ ...ch, undo: inverse });
}

// ─── Отмена изменений ───────────────────────────────────────────────────

/** Какие «поля» объектов трогает операция. Минус-слова — операции над множеством, они не перезаписывают чужое */
function opKeys(op: UndoOp): string[] {
  switch (op.op) {
    case "campaignStatus": return [`c:${op.campaignId}:status`];
    case "campaignBudget": return [`c:${op.campaignId}:weekly`];
    case "campaignStrategy": return [`c:${op.campaignId}:strategy`];
    case "bidCeiling": return [`c:${op.campaignId}:ceiling`];
    case "adStatus": return [`a:${op.adId}:status`];
    case "adText": return [`a:${op.adId}:text`];
    case "groupStatus": return [`g:${op.groupId}:status`, ...op.adIds.map((id) => `a:${id}:status`)];
    case "monthlyBudget": return [`b:${op.businessId}:monthly`];
    default: return [];
  }
}

/** Объект уже в том состоянии, в которое его вернёт операция — тогда более поздние изменения ей не мешают */
async function alreadyThere(op: UndoOp): Promise<boolean> {
  const db = await getDb();
  const camp = async (id: string) => (await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)))[0];
  const ad = async (id: string) => (await db.select().from(schema.ads).where(eq(schema.ads.id, id)))[0];
  switch (op.op) {
    case "campaignStatus": return (await camp(op.campaignId))?.status === op.status;
    case "campaignBudget": return (await camp(op.campaignId))?.weeklyBudget === op.weeklyBudget;
    case "campaignStrategy": return (await camp(op.campaignId))?.strategy === op.strategy;
    case "bidCeiling": { const c = await camp(op.campaignId); return !!c && ceilingOf(c) === op.value; }
    case "adStatus": {
      const a = await ad(op.adId);
      return !!a && (op.status === "paused" ? a.status === "paused" : a.status === "active" || a.status === "moderation");
    }
    case "adText": { const a = await ad(op.adId); return !!a && a.title === op.title && a.title2 === op.title2 && a.text === op.text; }
    case "monthlyBudget": return (await db.select().from(schema.businesses).where(eq(schema.businesses.id, op.businessId)))[0]?.monthlyBudget === op.monthlyBudget;
    default: return false;
  }
}

const revertTarget = (x: Change) => x.revertOf ?? (typeof x.details?.revertOf === "string" ? (x.details.revertOf as string) : null);

/** История бизнеса с «действует ли ещё изменение» (его не отменили, или отменили отмену) */
function historyIndex(all: Change[]) {
  const byId = new Map(all.map((x) => [x.id, x]));
  const revertsOf = new Map<string, Change>();
  for (const x of [...all].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const t = revertTarget(x);
    if (t) revertsOf.set(t, x); // последняя отмена
  }
  const memo = new Map<string, boolean>();
  const inEffect = (x: Change): boolean => {
    if (memo.has(x.id)) return memo.get(x.id)!;
    memo.set(x.id, true); // защита от циклов
    const r = revertsOf.get(x.id);
    const v = !x.revertedAt ? true : r ? !inEffect(r) : false;
    memo.set(x.id, v);
    return v;
  };
  return { byId, inEffect };
}

const shortDate = (d: Date) => d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" });

/**
 * Отмена хранит абсолютные «старые» значения. Если после этого изменения тот же объект менялся ещё раз
 * (и то изменение действует), отмена перезаписала бы более новое состояние — такое не делаем.
 */
async function assertNoNewerChanges(ch: Change, all: Change[], onlyKeys?: string[]) {
  const keys = new Set<string>();
  for (const op of ch.undo ?? []) {
    if (await alreadyThere(op)) continue;
    for (const k of opKeys(op)) if (!onlyKeys || onlyKeys.includes(k)) keys.add(k);
  }
  if (!keys.size) return;
  const { byId, inEffect } = historyIndex(all);
  const newer = all
    .filter((y) => y.id !== ch.id && y.at.getTime() > ch.at.getTime())
    .filter((y) => {
      const t = revertTarget(y);
      const target = t ? byId.get(t) : null;
      if (target && target.at.getTime() > ch.at.getTime()) return false; // пара «изменение + его отмена» после нашего — взаимно гасится
      return inEffect(y) && (y.undo ?? []).some((op) => opKeys(op).some((k) => keys.has(k)));
    })
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  if (newer.length) {
    const y = newer[0];
    throw userError(`Сначала отмените более позднее изменение: «${y.title}» (${shortDate(y.at)}). Иначе отмена перезапишет то, что поменяли после.`, 409);
  }
}

/** Не даём отменой включить рекламу или поднять лимиты сверх бюджета месяца */
async function assertFitsBudget(ch: Change) {
  const db = await getDb();
  const [b] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, ch.businessId));
  if (!b || b.status !== "active") return;
  const camps = await liveCampaigns(b.id);
  const after = new Map(camps.map((c) => [c.id, { status: c.status, weekly: c.weeklyBudget }]));
  let touches = false;
  for (const op of ch.undo ?? []) {
    const c = "campaignId" in op ? after.get(op.campaignId) : undefined;
    if (!c) continue;
    if (op.op === "campaignStatus" && op.status === "active" && c.status !== "active") { c.status = "active"; touches = true; }
    if (op.op === "campaignBudget" && op.weeklyBudget > c.weekly) { c.weekly = op.weeklyBudget; touches = true; }
  }
  if (!touches) return;
  const running = [...after.values()].filter((c) => c.status === "active");
  const weekly = running.reduce((s, c) => s + c.weekly, 0);
  if (weekly > weeklyFromMonthly(b.monthlyBudget) + 1) {
    throw userError(`После отмены недельные лимиты составят ${rub(weekly)} — это больше, чем позволяет бюджет ${rub(b.monthlyBudget)} в месяц. Сначала увеличьте бюджет в настройках.`);
  }
  const now = await businessNow(b.id, camps);
  const st = await budgetState(b.id, b.monthlyBudget, now, camps);
  if (st.remaining < reserveFor(weekly, st.daysLeft, st.model)) {
    throw userError(`Бюджет этого месяца почти израсходован: потрачено ${rub(st.spent)} из ${rub(b.monthlyBudget)}. Если включить рекламу, она выйдет за бюджет, и робот снова её остановит. Увеличьте бюджет в настройках — тогда реклама включится сама.`);
  }
}

/** Исходное изменение в цепочке «отмена отмены…» и что с ним делаем: undo — отменяем, redo — возвращаем */
function rootOf(ch: Change, byId: Map<string, Change>) {
  let x = ch, depth = 0;
  for (let t = revertTarget(x); t && byId.has(t) && depth < 50; t = revertTarget(x)) {
    x = byId.get(t)!;
    depth++;
  }
  return { root: x, action: depth % 2 === 0 ? ("undo" as const) : ("redo" as const) };
}

/** То, что не выражается операциями площадки: состояние тестов и отклонённых объявлений */
async function sideEffects(root: Change, action: "undo" | "redo", now: Date) {
  const db = await getDb();
  const d = root.details ?? {};
  if (root.kind === "test_start") {
    const ids = (Array.isArray(d.experimentIds) ? d.experimentIds : [d.experimentId]).filter((x): x is string => typeof x === "string" && !!x);
    if (!ids.length) return;
    if (action === "undo") {
      await db.update(schema.experiments).set({ status: "draw", result: "Тест отменён владельцем", finishedAt: now }).where(inArray(schema.experiments.id, ids));
      // Объявления возвращаются в обычную оптимизацию
      await db.update(schema.ads).set({ experimentId: null }).where(inArray(schema.ads.experimentId, ids));
    } else {
      await db.update(schema.experiments).set({ status: "running", result: null, finishedAt: null }).where(inArray(schema.experiments.id, ids));
      for (const ex of await db.select().from(schema.experiments).where(inArray(schema.experiments.id, ids))) {
        await db.update(schema.ads).set({ experimentId: ex.id }).where(inArray(schema.ads.id, [ex.controlId, ex.variantId]));
      }
    }
  }
  if (root.kind === "ad_new" && typeof d.oldAdId === "string") {
    // Замена отклонённого объявления: при отмене возвращаем старое (оно снова видно как «не прошло модерацию»)
    const [from, to] = action === "undo" ? ["archived", "rejected"] : ["rejected", "archived"];
    await db.update(schema.ads).set({ status: to }).where(and(eq(schema.ads.id, d.oldAdId), eq(schema.ads.status, from)));
  }
}

export async function revertChange(businessId: string, changeId: string, actor: Who = "owner") {
  const db = await getDb();
  const all = await db.select().from(schema.changes).where(eq(schema.changes.businessId, businessId));
  const ch = all.find((x) => x.id === changeId);
  if (!ch) throw userError("Изменение не найдено", 404);
  if (ch.revertedAt) throw userError("Это изменение уже отменено", 409);
  if (!ch.undo?.length) throw userError("Это изменение нельзя отменить автоматически");

  const monthly = ch.undo.find((o) => o.op === "monthlyBudget");
  // Смену месячного бюджета отменяем не «старыми лимитами», а пересчётом лимитов под прежний бюджет
  if (monthly && monthly.op === "monthlyBudget") await assertNoNewerChanges(ch, all, opKeys(monthly));
  else {
    await assertNoNewerChanges(ch, all);
    await assertFitsBudget(ch);
  }

  // Захватываем изменение атомарно: две вкладки не отменят его дважды
  const claimed = await db.update(schema.changes).set({ revertedAt: new Date() }).where(and(eq(schema.changes.id, ch.id), isNull(schema.changes.revertedAt))).returning({ id: schema.changes.id });
  if (!claimed.length) throw userError("Это изменение уже отменено", 409);
  const title = `Отменено: ${ch.title.charAt(0).toLowerCase()}${ch.title.slice(1)}`;
  try {
    if (monthly && monthly.op === "monthlyBudget") {
      const [b] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
      if (!b) throw userError("Бизнес не найден", 404);
      const { applyMonthlyBudget } = await import("./optimizer");
      return await applyMonthlyBudget(b, monthly.monthlyBudget, { actor, revert: { of: ch.id, title } });
    }
    const inverse = await applyOps(ch.undo, actor);
    const { byId } = historyIndex(all);
    const { root, action } = rootOf(ch, byId);
    await sideEffects(root, action, await businessNow(businessId));
    return await logChange({
      businessId,
      actor,
      kind: "revert",
      title,
      reason: "Вернули как было по вашей команде. Если передумаете — эту отмену тоже можно отменить.",
      undo: inverse,
      revertOf: ch.id,
    });
  } catch (e) {
    await db.update(schema.changes).set({ revertedAt: null }).where(eq(schema.changes.id, ch.id));
    throw e;
  }
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

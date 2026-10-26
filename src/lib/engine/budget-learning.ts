import type { Change } from "../db/schema";

/**
 * Период обучения площадки — одно правило для робота (не трогает настройки) и для значка «обучается» в кабинете.
 *
 * После запуска и после смены стратегии, бюджета или цены клика площадка заново подбирает аудиторию.
 * Обучение начинается с первых показов (но не раньше создания кампании), длится:
 *  - запуск: Директ — 14 дней, VK — 7;
 *  - смена стратегии: Директ — 14, VK — 7;
 *  - смена лимита или цены клика: 7.
 * Поправки защиты бюджета (details.guard) обучение не сбрасывают — иначе кампания училась бы вечно.
 */
export const LEARN_DAYS = { vk: 7, directLaunch: 14, directStrategy: 14, budget: 7 };
/** Сколько длится обучение после запуска — для подсказок */
export const LEARNING_DAYS: Record<string, number> = { vk: LEARN_DAYS.vk, search: LEARN_DAYS.directLaunch, network: LEARN_DAYS.directLaunch };
/** За сколько дней смотрим историю и статистику, чтобы найти начало обучения */
export const LEARN_LOOKBACK_DAYS = 45;

export type LearningInput = {
  now: Date;
  /** Изменения бизнеса (хватит последних LEARN_LOOKBACK_DAYS дней) */
  history: Pick<Change, "at" | "details" | "undo">[];
  /** Первый день с показами по кампании, YYYY-MM-DD */
  firstDay: Map<string, string>;
};

const DAY = 864e5;

/** Сколько дней ещё учится кампания (0 — обучение закончилось) */
export function learningLeft(c: { id: string; channel: string; createdAt: Date | string }, x: LearningInput): number {
  const vk = c.channel === "vk";
  const created = new Date(c.createdAt).getTime();
  const first = x.firstDay.get(c.id);
  // Показы до создания кампании (например, история демо-кабинета) обучение не сокращают
  const start = Math.max(created, first ? new Date(first + "T00:00:00Z").getTime() : created);
  const events: { at: number; days: number }[] = [{ at: start, days: vk ? LEARN_DAYS.vk : LEARN_DAYS.directLaunch }];
  for (const ch of x.history) {
    if ((ch.details as { guard?: unknown } | null)?.guard) continue;
    for (const op of ch.undo ?? []) {
      if (!("campaignId" in op) || op.campaignId !== c.id) continue;
      if (op.op === "campaignStrategy") events.push({ at: ch.at.getTime(), days: vk ? LEARN_DAYS.vk : LEARN_DAYS.directStrategy });
      if (op.op === "campaignBudget" || op.op === "bidCeiling") events.push({ at: ch.at.getTime(), days: vk ? LEARN_DAYS.vk : LEARN_DAYS.budget });
    }
  }
  const left = Math.max(...events.map((e) => e.at + e.days * DAY - x.now.getTime()));
  return left > 0 ? Math.ceil(left / DAY) : 0;
}

/** Первый день с показами по каждой кампании */
export function firstDays(rows: { campaignId: string; day: string | Date; impressions: number }[]) {
  const out = new Map<string, string>();
  for (const r of rows) {
    if (r.impressions <= 0) continue;
    const d = typeof r.day === "string" ? r.day.slice(0, 10) : r.day.toISOString().slice(0, 10);
    if (!out.has(r.campaignId) || d < out.get(r.campaignId)!) out.set(r.campaignId, d);
  }
  return out;
}

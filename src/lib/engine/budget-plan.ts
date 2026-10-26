import type { Channel } from "../platforms/types";
import { daysInMonth } from "../util";
import { MIN_WEEKLY, PRIORITY } from "./budget";

/**
 * Чистая математика бюджета месяца — без базы и площадок.
 *
 * Гарантия: до конца месяца реклама не может потратить больше остатка.
 *  1) недельные лимиты подбираем так, чтобы Σ(лимит/7) × оставшиеся дни ≤ остаток;
 *  2) если минимальные лимиты площадок в остаток не помещаются — отключаем наименее важный канал;
 *  3) если не помещается даже один канал — реклама работает, пока до следующей проверки
 *     она гарантированно не успеет потратить больше остатка, и останавливается заранее.
 */

/** Как быстро тратятся деньги между проверками робота */
export type SpendModel = {
  /** Сколько дней трат может пройти до следующей проверки (интервал проверки + задержка статистики) */
  horizonDays: number;
  /** Во сколько раз дневной расход может превысить лимит/7 */
  peak: number;
};

/**
 * Проверка раз в сутки, статистика за сегодня ещё может измениться — до следующей проверки
 * успевают пройти до 2 дней трат «вслепую». Демо тратит не больше лимита/7, а Директ и VK
 * в отдельные дни тратят больше средней недельной доли.
 */
export const spendModel = (demo: boolean): SpendModel => (demo ? { horizonDays: 2, peak: 1 } : { horizonDays: 2, peak: 1.3 });

export const monthKey = (d: Date) => d.toISOString().slice(0, 7);

/** Сколько дней месяца ещё могут тратиться деньги, включая сегодняшний */
export const daysLeftInMonth = (now: Date) => daysInMonth(now) - now.getUTCDate() + 1;

/** Недельный лимит (сумма по каналам), при котором остаток точно хватит до конца месяца */
export const fitWeekly = (remaining: number, daysLeft: number) => (daysLeft <= 0 ? 0 : Math.floor((Math.max(0, remaining) / daysLeft) * 7));

/** Обычный недельный лимит для этого месяца: бюджет ровно на все его дни */
export const monthWeekly = (monthly: number, now: Date) => Math.floor((monthly / daysInMonth(now)) * 7);

/** Сколько реклама успеет потратить до следующей проверки (с запасом) */
export const reserveFor = (weeklyTotal: number, daysLeft: number, m: SpendModel) => (weeklyTotal / 7) * Math.min(m.horizonDays, Math.max(daysLeft, 0)) * m.peak;

export type PlanItem = {
  id: string;
  channel: Channel;
  want: number;
  /** Лимит менял владелец — оставляем как есть (только если он не помещается в бюджет, режем вместе со всеми) */
  fixed?: boolean;
};
export type Plan = {
  weekly: Map<string, number>;
  /** Кампании, на которые бюджета не хватает (минимум площадки не помещается) */
  dropped: string[];
  /** Даже один оставшийся канал не помещается в лимит — держится на минимуме, страхует пауза */
  short: boolean;
};

const rank = (c: Channel) => PRIORITY.indexOf(c);
const minOf = (i: PlanItem) => MIN_WEEKLY[i.channel];
const sum = (list: PlanItem[], f: (i: PlanItem) => number) => list.reduce((s, i) => s + f(i), 0);

/**
 * Разложить общий недельный лимит total по кампаниям пропорционально want.
 *
 * up=false — робот в середине месяца только снижает лимиты: пропорционально, но не ниже минимума площадки;
 *   канал отключаем, только если минимумы всех каналов не помещаются в total.
 * up=true — раскладка бюджета заново (владелец сменил бюджет, начался месяц): лимиты масштабируются под total,
 *   и, как при запуске, канал, чья доля заметно меньше минимума площадки, отключаем — начиная с наименее важного.
 */
export function planLimits(items: PlanItem[], total: number, up = false): Plan {
  let pool = [...items].sort((a, b) => rank(a.channel) - rank(b.channel));
  const dropped: string[] = [];
  const drop = (id: string) => {
    dropped.push(id);
    pool = pool.filter((i) => i.id !== id);
  };
  if (up) {
    for (;;) {
      const free = pool.filter((i) => !i.fixed);
      const left = total - sum(pool.filter((i) => i.fixed), (i) => i.want);
      const k = left / Math.max(1, sum(free, (i) => Math.max(i.want, 1)));
      // Доля чуть ниже минимума (до 10 %) — не повод отключать канал: поднимем до минимума за счёт остальных
      const short = free.filter((i) => Math.max(i.want, 1) * k < minOf(i) * 0.9);
      if (!short.length || pool.length === 1) break;
      drop(short[short.length - 1].id);
    }
  }
  while (pool.length > 1 && sum(pool, minOf) > total) drop(pool[pool.length - 1].id);
  const weekly = new Map<string, number>();
  if (!pool.length) return { weekly, dropped, short: false };
  if (pool.length === 1 && minOf(pool[0]) > total) {
    weekly.set(pool[0].id, minOf(pool[0]));
    return { weekly, dropped, short: true };
  }
  // Сначала — лимиты владельца, если помещаются вместе с минимумами остальных
  const fixedSum = sum(pool.filter((i) => i.fixed), (i) => Math.max(i.want, minOf(i)));
  const keepFixed = fixedSum + sum(pool.filter((i) => !i.fixed), minOf) <= total;
  const flex = keepFixed ? pool.filter((i) => !i.fixed) : pool;
  if (keepFixed) for (const i of pool.filter((x) => x.fixed)) weekly.set(i.id, Math.max(i.want, minOf(i)));
  const budget = keepFixed ? total - fixedSum : total;
  // «Водяное заполнение»: кто ниже минимума — поднимаем до минимума, остальные делят остаток пропорционально
  const atMin = new Set<string>();
  for (;;) {
    const free = flex.filter((i) => !atMin.has(i.id));
    const left = budget - sum(flex.filter((i) => atMin.has(i.id)), minOf);
    const wantSum = sum(free, (i) => Math.max(i.want, 1));
    const k = wantSum ? (up ? left / wantSum : Math.min(1, left / wantSum)) : 0;
    const below = free.filter((i) => Math.floor(Math.max(i.want, 1) * k) < minOf(i));
    if (!below.length) {
      for (const i of free) weekly.set(i.id, Math.floor(Math.max(i.want, 1) * k));
      for (const i of flex.filter((x) => atMin.has(x.id))) weekly.set(i.id, minOf(i));
      return { weekly, dropped, short: false };
    }
    for (const i of below) atMin.add(i.id);
  }
}

/** Служебные пометки бюджета в campaigns.meta */
export type BudgetMeta = {
  /** Месяц (YYYY-MM), в котором робот остановил кампанию из-за бюджета */
  pausedByGuard?: string | null;
  /** Кто поставил кампанию на паузу последним: решение владельца робот не отменяет */
  pausedBy?: "owner" | "robot" | null;
  /** Лимит до того, как робот снизил его ради бюджета, и лимит, который он поставил */
  guardCutFrom?: number | null;
  guardCutTo?: number | null;
};

export const budgetMeta = (c: { meta?: Record<string, unknown> | null }) => (c.meta ?? {}) as BudgetMeta;

/**
 * «Обычный» лимит кампании — к нему её вернут, когда бюджет позволит. Если робот менял лимит ради бюджета
 * и после никто его не трогал, обычный лимит хранится отдельно; иначе это текущий лимит.
 * Он может быть и ниже минимума площадки — это доля канала в бюджете; минимум добавит planLimits.
 */
export function restoreTarget(c: { weeklyBudget: number; meta?: Record<string, unknown> | null }) {
  const m = budgetMeta(c);
  return typeof m.guardCutFrom === "number" && m.guardCutTo === c.weeklyBudget ? m.guardCutFrom : c.weeklyBudget;
}

/** Пометки после изменения лимита роботом: запоминаем «обычный» лимит, чтобы потом вернуть */
export function cutMeta(c: { weeklyBudget: number; meta?: Record<string, unknown> | null }, next: number, normal = restoreTarget(c)): BudgetMeta {
  return next !== normal ? { guardCutFrom: normal, guardCutTo: next } : { guardCutFrom: null, guardCutTo: null };
}

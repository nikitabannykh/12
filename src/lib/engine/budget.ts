import type { Channel } from "../platforms/types";

/** Минимальный бюджет площадок в неделю, ₽ */
export const MIN_WEEKLY: Record<Channel, number> = {
  search: 370, // автостратегия Директа: 300 ₽ без НДС (лимит уходит в Директ за вычетом НДС)
  network: 370,
  vk: 700, // дневной бюджет VK — от 100 ₽
};

export const WEEKS_IN_MONTH = 30.4 / 7;
/** Самый длинный месяц — по нему считаем минимальный бюджет, чтобы минимум площадки помещался в любой месяц */
const WEEKS_IN_LONG_MONTH = 31 / 7;
/** Верхняя граница месячного бюджета (как в анкете бизнеса) */
export const MAX_MONTHLY = 5_000_000;
export const weeklyFromMonthly = (m: number) => Math.floor(m / WEEKS_IN_MONTH);

// Доли по умолчанию: поиск ловит готовый спрос и обычно даёт самых дешёвых клиентов для услуг «рядом»,
// картинки в РСЯ и VK — охват и узнаваемость, часть бюджета на проверку гипотез
const WEIGHTS: Record<Channel, number> = { search: 0.5, network: 0.25, vk: 0.25 };
/** Порядок важности каналов: при нехватке бюджета первым отключаем последний */
export const PRIORITY: Channel[] = ["search", "network", "vk"];

export type Allocation = { channel: Channel; weekly: number; share: number }[];

export function allocate(monthly: number, available: Channel[]): { allocation: Allocation; dropped: Channel[] } {
  let channels = PRIORITY.filter((c) => available.includes(c));
  const dropped: Channel[] = [];
  const weekly = weeklyFromMonthly(monthly);
  for (;;) {
    const wsum = channels.reduce((s, c) => s + WEIGHTS[c], 0);
    const alloc = channels.map((c) => ({ channel: c, weekly: Math.floor((weekly * WEIGHTS[c]) / wsum), share: WEIGHTS[c] / wsum }));
    const short = alloc.filter((a) => a.weekly < MIN_WEEKLY[a.channel]);
    if (!short.length || channels.length === 1) {
      // Один канал ниже минимума площадки — бюджет меньше minMonthlyFor; сервер такой бюджет не принимает
      return { allocation: alloc, dropped };
    }
    // Бюджета не хватает на все каналы — убираем наименее приоритетный
    const drop = [...channels].reverse().find((c) => short.some((s) => s.channel === c))!;
    dropped.push(drop);
    channels = channels.filter((c) => c !== drop);
  }
}

/** Самый важный из каналов — он работает при любом допустимом бюджете */
export function firstChannel(channels: Channel[]): Channel {
  return PRIORITY.find((c) => channels.includes(c)) ?? "search";
}

/** Минимальный бюджет в месяц: должен поместиться минимальный недельный лимит хотя бы одного (самого важного) канала */
export function minMonthlyFor(channels: Channel[]) {
  return Math.ceil((MIN_WEEKLY[firstChannel(channels)] * WEEKS_IN_LONG_MONTH) / 100) * 100;
}

/** Грубый прогноз обращений в месяц — для подсказки при выборе бюджета */
export function forecast(monthly: number, niche: string) {
  // Средняя стоимость обращения по нишам для малых городов и районов мегаполисов (интервью и открытые кейсы), ₽
  const cpl: Record<string, [number, number]> = {
    nails: [250, 600], brows: [250, 600], hair: [350, 900], barber: [300, 700], massage: [400, 1000],
    cosmetology: [600, 1500], yoga: [400, 1100], fitness: [500, 1300], dance: [400, 1000], other: [400, 1200],
  };
  const [lo, hi] = cpl[niche] ?? cpl.other;
  return { min: Math.max(0, Math.floor(monthly / hi)), max: Math.max(1, Math.floor(monthly / lo)), cplLo: lo, cplHi: hi };
}

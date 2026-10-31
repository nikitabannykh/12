import type { Channel } from "../platforms/types";

/** Минимальный бюджет площадок в неделю, ₽ */
export const MIN_WEEKLY: Record<Channel, number> = {
  search: 370, // автостратегия Директа: 300 ₽ без НДС (лимит уходит в Директ за вычетом НДС)
  network: 370,
  // Дневной бюджет VK — от 100 ₽ без НДС. Лимит уходит в VK за вычетом НДС (÷1,22), а расход считаем с НДС,
  // поэтому минимум — 100 × 1,22 = 122 ₽ в день, 854 ₽ в неделю
  vk: 854,
  // Ретаргетинг — отдельные кампании с теми же минимумами площадок
  retarget_yandex: 370,
  retarget_vk: 854,
};

export const WEEKS_IN_MONTH = 30.4 / 7;
/** Самый длинный месяц — по нему считаем минимальный бюджет, чтобы минимум площадки помещался в любой месяц */
const WEEKS_IN_LONG_MONTH = 31 / 7;
/** Верхняя граница месячного бюджета (как в анкете бизнеса) */
export const MAX_MONTHLY = 5_000_000;
export const weeklyFromMonthly = (m: number) => Math.floor(m / WEEKS_IN_MONTH);

// Доли по умолчанию: поиск ловит готовый спрос и обычно даёт самых дешёвых клиентов для услуг «рядом»,
// картинки в РСЯ и VK — охват и узнаваемость, часть бюджета на проверку гипотез.
// Ретаргетинг — небольшая доля (≈ 6 % на площадку, 10–12 % вместе): аудитория «были, но не записались» маленькая,
// и больше она не потратит. Он последний по важности — при нехватке бюджета отключается первым.
const WEIGHTS: Record<Channel, number> = { search: 0.5, network: 0.25, vk: 0.25, retarget_yandex: 0.07, retarget_vk: 0.07 };
/** Порядок важности каналов: при нехватке бюджета первым отключаем последний */
export const PRIORITY: Channel[] = ["search", "network", "vk", "retarget_yandex", "retarget_vk"];

export type Allocation = { channel: Channel; weekly: number; share: number }[];

/**
 * Сколько в неделю нужно каналу, чтобы автостратегия набрала данных и обучилась (а не просто «минимум площадки»).
 * При маленьком бюджете лучше один поиск, чем поиск + РСЯ + VK по 300 ₽: каналы не обучатся, а деньги размажутся.
 */
const USEFUL_WEEKLY: Record<Channel, number> = { search: MIN_WEEKLY.search, network: 1500, vk: 1500, retarget_yandex: 700, retarget_vk: 700 };

export function allocate(monthly: number, available: Channel[]): { allocation: Allocation; dropped: Channel[] } {
  let channels = PRIORITY.filter((c) => available.includes(c));
  const dropped: Channel[] = [];
  const weekly = weeklyFromMonthly(monthly);
  for (;;) {
    const wsum = channels.reduce((s, c) => s + WEIGHTS[c], 0);
    const alloc = channels.map((c) => ({ channel: c, weekly: Math.floor((weekly * WEIGHTS[c]) / wsum), share: WEIGHTS[c] / wsum }));
    // Главный канал держим при любом допустимом бюджете; остальные — только если им хватает на обучение
    const short = alloc.filter((a) => a.weekly < (a.channel === channels[0] ? MIN_WEEKLY[a.channel] : Math.max(MIN_WEEKLY[a.channel], USEFUL_WEEKLY[a.channel])));
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

export type Range = [number, number];

/**
 * Допущения прогноза по нишам — всё, что в прогнозе НЕ из данных, собрано здесь. Источники: интервью с владельцами,
 * открытые кейсы агентств по Директу для услуг «рядом» (2024–2026), справка Директа о ценах клика. Для городов-миллионников
 * без Москвы и Петербурга (их цены — CITY_CPC_FACTOR). После запуска робот считает по настоящим данным аукциона.
 *
 *  cpc  — цена клика на поиске, ₽ (с НДС, так платит владелец);
 *  ctr  — доля целевых запросов месяца, которые станут НАШИМИ кликами: объявление показывается не на каждом запросе
 *         (аукцион, места, расписание), а из увиденных кликают 5–12 %; итог — несколько процентов всего спроса;
 *  conv — доля посетителей, которые записываются или звонят (страница записи / сайт);
 *  cpl  — цена обращения, ₽: для каналов без измеримого спроса (РСЯ, VK, ретаргетинг) и грубой оценки без Wordstat.
 */
export const FORECAST: Record<string, { cpc: Range; ctr: Range; conv: Range; cpl: Range }> = {
  nails: { cpc: [25, 60], ctr: [0.04, 0.09], conv: [0.06, 0.12], cpl: [250, 600] },
  brows: { cpc: [25, 60], ctr: [0.04, 0.09], conv: [0.06, 0.12], cpl: [250, 600] },
  hair: { cpc: [30, 70], ctr: [0.04, 0.08], conv: [0.05, 0.1], cpl: [350, 900] },
  barber: { cpc: [25, 60], ctr: [0.04, 0.09], conv: [0.06, 0.12], cpl: [300, 700] },
  massage: { cpc: [35, 90], ctr: [0.04, 0.08], conv: [0.05, 0.1], cpl: [400, 1000] },
  cosmetology: { cpc: [50, 140], ctr: [0.03, 0.07], conv: [0.04, 0.08], cpl: [600, 1500] },
  yoga: { cpc: [30, 80], ctr: [0.03, 0.07], conv: [0.04, 0.09], cpl: [400, 1100] },
  fitness: { cpc: [40, 110], ctr: [0.03, 0.07], conv: [0.03, 0.08], cpl: [500, 1300] },
  dance: { cpc: [30, 80], ctr: [0.03, 0.07], conv: [0.04, 0.09], cpl: [400, 1000] },
  other: { cpc: [40, 100], ctr: [0.03, 0.07], conv: [0.04, 0.09], cpl: [400, 1200] },
  // Медицинские услуги (остеопатия, мануальная терапия, лечебный массаж — в анкете ниша «Массаж» или «Другое», isMedical):
  // аукцион дороже (клиники), решение о записи взвешеннее, приём дороже — и обращение дороже
  medical: { cpc: [60, 120], ctr: [0.03, 0.07], conv: [0.05, 0.1], cpl: [800, 2000] },
};

/** Цена клика в Москве и Петербурге выше, чем в остальных городах (те же кейсы, Москва ≈ ×1,6) */
const CITY_CPC_FACTOR: Record<number, number> = { 213: 1.6, 1: 1.6, 2: 1.3, 10174: 1.3 };

export function forecastAssumptions(niche: string, medical = false, regionIds: number[] = []) {
  const a = medical ? FORECAST.medical : FORECAST[niche] ?? FORECAST.other;
  const k = Math.max(1, ...regionIds.map((r) => CITY_CPC_FACTOR[r] ?? 1));
  return { ...a, cpc: [Math.round(a.cpc[0] * k), Math.round(a.cpc[1] * k)] as Range };
}

/** Грубый прогноз обращений в месяц — для подсказки при выборе бюджета, когда спроса из Wordstat нет */
export function forecast(monthly: number, niche: string, medical = false) {
  const [lo, hi] = (medical ? FORECAST.medical : FORECAST[niche] ?? FORECAST.other).cpl;
  return { min: Math.max(0, Math.floor(monthly / hi)), max: Math.max(1, Math.floor(monthly / lo)), cplLo: lo, cplHi: hi };
}

export type DemandForecast = {
  kind: "demand";
  /** Поиск: спрос — данные (Wordstat), остальное — допущения FORECAST */
  search: {
    demand: number; budget: number; cpc: Range; ctr: Range; conv: Range;
    /** Кликов позволяет спрос (спрос × ctr) и бюджет (бюджет / cpc) */
    reachable: Range; affordable: Range; clicks: Range; leads: Range;
    /** Что ограничивает: бюджет (спроса больше), спрос (бюджет выбирается не весь) или оба примерно равны */
    limit: "budget" | "demand" | "both";
    /** Сколько поиск потратит за месяц, ₽ (меньше бюджета, когда упираемся в спрос) */
    spend: Range;
  };
  /** РСЯ, VK, ретаргетинг: бюджет / цена обращения по нише */
  other: { budget: number; cpl: Range; leads: Range; channels: Channel[] } | null;
  leads: Range;
};
export type RoughForecast = { kind: "rough"; leads: Range; cpl: Range };

/**
 * Прогноз на месяц со спросом. Поиск: кликов не больше, чем даёт спрос (спрос × ctr), и не больше, чем позволяет бюджет
 * (бюджет / цена клика); обращения = клики × conv. Нижняя граница — от осторожных допущений (дорогой клик, низкий ctr
 * и conv), верхняя — от оптимистичных. Остальные каналы — по цене обращения в нише. Нет спроса — грубая оценка (forecast).
 */
export function forecastWithDemand(p: { monthly: number; niche: string; medical?: boolean; regionIds?: number[]; allocation: Allocation; demand: number | null }): DemandForecast | RoughForecast {
  const a = forecastAssumptions(p.niche, p.medical, p.regionIds);
  const s = p.allocation.find((x) => x.channel === "search");
  if (p.demand === null || !s) {
    const f = forecast(p.monthly, p.niche, p.medical);
    return { kind: "rough", leads: [f.min, f.max], cpl: [f.cplLo, f.cplHi] };
  }
  const budget = Math.round(s.weekly * WEEKS_IN_MONTH);
  const reachable: Range = [p.demand * a.ctr[0], p.demand * a.ctr[1]];
  const affordable: Range = [budget / a.cpc[1], budget / a.cpc[0]];
  const clicks: Range = [Math.min(reachable[0], affordable[0]), Math.min(reachable[1], affordable[1])];
  const leads: Range = [clicks[0] * a.conv[0], clicks[1] * a.conv[1]];
  const midA = (affordable[0] + affordable[1]) / 2, midR = (reachable[0] + reachable[1]) / 2;
  const limit: DemandForecast["search"]["limit"] =
    affordable[0] >= reachable[1] || midA > midR * 1.25 ? "demand" : reachable[0] >= affordable[1] || midR > midA * 1.25 ? "budget" : "both";
  const spend: Range = [Math.min(budget, clicks[0] * a.cpc[0]), Math.min(budget, clicks[1] * a.cpc[1])];
  const rest = p.allocation.filter((x) => x.channel !== "search");
  const otherBudget = Math.round(rest.reduce((n, x) => n + x.weekly, 0) * WEEKS_IN_MONTH);
  const other = rest.length && otherBudget > 0 ? { budget: otherBudget, cpl: a.cpl, leads: [otherBudget / a.cpl[1], otherBudget / a.cpl[0]] as Range, channels: rest.map((x) => x.channel) } : null;
  const r = (x: Range): Range => [Math.floor(x[0]), Math.max(Math.floor(x[0]), Math.round(x[1]))];
  return {
    kind: "demand",
    search: { demand: p.demand, budget, cpc: a.cpc, ctr: a.ctr, conv: a.conv, reachable: r(reachable), affordable: r(affordable), clicks: r(clicks), leads: r(leads), limit, spend: r(spend) },
    other: other ? { ...other, leads: r(other.leads) } : null,
    leads: r([leads[0] + (other?.leads[0] ?? 0), leads[1] + (other?.leads[1] ?? 0)]),
  };
}

/**
 * Сколько нужно в месяц, чтобы поиск забрал почти весь спрос: середина достижимых кликов (спрос × ctr) по средней
 * цене клика — это доля поиска; общий бюджет — она, делённая на долю поиска в раскладке. Округляем вверх до 1 000 ₽.
 * Оценка на допущениях FORECAST, как и прогноз.
 */
export function recommendedBudget(p: { demand: number; niche: string; medical?: boolean; regionIds?: number[]; searchShare: number; minMonthly: number }) {
  const a = forecastAssumptions(p.niche, p.medical, p.regionIds);
  const clicks = (p.demand * (a.ctr[0] + a.ctr[1])) / 2;
  const cpc = (a.cpc[0] + a.cpc[1]) / 2;
  const search = clicks * cpc;
  const share = p.searchShare > 0 ? p.searchShare : 1;
  const monthly = Math.min(MAX_MONTHLY, Math.max(p.minMonthly, Math.ceil(search / share / 1000) * 1000));
  // Достижимые клики — тот же диапазон, что в прогнозе (спрос × ctr): прогноз не обещает кликов больше, чем здесь
  const reachable: Range = [Math.floor(p.demand * a.ctr[0]), Math.max(Math.floor(p.demand * a.ctr[0]), Math.round(p.demand * a.ctr[1]))];
  return { monthly, search: Math.round(search), clicks: Math.round(clicks), reachable, cpc: Math.round(cpc) };
}


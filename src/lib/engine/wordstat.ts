/**
 * Спрос по Wordstat: что спрашиваем (семена), как считаем спрос группы и всего поиска, как данные Wordstat
 * правят семантическое ядро. Модуль без серверных зависимостей (сбор данных и кэш — engine/demand.ts).
 *
 * Что такое «показы» Wordstat: число запросов за прошлый месяц, в которых есть все слова фразы в любой форме
 * (широкое соответствие). Поэтому «маникюр» включает и «японский маникюр», и «маникюр фото» — отсюда две поправки:
 *  1) целевая доля: из хвостов SearchedWith вычитаем нецелевые (минус-слова кампании и информационные «фото», «как»…);
 *  2) пересечения: вложенные семена («японский маникюр» внутри «маникюр») в сумму не идут, а общие хвосты двух
 *     независимых семян («маникюр и педикюр») вычитаем один раз.
 */
import type { WordstatPhrase } from "../platforms/types";
import type { Layer } from "../niches";
import { addPhrases, conflicts, displayKeyword, finalizeCore, phraseKey, SEM, type SemanticCore } from "./semantics";

/** Не больше фраз за один сбор спроса бизнеса: лимит Wordstat в Директе — 1000 фраз в сутки на пользователя */
export const DEMAND_MAX_PHRASES = 60;
/** Хвост Wordstat добавляем в группу, если его ищут хотя бы столько раз в месяц */
export const WS_MIN_ADD_SHOWS = 10;
/** Сколько фраз из Wordstat добавляем в одну группу */
export const WS_ADD_PER_GROUP = 8;

/** Информационные запросы: ищут картинки и советы, а не мастера — в спрос и в ядро не берём */
export const INFO_RE = /(^|\s)(фото\S*|картинк\S*|иде[яи]\S*|видео|тренд\S*|модн\S*|новинк\S*|красив\S*|осен\S*|зим\S*|весн\S*|летн\S*|лето|дома|домашн\S*|самостоятельн\S*|сама|своими|как|что|почему|зачем|можно|форум\S*|вред\S*|википед\S*|рисун\S*|схем\S*|урок\S*|обучени\S*|курс\S*|вакан\S*|работа|бесплатн\S*|скачать|приколы?|мем\S*|смешн\S*)(\s|$)/;

export type DemandSeedGroup = { name: string; layer: Layer; seeds: string[] };

/**
 * Смежная группа, которая на деле ищет вашего же специалиста («мастер по ногтям», «мужской парикмахер», «косметолог»):
 * это готовый спрос на услугу, он входит в итог. Другие специалисты и методы («мануальный терапевт») — нет.
 */
const OWN_PRO_RE = /(^|\s)(мастер\S*|салон\S*|студи\S*|парикмахер\S*|барбер\S*|барбершоп\S*|стилист\S*|косметолог\S*|тренер\S*|нейл|ногтев\S*|бровист\S*|лэшмейкер\S*|массажист\S*)(\s|$)/;
/** Группа входит в итог спроса: услуги, аудитории (в них слово услуги) и поиск вашего специалиста */
export const countedGroup = (g: Pick<DemandSeedGroup, "layer" | "seeds" | "name">) =>
  g.layer === "service" || g.layer === "audience" || (g.layer === "adjacent" && [g.name, ...g.seeds].some((x) => OWN_PRO_RE.test(displayKeyword(x).toLowerCase().replace(/ё/g, "е"))));

const sig = (p: string) => [...new Set(phraseKey(p).split(" ").filter(Boolean))];
/** Все слова a есть в b (b — уточнение a) */
const within = (a: string[], b: string[]) => a.length > 0 && a.every((w) => b.includes(w));

/**
 * Семена: у группы услуги — две главные фразы ядра (без гео и коммерческих хвостов), у остальных слоёв — одна.
 * Сначала по одной фразе каждой группы (услуги первыми), потом вторые — так при лимите спрос есть у всех групп.
 */
export function demandSeeds(core: Pick<SemanticCore, "groups">, max = DEMAND_MAX_PHRASES): DemandSeedGroup[] {
  const groups = core.groups.map((g) => {
    const layer = (g.layer ?? "service") as Layer;
    const list = (g.core.length ? g.core : g.keywords).map(displayKeyword).filter((p) => p && sig(p).length);
    return { name: g.name, layer, all: list.slice(0, layer === "service" ? 2 : 1), seeds: [] as string[] };
  });
  const order = [...groups].sort((a, b) => Number(a.layer !== "service") - Number(b.layer !== "service"));
  const used = new Set<string>();
  let n = 0;
  for (let k = 0; k < 2; k++) {
    for (const g of order) {
      const p = g.all[k];
      if (!p || n >= max) continue;
      const key = phraseKey(p);
      if (!used.has(key)) {
        used.add(key);
        n++;
      }
      g.seeds.push(p);
    }
  }
  return groups.map(({ name, layer, seeds }) => ({ name, layer, seeds }));
}

/** Хвост нецелевой: минус-слово кампании или информационный запрос */
export const offTarget = (phrase: string, negatives: string[]) => INFO_RE.test(displayKeyword(phrase)) || negatives.some((n) => conflicts(n, phrase));

/**
 * Целевая часть спроса фразы: всего запросов × доля целевых среди её хвостов SearchedWith.
 * Хвосты вложены друг в друга («маникюр цена» ⊃ «маникюр цена екатеринбург»), но это искажает числитель и
 * знаменатель одинаково, поэтому доля — разумная оценка. Нет хвостов — считаем все запросы целевыми.
 */
export function targetedShows(r: WordstatPhrase, negatives: string[]) {
  const self = phraseKey(r.phrase);
  const tails = r.searchedWith.filter((x) => phraseKey(x.phrase) !== self);
  const all = tails.reduce((s, x) => s + x.shows, 0);
  if (!all || !r.shows) return r.shows;
  const good = tails.filter((x) => !offTarget(x.phrase, negatives)).reduce((s, x) => s + x.shows, 0);
  const share = Math.min(1, Math.max(0.1, good / all));
  return Math.round(r.shows * share);
}

export type DemandSummary = {
  /** Целевых запросов в месяц по услугам (без пересечений) */
  total: number;
  /** То же без вычета нецелевых — для пояснения */
  raw: number;
  /** counted — группа входит в итог (total) */
  groups: { name: string; layer: Layer; counted: boolean; demand: number | null; top: { phrase: string; shows: number }[] }[];
  /** Сколько фраз с данными (из всех семян) */
  phrases: number;
  seeds: number;
};

const lookup = (results: Record<string, WordstatPhrase>, p: string) => results[phraseKey(p)] ?? null;

/**
 * Итог спроса. Спрос группы — максимум по её семенам и самому частому запросу (семена группы пересекаются).
 * Спрос поиска — услуги, аудитории (в них слово услуги) и поиск вашего специалиста (countedGroup): запросы о проблемах
 * («болит спина») и другие специалисты — тёплый, а не готовый спрос, в прогноз записей их не складываем (а у групп показываем).
 * Пересечения: семя, все слова которого содержат слова другого семени, уже посчитано в нём (вложенное) — пропускаем;
 * у независимых семян вычитаем общий хвост: самый частый запрос из SearchedWith одного, где есть все слова другого
 * («маникюр и педикюр»). Это нижняя оценка пересечения, поэтому итог лежит между настоящим объединением и суммой.
 */
export function summarizeDemand(seedGroups: DemandSeedGroup[], results: Record<string, WordstatPhrase>, negatives: string[]): DemandSummary {
  const groups = seedGroups.map((g) => {
    const vals = g.seeds.map((s) => lookup(results, s)).filter((r): r is WordstatPhrase => !!r).map((r) => targetedShows(r, negatives));
    // Самые частые целевые запросы группы (с самой фразой-семенем) — показать владельцу, что именно ищут
    const seen = new Set<string>();
    const top = g.seeds
      .map((s) => lookup(results, s))
      .filter((r): r is WordstatPhrase => !!r)
      .flatMap((r) => r.searchedWith)
      .filter((t) => t.shows > 0 && !offTarget(t.phrase, negatives))
      .sort((a, b) => b.shows - a.shows)
      .filter((t) => (seen.has(phraseKey(t.phrase)) ? false : (seen.add(phraseKey(t.phrase)), true)))
      .slice(0, 3)
      .map((t) => ({ phrase: displayKeyword(t.phrase), shows: t.shows }));
    // Спрос группы не меньше её самого частого запроса: иначе «~900 в мес.» над строкой «маникюр рядом — 1 200»
    const demand = vals.length || top.length ? Math.max(0, ...vals, ...top.map((t) => t.shows)) : null;
    return { name: g.name, layer: g.layer, counted: countedGroup(g), demand, top };
  });
  const seeds = new Map<string, { r: WordstatPhrase; words: string[] }>();
  for (const g of seedGroups) {
    if (!countedGroup(g)) continue;
    for (const s of g.seeds) {
      const r = lookup(results, s);
      // «остеопат» и «остеопатия» — один ключ: берём более частую
      if (r && (seeds.get(phraseKey(s))?.r.shows ?? -1) < r.shows) seeds.set(phraseKey(s), { r, words: sig(s) });
    }
  }
  const list = [...seeds.values()];
  const top = list.filter((a) => !list.some((b) => b !== a && b.words.length < a.words.length && within(b.words, a.words)));
  let total = 0, raw = 0;
  for (const a of top) {
    total += targetedShows(a.r, negatives);
    raw += a.r.shows;
  }
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      const a = top[i], b = top[j];
      const shared = (x: typeof a, y: typeof a) => Math.max(0, ...x.r.searchedWith.filter((t) => within(y.words, sig(t.phrase)) && within(x.words, sig(t.phrase))).map((t) => t.shows));
      const ov = Math.min(Math.max(shared(a, b), shared(b, a)), a.r.shows, b.r.shows);
      if (!ov) continue;
      raw -= ov;
      const share = (targetedShows(a.r, negatives) / Math.max(1, a.r.shows) + targetedShows(b.r, negatives) / Math.max(1, b.r.shows)) / 2;
      total -= Math.round(ov * share);
    }
  }
  // Итог не меньше любой группы, которая в него входит
  const single = Math.max(0, ...top.map((a) => targetedShows(a.r, negatives)), ...groups.filter((g) => g.counted).map((g) => g.demand ?? 0));
  return {
    total: Math.max(single, Math.round(total)),
    raw: Math.max(Math.max(0, ...top.map((a) => a.r.shows)), Math.round(raw)),
    groups,
    phrases: Object.keys(results).length,
    seeds: seedGroups.reduce((s, g) => s + g.seeds.length, 0),
  };
}

/**
 * Правим ядро по Wordstat (без сети — по уже собранным данным):
 *  - спрос группы (demand) — для показа владельцу;
 *  - фразы внутри группы — по убыванию частоты (неизвестные — после известных, в прежнем порядке);
 *  - частые хвосты SearchedWith, которые проходят те же фильтры, что и фразы модели (acceptPhrase / addPhrases:
 *    слово услуги, минус-слова группы и кампании, чужие услуги), — до WS_ADD_PER_GROUP в группу и в лимит SEM.perGroup;
 *  - убираем фразу, только если и Wordstat показывает ноль (её семя или она сама — 0 запросов), и Директ сказал
 *    «нет показов» (noVolume — фразы, оставленные refineWithDirect ради минимума группы). В группе остаётся хотя бы 2.
 */
export function applyWordstat(core: SemanticCore, results: Record<string, WordstatPhrase>, nicheId: string, opts: { noVolume?: string[]; source?: string | null } = {}): SemanticCore {
  const out: SemanticCore = { ...core, groups: core.groups.map((g) => ({ ...g, keywords: [...g.keywords] })), checks: { ...core.checks } };
  const seedGroups = demandSeeds(out);
  if (!Object.keys(results).length) return out;
  // Частота по ключу фразы: семена и их хвосты
  const freq = new Map<string, number>();
  for (const r of Object.values(results)) {
    for (const t of r.searchedWith) {
      const k = phraseKey(t.phrase);
      freq.set(k, Math.max(freq.get(k) ?? 0, t.shows));
    }
    freq.set(phraseKey(r.phrase), r.shows);
  }
  const zeroSeeds = Object.values(results).filter((r) => r.shows === 0).map((r) => sig(r.phrase));
  const noVol = new Set(opts.noVolume ?? []);
  const summary = summarizeDemand(seedGroups, results, out.negatives);
  let added = 0, dropped = 0;
  out.groups.forEach((g, gi) => {
    const sg = seedGroups[gi];
    const d = summary.groups[gi]?.demand;
    if (d !== null && d !== undefined) g.demand = d;
    // Убираем «нулевые»: только при согласии Директа и Wordstat
    const isZero = (k: string) => freq.get(phraseKey(k)) === 0 || zeroSeeds.some((z) => within(z, sig(k)));
    for (const k of [...g.keywords]) {
      if (g.keywords.length <= 2) break;
      if (noVol.has(k) && isZero(k)) {
        g.keywords = g.keywords.filter((x) => x !== k);
        dropped++;
      }
    }
    // Частые хвосты семян группы
    const tails = sg.seeds
      .map((s) => lookup(results, s))
      .filter((r): r is WordstatPhrase => !!r)
      .flatMap((r) => r.searchedWith)
      .filter((t) => t.shows >= WS_MIN_ADD_SHOWS && !offTarget(t.phrase, out.negatives) && sig(t.phrase).length <= SEM.words)
      .sort((a, b) => b.shows - a.shows)
      .map((t) => t.phrase);
    const room = Math.min(WS_ADD_PER_GROUP, SEM.perGroup - g.keywords.length);
    if (room > 0 && tails.length) added += addPhrases(out, gi, [...new Set(tails)], nicheId, room);
    // Порядок: частые первыми
    const known = g.keywords.filter((k) => freq.has(phraseKey(k)));
    const unknown = g.keywords.filter((k) => !freq.has(phraseKey(k)));
    known.sort((a, b) => (freq.get(phraseKey(b)) ?? 0) - (freq.get(phraseKey(a)) ?? 0));
    g.keywords = [...known, ...unknown];
  });
  out.checks.wordstat = { phrases: summary.phrases, added, dropped, total: summary.total, source: opts.source ?? null };
  return finalizeCore(out, nicheId);
}

// ─── Город в предложном падеже: «Спрос в Екатеринбурге» ─────────────────

const CITY_IN: Record<string, string> = {
  "москва": "Москве", "санкт-петербург": "Санкт-Петербурге", "петербург": "Петербурге", "спб": "Петербурге", "нижний новгород": "Нижнем Новгороде",
  "ростов-на-дону": "Ростове-на-Дону", "сочи": "Сочи", "тверь": "Твери", "пермь": "Перми", "казань": "Казани", "рязань": "Рязани",
  "астрахань": "Астрахани", "тюмень": "Тюмени", "великий новгород": "Великом Новгороде", "набережные челны": "Набережных Челнах",
  "кострома": "Костроме", "уфа": "Уфе", "пенза": "Пензе",
};

/** «Екатеринбург» → «в Екатеринбурге»; непонятные названия — «в г. Название» */
export function cityIn(city: string): string {
  const c = city.trim().replace(/^г\.?\s*/i, "");
  if (!c) return "";
  const k = c.toLowerCase().replace(/ё/g, "е");
  if (CITY_IN[k]) return `в ${CITY_IN[k]}`;
  const v = /^[вф][бвгджзклмнпрстфхцчшщ]/i.test(c) ? "во" : "в";
  if (/[\s-]/.test(c)) return `в г. ${c}`;
  if (/[бвгджзклмнпрстфхцчшщ]$/i.test(c)) return `${v} ${c}е`;
  if (/[^жшчщц]а$/i.test(c)) return `${v} ${c.slice(0, -1)}е`;
  if (/я$/i.test(c)) return `${v} ${c.slice(0, -1)}е`;
  if (/ь$/i.test(c)) return `${v} ${c.slice(0, -1)}и`;
  return `в г. ${c}`;
}


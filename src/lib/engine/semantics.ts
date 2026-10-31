/**
 * Семантическое ядро поиска: запросы, по которым показываем рекламу, и минус-слова.
 *
 * Как строим (без генерации — детерминированно, из анкеты и словарей ниши в niches.ts):
 *  1. Разбираем каждую услугу: главное понятие (маникюр, остеопат), уточнения — прилагательные («японский»,
 *     «детский»), модификаторы («гель лак», «для детей»), «без покрытия», прочие слова («пальчиков»).
 *     Названия пакетов в кавычках («Стандарт»), бренды латиницей, цены и минуты в запросы не попадают.
 *  2. Услуги с одинаковым смыслом — одна группа («Маникюр «Стандарт»» и «Маникюр «Все включено»» → «маникюр»).
 *     Цель — группа на услугу, до 15 групп; лишние сливаем с ближайшей группой того же понятия.
 *  3. Общие запросы семейства («маникюр», «ногти», «маникюр цена») получает одна группа — неуточнённая услуга
 *     (иначе первая); остальные группы — только свои уточнённые запросы («японский маникюр»).
 *  4. Каждую фразу размножаем: синонимы × город (и «спб», «екб») × коммерческие слова (цена, недорого, запись,
 *     рядом, отзывы…) × намерения («где сделать маникюр», «записаться к остеопату») × улица и метро из адреса.
 *     2–7 слов, без повторов с точностью до словоформ и порядка слов, до 120 фраз в группе.
 *  5. Кросс-минусовка: группе «маникюр» — минус «педикюр», «японский», «покрытие»…, чтобы запрос
 *     «японский маникюр» уходил в свою группу с ценой японского маникюра, а группы не конкурировали.
 *  6. Минус-слова кампании — из словаря ниши, без тех, что пересекаются с нашими же фразами
 *     (иначе Директ заблокирует свою же фразу: «школа» у школы танцев).
 *  7. Слои (layer): кроме групп услуг — «Проблемы клиентов» («болит шея», «ломкие ногти»), «Смежные запросы»
 *     («мануальный терапевт» у остеопата) и «Аудитории» («остеопат для беременных», «маникюр на свадьбу»). Словари —
 *     niches.ts (layersFor); группа слоя создаётся, только если у владельца есть услуга, к которой ведёт запрос.
 *     Автотаргетинг у них выключен, а робот сравнивает цену обращения слоя с услугами (engine/layers.ts).
 *
 * Операторы Директа: однословная фраза — в кавычках ("маникюр" — только запросы из одного слова: широкие хвосты
 * покрывают уточнённые фразы и автотаргетинг), «+без» — стоп-слово, меняющее смысл. Остальное — широкое
 * соответствие: Директ сам учитывает словоформы и порядок слов.
 *
 * Модуль без серверных зависимостей: им пользуются и запуск, и страницы (показ ядра владельцу).
 * Проверка частотности и дублей через API Директа — refineWithDirect (вызывает сервер, если подключён Директ).
 */
import type { Business, Service } from "../db/schema";
import { parseWeekHours } from "./extras";
import { CITY_ALIASES, COMMERCIAL, isMedical, KIDS_RE, LAYER_JUNK, LAYER_LABEL, LAYERS, layersFor, NO_KIDS_NEG, nicheById, semanticsFor, sharedMods, type Concept, type Layer, type LayerEntry } from "../niches";

export type { Layer } from "../niches";

export const SEM = {
  maxGroups: 15,
  perGroup: 120,
  minGroup: 8,
  words: 7,
  wordLen: 35,
  /** Минус-слова группы (AdGroup.NegativeKeywords): не длиннее 4096 символов вместе */
  groupNegChars: 4000,
  /** Сколько фраз оставить в группе, даже если Директ считает, что показов по ним нет */
  keepMin: 5,
} as const;

export type SemanticGroup = {
  /** Название группы: услуга, как у владельца */
  name: string;
  /** Основная услуга группы (цена и заголовок объявлений) */
  service: string;
  /** Все услуги прайса, которые покрывает группа */
  services: string[];
  category: string;
  /** Понятия словаря (id), найденные в услугах группы */
  concepts: string[];
  /** Фразы для Директа (с операторами) */
  keywords: string[];
  /** Минус-слова группы: кросс-минусовка с соседними группами */
  negatives: string[];
  /** Ядро без коммерческих и гео-хвостов: для интересов в РСЯ и подсказок */
  core: string[];
  /** Слой: услуга, проблема клиента, смежный запрос, аудитория (см. niches.ts → Layer) */
  layer: Layer;
  /** Слои проблем, смежных и аудиторий: из чего строим объявление «проблема → решение» */
  hook?: LayerHook;
  /** Целевых запросов в месяц по Wordstat (engine/wordstat.ts); нет — данных не собрали */
  demand?: number;
};
export type LayerHook = { entry: string; ask: string; when?: string; noun: string };
export type SemanticChecks = {
  /** none — фразы без показов, оставленные ради минимума группы (их может убрать Wordstat, если и он показывает ноль) */
  volume?: { checked: number; dropped: number; examples: string[]; none?: string[] } | null;
  /** Wordstat: фраз с данными, добавлено хвостов, убрано нулевых, целевой спрос в месяц; null — данных нет (note — почему) */
  wordstat?: { phrases: number; added: number; dropped: number; total: number; source: string | null } | { phrases: 0; note: string } | null;
  dedup?: { merged: number } | null;
  ai?: { added: number } | null;
};
export type SemanticCore = {
  groups: SemanticGroup[];
  /** Минус-слова кампании */
  negatives: string[];
  geo: { city: string[]; local: string[] };
  total: number;
  checks: SemanticChecks;
  /** Медицинские услуги (остеопатия, косметология…): лицензия, предупреждение, осторожные тексты */
  medical?: boolean;
};

type B = Pick<Business, "niche" | "city" | "address" | "services" | "name"> & Partial<Pick<Business, "description" | "hours" | "searchTopics">>;

// ─── Слова ────────────────────────────────────────────────────────────

const lower = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/ё/g, "е");
/** Стоп-слова Директа (предлоги, союзы, частицы): в ключе дублей не участвуют */
const STOP = new Set(["в", "во", "на", "по", "с", "со", "к", "ко", "у", "о", "об", "обо", "от", "до", "из", "за", "для", "без", "при", "про", "над", "под", "через", "и", "или", "а", "но", "да", "же", "ли", "бы", "не", "ни", "то"]);
/** Слова, которые не отличают одну услугу от другой: не минусуем их в соседних группах */
const GENERIC = new Set([
  "услуга", "услуги", "процедура", "процедуры", "сеанс", "сеансы", "прием", "консультация", "комплекс", "программа", "сделать", "мастер",
  "салон", "студия", "кабинет", "центр", "занятие", "занятия", "тренировка", "тренировки", "запись", "цена", "стоимость", "врач",
]);
const ENDINGS = ["иями", "ями", "ами", "ого", "его", "ому", "ему", "ыми", "ими", "ией", "ием", "иям", "иях", "ьям", "ьях", "ых", "их", "ым", "им", "ая", "яя", "ое", "ее", "ые", "ие", "ый", "ий", "ой", "ую", "юю", "ом", "ем", "ам", "ям", "ах", "ях", "ов", "ев", "ей", "ия", "ию", "ии", "а", "я", "о", "е", "ы", "и", "у", "ю", "ь", "й"];

/** Грубая основа слова: «маникюра» → «маникюр», «стрижку» → «стрижк». Для сравнения словоформ, не для текста */
export function stem(w: string) {
  const x = lower(w).replace(/[^\p{L}\p{N}]/gu, "");
  for (const e of ENDINGS) if (x.endsWith(e) && x.length - e.length >= 3) return x.slice(0, -e.length);
  return x;
}
const plainWords = (p: string) => displayKeyword(p).split(/[\s-]+/).filter(Boolean);
const sigWords = (p: string) => plainWords(p).filter((w) => !STOP.has(w));
/** «без» и «не» меняют смысл: в Директе их фиксируют «+», поэтому они значимы и для ключа, и для лимита слов */
const MEANINGFUL_STOP = new Set(["без", "не"]);
const keyWords = (p: string) => plainWords(p).filter((w) => !STOP.has(w) || MEANINGFUL_STOP.has(w));
/** Ключ фразы: словоформы и порядок слов не важны (как в Директе) */
export const phraseKey = (p: string) => [...new Set(keyWords(p).map(stem))].sort().join(" ");
/** Фраза без операторов и встроенных минус-слов — для показа владельцу */
export const displayKeyword = (k: string) => lower(k).replace(/\s-\S+/g, " ").replace(/["!+[\]]/g, "").replace(/\s+/g, " ").trim();

/** Минус-слово (или минус-фраза) блокирует ключевую фразу, если все его слова есть во фразе */
export function conflicts(negative: string, keyword: string) {
  const ns = sigWords(negative.replace(/^!/, "")).map(stem);
  if (!ns.length) return false;
  const ks = new Set(sigWords(keyword).map(stem));
  return ns.every((s) => ks.has(s));
}

/** Фраза в формате Директа: однословная — в кавычках, «без»/«не» — с «+». null — фраза не проходит лимиты */
export function toDirect(phrase: string): string | null {
  const ws = lower(phrase).replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).map((w) => w.replace(/^-+|-+$/g, "")).filter(Boolean);
  const sig = ws.filter((w) => !STOP.has(w) || MEANINGFUL_STOP.has(w));
  // Директ: не больше 7 слов во фразе — считаем все слова, включая предлоги (так надёжнее при любом подсчёте)
  if (!sig.length || ws.length > SEM.words) return null;
  if (ws.some((w) => w.length > SEM.wordLen)) return null;
  if (sig.every((w) => /^\d+$/.test(w))) return null;
  if (ws.length === 1) return `"${ws[0]}"`;
  return ws.map((w) => (w === "без" || w === "не" ? `+${w}` : w)).join(" ");
}

// ─── Согласование: «детский массаж», «детская стрижка», «записаться на стрижку» ──

type Adj = { stem: string; soft: boolean; oy: boolean };
const ADJ_END = /(ый|ий|ой|ая|яя|ое|ее|ые|ие)$/;
const NOUN_LIKE = /(ние|тие|чие|рий|лий|ций|зий|сий|ье|ия)$/;
/** Прилагательные, которые не уточняют услугу для поиска */
const ADJ_SKIP = ["разов", "пробн", "перв", "втор", "вторичн", "повторн", "нов", "люб", "обычн", "стандартн", "ежедневн", "ногтев", "дополнительн", "легк", "прост"].map(stem);

function asAdj(w: string): Adj | null {
  const x = lower(w);
  if (x.length < 5 || !ADJ_END.test(x) || NOUN_LIKE.test(x)) return null;
  const end = x.slice(-2);
  const st = x.slice(0, -2);
  return { stem: st, soft: end === "яя" || end === "ее" || (end === "ий" && !/[кгхжшчщ]$/.test(st)), oy: end === "ой" };
}
const adjFromStem = (s: string): Adj => ({ stem: s, soft: false, oy: false });

function genderOf(phrase: string): "m" | "f" | "n" | "p" {
  const w = plainWords(phrase)[0] ?? "";
  if (/(ая|яя)$/.test(w)) return "f";
  if (/(ое|ее|ние|тие|ье|о)$/.test(w)) return "n";
  if (/(ые|ие|ы|и)$/.test(w)) return "p";
  if (/[ая]$/.test(w)) return "f";
  return "m";
}

export function agree(a: Adj, phrase: string) {
  const g = genderOf(phrase);
  const hush = /[жшчщ]$/.test(a.stem);
  const velar = /[кгх]$/.test(a.stem);
  const end =
    g === "f" ? (a.soft ? "яя" : "ая")
    : g === "n" ? (a.soft || (hush && !a.oy) ? "ее" : "ое")
    : g === "p" ? (a.soft || hush || velar ? "ие" : "ые")
    : a.oy ? "ой" : a.soft || hush || velar ? "ий" : "ый";
  return `${a.stem}${end} ${phrase}`;
}

/** Винительный падеж для «записаться на …»: прилагательные и первое существительное женского рода */
export function acc(phrase: string) {
  const ws = phrase.split(" ");
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    if (w.length <= 3) continue; // «спа», «хип»: несклоняемые и короткие
    if (/ая$/.test(w)) { ws[i] = w.replace(/ая$/, "ую"); continue; }
    if (/яя$/.test(w)) { ws[i] = w.replace(/яя$/, "юю"); continue; }
    if (/а$/.test(w)) ws[i] = w.replace(/а$/, "у");
    else if (/я$/.test(w)) ws[i] = w.replace(/я$/, "ю");
    break;
  }
  return ws.join(" ");
}

// ─── Гео ──────────────────────────────────────────────────────────────

const STREET = /(?:^|\s)(ул\.?|улица|пр-т\.?|пр-кт\.?|просп\.?|проспект|пр\.|пер\.?|переулок|б-р|бульвар|ш\.|шоссе|наб\.?|набережная|пл\.|площадь|проезд|тракт|аллея)(?=\s|$)/;
const MONTHS = /(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/;

/** Город (и как его сокращают) и места рядом из адреса: улица, метро, район */
export function geoTerms(b: Pick<Business, "city" | "address">) {
  const city = lower(b.city).replace(/^г\.?\s*/, "").trim();
  const cityTerms = city ? [city, ...(CITY_ALIASES[city] ?? [])] : [];
  const local: string[] = [];
  const addr = lower(b.address).replace(/\./g, ". ");
  const push = (s: string) => {
    const t = s.replace(/[«»"()]/g, " ").replace(/\s+/g, " ").trim();
    if (!t || t.length < 4 || MONTHS.test(t) || /\d/.test(t) || t.split(" ").length > 2 || cityTerms.includes(t)) return;
    if (!local.includes(t)) local.push(t);
  };
  for (const m of addr.matchAll(/(?:^|[\s,])(?:м\.|метро|ст\.\s?м\.?)\s*«?([\p{L}-]+(?:\s[\p{L}-]+)?)/gu)) push(`метро ${m[1].replace(/\s(?:ул|д|дом|корп).*$/, "")}`);
  for (const m of addr.matchAll(/([\p{L}-]+)\s+район|район\s+([\p{L}-]+)|р-н\s+([\p{L}-]+)|мкр\.?\s*([\p{L}-]+)/gu)) push(m[1] ?? m[2] ?? m[3] ?? m[4] ?? "");
  for (const seg of addr.split(/[,;]/)) {
    if (!STREET.test(` ${seg} `)) continue;
    const name = seg.replace(STREET, " ").replace(/\d+\S*/g, " ").replace(/(?:^|\s)(д|дом|корп|стр|офис|оф|к)\.?(?=\s|$)/g, " ").trim();
    // «ул. 8 Марта» → «марта» отсеет push: «маникюр 8 марта» — это про праздник
    push(name);
  }
  return { city: cityTerms, local: local.slice(0, 3) };
}

// ─── Разбор услуги ────────────────────────────────────────────────────

/** Латиница, которую ищут как есть; остальная латиница в названиях — бренды косметики */
const LATIN_OK = new Set(["airtouch", "shellac", "spa", "trx", "lpg", "smas", "barre", "fade", "strip", "k-pop", "kpop", "hip", "hop", "high", "heels"]);

/** Название услуги → слова для запросов: без кавычек-пакетов, брендов, цифр и единиц */
export function cleanServiceName(name: string) {
  let s = ` ${name ?? ""} `;
  s = s.replace(/«[^»]*»|"[^"]*"|“[^”]*”|„[^“]*“/g, " ");
  // Скобки: «(без покрытия)» оставляем, «(Просто Лак)» — название пакета — убираем
  s = s.replace(/\(([^)]*)\)/g, (_m, inner: string) => (/^\s*\p{Lu}/u.test(inner) && !/^\s*(Без|С|Со|Для|На)\s/.test(inner) ? " " : ` ${inner} `));
  s = s.replace(/(?<=\s)c(?=\s)/g, "с"); // латинская «c» вместо русской
  s = s.replace(/\d+([.,]\d+)?\s*(-|–)?\s*\d*\s*(мин\S*|ч\.?|час\S*|занят\S*|сеанс\S*|процедур\S*|шт\.?|руб\S*|₽|р\.|%|см|мм|зон\S*|раз\S*|посещ\S*|дн\S*|мес\S*)?/giu, " ");
  s = s.replace(/[+/&:|—–,;.!?*#№]/g, " ");
  const ws = lower(s)
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .flatMap((w) => (/^[\p{L}]+-[\p{L}]+$/u.test(w) && !LATIN_OK.has(w) ? w.split("-") : [w]))
    .map((w) => w.replace(/^-+|-+$/g, ""))
    .filter((w) => w && (!/[a-z]/.test(w) || LATIN_OK.has(w)));
  while (ws.length && STOP.has(ws[ws.length - 1])) ws.pop();
  while (ws.length && STOP.has(ws[0]) && ws[0] !== "без") ws.shift();
  return ws.join(" ");
}

type Parsed = {
  svc: Service;
  base: string;
  mains: Concept[];
  mods: Concept[];
  adjs: Adj[];
  extras: string[];
  negs: string[];
  qualified: boolean;
  sig: string;
  /** Главное понятие найдено только в разделе прайса или не найдено вовсе (услуга «Пробное занятие») */
  implied: boolean;
};

function vocab(cs: Concept[]) {
  const out = new Set<string>();
  for (const c of cs) for (const p of [...c.heads, c.noun ?? "", ...(c.attach ?? []), ...(c.pros ?? [])]) for (const w of sigWords(p)) out.add(stem(w));
  return out;
}

function parseService(svc: Service, nicheId: string): Parsed {
  const sem = semanticsFor(nicheId);
  const base = cleanServiceName(svc.name);
  const negs: string[] = [];
  // «без покрытия», «без пальчиков и покрытия» — отрицание: само по себе уточнение, а не модификатор «покрытие»
  const positive = base.replace(/(?:^|\s)без\s+([\p{L}]+(?:\s+и\s+[\p{L}]+)?)/gu, (_m, x: string) => {
    negs.push(`без ${x}`);
    return " ";
  });
  const mainsAll = sem.concepts.filter((c) => !c.mod);
  // Порядок — как в названии: «Стрижка + борода» → стрижка, затем борода
  // Понятие, найденное только внутри слов более точного понятия («бров» в «окрашивание бровей»), не считаем отдельным
  const spans = (c: Concept, text: string) => {
    const re = new RegExp(c.match.source, c.match.flags.includes("g") ? c.match.flags : `${c.match.flags}g`);
    return [...text.matchAll(re)].map((m) => {
      let from = m.index ?? 0, to = from + m[0].length;
      while (from > 0 && /[\p{L}-]/u.test(text[from - 1])) from--;
      while (to < text.length && /[\p{L}-]/u.test(text[to])) to++;
      return [from, to] as const;
    });
  };
  const pickMains = (text: string) => {
    const out: { c: Concept; at: number }[] = [];
    const taken: (readonly [number, number])[] = [];
    for (const c of mainsAll) {
      if (out.some((x) => x.c.family === c.family)) continue;
      const free = spans(c, text).filter(([f, t]) => !taken.some(([a, z]) => f >= a && t <= z));
      if (!free.length) continue;
      out.push({ c, at: free[0][0] });
      taken.push(...spans(c, text));
    }
    return out.sort((a, b) => a.at - b.at).map((x) => x.c);
  };
  let mains = pickMains(positive);
  let implied = false;
  if (!mains.length) {
    const fromCat = pickMains(lower(svc.category));
    const general = mainsAll[mainsAll.length - 1];
    mains = fromCat.length ? fromCat.slice(0, 1) : general ? [general] : [];
    implied = true;
  }
  const mainVocab = vocab(mains);
  const mods = [...sem.concepts.filter((c) => c.mod), ...sharedMods()].filter((m) => {
    if (!m.match.test(positive)) return false;
    // «мужская стрижка» в барбершопе — главное понятие, а не уточнение
    const own = [...(m.attach ?? []), ...m.heads].flatMap(sigWords).map(stem);
    if (m.adj && mainVocab.has(stem(`${m.adj}ий`))) return false;
    return !own.length || !own.every((w) => mainVocab.has(w));
  });
  const modVocab = vocab(mods);
  for (const m of mods) if (m.adj) modVocab.add(stem(`${m.adj}ий`));
  const adjs: Adj[] = [];
  const extras: string[] = [];
  const negVocab = new Set(negs.flatMap(sigWords).map(stem));
  for (const w of positive.split(/\s+/).filter(Boolean)) {
    if (STOP.has(w) || /^\d+$/.test(w)) continue;
    const st = stem(w);
    if (mainVocab.has(st) || modVocab.has(st) || negVocab.has(st) || GENERIC.has(w)) continue;
    if (mains.some((c) => c.match.test(w))) continue;
    if ([...mods].some((m) => m.match.test(w))) continue;
    const a = asAdj(w);
    if (a) {
      if (!ADJ_SKIP.includes(stem(w)) && !adjs.some((x) => x.stem === a.stem)) adjs.push(a);
      continue;
    }
    if (w.length >= 3 && !extras.includes(w)) extras.push(w);
  }
  const qualified = mods.length > 0 || adjs.length > 0 || extras.length > 0 || negs.length > 0 || mains.length > 1;
  const sig = [
    mains.map((c) => c.id).sort().join("+"),
    mods.map((c) => c.id).sort().join("+"),
    adjs.map((a) => a.stem).sort().join("+"),
    extras.map(stem).sort().join("+"),
    negs.map(phraseKey).sort().join("+"),
  ].join("|");
  return { svc, base, mains, mods, adjs: adjs.slice(0, 2), extras: extras.slice(0, 3), negs, qualified, sig, implied };
}

/** Уточнённые фразы услуги: «японский маникюр», «маникюр гель лак», «остеопат для детей», «педикюр без покрытия» */
function qualifiedPhrases(p: Parsed): string[] {
  const c = p.mains[0];
  const out: string[] = [];
  const noun = c ? lower(c.noun ?? c.heads[0]) : "";
  const baseSig = sigWords(p.base).length;
  if (p.base && baseSig <= 5 && !/(^|\s)или(\s|$)/.test(p.base)) out.push(p.implied && noun && !p.base.includes(noun.split(" ")[0]) ? `${p.base} ${noun}` : p.base);
  if (!c) return out;
  for (const a of p.adjs) out.push(agree(a, noun));
  for (const m of p.mods) {
    if (m.adj) out.push(agree(adjFromStem(m.adj), noun));
    for (const t of m.attach ?? []) out.push(`${noun} ${t}`);
  }
  if (p.extras.length) out.push(`${noun} ${p.extras.join(" ")}`);
  for (const n of p.negs) out.push(`${noun} ${n}`);
  // Сочетания: «пилинговый педикюр без покрытия», «японский маникюр гель лак»
  const a0 = p.adjs[0];
  if (a0 && p.mods[0]?.attach?.[0]) out.push(`${agree(a0, noun)} ${p.mods[0].attach[0]}`);
  if (a0 && p.negs[0]) out.push(`${agree(a0, noun)} ${p.negs[0]}`);
  if (a0 && p.extras.length) out.push(`${agree(a0, noun)} ${p.extras.join(" ")}`);
  // Несколько главных понятий: «наращивание ногтей и маникюр»
  for (const c2 of p.mains.slice(1)) {
    const n2 = lower(c2.noun ?? c2.heads[0]);
    const tail = n2.split(" ").filter((w) => !noun.split(" ").includes(w)).join(" ");
    const h1 = lower(c.heads[0]);
    const c2short = lower(c2.combo ?? n2);
    out.push(`${noun} ${tail}`, `${h1} и ${c2short}`, ...c2.heads.slice(0, 2).map(lower));
  }
  // Синонимы-одно слово с модификатором: «ногти гель лак»
  for (const h of c.heads.filter((h) => !h.includes(" ") && lower(h) !== noun).slice(0, 2)) for (const m of p.mods.slice(0, 1)) if (m.attach?.[0]) out.push(`${h} ${m.attach[0]}`);
  return out;
}

// ─── Группы ───────────────────────────────────────────────────────────

type Unit = { parsed: Parsed[]; category: string };

const familyOf = (u: Unit) => u.parsed[0]?.mains[0]?.family ?? "";
const specificity = (u: Unit) => Math.min(...u.parsed.map((p) => p.sig.split(/[|+]/).filter(Boolean).length));

function clusterUnits(parsed: Parsed[], max: number): Unit[] {
  const units: Unit[] = [];
  for (const p of parsed) {
    const u = units.find((x) => x.parsed[0].sig === p.sig);
    if (u) u.parsed.push(p);
    else units.push({ parsed: [p], category: (p.svc.category ?? "").trim() });
  }
  // Больше лимита: сливаем две самые похожие группы (то же понятие, тот же раздел, общие уточнения)
  const tokens = (u: Unit) => new Set(u.parsed.flatMap((p) => p.sig.split(/[|+]/).filter(Boolean)));
  while (units.length > max) {
    let bi = 0, bj = 1, best = -Infinity;
    for (let i = 0; i < units.length; i++) {
      const ti = tokens(units[i]);
      for (let j = i + 1; j < units.length; j++) {
        const tj = tokens(units[j]);
        const inter = [...ti].filter((t) => tj.has(t)).length;
        const jac = inter / (new Set([...ti, ...tj]).size || 1);
        const score = jac + (familyOf(units[i]) === familyOf(units[j]) ? 1 : 0) + (units[i].category && units[i].category === units[j].category ? 0.5 : 0) - (units[i].parsed.length + units[j].parsed.length) * 0.01;
        if (score > best) { best = score; bi = i; bj = j; }
      }
    }
    units[bi].parsed.push(...units[bj].parsed);
    units.splice(bj, 1);
  }
  return units;
}

/** Общий (последний в словаре) концепт семейства: «массаж» для «массаж спины», «йога» для «хатха йога» */
function generalOf(nicheId: string, family: string): Concept | null {
  const list = semanticsFor(nicheId).concepts.filter((c) => c.family === family && !c.mod);
  return list[list.length - 1] ?? null;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const sigCount = (p: string) => keyWords(p).length;

/**
 * Семантическое ядро для поиска по анкете. Без услуг — одна группа по общему названию ниши.
 */
export function buildSemanticCore(b: B, opts: { maxGroups?: number; perGroup?: number; layers?: boolean } = {}): SemanticCore {
  const niche = nicheById(b.niche);
  const sem = semanticsFor(niche.id);
  const maxGroups = opts.maxGroups ?? SEM.maxGroups;
  const perGroup = opts.perGroup ?? SEM.perGroup;
  const services: Service[] = (b.services ?? []).filter((s) => s?.name?.trim());
  const list: Service[] = services.length ? services : [{ name: niche.id === "other" ? b.name : niche.generic }];
  const parsed = list.map((s) => parseService(s, niche.id)).filter((p) => p.base || p.mains.length);
  const medical = isMedical(b);
  if (!parsed.length) return { groups: [], negatives: [], geo: geoTerms(b), total: 0, checks: {}, medical };
  const units = clusterUnits(parsed, maxGroups);
  const geo = geoTerms(b);

  // Кто получает общие запросы семейства: неуточнённая услуга этого понятия, иначе первая группа семейства
  const owners = new Map<string, number>();
  const families = [...new Set(units.flatMap((u) => u.parsed.flatMap((p) => p.mains.map((c) => c.family))))];
  for (const f of families) {
    const plain = units.findIndex((u) => u.parsed.some((p) => p.mains[0]?.family === f && !p.qualified));
    const any = units.findIndex((u) => u.parsed.some((p) => p.mains.some((c) => c.family === f)));
    owners.set(f, plain >= 0 ? plain : any);
  }
  // Модификаторы с самостоятельными запросами («покрытие гель лаком», «дизайн ногтей») — тоже одной группе
  const modOwners = new Map<string, number>();
  units.forEach((u, i) => u.parsed.forEach((p) => p.mods.forEach((m) => m.heads.length && !modOwners.has(m.id) && modOwners.set(m.id, i))));

  // Проход 1: фразы услуг (уточнённые) и общие запросы владельца семейства
  const plans = units.map((u, ui) => {
    const mains = [...new Map(u.parsed.flatMap((p) => p.mains).map((c) => [c.id, c])).values()];
    const genericHeads: string[] = [];
    const pros: string[] = [];
    for (const f of [...owners.entries()].filter(([, i]) => i === ui).map(([f]) => f)) {
      const cs = [...new Map([...mains.filter((c) => c.family === f), generalOf(niche.id, f)].filter((c): c is Concept => !!c).map((c) => [c.id, c])).values()];
      for (const c of cs) {
        genericHeads.push(...c.heads.map(lower));
        pros.push(...(c.pros ?? []).map(lower));
      }
    }
    for (const [mid, i] of modOwners) if (i === ui) genericHeads.push(...(sem.concepts.find((c) => c.id === mid)?.heads ?? []).map(lower));
    // По очереди из каждой услуги группы, чтобы в лимит попали все
    const perSvc = u.parsed.map((p) => (p.qualified || p.implied ? qualifiedPhrases(p) : [p.base, ...(p.mains[0] ? [lower(p.mains[0].noun ?? p.mains[0].heads[0])] : [])]));
    const own: string[] = [];
    for (let k = 0; perSvc.some((l) => l.length > k); k++) for (const l of perSvc) if (l[k]) own.push(l[k]);
    const distinct = new Map<string, string>();
    for (const ph of own) for (const w of sigWords(ph)) if (w.length >= 3 && !GENERIC.has(w) && !/\d/.test(w)) distinct.set(stem(w), distinct.get(stem(w)) ?? w);
    // Главные слова понятий — минус-слова для групп других понятий («педикюр» в группе «маникюр»).
    // Специалист («косметолог», «остеопат») делает и чужие процедуры: его не минусуем
    const nouns = new Map<string, string>();
    for (const c of mains) if ((c.kind ?? sem.kind) !== "visit") for (const w of sigWords(c.noun ?? c.heads[0])) if (w.length >= 3 && !GENERIC.has(w)) nouns.set(stem(w), w);
    return { unit: u, mains, genericHeads, pros: uniq(pros), own: uniq(own), distinct, nouns, vocab: vocab(mains) };
  });

  // Запрещённые слова группы: отличительные слова соседей (того же понятия) и главные слова других понятий.
  // Фразы с ними группа не берёт, а сами слова становятся её минус-словами (кросс-минусовка)
  const geoStems = new Set([...geo.city, ...geo.local].flatMap(sigWords).map(stem));
  const forbidden = plans.map((pi, i) => {
    const fams = new Set(pi.mains.map((c) => c.family));
    const out = new Map<string, string>();
    plans.forEach((pj, j) => {
      if (j === i) return;
      const shared = pj.mains.some((c) => fams.has(c.family));
      for (const [st, w] of shared ? pj.distinct : pj.nouns) {
        if (pi.distinct.has(st) || pi.nouns.has(st) || pi.vocab.has(st) || geoStems.has(st) || out.has(st)) continue;
        out.set(st, w);
      }
    });
    return out;
  });

  const seen = new Set<string>();
  type Draft = { unit: Unit; core: string[]; kws: string[]; generic: boolean; mains: Concept[]; forbidden: Map<string, string> };
  const drafts: Draft[] = plans.map((pl, ui) => {
    const bad = forbidden[ui];
    const okPhrase = (p: string) => !sigWords(p).some((w) => bad.has(stem(w)));
    const core = uniq([...pl.genericHeads, ...pl.own]).filter((p) => sigCount(p) <= 5 && okPhrase(p) && toDirect(p) && !seen.has(phraseKey(p)));
    const pros = pl.pros.filter(okPhrase);
    const main = pl.mains[0];
    const kind = main?.kind ?? sem.kind;
    const primary = core.slice(0, 4);
    const tiers: string[][] = [];
    tiers.push(core);
    tiers.push(core.slice(0, 8).flatMap((p) => geo.city.map((c) => `${p} ${c}`)));
    tiers.push(primary.flatMap((p) => [...COMMERCIAL.suffix.map((m) => `${p} ${m}`), ...COMMERCIAL.prefix.map((m) => `${m} ${p}`)]));
    // Намерения: «где сделать маникюр», «записаться на стрижку», «записаться к остеопату»
    const intents: string[] = [];
    for (const p of primary.slice(0, 2)) {
      const a = acc(p);
      if (kind === "class") intents.push(`записаться на ${a}`, `куда сходить на ${a}`, `${p} занятия`, `${p} расписание`, `${p} абонемент`, `${p} пробное занятие`, `${p} для начинающих`);
      else if (kind === "visit") {
        const dat = main?.dat && lower(main.noun ?? "") === p ? main.dat : null;
        intents.push(...(dat ? [`записаться к ${dat}`, `${p} прием`, `${p} консультация`] : [`записаться на ${a}`]));
      } else intents.push(`где сделать ${a}`, `записаться на ${a}`, `сделать ${a}`);
      for (const t of sem.intents ?? []) intents.push(t.replace("{acc}", a).replace("{x}", p));
    }
    tiers.push(intents);
    // Специалист и место: «мастер маникюра екатеринбург», «массажный кабинет рядом», «маникюр салон»
    tiers.push([
      ...pros,
      ...pros.flatMap((p) => [...geo.city.slice(0, 1).map((c) => `${p} ${c}`), `${p} рядом`, `${p} отзывы`]),
      ...primary.slice(0, 2).flatMap((p) => sem.venues.map((v) => `${p} ${v}`)),
    ]);
    tiers.push(primary.slice(0, 3).flatMap((p) => geo.local.map((l) => `${p} ${l}`)));
    // «лучший маникюр», «хорошая стрижка» — в запросах можно (в объявлениях — нет)
    const nounish = primary.filter((p) => genderOf(p) !== "p" && !asAdj(plainWords(p)[0] ?? "")).slice(0, 2);
    tiers.push(nounish.flatMap((p) => COMMERCIAL.adjectives.map((a) => agree(adjFromStem(a), p))));
    tiers.push(core.slice(4).flatMap((p) => ["цена", "недорого", "запись", "рядом"].map((m) => `${p} ${m}`)));
    tiers.push(primary.slice(0, 2).flatMap((p) => geo.city.slice(0, 1).flatMap((c) => ["цена", "недорого", "запись", "отзывы", "рядом"].map((m) => `${p} ${c} ${m}`))));
    tiers.push(core.slice(0, 3).flatMap((p) => geo.local.flatMap((l) => ["цена", "рядом"].map((m) => `${p} ${l} ${m}`))));

    const kws: string[] = [];
    const local = new Set<string>();
    tiers.forEach((t, ti) => {
      for (const raw of t) {
        if (kws.length >= perGroup) break;
        if (ti > 0 && sigCount(raw) > 6) continue; // длинные хвосты почти не ищут
        if (!okPhrase(raw)) continue;
        const d = toDirect(raw);
        if (!d) continue;
        const k = phraseKey(raw);
        if (!k || local.has(k) || seen.has(k)) continue;
        local.add(k);
        seen.add(k);
        kws.push(d);
      }
    });
    return { unit: pl.unit, core, kws, generic: pl.genericHeads.length > 0, mains: pl.mains, forbidden: bad };
  });

  // Слишком маленькие группы (повторяют соседние) — в группу того же понятия
  for (let i = drafts.length - 1; i >= 0 && drafts.length > 1; i--) {
    const d = drafts[i];
    if (d.kws.length >= SEM.minGroup) continue;
    const j = drafts.findIndex((x, k) => k !== i && x.mains[0]?.family === d.mains[0]?.family);
    const into = drafts[j >= 0 ? j : i === 0 ? 1 : 0];
    into.unit.parsed.push(...d.unit.parsed);
    for (const k of d.kws) if (into.kws.length < perGroup && !into.kws.some((x) => conflictsAny(into.forbidden, x))) into.kws.push(k);
    into.core = uniq([...into.core, ...d.core]);
    drafts.splice(i, 1);
  }

  const groups: SemanticGroup[] = drafts.map((d) => {
    let negatives = [...d.forbidden.values()].filter((w) => !d.kws.some((k) => conflicts(w, k)));
    while (negatives.join(" ").length > SEM.groupNegChars) negatives = negatives.slice(0, -1);
    const svcs = d.unit.parsed.map((p) => p.svc);
    const sigs = new Set(d.unit.parsed.map((p) => p.sig));
    const cats = new Set(svcs.map((s) => (s.category ?? "").trim()));
    const noun = d.mains[0] ? cap(lower(d.mains[0].noun ?? d.mains[0].heads[0])) : "";
    // Одна услуга (или одинаковые) — её название; разные, слитые из-за лимита групп, — раздел или понятие
    const named = d.unit.parsed.filter((p) => !p.implied).map((p) => p.svc);
    const name = sigs.size === 1 ? [...(named.length ? named : svcs)].sort((a, b) => a.name.length - b.name.length)[0].name : cats.size === 1 && [...cats][0] ? [...cats][0] : noun || svcs[0].name;
    return {
      name,
      service: svcs[0].name,
      services: svcs.map((s) => s.name),
      category: d.unit.category,
      concepts: [...new Set(d.unit.parsed.flatMap((p) => [...p.mains, ...p.mods].map((c) => c.id)))],
      keywords: d.kws,
      negatives,
      core: d.core.slice(0, 30),
      layer: "service" as const,
    };
  });

  // Общая группа: как ищут сам бизнес («доставка суши», «детский остеопат») — услуги с сайта читаются не всегда полностью,
  // а реклама только по позициям прайса теряет основной спрос. Фразы — из анкеты (searchTopics: YandexGPT по описанию,
  // названию и услугам). Фразы, которые уже взяли группы услуг, сюда не попадают
  // Только фразы из анкеты: базовые запросы ниши сюда не берём — в них бывают услуги, которых у владельца нет
  const topics = uniq((b.searchTopics ?? []).map(lower)).filter((t) => toDirect(t) && sigCount(t) <= 4);
  let general = 0;
  if (topics.length) {
    const tiers: string[][] = [
      topics,
      topics.slice(0, 6).flatMap((t) => geo.city.map((c) => `${t} ${c}`)),
      topics.slice(0, 3).flatMap((t) => [...COMMERCIAL.suffix.map((m) => `${t} ${m}`), ...COMMERCIAL.prefix.map((m) => `${m} ${t}`)]),
      topics.slice(0, 3).flatMap((t) => geo.local.map((l) => `${t} ${l}`)),
      topics.slice(0, 4).flatMap((t) => ["рядом", "отзывы", "цена"].map((m) => `${t} ${m}`)),
    ];
    const kws: string[] = [];
    for (const t of tiers) for (const raw of t) {
      if (kws.length >= perGroup) break;
      const d = toDirect(raw);
      const k = phraseKey(raw);
      if (!d || !k || seen.has(k)) continue;
      seen.add(k);
      kws.push(d);
    }
    if (kws.length >= SEM.minGroup) {
      groups.unshift({
        name: cap(topics[0]),
        service: services[0]?.name ?? (niche.id === "other" ? b.name : niche.generic),
        services: services.slice(0, 5).map((x) => x.name),
        category: "",
        concepts: [],
        keywords: kws,
        negatives: [],
        core: topics.slice(0, 30),
        layer: "service" as const,
      });
      general = 1;
    }
  }

  // Слои: проблемы клиентов, смежные запросы, аудитории — только для услуг, которые есть у владельца
  if (services.length && opts.layers !== false) groups.push(...layerGroups(b, niche.id, services, geo, groups.slice(general)));

  const all = groups.flatMap((g) => g.keywords);
  const negatives = uniq(niche.negatives.map((n) => n.trim()).filter(Boolean)).filter((n) => !all.some((k) => conflicts(n, k)));
  return { groups, negatives, geo, total: all.length, checks: {}, medical };
}

// ─── Слои: проблемы, смежные запросы, аудитории ────────────────────────────

export const LAYER_SEM = {
  /** Сколько групп слоя: больше — бюджет размазывается, и робот долго не может сравнить слои */
  cap: { problem: 5, adjacent: 3, audience: 4 } as Record<Exclude<Layer, "service">, number>,
  perGroup: 60,
  minGroup: 5,
} as const;

/** Хвосты и общие слова: не отличают группу от соседней — их не минусуем у других групп */
const TAIL = new Set(["лечение", "лечения", "кому", "куда", "обратиться", "делать", "что", "цена", "стоимость", "запись", "рядом", "отзывы", "недорого", "хороший", "как", "после", "для", "очень", "сильно", "частые", "новый", "между", "одну", "сторону", "быстро", "тела", "тело", "взрослых", "взрослого", "салоне", "занятия"]);
/** Повторный или пакетный приём — не основная услуга для группы слоя */
const SECONDARY = /повтор|вторичн|абонемент|сертификат|пакет|курс\s|^курс|комплекс/;
const svcText = (s: Service) => lower(`${s.name ?? ""} ${s.category ?? ""}`);
/** Похожие словоформы, которые наш грубый стеммер не свёл («взрослых» и «взрослый»): Директ их сведёт — считаем конфликтом */
const skeleton = (w: string) => w.slice(0, 5).replace(/[аеёиоуыэюяьъй]/g, "");
const near = (a: string, b: string) => {
  if (Math.min(a.length, b.length) <= 4) return a.length >= 3 && b.length >= 3 && a.slice(0, 2) === b.slice(0, 2) && Math.abs(a.length - b.length) <= 1;
  // «взрослых» и «взрослый», «ноготь» и «ногти» (беглая гласная)
  return a.slice(0, 4) === b.slice(0, 4) || (skeleton(a).length >= 3 && skeleton(a) === skeleton(b));
};
const blocks = (w: string, kws: string[]) => kws.some((k) => conflicts(w, k) || (!w.includes(" ") && sigWords(k).some((x) => near(lower(w), x))));

/** «Остеопат в выходные», «маникюр вечером»: только если это правда по часам работы */
function timeEntries(b: B, noun: string): LayerEntry[] {
  const h = lower(b.hours);
  if (!h || !noun) return [];
  const phrases: string[] = [];
  // По разобранным часам: «Пн–Сб 10–20, Вс выходной» — суббота рабочая, воскресенье нет (а не «вс» в тексте)
  const week = parseWeekHours(b.hours);
  const daily = /ежедневн|без выходных|круглосуточ/.test(h);
  const sat = week ? !!week[5] : daily || /(?<!\p{L})(сб|суб\p{L}*)(?!\p{L})/u.test(h);
  const sun = week ? !!week[6] : daily || /(?<!\p{L})(вс|воскр\p{L}*)(?!\p{L})/u.test(h);
  if (sat && sun) phrases.push(`${noun} в выходные`);
  if (sat) phrases.push(`${noun} в субботу`);
  if (sun) phrases.push(`${noun} в воскресенье`);
  const closes = [...h.matchAll(/[-–—]\s*(\d{1,2})[:.]\d{2}/g)].map((m) => Number(m[1]));
  const late = closes.length ? Math.max(...closes) : 0;
  if (late >= 20) phrases.push(`${noun} вечером`, ...(late >= 21 ? [`${noun} поздно вечером`] : []));
  if (!phrases.length) return [];
  return [{ id: "time", layer: "audience", label: "Удобное время", to: /./, noun, ask: cap(phrases[0]), phrases }];
}

/**
 * Группы слоёв из словаря ниши. Каждая запись словаря → группа, если у владельца есть услуга, к которой она ведёт
 * (детские проблемы — только к детской услуге). Фразы × специалист × город × хвосты «к кому обратиться», «цена»;
 * без повторов с уже собранными группами услуг; фразы, которые задели бы минус-слова кампании, не берём.
 * Минус-слова группы: мусор слоя (упражнения, таблетки, форум…) + отличительные слова соседних групп слоя.
 * Группам услуг добавляем отличительные слова слоёв — чтобы «остеопат при головной боли цена» уходил в группу
 * проблемы с подходящим объявлением, а «остеопат цена» оставался в группе услуги.
 */
function layerGroups(b: B, nicheId: string, services: Service[], geo: SemanticCore["geo"], serviceGroups: SemanticGroup[]): SemanticGroup[] {
  const niche = nicheById(nicheId);
  const all = services.map(svcText).join(" \n ");
  const hasKids = services.some((s) => KIDS_RE.test(svcText(s)));
  const seen = new Set(serviceGroups.flatMap((g) => g.keywords).map(phraseKey));
  const campaignNeg = niche.negatives;
  const geoStems = new Set([...geo.city, ...geo.local].flatMap(sigWords).map(stem));
  const mainNoun = (() => {
    const p = parseService(services.find((s) => !SECONDARY.test(svcText(s)) && !KIDS_RE.test(svcText(s))) ?? services[0], nicheId);
    const c = p.mains[0];
    return c ? lower(c.noun ?? c.heads[0]) : sigWords(p.base).length <= 2 ? p.base : "";
  })();
  const entries = [...layersFor(nicheId), ...timeEntries(b, /остеопат/.test(all) ? "остеопат" : mainNoun)];
  const count: Record<string, number> = { problem: 0, adjacent: 0, audience: 0 };
  type Draft = SemanticGroup & { sig: Map<string, string> };
  const drafts: Draft[] = [];

  for (const e of entries) {
    if (count[e.layer] >= LAYER_SEM.cap[e.layer]) continue;
    if (e.unless?.test(all)) continue;
    let cands = services.filter((s) => e.to.test(svcText(s)));
    cands = e.kids ? cands.filter((s) => KIDS_RE.test(svcText(s))) : cands.filter((s) => !KIDS_RE.test(svcText(s)));
    if (!cands.length) continue;
    const primary = cands.filter((s) => !SECONDARY.test(svcText(s)));
    const pool = primary.length ? primary : cands;
    const target = (e.prefer && pool.find((s) => e.prefer!.test(svcText(s)))) || pool[0];
    const phrases = uniq(e.phrases.filter((p) => typeof p === "string" || p[1].test(all)).map((p) => lower(typeof p === "string" ? p : p[0])));
    if (!phrases.length) continue;
    const parsed = parseService(target, nicheId);
    const c = parsed.mains[0];
    const noun = lower(e.noun ?? (c ? c.noun ?? c.heads[0] : sigWords(parsed.base).slice(0, 2).join(" ")));
    const specialist = !!e.noun || (c?.kind ?? semanticsFor(nicheId).kind) === "visit";
    const nounStems = new Set(sigWords(noun).map(stem));
    const hasNoun = (p: string) => sigWords(p).some((w) => nounStems.has(stem(w)));
    const city = geo.city;
    const tiers: string[][] = [phrases];
    if (e.layer === "problem") {
      tiers.push((e.at ?? []).slice(0, 2).map((a) => `${noun} при ${a}`));
      const short = sigWords(noun).length <= 2;
      tiers.push(phrases.filter((p) => short && !hasNoun(p) && sigWords(p).length <= 4).slice(0, 8).map((p) => `${p} ${noun}`));
      tiers.push(phrases.slice(0, 8).flatMap((p) => city.slice(0, 1).map((ct) => `${p} ${ct}`)));
      tiers.push(phrases.slice(0, 6).flatMap((p) => [`${p} к кому обратиться`, `${p} куда обратиться`]));
      if (e.info) tiers.push(phrases.slice(0, 3).map((p) => `${p} что делать`));
      tiers.push((e.at ?? []).slice(0, 2).flatMap((a) => [...city.slice(0, 1).map((ct) => `${noun} при ${a} ${ct}`), `${noun} при ${a} цена`, `${noun} при ${a} запись`]));
      tiers.push(phrases.filter((p) => short && !hasNoun(p) && sigWords(p).length <= 3).slice(0, 4).flatMap((p) => city.slice(0, 1).map((ct) => `${p} ${noun} ${ct}`)));
      tiers.push(phrases.slice(0, 4).flatMap((p) => city.slice(1, 2).map((ct) => `${p} ${ct}`)));
    } else {
      tiers.push(phrases.flatMap((p) => city.slice(0, 1).map((ct) => `${p} ${ct}`)));
      tiers.push(phrases.slice(0, 6).flatMap((p) => ["цена", "запись", "рядом", "отзывы"].map((m) => `${p} ${m}`)));
      if (e.layer === "adjacent" && specialist) tiers.push(phrases.filter((p) => !hasNoun(p) && sigWords(p).length <= 2).slice(0, 4).map((p) => `${p} или ${noun}`));
      tiers.push(phrases.slice(0, 4).flatMap((p) => city.slice(1, 2).map((ct) => `${p} ${ct}`)));
      tiers.push(phrases.slice(0, 3).flatMap((p) => city.slice(0, 1).flatMap((ct) => ["цена", "запись"].map((m) => `${p} ${ct} ${m}`))));
    }
    const junk = uniq([...LAYER_JUNK, ...(e.neg ?? []), ...(hasKids ? [] : NO_KIDS_NEG)]);
    const kws: string[] = [];
    const local = new Set<string>();
    tiers.forEach((t, ti) => {
      for (const raw of t) {
        if (kws.length >= LAYER_SEM.perGroup) break;
        if ((ti > 0 && sigCount(raw) > 6) || plainWords(raw).length > SEM.words) continue;
        const d = toDirect(raw);
        if (!d) continue;
        const k = phraseKey(raw);
        if (!k || local.has(k) || seen.has(k)) continue;
        // Фраза, которую заблокировали бы минус-слова кампании или мусор слоя, — не берём (минус-слова важнее)
        if (campaignNeg.some((n) => conflicts(n, raw)) || junk.some((n) => conflicts(n, raw) && !phrases.some((p) => conflicts(n, p)))) continue;
        local.add(k);
        kws.push(d);
      }
    });
    if (kws.length < LAYER_SEM.minGroup) continue;
    for (const k of kws) seen.add(phraseKey(k));
    // Отличительные слова группы — минус-слова для соседей
    const sig = new Map<string, string>();
    for (const p of phrases) for (const w of sigWords(p)) {
      const st = stem(w);
      if (w.length < 4 || TAIL.has(w) || GENERIC.has(w) || nounStems.has(st) || geoStems.has(st) || /\d/.test(w)) continue;
      if (!sig.has(st)) sig.set(st, w);
    }
    drafts.push({
      name: e.label,
      service: target.name,
      services: [target.name],
      category: (target.category ?? "").trim(),
      concepts: c ? [c.id] : [],
      keywords: kws,
      negatives: junk.filter((n) => !blocks(n, kws)),
      core: phrases.slice(0, 30),
      layer: e.layer,
      hook: { entry: e.id, ask: e.ask, ...(e.when ? { when: e.when } : {}), noun },
      sig,
    });
    count[e.layer]++;
  }

  // Кросс-минусовка: соседние группы слоёв друг другу, группам услуг — слова всех слоёв
  const capNeg = (list: string[]) => {
    let out = uniq(list);
    while (out.join(" ").length > SEM.groupNegChars) out = out.slice(0, -1);
    return out;
  };
  for (const d of drafts) {
    const extra = drafts.filter((x) => x !== d).flatMap((x) => [...x.sig.values()]).filter((w) => !blocks(w, d.keywords) && !d.sig.has(stem(w)));
    d.negatives = capNeg([...d.negatives, ...extra]);
  }
  const layerWords = uniq(drafts.flatMap((x) => [...x.sig.values()]));
  for (const g of serviceGroups) {
    const own = new Set(g.keywords.flatMap(sigWords).map(stem));
    g.negatives = capNeg([...g.negatives, ...layerWords.filter((w) => !own.has(stem(w)) && !blocks(w, g.keywords))]);
  }
  return drafts.map(({ sig: _s, ...g }) => g);
}

const conflictsAny = (forbidden: Map<string, string>, keyword: string) => sigWords(keyword).some((w) => forbidden.has(stem(w)));

function uniq(list: string[]) {
  const s = new Set<string>();
  return list.filter((x) => {
    const k = lower(x).trim();
    if (!k || s.has(k)) return false;
    s.add(k);
    return true;
  });
}

/** Пересчёт итогов и минус-слов кампании после правок групп (проверка частотности, расширение) */
export function finalizeCore(core: SemanticCore, nicheId: string): SemanticCore {
  const all = core.groups.flatMap((g) => g.keywords);
  const negatives = uniq(nicheById(nicheId).negatives).filter((n) => !all.some((k) => conflicts(n, k)));
  for (const g of core.groups) g.negatives = g.negatives.filter((n) => !g.keywords.some((k) => conflicts(n, k)));
  return { ...core, negatives, total: all.length };
}

// ─── Расширение синонимами от модели: только проверенное ────────────────

/**
 * Фраза от модели подходит группе: 2–7 слов, есть слово самой услуги, нет слов соседних групп (минус-слов группы),
 * минус-слов кампании и названий услуг ниши, которых у владельца нет (модель не придумывает услуги).
 */
export function acceptPhrase(core: SemanticCore, gi: number, phrase: string, nicheId: string): string | null {
  const g = core.groups[gi];
  if (!g) return null;
  const p = displayKeyword(phrase);
  if (!p || /[^\p{L}\s-]/u.test(p) || /[a-z]/.test(p)) return null;
  const ws = sigWords(p);
  if (ws.length < 1 || ws.length > SEM.words) return null;
  const stems = ws.map(stem);
  const own = new Set([...g.core, ...g.services.map(cleanServiceName)].flatMap(sigWords).map(stem));
  if (!stems.some((s) => own.has(s))) return null;
  if (g.negatives.some((n) => stems.includes(stem(n)))) return null;
  if (core.negatives.some((n) => conflicts(n, p))) return null;
  const sem = semanticsFor(nicheId);
  const used = new Set(core.groups.flatMap((x) => x.concepts));
  const usedFamilies = new Set(sem.concepts.filter((c) => used.has(c.id)).map((c) => c.family));
  const foreign = vocab(sem.concepts.filter((c) => !c.mod && !used.has(c.id) && !usedFamilies.has(c.family)));
  for (const s of own) foreign.delete(s);
  if (stems.some((s) => foreign.has(s))) return null;
  return toDirect(p);
}

/** Добавить проверенные фразы в группу (без повторов по всему ядру). Возвращает, сколько добавлено */
export function addPhrases(core: SemanticCore, gi: number, phrases: string[], nicheId: string, limit = 20) {
  const g = core.groups[gi];
  if (!g) return 0;
  const keys = new Set(core.groups.flatMap((x) => x.keywords).map(phraseKey));
  let added = 0;
  for (const ph of phrases) {
    if (added >= limit || g.keywords.length >= 200) break;
    const d = acceptPhrase(core, gi, ph, nicheId);
    if (!d) continue;
    const k = phraseKey(d);
    if (keys.has(k)) continue;
    keys.add(k);
    g.keywords.push(d);
    added++;
  }
  return added;
}

// ─── Проверка через Директ: частотность и дубли ─────────────────────────

/** Методы keywordsresearch, которые нужны ядру (реализация — YandexDirect) */
export type DirectResearch = {
  /** keywordsresearch.hasSearchVolume: фраза → были ли показы в регионах (AllDevices) */
  hasSearchVolume(keywords: string[], regionIds: number[]): Promise<Map<string, boolean>>;
  /** keywordsresearch.deduplicate (MERGE_DUPLICATES): что заменить и что удалить */
  deduplicate(items: { id: number; keyword: string }[]): Promise<{ update: { id: number; keyword: string }[]; remove: number[] }>;
};

/**
 * Убираем фразы без показов в регионе и дубли, которые Директ считает одинаковыми. В каждой группе оставляем
 * хотя бы SEM.keepMin фраз (по порядку важности), даже без показов: группа без фраз осталась бы без трафика.
 * Ошибки API не ломают запуск: возвращаем ядро как было.
 */
export async function refineWithDirect(core: SemanticCore, api: DirectResearch, regionIds: number[], nicheId: string): Promise<SemanticCore> {
  const out: SemanticCore = { ...core, groups: core.groups.map((g) => ({ ...g, keywords: [...g.keywords] })), checks: { ...core.checks } };
  try {
    const all = [...new Set(out.groups.flatMap((g) => g.keywords))];
    const vol = new Map<string, boolean>();
    for (let i = 0; i < all.length; i += 10_000) for (const [k, v] of await api.hasSearchVolume(all.slice(i, i + 10_000), regionIds)) vol.set(k, v);
    const dropped: string[] = [];
    const none: string[] = [];
    for (const g of out.groups) {
      const keep = g.keywords.filter((k) => vol.get(k) !== false);
      const restore = g.keywords.filter((k) => !keep.includes(k)).slice(0, Math.max(0, SEM.keepMin - keep.length));
      none.push(...restore);
      dropped.push(...g.keywords.filter((k) => !keep.includes(k) && !restore.includes(k)));
      g.keywords = g.keywords.filter((k) => keep.includes(k) || restore.includes(k));
    }
    out.checks.volume = { checked: all.length, dropped: dropped.length, examples: dropped.slice(0, 8).map(displayKeyword), ...(none.length ? { none: none.slice(0, 200) } : {}) };
  } catch {
    out.checks.volume = null;
  }
  try {
    const items: { id: number; keyword: string; g: number }[] = [];
    out.groups.forEach((g, gi) => g.keywords.forEach((keyword) => items.push({ id: items.length + 1, keyword, g: gi })));
    if (items.length) {
      const r = await api.deduplicate(items.map(({ id, keyword }) => ({ id, keyword })));
      const remove = new Set(r.remove);
      const upd = new Map(r.update.map((u) => [u.id, u.keyword]));
      out.groups.forEach((g, gi) => {
        const mine = items.filter((x) => x.g === gi);
        const next = mine.filter((x) => !remove.has(x.id)).map((x) => upd.get(x.id) ?? x.keyword);
        g.keywords = next.length ? next : mine.slice(0, SEM.keepMin).map((x) => x.keyword);
      });
      out.checks.dedup = { merged: remove.size };
    }
  } catch {
    out.checks.dedup = null;
  }
  return finalizeCore(out, nicheId);
}

// ─── Для РСЯ и показа владельцу ───────────────────────────────────────

/** Интересы для РСЯ: тематические фразы по разделам/понятиям (без операторов и гео) */
export function networkInterests(core: SemanticCore, max = 3): { name: string; service: string; keywords: string[] }[] {
  const byKey = new Map<string, { name: string; service: string; keywords: string[] }>();
  // Только услуги: тёплые запросы о проблемах и аудитории (беременность, болезни) — деликатные темы, интересы по ним в РСЯ
  // Яндекс не разрешает, а показы «похожим» по симптомам — это персональный таргетинг по здоровью
  for (const g of core.groups.filter((x) => (x.layer ?? "service") === "service")) {
    const key = g.category || g.concepts[0] || g.name;
    const cur = byKey.get(key) ?? { name: g.category || g.name, service: g.service, keywords: [] };
    cur.keywords.push(...g.core.map(displayKeyword));
    byKey.set(key, cur);
  }
  return [...byKey.values()].slice(0, max).map((x) => ({ ...x, keywords: uniq(x.keywords).filter((k) => sigWords(k).length <= SEM.words).slice(0, 20) }));
}

export type SemanticsView = {
  total: number;
  groups: { id?: string; name: string; services: string[]; count: number; sample: string[]; keywords: string[]; negatives: string[]; layer: Layer; layerLabel: string; demand?: number }[];
  /** Итоги по слоям: группы и запросы */
  layers: { id: Layer; label: string; groups: number; count: number }[];
  negatives: string[];
  geo: { city: string[]; local: string[] };
  checks: SemanticChecks;
  medical?: boolean;
};

/** То, что показываем владельцу: фразы без операторов, примеры, минус-слова */
export function semanticsView(core: {
  groups: { id?: string; name: string; service?: string; services?: string[]; keywords: string[]; negatives?: string[]; layer?: Layer; demand?: number }[];
  negatives: string[];
  geo: SemanticCore["geo"];
  checks: SemanticChecks;
  medical?: boolean;
}): SemanticsView {
  const groups = core.groups.map((g) => {
    const keywords = uniq(g.keywords.map(displayKeyword));
    const layer = g.layer ?? "service";
    return { id: g.id, name: g.name, services: g.services ?? (g.service ? [g.service] : [g.name]), count: keywords.length, sample: keywords.slice(0, 12), keywords, negatives: g.negatives ?? [], layer, layerLabel: LAYER_LABEL[layer], ...(typeof g.demand === "number" ? { demand: g.demand } : {}) };
  });
  // Порядок: услуги, проблемы, смежные, аудитории
  groups.sort((a, b) => LAYERS.indexOf(a.layer) - LAYERS.indexOf(b.layer));
  const layers = LAYERS.map((id) => ({ id, label: LAYER_LABEL[id], groups: groups.filter((g) => g.layer === id).length, count: groups.filter((g) => g.layer === id).reduce((s, g) => s + g.count, 0) })).filter((x) => x.groups);
  return { total: groups.reduce((s, g) => s + g.count, 0), groups, layers, negatives: core.negatives, geo: core.geo, checks: core.checks, ...(core.medical ? { medical: true } : {}) };
}


// ─── Охват поиска: точно / оптимально / широко ──────────────────────────

/** Маркеры намерения «записаться»: цена, запись, рядом, салон/мастер, срочность */
const INTENT_RE = /(^|\s)(цен\S*|стоимост\S*|сколько|прайс|запис\S*|рядом|недорог\S*|дешев\S*|салон\S*|студи\S*|мастер\S*|кабинет\S*|центр\S*|клиник\S*|врач\S*|адрес\S*|сегодня|завтра|срочно|круглосуточно|отзыв\S*|лучш\S*|недалеко|возле|около|метро|район\S*|улиц\S*|онлайн)(\s|$)/;
/** Информационные хвосты, которые не продают (дублирует wordstat.INFO_RE для фраз ядра) + год («маникюр 2026» — тренды) */
const INFO_KW_RE = /(^|\s)(фото\S*|картинк\S*|иде[яи]\S*|видео|тренд\S*|модн\S*|новинк\S*|своими|дома|как|что|почему|обучени\S*|курс\S*|вакан\S*|20\d\d)(\s|$)/;

/**
 * Фразы поиска под выбранный охват. Директолог на маленьком бюджете не покупает «ногти» и «маникюр»:
 * это сотни тысяч показов в месяц, большинство — не про запись. Поэтому:
 *  - precise: остаются фразы с намерением (цена, запись, рядом, город/район) или из 3+ слов; двухсловные — в кавычках;
 *  - balanced: без однословных и информационных; двухсловные без намерения — в кавычках (Директ не расширяет);
 *  - wide: как есть.
 * Не меньше `min` фраз в группе: если фильтр выкинул всё, оставляем самые конкретные (длинные).
 */
/** Попадает ли фраза в охват (те же правила, что reachKeywords): для подсчёта спроса под выбранный охват */
export function phraseInReach(phrase: string, reach: "precise" | "balanced" | "wide" | undefined, geo: { city: string[]; local: string[] }): boolean {
  if (!reach || reach === "wide") return true;
  const plain = displayKeyword(phrase);
  const n = sigWords(plain).length;
  if (INFO_KW_RE.test(plain) || n < 2) return false;
  if (reach === "balanced") return true;
  const geoRe = new RegExp(`(^|\\s)(${[...geo.city, ...geo.local].map((g) => g.split(/\s+/).map((w) => stem(w).replace(/[.*+?^${}()|[\]\\]/g, "")).join("\\S*\\s+")).filter(Boolean).join("|") || "$^"})`, "i");
  return n >= 3 || INTENT_RE.test(plain) || geoRe.test(plain);
}

export function reachKeywords(keywords: string[], reach: "precise" | "balanced" | "wide" | undefined, geo: { city: string[]; local: string[] }, min = 3): string[] {
  if (!reach || reach === "wide") return keywords;
  const geoRe = new RegExp(`(^|\\s)(${[...geo.city, ...geo.local].map((g) => g.split(/\s+/).map((w) => stem(w).replace(/[.*+?^${}()|[\]\\]/g, "")).join("\\S*\\s+")).filter(Boolean).join("|") || "$^"})`, "i");
  const scored = keywords.map((k) => {
    const plain = displayKeyword(k);
    const words = sigWords(plain);
    const intent = INTENT_RE.test(plain) || geoRe.test(plain);
    const info = INFO_KW_RE.test(plain);
    return { k, plain, n: words.length, intent, info };
  });
  // Кавычки фиксируют число слов: Директ не покажет «маникюр гель» по «маникюр гель лак фото» (операторы +без сохраняем)
  const fix = (x: { k: string; n: number }) => (x.n === 2 && !/^".*"$/.test(x.k) && !/\s-/.test(x.k) ? `"${x.k}"` : x.k);
  let out: string[];
  if (reach === "precise") out = scored.filter((x) => !x.info && x.n >= 2 && (x.intent || x.n >= 3)).map(fix);
  else out = scored.filter((x) => !x.info && x.n >= 2).map((x) => (x.intent ? x.k : fix(x)));
  if (out.length < min) {
    const extra = scored.filter((x) => !x.info && x.n >= 2).sort((a, b) => b.n - a.n).map(fix).filter((k) => !out.includes(k));
    out = [...out, ...extra].slice(0, Math.max(min, out.length));
  }
  // Совсем пусто (в группе одни общие или информационные фразы) — оставляем исходные без информационных,
  // а если и их нет — исходные как есть: группа без фраз в Директе вообще не показывается
  if (!out.length) out = scored.filter((x) => !x.info).map((x) => x.k);
  if (!out.length) out = keywords;
  return [...new Set(out)];
}

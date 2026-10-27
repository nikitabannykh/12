/**
 * Приведение найденного к виду анкеты: телефоны, мессенджеры, часы работы, цены, город, сфера.
 * Чистые функции — их проверяют тесты (scripts/test-importer.ts).
 */
import type { ImportService } from "./types";
import type { Block } from "./html";
import { hasSuperlative, parseWeekHours } from "../engine/extras";

// ─── Телефоны и мессенджеры ───────────────────────────────────────────

/** «89001234567», «+7(900)123-45-67» → «+7 900 123-45-67». Не российский — как есть, без лишних пробелов. */
export function formatPhone(raw?: string | null): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  const d = s.replace(/\D/g, "");
  // Заглушки шаблонов: +7 000 000-00-00, 8 999 999 99 99
  if (/^[78]?(\d)\1{9}$/.test(d)) return "";
  if (d.length === 11 && /^[78]/.test(d)) return `+7 ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
  if (d.length === 10 && /^9/.test(d)) return `+7 ${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8)}`;
  if (d.length >= 10 && d.length <= 15 && s.startsWith("+")) return `+${d}`;
  return s.replace(/\s+/g, " ").slice(0, 40);
}

/** Телефон в тексте (российский формат) */
export function phoneInText(text: string): string {
  const m = text.match(/(?<![\d+])(?:\+7|8)[\s\-‒–(]*\d{3}[\s\-‒–)]*\d{3}[\s\-‒–]*\d{2}[\s\-‒–]*\d{2}(?!\d)/);
  return m ? formatPhone(m[0]) : "";
}

/** WhatsApp из ссылки: wa.me/79…, api.whatsapp.com/send?phone=…, whatsapp://send?phone=… */
export function whatsappFrom(href: string): string {
  const m = href.match(/(?:wa\.me|whatsapp\.com\/send|whatsapp:\/\/send|wa\.clck\.bar)\/?(?:\?phone=|\/)?\+?(\d{10,15})/i) ?? href.match(/whatsapp[^?]*\?(?:.*&)?phone=\+?(\d{10,15})/i);
  return m ? formatPhone(`+${m[1]}`) : "";
}

/** Telegram из ссылки: t.me/name → @name; t.me/+79… → +7 …; служебные ссылки (share, joinchat) — нет */
export function telegramFrom(href: string): string {
  const m = href.match(/(?:t\.me|telegram\.me|telegram\.dog)\/([^/?#\s]+)/i) ?? href.match(/^tg:\/\/resolve\?domain=([\w]+)/i);
  if (!m) return "";
  const v = decodeURIComponent(m[1]);
  if (/^\+?\d{10,15}$/.test(v)) return formatPhone(v.startsWith("+") ? v : `+${v}`);
  if (/^(share|joinchat|addstickers|iv|s|c|proxy|socks|setlanguage|login|\+)$/i.test(v) || v.startsWith("+")) return "";
  return /^[a-z][\w]{3,31}$/i.test(v) ? `@${v}` : "";
}

// ─── Цены ─────────────────────────────────────────────────────────────

const group = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/** Цена как в анкете: «1 900 ₽», «от 1 500 ₽», «1 500–2 000 ₽» */
export function formatPrice(min: number | null | undefined, max?: number | null, from = false): string {
  if (!min || !Number.isFinite(min) || min <= 0) return "";
  if (max && max > min) return `${group(min)}–${group(max)} ₽`;
  return `${from ? "от " : ""}${group(min)} ₽`;
}

const num = (s: string) => Number(s.replace(/[\s  ]/g, "").replace(",", "."));

/** «от 1500 руб.», «1 297–2 100 ₽», «2000» → нормальная цена или "" */
export function normalizePrice(raw: unknown): string {
  if (typeof raw === "number") return raw >= 50 && raw <= 500000 ? formatPrice(raw) : "";
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  const m = s.match(/(от|from)?\s*(\d{1,3}(?:[   ]\d{3})+|\d+)(?:[.,]\d{1,2})?(?:\s*(?:-|–|—|до)\s*(\d{1,3}(?:[   ]\d{3})+|\d+)(?:[.,]\d{1,2})?)?/i);
  if (!m) return "";
  const a = num(m[2]);
  const b = m[3] ? num(m[3]) : null;
  if (!(a >= 50 && a <= 500000)) return "";
  return formatPrice(a, b && b > a && b <= 1000000 ? b : null, Boolean(m[1]));
}

const CUR = String.raw`(?:₽|руб(?:\.|лей|ля|ль)?|р\.(?!\w)|rub\b|rur\b)`;
const AMOUNT = String.raw`\d{1,3}(?:[   ]\d{3})+|\d{2,6}`;
const PRICE_RE = new RegExp(String.raw`(?:(от|from)\s*)?(${AMOUNT})(?:[.,]\d{1,2})?(?:\s*(?:-|–|—|до)\s*(${AMOUNT})(?:[.,]\d{1,2})?)?\s*${CUR}`, "i");
const PRICE_ONLY = new RegExp(String.raw`^(?:цена[:\s]*)?(?:(от|from)\s*)?(${AMOUNT})(?:[.,]\d{1,2})?(?:\s*(?:-|–|—|до)\s*(${AMOUNT}))?\s*${CUR}?\s*$`, "i");

const NOT_SERVICE = /(итого|всего|доставк|депозит|предоплат|штраф|корзин|оплат|скидк[аи]\s+\d|баланс|кэшбэк|бонус|подписк|в\s+месяц\s*$|зарплат|ваканс|доход|аренд[аы]\s+(кабинет|места)|^тел|^телефон|^адрес|^\d)/i;
const HEADING = /^(цены|прайс|прайс-лист|стоимость|услуги|наши услуги|услуги и цены|цена|price|prices|services)\s*:?$/i;

/** Название услуги из строки прайса: без точек-заполнителей, нумерации и хвостовых разделителей */
export function cleanServiceName(raw: string): string {
  let s = raw
    .replace(/\s*\|\s*/g, " ")
    .replace(/[.·…_]{3,}/g, " ")
    .replace(/^[\s•·*\-–—\d.)]+(?=\p{L})/u, "")
    .replace(/[\s:–—\-|=.,…]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
  s = s.replace(/\s*[(–—-]\s*$/, "").trim();
  if (s.length > 80) s = s.slice(0, 80).replace(/\s+\S*$/, "").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

export const isName = (s: string) => {
  if (s.length < 3 || s.length > 90) return false;
  const letters = (s.match(/\p{L}/gu) ?? []).length;
  if (letters < 3 || letters < s.replace(/\s/g, "").length * 0.5) return false;
  if (s.split(/\s+/).length > 12) return false;
  if (HEADING.test(s) || NOT_SERVICE.test(s)) return false;
  if (/https?:|www\.|@|©/.test(s)) return false;
  return true;
};

/**
 * Прайс из видимого текста страницы: строки «услуга … цена ₽» (в т. ч. ячейки таблицы «услуга | цена»)
 * и пары «название» + следующая строка «1 900 ₽» (карточки Tilda/Taplink).
 */
export function pricesFromText(text: string, limit = 15): ImportService[] {
  const out: ImportService[] = [];
  const seen = new Set<string>();
  const add = (name: string, price: string) => {
    const n = cleanServiceName(name);
    const key = n.toLowerCase().replace(/ё/g, "е");
    if (!n || !isName(n) || !price || seen.has(key)) return;
    seen.add(key);
    out.push({ name: n, price });
  };
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length && out.length < limit; i++) {
    const line = lines[i];
    if (line.length > 200) continue;
    const m = PRICE_RE.exec(line);
    if (m && m.index > 0) {
      const name = line.slice(0, m.index);
      const price = normalizePrice(m[0]);
      if (isName(cleanServiceName(name))) {
        add(name, price);
        continue;
      }
    }
    const only = PRICE_ONLY.exec(line);
    if (only && i > 0 && (only[1] || /₽|руб|р\./i.test(line) || /\d\s?\d{3}/.test(line))) {
      // Цена отдельной строкой — название строкой выше (или двумя, если выше описание — тогда берём короткую)
      const prev = lines[i - 1];
      const prev2 = lines[i - 2];
      const price = normalizePrice(line);
      if (prev && !PRICE_RE.test(prev) && isName(cleanServiceName(prev)) && prev.length <= 70) add(prev, price);
      else if (prev2 && !PRICE_RE.test(prev2) && isName(cleanServiceName(prev2)) && prev2.length <= 70) add(prev2, price);
    }
  }
  return out;
}

/**
 * Услуги из встроенного JSON (виджеты записи, состояние страниц): ищем массивы объектов,
 * у которых есть название (title/name) и цена (price/cost/price_min…).
 */
export function servicesFromJson(root: unknown, limit = 15): ImportService[] {
  const out: ImportService[] = [];
  const seen = new Set<string>();
  const NAME_KEYS = ["title", "name", "service_name", "serviceName", "label"];
  const visit = (v: unknown, depth: number) => {
    if (out.length >= limit || depth > 12 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const x of v) visit(x, depth + 1);
      return;
    }
    const o = v as Record<string, unknown>;
    const nameKey = NAME_KEYS.find((k) => typeof o[k] === "string" && (o[k] as string).trim());
    const min = o.price_min ?? o.priceMin ?? o.minPrice ?? o.min_price ?? o.price ?? o.cost ?? o.amount;
    const max = o.price_max ?? o.priceMax ?? o.maxPrice ?? o.max_price;
    if (nameKey && min !== undefined && min !== null && typeof min !== "object") {
      const a = typeof min === "number" ? min : num(String(min).replace(/[^\d.,\s]/g, ""));
      const b = max === undefined || max === null ? null : typeof max === "number" ? max : num(String(max).replace(/[^\d.,\s]/g, ""));
      const from = o.floating === true || o.price_from === true || /^от/i.test(String(o.price ?? ""));
      const price = typeof min === "string" && /[–—-]|от/i.test(min) ? normalizePrice(min) : a >= 50 && a <= 500000 ? formatPrice(a, b && b > a ? b : null, from) : "";
      const name = cleanServiceName(String(o[nameKey]));
      const key = name.toLowerCase();
      if (name && price && isName(name) && !seen.has(key)) {
        seen.add(key);
        out.push({ name, price });
      }
    }
    for (const k of Object.keys(o)) if (typeof o[k] === "object") visit(o[k], depth + 1);
  };
  visit(root, 0);
  return out;
}

// ─── Часы работы ──────────────────────────────────────────────────────

const DAYS_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
export type DayHours = { open: string; close: string } | null;

const hm = (s: string) => {
  const m = /^(\d{1,2})(?::(\d{2}))?/.exec(s.trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2] ?? "00"}` : "";
};

/** Неделя (пн…вс) → «Ежедневно 10:00–21:00» или «Пн–Пт 10:00–21:00, Сб–Вс 11:00–19:00» (понимает parseWeekHours) */
export function formatWeek(week: (DayHours | undefined)[]): string {
  if (week.length !== 7 || week.every((d) => d === undefined)) return "";
  const key = (d: DayHours | undefined) => (d ? `${d.open}–${d.close}` : "выходной");
  const k = week.map((d) => (d === undefined ? "выходной" : key(d)));
  const show = (s: string) => (s === "00:00–24:00" || s === "00:00–00:00" ? "круглосуточно" : s);
  if (k.every((x) => x === k[0])) return k[0] === "выходной" ? "" : k[0] === "00:00–24:00" || k[0] === "00:00–00:00" ? "Круглосуточно" : `Ежедневно ${k[0]}`;
  const parts: string[] = [];
  for (let i = 0; i < 7; ) {
    let j = i;
    while (j + 1 < 7 && k[j + 1] === k[i]) j++;
    const days = i === j ? DAYS_RU[i] : `${DAYS_RU[i]}–${DAYS_RU[j]}`;
    parts.push(`${days} ${show(k[i])}`);
    i = j + 1;
  }
  let s = parts.join(", ");
  if (s.length > 80) s = s.replace(/:00(?=[–,\s]|$)/g, "");
  return s.slice(0, 80);
}

const EN_DAYS: Record<string, number> = { mo: 0, tu: 1, we: 2, th: 3, fr: 4, sa: 5, su: 6, monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };

/** schema.org openingHours: «Mo-Fr 10:00-21:00», ["Mo-Su 09:00-20:00"] */
export function hoursFromSchema(v: unknown): string {
  const list = ([] as unknown[]).concat(v ?? []).map(String).join(",");
  if (!list.trim()) return "";
  const week: (DayHours | undefined)[] = Array(7).fill(undefined);
  let any = false;
  for (const part of list.split(/[,;]/)) {
    const m = /^\s*([A-Za-z]{2}(?:\s*-\s*[A-Za-z]{2})?(?:\s*,\s*[A-Za-z]{2})*)?\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/.exec(part);
    if (!m) continue;
    const days: number[] = [];
    const spec = (m[1] ?? "Mo-Su").toLowerCase().replace(/\s/g, "");
    for (const seg of spec.split(",")) {
      const [a, b] = seg.split("-").map((x) => EN_DAYS[x]);
      if (a === undefined) continue;
      if (b === undefined) days.push(a);
      else for (let d = a; ; d = (d + 1) % 7) {
        days.push(d);
        if (d === b || days.length > 7) break;
      }
    }
    for (const d of days) week[d] = { open: hm(m[2]), close: hm(m[3]) };
    any = true;
  }
  return any ? formatWeek(week) : "";
}

/** schema.org openingHoursSpecification: [{dayOfWeek, opens, closes}] */
export function hoursFromSpec(v: unknown): string {
  const list = ([] as unknown[]).concat(v ?? []) as Record<string, unknown>[];
  const week: (DayHours | undefined)[] = Array(7).fill(undefined);
  let any = false;
  for (const s of list) {
    if (!s || typeof s !== "object" || !s.opens || !s.closes) continue;
    for (const d of ([] as unknown[]).concat(s.dayOfWeek ?? [])) {
      const name = String(d).replace(/^https?:\/\/schema\.org\//, "").toLowerCase();
      const i = EN_DAYS[name] ?? EN_DAYS[name.slice(0, 2)];
      if (i === undefined) continue;
      week[i] = { open: hm(String(s.opens)), close: hm(String(s.closes)) };
      any = true;
    }
  }
  return any ? formatWeek(week) : "";
}

// ─── Город ────────────────────────────────────────────────────────────

export const CITIES = [
  "Москва", "Санкт-Петербург", "Новосибирск", "Екатеринбург", "Казань", "Нижний Новгород", "Челябинск", "Красноярск", "Самара", "Уфа",
  "Ростов-на-Дону", "Омск", "Краснодар", "Воронеж", "Пермь", "Волгоград", "Саратов", "Тюмень", "Тольятти", "Ижевск", "Барнаул",
  "Ульяновск", "Иркутск", "Хабаровск", "Махачкала", "Ярославль", "Владивосток", "Оренбург", "Томск", "Кемерово", "Новокузнецк",
  "Рязань", "Набережные Челны", "Астрахань", "Пенза", "Киров", "Липецк", "Чебоксары", "Балашиха", "Калининград", "Тула", "Курск",
  "Сочи", "Ставрополь", "Улан-Удэ", "Тверь", "Магнитогорск", "Брянск", "Иваново", "Белгород", "Сургут", "Владимир", "Архангельск",
  "Чита", "Калуга", "Смоленск", "Волжский", "Курган", "Череповец", "Орёл", "Вологда", "Саранск", "Владикавказ", "Якутск", "Мурманск",
  "Подольск", "Тамбов", "Грозный", "Стерлитамак", "Петрозаводск", "Кострома", "Новороссийск", "Химки", "Мытищи", "Королёв",
  "Люберцы", "Красногорск", "Пушкино", "Одинцово", "Домодедово", "Сыктывкар", "Нижневартовск", "Йошкар-Ола", "Таганрог", "Анапа",
  "Геленджик", "Пятигорск", "Ессентуки", "Кисловодск", "Севастополь", "Симферополь", "Великий Новгород", "Псков", "Нальчик",
];

const CITY_SLUG: Record<string, string> = {
  moscow: "Москва", msk: "Москва", "saint-petersburg": "Санкт-Петербург", spb: "Санкт-Петербург", "sankt-peterburg": "Санкт-Петербург",
  novosibirsk: "Новосибирск", yekaterinburg: "Екатеринбург", ekaterinburg: "Екатеринбург", kazan: "Казань",
  "nizhny-novgorod": "Нижний Новгород", n_novgorod: "Нижний Новгород", "nizhniy-novgorod": "Нижний Новгород", chelyabinsk: "Челябинск",
  krasnoyarsk: "Красноярск", samara: "Самара", ufa: "Уфа", "rostov-na-donu": "Ростов-на-Дону", rostov: "Ростов-на-Дону", omsk: "Омск",
  krasnodar: "Краснодар", voronezh: "Воронеж", perm: "Пермь", volgograd: "Волгоград", saratov: "Саратов", tyumen: "Тюмень",
  tolyatti: "Тольятти", togliatti: "Тольятти", izhevsk: "Ижевск", barnaul: "Барнаул", ulyanovsk: "Ульяновск", irkutsk: "Иркутск",
  khabarovsk: "Хабаровск", yaroslavl: "Ярославль", vladivostok: "Владивосток", orenburg: "Оренбург", tomsk: "Томск",
  kemerovo: "Кемерово", ryazan: "Рязань", astrakhan: "Астрахань", penza: "Пенза", kirov: "Киров", lipetsk: "Липецк",
  cheboksary: "Чебоксары", kaliningrad: "Калининград", tula: "Тула", kursk: "Курск", sochi: "Сочи", stavropol: "Ставрополь",
  tver: "Тверь", bryansk: "Брянск", ivanovo: "Иваново", belgorod: "Белгород", surgut: "Сургут", vladimir: "Владимир",
  arkhangelsk: "Архангельск", kaluga: "Калуга", smolensk: "Смоленск", murmansk: "Мурманск", pushkino: "Пушкино",
  balashikha: "Балашиха", podolsk: "Подольск", khimki: "Химки", mytischi: "Мытищи", mytishchi: "Мытищи", sevastopol: "Севастополь",
  simferopol: "Симферополь", anapa: "Анапа", novorossiysk: "Новороссийск", yakutsk: "Якутск", makhachkala: "Махачкала",
};

/** Город из «слага» ссылки (yandex.ru/maps/213/moscow/…, 2gis.ru/kazan/…) */
export const cityFromSlug = (slug?: string | null) => (slug ? CITY_SLUG[slug.toLowerCase()] ?? "" : "");

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");

/** Город из адреса: «г. Казань, ул. …», «Москва, Тверская 1», «420111, Казань, …» */
const CITY_ALIAS: [RegExp, string][] = [[/(^|[\s,(])(спб|питер|с\.-петербург)([\s,).]|$)/i, "Санкт-Петербург"], [/(^|[\s,(])(мск)([\s,).]|$)/i, "Москва"], [/(^|[\s,(])(екб)([\s,).]|$)/i, "Екатеринбург"], [/(^|[\s,(])(нн|н\.\s?новгород)([\s,).]|$)/i, "Нижний Новгород"]];

export function cityFromAddress(address?: string | null): string {
  const a = (address ?? "").trim();
  const alias = CITY_ALIAS.find(([re]) => re.test(a));
  if (alias) return alias[1];
  if (!a) return "";
  const g = /(?:^|[\s,])(?:г\.|гор\.|город)\s*([А-ЯЁ][а-яё]+(?:[\s-](?:на-)?[А-ЯЁ]?[а-яё]+)?)/.exec(a);
  if (g) {
    const hit = CITIES.find((c) => norm(g[1]).startsWith(norm(c)));
    return hit ?? g[1].trim();
  }
  const parts = a.split(",").map((p) => p.trim());
  for (const p of parts.slice(0, 4)) {
    const hit = CITIES.find((c) => norm(p) === norm(c));
    if (hit) return hit;
  }
  const n = norm(a);
  return CITIES.find((c) => new RegExp(`(^|[\\s,(])${norm(c)}([\\s,)]|$)`).test(n)) ?? "";
}

/** Адрес без города и индекса в начале: «Москва, Тверская 1» → «Тверская 1» */
export function stripCity(address: string, city: string): string {
  let a = address.replace(/^\s*\d{6}\s*,?\s*/, "").replace(/^(Россия|Russia)\s*,\s*/i, "");
  if (city) a = a.replace(new RegExp(`^(?:г\\.?\\s*)?${city.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}\\s*,\\s*`, "i"), "");
  return a.replace(/\s+/g, " ").trim().slice(0, 200);
}

// ─── Сфера ────────────────────────────────────────────────────────────

const NICHE_WORDS: [string, RegExp][] = [
  ["barber", /барбер|barber|мужск[а-яё]*\s+(стрижк|парикмахер)|бород/i],
  ["nails", /маникюр|педикюр|ногт|nail|гель[- ]?лак|шеллак/i],
  ["brows", /бров|ресниц|lash|brow|ламинирован/i],
  ["hair", /парикмахер|окрашивани[а-яё]* волос|стрижк|укладк|колорист|hair|кератин|ботокс для волос|салон красоты/i],
  ["massage", /массаж|\bспа\b|\bspa\b|massage|релакс/i],
  ["cosmetology", /косметолог|чистк[а-яё]* лица|пилинг|биоревитализ|эпиляц|депиляц|шугаринг|cosmetolog|уход за лицом/i],
  ["yoga", /\bйог|yoga|медитац/i],
  ["fitness", /фитнес|тренажер|тренажёр|\bgym\b|fitness|кроссфит|crossfit|пилатес|pilates|растяжк|stretching|персональн[а-яё]* тренир|бокс/i],
  ["dance", /танц|dance|хореограф|\bpole\b|балет|хип-хоп|zumba|зумба/i],
];

/**
 * Сфера по категориям карточки (вес 3), названию (2) и услугам/описанию (1).
 * Возвращает id из niches.ts или null — тогда владелец выберет сам.
 */
export function detectNiche(p: { categories?: string[]; name?: string; services?: string[]; text?: string }): string | null {
  const score = new Map<string, number>();
  const add = (s: string | undefined, w: number, cap = 5) => {
    if (!s) return;
    for (const [id, re] of NICHE_WORDS) {
      const n = (s.match(new RegExp(re.source, "gi")) ?? []).length;
      if (n) score.set(id, (score.get(id) ?? 0) + Math.min(n, cap) * w);
    }
  };
  // Первая категория карточки — основная («Парикмахерская»), она весит больше всего; услуги и текст — подсказки с потолком
  (p.categories ?? []).forEach((c, i) => add(c, i === 0 ? 10 : 3, 1));
  add(p.name, 3, 1);
  add((p.services ?? []).join("\n"), 1, 5);
  add(p.text?.slice(0, 8000), 0.25);
  const best = [...score.entries()].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 1 ? best[0] : null;
}

// ─── Тексты ───────────────────────────────────────────────────────────

/** Название без хвостов «— Яндекс Карты», «| Онлайн-запись», «at Taplink» */
export function cleanName(raw?: string | null): string {
  let s = (raw ?? "").replace(/\s+/g, " ").trim();
  s = s.replace(/\s+(at|в|на)\s+taplink\s*$/i, "").replace(/\s*[|—–-]\s*(яндекс карты|2гис|онлайн[- ]запись|online booking|dikidi|yclients|вконтакте|vk).*$/i, "");
  // «Студия «Лак» | Маникюр в Казани» — берём первую часть, если она осмысленная
  const first = s.split(/\s+[|•·—–-]\s+/)[0]?.trim();
  if (first && first.length >= 2 && first.length < s.length) s = first;
  return s.slice(0, 80);
}

/** Описание: 1–3 предложения, без рекламных превосходных степеней; до max символов */
export function cleanDescription(raw?: string | null, max = 500): string {
  const s = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!s || s.length < 20) return "";
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (end > 60 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…").trim();
}

/** Преимущество для анкеты: до 100 символов, без «лучший/самый» (модерация не пропустит) */
export function cleanAdvantage(raw?: string | null): string {
  const s = (raw ?? "").replace(/\s+/g, " ").trim().replace(/[.;,]+$/, "");
  if (!s || s.length < 3 || s.length > 100 || hasSuperlative(s)) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const uniq = <T>(list: T[], key: (x: T) => string = (x) => String(x).toLowerCase()) => {
  const seen = new Set<string>();
  return list.filter((x) => {
    const k = key(x);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/** Ссылка без меток (utm, yclid…) — чтобы в анкету не попадали чужие метки */
export function stripTracking(u: string): string {
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) if (/^(utm_|yclid|gclid|fbclid|_openstat|from$|ref$)/i.test(k)) url.searchParams.delete(k);
    url.hash = "";
    return url.toString();
  } catch {
    return u;
  }
}

// ─── Прайс по блокам страницы: категории по заголовкам, диапазоны, длительность ─────


const PRICE_G = new RegExp(PRICE_RE.source, "gi");

/** Все цены в строке: «1 700 ₽ | 1 900 ₽» → [1700, 1900] (+ «от») */
function pricesIn(raw: string): { index: number; end: number; min: number; max: number | null; from: boolean }[] {
  const out: { index: number; end: number; min: number; max: number | null; from: boolean }[] = [];
  // «1400 | 1600 руб.», «+300 | +500 руб.» — валюта одна на несколько сумм (длина строки сохраняется для индексов)
  const line = new RegExp(CUR, "i").test(raw) ? raw.replace(/(\d{1,3}(?:[   ]\d{3})+|\d{2,6})(\s*)([|/])(?=\s*\+?\s*\d)/g, (m, a: string, sp: string, sep: string) => `${a}₽${sp.slice(1)}${sep}`.padEnd(m.length, " ")) : raw;
  for (const m of line.matchAll(PRICE_G)) {
    const a = num(m[2]);
    const b = m[3] ? num(m[3]) : null;
    if (!(a >= 50 && a <= 500000)) continue;
    out.push({ index: m.index ?? 0, end: (m.index ?? 0) + m[0].length, min: a, max: b && b > a ? b : null, from: Boolean(m[1]) });
  }
  return out;
}

/** Цена из текста ячейки: «1 700 ₽ | 1 900 ₽» → «1 700–1 900 ₽», «от 900 руб.» → «от 900 ₽» */
export function priceOfText(raw: string): string {
  const list = pricesIn(raw);
  return list.length > 1 ? joinPrices(list) : normalizePrice(raw);
}

/** Несколько цен (уровни мастеров, длина волос) → диапазон «1 700–1 900 ₽» */
function joinPrices(list: ReturnType<typeof pricesIn>): string {
  if (!list.length) return "";
  const lo = Math.min(...list.map((p) => p.min));
  const hi = Math.max(...list.map((p) => p.max ?? p.min));
  return formatPrice(lo, hi > lo ? hi : null, list.length === 1 && list[0].from);
}

/** Строка из одних цен: «2000 ₽ 2200 ₽», «от 900 руб.», «1 500» */
function onlyPrices(line: string): ReturnType<typeof pricesIn> | null {
  const list = pricesIn(line);
  if (list.length) {
    const rest = line.replace(PRICE_G, " ").replace(/цена|стоимость|руб\.?|р\.|₽|\bот\b|[\d|/:;,.\-–—+\s]/gi, "");
    return rest.length <= 2 ? list : null;
  }
  const only = PRICE_ONLY.exec(line);
  if (only && (only[1] || /\d\s?\d{3}/.test(line))) {
    const a = num(only[2]);
    const b = only[3] ? num(only[3]) : null;
    return a >= 50 && a <= 500000 ? [{ index: 0, end: line.length, min: a, max: b && b > a ? b : null, from: Boolean(only[1]) }] : null;
  }
  return null;
}

const DURATION = /(?<![\d.,])(\d{1,3}(?:[.,]\d)?)\s*(мин(?:ут[аы]?)?\.?|ч(?:ас(?:а|ов)?)?\.?)(?![а-яё])/i;
export function durationIn(s: string): string {
  const m = DURATION.exec(s);
  if (!m) return "";
  const n = m[1].replace(".", ",");
  return /^м/i.test(m[2]) ? `${n} мин` : `${n} ч`;
}

/** Категории: ключевое слово заголовка → короткое название группы услуг */
const CATEGORY_WORDS: [RegExp, string][] = [
  [/наращивани[а-яё]*\s+ногт|моделировани[а-яё]*\s+ногт/i, "Наращивание ногтей"],
  [/маникюр|manicure/i, "Маникюр"],
  [/педикюр|pedicure/i, "Педикюр"],
  [/дизайн\s+ногт|nail[- ]?art/i, "Дизайн ногтей"],
  [/стрижк|haircut/i, "Стрижки"],
  [/окрашивани|колорир|тонировани[а-яё]*\s+волос|мелировани|блондирован/i, "Окрашивание"],
  [/уклад|причёск|прическ/i, "Укладки и причёски"],
  [/кератин|ботокс|уход[а-яё]*\s+за\s+волос|восстановлени[а-яё]*\s+волос/i, "Уход за волосами"],
  [/наращивани[а-яё]*\s+волос/i, "Наращивание волос"],
  [/бров/i, "Брови"],
  [/ресниц|lash/i, "Ресницы"],
  [/массаж|massage/i, "Массаж"],
  [/лазерн[а-яё]*\s+эпиляц/i, "Лазерная эпиляция"],
  [/эпиляц/i, "Эпиляция"],
  [/депиляц|шугаринг|воск/i, "Депиляция"],
  [/инъекц|ботулино|контурн[а-яё]*\s+пластик|биоревитализ|мезотерап/i, "Инъекционная косметология"],
  [/косметолог|чистк[а-яё]*\s+лица|уход[а-яё]*\s+за\s+лиц|пилинг|cosmetolog/i, "Косметология"],
  [/макияж|make-?up/i, "Макияж"],
  [/бород|бритьё|бритье|бритв/i, "Борода и бритьё"],
  [/\bспа\b|\bspa\b|spa-|спа-/i, "СПА"],
  [/солярий|загар/i, "Солярий"],
  [/абонемент/i, "Абонементы"],
  [/персональн[а-яё]*\s+тренир/i, "Персональные тренировки"],
  [/групп[а-яё]*\s+(занят|тренир)/i, "Групповые занятия"],
  [/йог/i, "Йога"],
  [/пилатес|pilates/i, "Пилатес"],
  [/растяжк|stretch/i, "Растяжка"],
  [/танц|dance/i, "Танцы"],
  [/детск/i, "Для детей"],
];

/** Заголовок, который не может быть группой услуг: колонки прайса, общие слова */
const NOT_CATEGORY = /(мастер|^топ|^проф|^цен[аы]|^стоимост|^прайс|^услуг[аи]?$|^наши услуги|^популярн|^акци|^скидк|^запис|^отзыв|^контакт|^адрес|^о нас|^почему|^преимуществ|^команд|^галере|^фото|^\d)/i;

/** Заголовок → категория: «Педикюр SMART Профи Топ» → «Педикюр»; «Маникюр и педикюр» → как есть */
export function categoryOf(heading: string): string {
  const h = heading.replace(/\s+/g, " ").trim();
  if (!h || h.length > 70 || NOT_CATEGORY.test(h)) return "";
  const hits = CATEGORY_WORDS.filter(([re]) => re.test(h)).map(([, c]) => c);
  const uniqHits = [...new Set(hits)];
  if (uniqHits.length === 1) return uniqHits[0];
  // Два ключевых слова («Наращивание ногтей» содержит «ногт» и «наращивани») — берём самое специфичное (первое в списке, которое совпало раньше всего)
  if (uniqHits.length > 1) {
    if (uniqHits.includes("Лазерная эпиляция")) return "Лазерная эпиляция";
    if (uniqHits.includes("Инъекционная косметология")) return "Инъекционная косметология";
    if (uniqHits.includes("Наращивание ногтей") && uniqHits.length === 2) return "Наращивание ногтей";
    // «Пилинговый педикюр» — педикюр; «Маникюр и педикюр» — общий раздел, не категория
    const body = uniqHits.filter((c) => !["Косметология", "СПА", "Для детей", "Абонементы"].includes(c));
    return body.length === 1 ? body[0] : "";
  }
  // Без ключевого слова — сам заголовок, если он короткий и похож на название группы
  const words = h.split(/\s+/);
  if (words.length > 5 || h.length > 40 || /[!?.:]$/.test(h) || PRICE_RE.test(h)) return "";
  const s = h.toLowerCase() === h || h.toUpperCase() === h ? h.charAt(0).toUpperCase() + h.slice(1).toLowerCase() : h;
  return s;
}

/** Категория по названию услуги, если заголовков нет: «Педикюр пальчиков» → «Педикюр» */
export function categoryFromName(name: string): string {
  // Порядок списка — приоритет: «Пилинговый педикюр» — это педикюр, а не косметология
  return CATEGORY_WORDS.find(([re]) => re.test(name))?.[1] ?? "";
}

/** Финальная расстановка категорий: заголовок → по названию; одна категория на всех — не нужна */
export function finalizeCategories(list: ImportService[]): ImportService[] {
  // Один раздел на всех (обычно заголовок страницы) — не разбивка: тогда раскладываем по названиям услуг
  const headCats = new Set(list.map((s) => s.category).filter(Boolean));
  const base = headCats.size >= 2 || (headCats.size === 1 && list.some((s) => !s.category)) ? list : list.map((s) => ({ ...s, category: undefined }));
  const withCat = base.map((s) => ({ ...s, category: s.category || categoryFromName(s.name) || undefined }));
  const count = new Map<string, number>();
  for (const s of withCat) if (s.category) count.set(s.category, (count.get(s.category) ?? 0) + 1);
  const none = withCat.filter((s) => !s.category).length;
  // Группы имеют смысл, если их хотя бы две, есть группа из 2+ услуг и почти всё разложилось
  const useful = count.size >= 2 && [...count.values()].some((n) => n >= 2) && none <= Math.max(1, withCat.length / 3);
  if (!useful) return list.map(({ category: _c, ...rest }) => rest); // eslint-disable-line @typescript-eslint/no-unused-vars
  // Услуги без категории — в «Другое», чтобы группы в анкете были полными; порядок — по первым появлениям групп
  const filled = withCat.map((s) => (s.category ? s : { ...s, category: "Другое" }));
  const order = [...new Set(filled.map((s) => s.category))];
  return order.flatMap((c) => filled.filter((s) => s.category === c));
}

/**
 * Прайс по блокам страницы — как pricesFromText, плюс:
 *  - категория из ближайшего заголовка над услугой (h2–h4, заголовки конструкторов, вкладки и аккордеоны);
 *  - несколько цен в строке (Проф-мастер | Топ-мастер) → диапазон;
 *  - примечание в скобках под ценой и длительность («60 мин»).
 */
/** Примечание к услуге до 120 символов, по границе слова */
export function shortNote(raw: string): string {
  const t = raw.replace(/\s+,/g, ",").replace(/\s+/g, " ").trim();
  return t.length <= 120 ? t : `${t.slice(0, 118).replace(/[\s,;:+]+\S*$/, "")}…`;
}

/** Заголовок колонок прайса: «(мастер | топ мастер)», «Руки | Ноги», «Проф-мастер / Топ-мастер» */
export function isColumnHeader(t: string): boolean {
  const s = t.trim().replace(/^\(|\)$/g, "");
  if (!s || /\d/.test(s) || s.length > 50) return false;
  const segs = s.split(/\s*[|/]\s*/);
  if (segs.length >= 2 && segs.every((x) => x && x.split(/\s+/).length <= 2 && x.length <= 20)) return true;
  return /^(проф|топ|мастер|стилист|руки|ноги)[\s-]/i.test(s) && s.split(/\s+/).length <= 4;
}

const okName = (s?: string) => Boolean(s && !PRICE_RE.test(s) && isName(cleanServiceName(s)) && s.length <= 90 && !isColumnHeader(s));

/**
 * Название над строкой с ценой: пропускает заголовок колонок («мастер | топ мастер» → примечание),
 * длинную скобку (примечание), склеивает название в две строки одного стиля карточки
 * («Пилочный маникюр» + «Christina Fitzgerald», «Маникюр + Покрытие» + «(Просто Лак)»).
 */
function nameAbove(lines: Block[], i: number): { name: string; note: string } | null {
  let note = "";
  const parts: string[] = [];
  let lvl = -1;
  let skipped = 0;
  for (let j = i - 1; j >= 0 && j >= i - 5; j--) {
    const L = lines[j];
    const t = L.text;
    if (pricesIn(t).length || onlyPrices(t) || CARD_MARK.test(t)) break;
    if (isColumnHeader(t)) {
      if (parts.length) break;
      note ||= t.replace(/^\(|\)$/g, "").replace(/\s*[|/]\s*/g, " / ");
      continue;
    }
    const paren = /^\((.*)\)$/.exec(t);
    if (paren && !parts.length) {
      if (paren[1].split(/\s+/).length > 3) {
        note ||= paren[1];
        continue;
      }
      parts.unshift(t);
      lvl = L.level;
      continue;
    }
    if (!okName(t)) {
      // Одна строка описания между названием и ценой — пропускаем (как раньше: prev2)
      if (!parts.length && !skipped && j === i - 1 && t.length <= 300) {
        skipped++;
        continue;
      }
      break;
    }
    if (parts.length && !parts[0].startsWith("(")) {
      const joined = parts.join(" ");
      if (L.level >= 4 && L.level === lvl && joined.length + t.length <= 90 && !(categoryOf(t) && t.split(/\s+/).length <= 1)) parts.unshift(t);
      break;
    }
    parts.unshift(t);
    lvl = L.level;
    if (L.level < 4 || skipped) break;
  }
  if (!parts.length || parts[0].startsWith("(")) return null;
  return { name: parts.join(" "), note };
}

/** Вкладки прайса (Tilda и др.): строка коротких пунктов «Маникюр | Педикюр | Брови», а под ней — по секции на вкладку */
function tabSections(lines: Block[]): Map<number, string> {
  const map = new Map<number, string>();
  for (let i = 0; i < lines.length; i++) {
    const run: Block[] = [];
    let j = i;
    while (j < lines.length && (lines[j].level || lines[j].li) && lines[j].text.length <= 40 && !pricesIn(lines[j].text).length && lines[j].sec === lines[i].sec && run.length < 12) run.push(lines[j++]);
    if (run.length < 2 || run.filter((b) => categoryOf(b.text)).length < Math.ceil(run.length / 2)) continue;
    const secs: number[] = [];
    for (let k = j; k < lines.length && secs.length < run.length; k++) {
      const sec = lines[k].sec;
      if (sec === run[0].sec || secs.includes(sec)) continue;
      // секция-вкладка: в ней есть цены
      const hasPrice = lines.some((b) => b.sec === sec && (CARD_MARK.test(b.text) || pricesIn(b.text).length || onlyPrices(b.text)));
      if (hasPrice) secs.push(sec);
      else if (secs.length) break;
    }
    if (secs.length === run.length) {
      secs.forEach((sec, k) => map.set(sec, categoryOf(run[k].text) || run[k].text));
      return map;
    }
    i = j;
  }
  return map;
}

export const CARD_MARK = /^⟦svc:(\d+)⟧$/;

export function pricesFromBlocks(list: Block[], limit = 40, onCard?: (idx: number, category: string, next: string) => void): ImportService[] {
  const out: (ImportService & { i: number })[] = [];
  const seen = new Set<string>();
  const lines = list.filter((b) => !b.nav && b.text.length <= 300);
  let cat = "";
  const tabs = tabSections(lines);
  let curSec = -1;
  const add = (name: string, price: string, i: number, extra = "") => {
    const n = cleanServiceName(name.replace(/\s*[|/]\s*$/, ""));
    const key = n.toLowerCase().replace(/ё/g, "е");
    if (!n || !isName(n) || !price || seen.has(key) || out.length >= limit) return false;
    seen.add(key);
    const dur = durationIn(extra) || durationIn(name);
    out.push({ name: dur ? cleanServiceName(n.replace(DURATION, "").replace(/[,(]\s*\)?\s*$/, "")) || n : n, price, ...(cat ? { category: cat } : {}), ...(dur ? { note: dur } : {}), i });
    return true;
  };
  for (let i = 0; i < lines.length && out.length < limit; i++) {
    const b = lines[i];
    const line = b.text;
    if (b.sec !== curSec) {
      curSec = b.sec;
      if (tabs.has(b.sec)) cat = tabs.get(b.sec)!;
    }
    const card = CARD_MARK.exec(line);
    if (card) {
      onCard?.(Number(card[1]), cat, lines[i + 1]?.text ?? "");
      continue;
    }
    const ps = pricesIn(line);
    if (b.level && !ps.length && line.length <= 70) {
      // Заголовок карточки услуги (сразу под ним цена) — это название, а не раздел прайса
      const n1 = lines[i + 1], n2 = lines[i + 2];
      const priceLike = (t?: string) => Boolean(t && (onlyPrices(t) || /^(бесплатно|free|0\s*₽|по запросу|договорная|уточняйте[\s\S]*|индивидуально)$/i.test(t.trim())));
      const isName = priceLike(n1?.text) || (n1 && n2 && priceLike(n2.text) && (n1.level === b.level || /^\(/.test(n1.text) || isColumnHeader(n1.text)));
      if (!isName) {
        if (tabs.size && !tabs.has(b.sec) && [...tabs.keys()].some((k) => k > b.sec) && lines.some((x, k) => k > i && tabs.has(x.sec))) continue; // строка вкладок
        const c = categoryOf(line);
        const keyword = CATEGORY_WORDS.some(([re]) => re.test(line));
        if (c && (keyword || (b.level >= 2 && b.level <= 3 && !/(салон|студи|центр|сеть|клиник|школ)/i.test(line)))) cat = c;
        continue;
      }
    }
    // «услуга … цена [цена]»
    if (ps.length && ps[0].index > 0) {
      const name = line.slice(0, ps[0].index);
      if (isName(cleanServiceName(name.replace(/\s*[|/]\s*$/, "")))) {
        if (add(name, joinPrices(ps), i, line.slice(ps[ps.length - 1].end))) continue;
      }
    }
    const only = onlyPrices(line);
    if (only && i > 0) {
      const found = nameAbove(lines, i);
      if (found && add(found.name, joinPrices(only), i) && found.note && !out[out.length - 1].note) out[out.length - 1].note = shortNote(found.note);
    }
  }
  // Примечание: строка в скобках сразу под ценой — «(Снятие, маникюр, покрытие гель-лак)»
  for (const s of out) {
    const nx = lines[s.i + 1]?.text ?? "";
    const m = /^\(\s*([^()]{3,200})\s*\)$/.exec(nx);
    if (m && !s.note) s.note = shortNote(m[1]);
  }
  return out.map(({ i: _i, ...s }) => s); // eslint-disable-line @typescript-eslint/no-unused-vars
}

// ─── Часы работы из текста ─────────────────────────────────────────────

const HOURS_CTX = /(работаем|режим|часы работы|график|ежедневно|без выходных|круглосуточно|открыт|пн|вт|ср|чт|пт|сб|вс|понедельник|будни|выходн)/i;

/** «С 9:00 до 21:00», «Работаем с 9 утра до 21 вечера. Без выходных!», «Пн–Пт 10–20, Сб 11–18» → формат анкеты */
export function hoursFromText(line: string, prev = ""): string {
  if (line.length > 140) return "";
  let s = line.toLowerCase().replace(/ё/g, "е");
  s = s.replace(/(\d{1,2})\s*(утра|дня|вечера|ночи)/g, (_, h: string, p: string) => {
    let n = Number(h);
    if ((p === "вечера" || (p === "дня" && n < 12)) && n < 12) n += 12;
    return `${n}:00`;
  });
  const hasTime = /\d{1,2}[:.]\d{2}\s*(?:-|–|—|до)\s*\d{1,2}[:.]?\d{0,2}|\bс\s*\d{1,2}(?:[:.]\d{2})?\s*до\s*\d{1,2}/.test(s);
  if (!hasTime) return "";
  const short = s.replace(/[^а-яa-z]/g, "").length <= 14; // «С 9:00 до 21:00», «10:00–20:00»
  if (!short && !HOURS_CTX.test(s) && !HOURS_CTX.test(prev)) return "";
  if (/(парковк|доставк|обед|перерыв|акци|скидк|звонк|период)/i.test(s)) return "";
  const s2 = s.replace(/(\d{1,2})\.(\d{2})/g, "$1:$2").replace(/\bс\s*(\d{1,2}(?::\d{2})?)\s*до\s*/g, "$1-").replace(/[–—]/g, "-");
  const week = parseWeekHours(s2);
  if (!week || week.every((d) => !d)) return "";
  const hhmm = (x: number) => `${String(Math.floor(x)).padStart(2, "0")}:${String(Math.round((x % 1) * 60)).padStart(2, "0")}`;
  if (week.some((d) => d && (d.open < 5 && d.close < 24))) return "";
  return formatWeek(week.map((d) => (d ? { open: hhmm(d.open), close: hhmm(d.close) } : null)));
}

// ─── Адреса ────────────────────────────────────────────────────────────

const STREET = String.raw`(?:ул\.?|улица|пр-кт|пр-т|пр\.|просп\.?|проспект|пер\.|переулок|бул\.|бульвар|б-р|ш\.|шоссе|наб\.|набережная|пл\.|площадь|мкр\.?|микрорайон|тракт|проезд|аллея|тупик|линия|кв-л|квартал)`;
const HOUSE = String.raw`(?:,\s*|\s+)(?:д\.?\s*|дом\s*|№\s*)?\d{1,4}(?!\d)`;
// «ул. Шейнкмана, 111», «пр-т Ленина 5» — и «Ленинский проспект, 30», «Краснодарская улица, 10»
const STREET_RE = new RegExp(
  String.raw`(?:^|[\s,(])(?:${STREET}(?![а-яё])\s*[«"]?(?:[А-ЯЁA-Z0-9][А-ЯЁа-яёA-Za-z0-9.\- «»"]{0,3})?[А-ЯЁа-яё]{3}[А-ЯЁа-яё0-9.\- «»"]{0,40}?|[А-ЯЁ0-9][А-ЯЁа-яё0-9-]{2,30}\s+${STREET}(?![а-яё]))${HOUSE}`,
  "i",
);
const CITY_STREET_RE = new RegExp(String.raw`(?:^|[\s,(:])(?:г\.\s*)?(${CITIES.map((c) => c.replace(/[-]/g, "\\-")).join("|")})\s*,\s*(?:${STREET}(?![а-яё])\s*)?[«"]?[А-ЯЁ][А-ЯЁа-яё0-9.\- ]{1,40}?${HOUSE}`, "i");
const ADDRESS_LABEL = /(адрес|по адресу|мы находимся|находимся|ждем вас|ждём вас|как нас найти|как добраться|приходите|наш салон|филиал|студия на|салон на)/i;
const LEGAL_CTX = /(реквизит|юр\.?\s*адрес|юридическ|огрн|инн|кпп|р\/с|расч[её]тн|корр?\.?\s*сч|бик|банк|почтов[а-яё]*\s+адрес|счёт|счет)/i;

export type AddressCand = { address: string; city: string; score: number };

/** Адрес из строки: от города или улицы до конца адреса, без «Адрес:», хвостов и пояснений */
export function cleanAddress(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  s = s.replace(/^.*?(адрес[а-я]*|по адресу|находимся|ждем вас|ждём вас)\s*:?\s*/i, "");
  const startCity = CITY_STREET_RE.exec(s);
  const startStreet = STREET_RE.exec(s);
  const idx = Math.min(startCity ? startCity.index : Infinity, startStreet ? startStreet.index : Infinity);
  if (Number.isFinite(idx) && idx > 0 && idx < s.length) {
    // До начала адреса может быть индекс или «г. Город,»
    const before = s.slice(0, idx);
    const tail = /(\d{6}\s*,?\s*)?((?:г\.\s*)?[А-ЯЁ][а-яё-]+(?:-на-[А-ЯЁ][а-яё]+)?\s*,\s*)?$/.exec(before);
    s = s.slice(idx - (tail?.[0].length ?? 0));
  }
  s = s.replace(/^[\s,(:]+/, "");
  // Хвост после адреса: « — вход со двора», «(ТЦ …)», следующее предложение. Точки сокращений («ул.», «д.», «пр.») — не конец
  s = s.split(/\s+[—–]\s+|\s*\(|\s*[|•]\s*|(?<!(?:^|[^а-яёa-z])(?:ул|пр|просп|пер|бул|наб|пл|мкр|д|г|гор|стр|корп|к|лит|пом|оф|эт|ш|обл|пос|с|им|пр-т|пр-кт|б-р|кв-л|р-н|тц|трц|бц|м))\.\s+(?=[А-ЯЁ])|;\s*/i)[0];
  s = s.replace(/[,.\s]+$/, "");
  // Адрес — это улица с домом (или «Город, Улица 12»), а не координаты и не строка прайса
  const letters = (s.match(/[а-яё]/gi) ?? []).length;
  if (letters < 4 || PRICE_RE.test(s) || !(STREET_RE.test(` ${s}`) || CITY_STREET_RE.test(` ${s}`))) return "";
  return s.length >= 6 && s.length <= 140 && /\d/.test(s) ? s : "";
}

/**
 * Адреса из блоков страницы: строки с улицей и домом (или «Город, Улица 12»), рядом с «Адрес», «Ждём вас по адресу»,
 * в подвале и на странице контактов. Реквизиты (юр. адрес рядом с ИНН/ОГРН/счётом) — не адрес салона.
 */
export function addressesFromBlocks(list: Block[]): AddressCand[] {
  const out: AddressCand[] = [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i].text;
    if (t.length > 220) continue;
    if (!STREET_RE.test(t) && !CITY_STREET_RE.test(t)) continue;
    const ctx = list.slice(Math.max(0, i - 4), i + 3).map((b) => b.text).join(" \n ");
    if (LEGAL_CTX.test(ctx) && !/адрес салона|адрес студии|ждем вас|ждём вас/i.test(ctx)) continue;
    const prev = list[i - 1]?.text ?? "";
    const a = cleanAddress(t);
    if (!a) continue;
    const city = cityFromAddress(a) || cityFromAddress(t);
    const score = (ADDRESS_LABEL.test(t) ? 3 : 0) + (ADDRESS_LABEL.test(prev) ? 3 : 0) + (city ? 1 : 0) + (STREET_RE.test(a) ? 1 : 0);
    out.push({ address: a, city, score });
  }
  return out;
}

/** Ключ адреса для склейки дублей: «Екатеринбург, ул. Шейнкмана, 111» = «ул. Шейнкмана 111» */
export function addressKey(a: string, city = ""): string {
  return stripCity(a, city || cityFromAddress(a))
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(new RegExp(String.raw`(^|\s)${STREET}\s*`, "gi"), " ")
    .replace(/(^|[^а-яa-z])(дом|город|корп|стр|д|г|к)\.?\s*(?=[\s\d,]|$)/g, "$1")
    .replace(/[^a-zа-я0-9]/g, "");
}

// ─── Город в тексте: «в Екатеринбурге», «Казани» ───────────────────────

export function cityFromText(text: string): string {
  const t = norm(text.slice(0, 5000));
  let best = "";
  let at = Infinity;
  for (const c of CITIES) {
    const stem = norm(c).replace(/[аеиоуыьйяю]$/, "");
    if (stem.length < 4) continue;
    const m = new RegExp(`(^|[^а-я])${stem.replace(/[-]/g, "\\-")}(е|и|у|а|ом|ой|ь|ы|я|ю)?([^а-я]|$)`).exec(t);
    if (m && m.index < at) {
      at = m.index;
      best = c;
    }
  }
  return best;
}

// ─── Юр. данные: «ИП Иванова Анна Сергеевна, ИНН 123456789012» ───────────

export function innValid(inn: string): boolean {
  const d = inn.split("").map(Number);
  const sum = (w: number[]) => (w.reduce((s, k, i) => s + k * d[i], 0) % 11) % 10;
  if (d.length === 10) return sum([2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[9];
  if (d.length === 12) return sum([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[10] && sum([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[11];
  return false;
}

export function legalFromText(text: string): string {
  const t = text.replace(/[\s  ]+/g, " ");
  const ip = /(?:^|[^А-ЯЁа-яё])(?:ИП|Индивидуальный предприниматель)\s+([А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?\s+(?:[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+|[А-ЯЁ]\.\s?[А-ЯЁ]\.))/.exec(t);
  const org = /(?:^|[^А-ЯЁа-яё])(ООО|АО|ПАО|ЗАО|АНО)\s*[«"]([^»"]{2,60})[»"]/.exec(t);
  const inns = [...t.matchAll(/ИНН[:\s№]*(\d{10}|\d{12})(?!\d)/g)].map((m) => m[1]).filter(innValid);
  const hasOgrnip = /ОГРНИП/.test(t);
  const inn12 = inns.find((x) => x.length === 12);
  const inn10 = inns.find((x) => x.length === 10);
  if ((ip || hasOgrnip) && inn12) return `ИП${ip ? ` ${ip[1]}` : ""}, ИНН ${inn12}`;
  if (org && inn10) return `${org[1]} «${org[2]}», ИНН ${inn10}`;
  return "";
}

// ─── Предложение для новых клиентов ──────────────────────────────────

export function offerFromText(text: string): string {
  for (const line of text.split("\n")) {
    const l = line.trim();
    if (l.length < 8 || l.length > 120) continue;
    if (/(скидк[аиуе]|−|-)\s*\d{1,2}\s*%|\d{1,2}\s*%\s*скидк/i.test(l) && /(перв|нов[ыо]|знакомств|пробн)/i.test(l)) return l.replace(/[!]+$/, "").slice(0, 80);
    if (/(первое|пробное)\s+(посещение|занятие|тренировка)\s+(бесплатно|за\s+\d)/i.test(l)) return l.replace(/[!]+$/, "").slice(0, 80);
  }
  return "";
}

// ─── Преимущества ─────────────────────────────────────────────────────

const ADV_HEAD = /(почему\s+(мы|нас|выбирают|стоит|клиенты|именно)|преимуществ|наши\s+плюсы|что\s+вы\s+получ|мы\s+гарантир|наши\s+принципы|^о\s+нас|^о\s+студии|^о\s+салоне|why\s+us|наш[аи]?\s+(подход|стандарт)|ваша\s+безопасность|стерильност|безопасност)/i;
/** Кнопки, формы, всплывающие окна и бонусные правила — не преимущества */
const ADV_JUNK = /(карта сайта|на карте|фотографии|^бренды|^наши (работы|мастера|студии)|заказать|оставить|обратн[а-яё]+\s+звон|ваше\s+имя|ваш\s+телефон|согласен|согласие|персональн[а-яё]+\s+данн|заявк|спасибо|представьтесь|ближайш[а-яё]+\s+студ|подробнее|записаться|отправить|выбрать|перейти|смотреть|читать|бонус|начисл|сгора|кэшбэк|\*$|^\d+\s*[=:])/i;
const ADV_FACT = /(стерилиз|автоклав|крафт[- ]?пакет|одноразов|дезинфекц|парковк|отдельный вход|лицензи|сертифиц|опыт[а-яё]*\s+(более\s+|от\s+)?\d|\d+\s+(лет|года?)\s+(опыта|работ)|с\s+(19|20)\d\d\s+года|гаранти|в\s+4\s+руки|в\s+четыре\s+руки|детск[а-яё]+\s+(комнат|уголок)|кофе|у\s+метро|\d+\s+минут[аы]?\s+от\s+метро|онлайн[- ]запис|рассрочк|подарочн[а-яё]+\s+сертификат|косметик[а-яё]*\s+\w|материал[а-яё]*\s|бренд|wi-?fi|кондиционер|без\s+выходных|до\s+2[0-3]:00|в\s+центре)/i;
const STAT = /^(\d[\d\s  ]*\+|\d{2,}[\d\s  ]*|\d{1,3}\s*%)$/;

const tidy = (s: string) => {
  let t = s.replace(/\s+/g, " ").replace(/[«»"]/g, (c) => c).trim().replace(/^[-–—•·*✓✔☑️\s]+/, "").replace(/[:;,]+$/, "");
  // Без эмодзи и пиктограмм
  t = t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim();
  if (t.length > 3 && t === t.toUpperCase() && /[А-ЯЁ]/.test(t)) t = t.charAt(0) + t.slice(1).toLowerCase();
  return t;
};

/**
 * Преимущества с сайта: пункты и карточки под заголовками «Почему мы», «Преимущества», «О нас»;
 * факты в коротких строках (стерилизация, парковка, лицензия, опыт, «в 4 руки»); пары «число + подпись»
 * («93+» / «вида процедур»). Только то, что написано на странице, — без пересказа.
 */
export function advantagesFromBlocks(list: Block[], exclude: string[] = []): string[] {
  const out: { t: string; w: number }[] = [];
  const skip = new Set(exclude.map((x) => x.toLowerCase().replace(/ё/g, "е")));
  const push = (raw: string, w: number) => {
    const t = cleanAdvantage(tidy(raw));
    if (!t || t.length < 6 || !/[а-яё]{3}/i.test(t) || t.split(/\s+/).length < 2) return;
    const k = t.toLowerCase().replace(/ё/g, "е");
    if (hoursFromText(t) || /(платн|возможн|к сожалению|не работа|запрещен)/i.test(t) || ADV_JUNK.test(t) || /\?$/.test(t)) return;
    if (skip.has(k) || PRICE_RE.test(t) || /(https?:|www\.|@|©|политик|конфиденц|оферт|договор|cookie|запис(аться|ь)\s|подробнее|узнать|хочу так же|позвонить|написать|ваши отзывы|\+7|8\s?\(\d{3}\))/i.test(t)) return;
    if (/^(главная|услуги|цены|прайс|контакты|о нас|отзывы|галерея|акции|блог|советы|наша команда|как проехать)/i.test(t)) return;
    out.push({ t, w });
  };
  const body = list.filter((b) => !b.nav);
  // 1. Секции «Почему мы» / «Преимущества»
  for (let i = 0; i < body.length; i++) {
    const b = body[i];
    if (!b.level || b.text.length > 90 || !ADV_HEAD.test(b.text)) continue;
    // Заголовок-факт («Все инструменты проходят … стерилизации в автоклаве») — сам по себе преимущество
    if (b.text.length > 25 && ADV_FACT.test(b.text)) push(b.text, 5);
    let n = 0;
    for (let j = i + 1; j < body.length && n < 14; j++) {
      const x = body[j];
      if (x.level && x.level <= Math.max(2, b.level) && j > i + 1 && !x.li) break;
      n++;
      if (x.text.length > 110) {
        const first = x.text.split(/(?<=[.!?])\s+/)[0];
        if (first.length <= 100 && ADV_FACT.test(first)) push(first, 3);
        continue;
      }
      if (x.level || x.li || x.text.length <= 70) {
        // Короткий заголовок карточки + описание: «Стерилизация» + «Инструменты в автоклаве…» → описание, если оно короткое
        const nx = body[j + 1];
        if (x.level && x.text.split(/\s+/).length <= 2 && nx && !nx.level) {
          // Короткий заголовок карточки — берём описание (или его первое предложение), если оно короткое
          const d = nx.text.length <= 100 ? nx.text : nx.text.split(/(?<=[.!?])\s+/)[0];
          if (d.length <= 100) push(d, 4);
          j++;
        } else push(x.text, x.li ? 4 : 3);
      }
    }
  }
  // 2. Пары «число» + подпись: «10000+» / «Счастливых клиентов»
  for (let i = 0; i < body.length - 1; i++) {
    const a = body[i].text.replace(/[^\d+%,.\s★⭐]/gu, "").trim();
    if (!STAT.test(body[i].text.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "").trim()) || !a) continue;
    const label = tidy(body[i + 1].text);
    if (label.length < 4 || label.length > 40 || /\d/.test(label) || body[i + 1].level > 2) continue;
    const num = a.replace(/\s+/g, "");
    if (/[★⭐]/.test(body[i].text) || /любов/i.test(label)) continue;
    push(`${num} ${label.charAt(0).toLowerCase()}${label.slice(1)}`, 2);
  }
  // 3. Факты в коротких строках и пунктах списков по всей странице
  for (let i = 0; i < body.length; i++) {
    const b = body[i];
    if (b.text.length > 100) {
      for (const s of b.text.split(/(?<=[.!?])\s+/)) if (s.length <= 100 && s.length >= 12 && ADV_FACT.test(s) && !/[?]$/.test(s)) push(s, 1);
      continue;
    }
    if (ADV_FACT.test(b.text) && b.text.length >= 10 && !(b.level > 0 && b.level <= 3) && (b.text.match(/[;|]/g) ?? []).length < 2) push(b.text, b.li ? 2 : 1);
    // Пункты списка под строкой «Работаем на косметике …:» — сами пункты тоже факты
    if (b.li && /:\s*$/.test(body[i - 1]?.text ?? "") && /(работ|использ|косметик|материал|бренд|лак)/i.test(body[i - 1]?.text ?? "")) push(b.text, 2);
  }
  const best = new Map<string, { t: string; w: number }>();
  for (const x of out) {
    const k = x.t.toLowerCase().replace(/ё/g, "е");
    const p = best.get(k);
    if (!p || x.w > p.w) best.set(k, x);
  }
  // Поле карточки мастера («Опыт работы: с 2021 года» × 8) — повторяющийся шаблон, а не преимущество
  const head2 = (t: string) => t.toLowerCase().split(/[\s:]+/).slice(0, 2).join(" ");
  const freq = new Map<string, number>();
  for (const x of best.values()) freq.set(head2(x.t), (freq.get(head2(x.t)) ?? 0) + 1);
  const vals = [...best.values()].filter((x) => (freq.get(head2(x.t)) ?? 0) < 3);
  return dedupeAdvantages(vals.sort((a, b) => b.w - a.w).map((x) => x.t)).slice(0, 15);
}

/** Без дублей по смыслу: «Медицинская лицензия» уходит, если есть «Медицинская лицензия ЛО-66-…» */
export function dedupeAdvantages(list: string[]): string[] {
  const l = uniq(list);
  const low = l.map((x) => x.toLowerCase().replace(/ё/g, "е"));
  return l.filter((x, i) => !low.some((y, j) => j !== i && y.length > low[i].length && y.includes(low[i])));
}

/**
 * Приведение найденного к виду анкеты: телефоны, мессенджеры, часы работы, цены, город, сфера.
 * Чистые функции — их проверяют тесты (scripts/test-importer.ts).
 */
import type { ImportService } from "./types";
import { hasSuperlative } from "../engine/extras";

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

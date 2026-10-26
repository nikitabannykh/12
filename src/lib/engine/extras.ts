/**
 * Всё, что можно показать в объявлении помимо заголовка и текста:
 * уточнения, быстрые ссылки, отображаемая ссылка, цена, визитка (адрес, телефон, часы), длинный текст для VK.
 * Собирается из анкеты бизнеса — одинаково для запуска, робота и предпросмотра.
 */
import type { Business } from "../db/schema";
import { nicheById } from "../niches";

export type ExtrasBiz = Pick<Business, "name" | "niche" | "city" | "address" | "phone" | "whatsapp" | "telegram" | "hours" | "services" | "advantages" | "offer" | "review" | "description">;

/** Уточнения из плана (их можно отредактировать в мастере) идут первыми, затем факты из анкеты */
export function withPlanCallouts<T extends { callouts: string[] }>(x: T, planned: string[] | undefined): T {
  const list = [...(planned ?? []), ...x.callouts].map((c) => cleanText(c)).filter((c) => c && c.length <= 25);
  return { ...x, callouts: [...new Map(list.map((c) => [c.toLowerCase(), c])).values()].slice(0, 8) };
}

export type Sitelink = { title: string; href: string; description?: string };
export type PriceExt = { price: number; qualifier: "FROM" | "NONE"; label: string };
export type VCard = {
  company: string;
  city: string;
  street: string | null;
  house: string | null;
  phone: { country: string; city: string; number: string } | null;
  phoneText: string | null;
  hoursText: string;
  workTime: string; // формат Директа: «день;день;час;мин;час;мин»
};
export type AdExtras = {
  callouts: string[];
  sitelinks: Sitelink[];
  displayPath: string | null;
  price: PriceExt | null;
  vcard: VCard | null;
  longText: string; // VK: до 220
  about: string; // VK: «о компании», до 115
};

// ─── Чистка текста для площадок (общая для сервера и предпросмотра в браузере) ───

/** Эмодзи, пиктограммы, модификаторы и невидимые символы — Директ и VK такое отклоняют */
const EMOJI_SRC = "[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u{1F3FB}-\\u{1F3FF}\\uFE0E\\uFE0F\\u200B-\\u200D\\u2060\\u20E3]";
const EMOJI = new RegExp(EMOJI_SRC, "gu");
const EMOJI_ONE = new RegExp(EMOJI_SRC, "u");
/** Что допускает Директ в текстах: буквы, цифры, пробел и обычная пунктуация */
const AD_CHAR = /[\p{L}\p{N}\s.,!?;:"'«»„“”()\[\]\-–—\/№%₽$€+&*#@’]/u;

export const stripEmoji = (s: string) => s.replace(EMOJI, "");

/** Символы, которые площадка не примет (для сообщений владельцу) */
export function badChars(s: string): string[] {
  const out = new Set<string>();
  for (const ch of s) if (EMOJI_ONE.test(ch) || (!AD_CHAR.test(ch) && !SUBST[ch])) out.add(ch);
  return [...out];
}

/** Похожие символы, которых нет в списке Директа, заменяем на допустимые */
const SUBST: Record<string, string> = { "−": "-", "‐": "-", "‑": "-", "…": "...", "·": "—", "•": "—", "×": "x", "`": "'", "ʼ": "'" };

/** Убираем эмодзи и неподдерживаемые символы, схлопываем пробелы */
export function cleanText(s: string | null | undefined): string {
  return [...stripEmoji(s ?? "").replace(/[−‐‑…·•×`ʼ]/g, (c) => SUBST[c] ?? c)].map((ch) => (AD_CHAR.test(ch) ? ch : " ")).join("").replace(/\s+/g, " ").replace(/\s+([.,!?;:])/g, "$1").trim();
}

const clean = (s: string) => cleanText(s);

/** «лучший», «самый», «№1» — модерация Директа пропускает их только с документами. Граница слова с учётом кириллицы и кавычек. */
export const SUPERLATIVE = /(?<![\p{L}\p{N}])(лучш[а-яё]*|№\s?1|номер\s+один|сам(ый|ая|ое|ые|ого|ой|ую|ых|ым)|первый\s+в\s+городе)(?![\p{L}\p{N}])/iu;
export const hasSuperlative = (s: string | null | undefined) => SUPERLATIVE.test(s ?? "");

/** Факт владельца без превосходных степеней: предложения с «лучший/самый» выкидываем целиком, а не калечим */
export function withoutSuperlatives(s: string | null | undefined): string {
  return clean(s ?? "")
    .split(/(?<=[.!?])\s+/)
    .filter((x) => x && !hasSuperlative(x))
    .join(" ")
    .trim();
}
const cut = (s: string, max: number) => {
  const t = clean(s);
  if (t.length <= max) return t;
  const c = t.slice(0, max + 1);
  const i = c.lastIndexOf(" ");
  return (i > max * 0.6 ? c.slice(0, i) : c.slice(0, max)).replace(/[,.\-–—:;]$/, "");
};

/** «от 3 000 ₽» → 3000, FROM */
export function parsePrice(s?: string | null): PriceExt | null {
  if (!s) return null;
  const m = s.replace(/\s/g, "").match(/(\d{2,7})/);
  if (!m) return null;
  const price = Number(m[1]);
  if (!price) return null;
  const from = /от/i.test(s);
  return { price, qualifier: from ? "FROM" : "NONE", label: `${from ? "от " : ""}${new Intl.NumberFormat("ru-RU").format(price)} ₽` };
}

/**
 * Уточнения — только факты из анкеты и правда о продукте (на странице записи есть онлайн-форма).
 * Ничего не придумываем: «Без очереди», «Удобно добраться», «Стерильные инструменты» — только если это написал владелец.
 * Короткие факты не длиннее 25 символов: длинные преимущества сокращаем по смыслу, а не обрезаем на полуслове.
 */
export function factCallouts(b: Pick<ExtrasBiz, "advantages" | "offer" | "whatsapp" | "telegram">) {
  const out: string[] = [];
  const add = (s?: string | null) => {
    if (!s) return;
    const t = clean(s).replace(/[.!]$/, "");
    if (t && t.length <= 25 && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  for (const a0 of b.advantages ?? []) {
    const a = withoutSuperlatives(a0);
    if (!a) continue;
    add(a);
    // «Покрытие держится 3–4 недели» → «Держится 3–4 недели»
    if (clean(a).length > 25) add(clean(a).replace(/^[А-ЯЁA-Z][а-яёa-z]+\s+/, "").replace(/^./, (c) => c.toUpperCase()));
  }
  if (b.offer) add(withoutSuperlatives(b.offer));
  add("Онлайн-запись");
  if (b.whatsapp && b.telegram) add("Запись в WhatsApp и Telegram");
  else if (b.whatsapp || b.telegram) add(`Запись в ${b.whatsapp ? "WhatsApp" : "Telegram"}`);
  return out.slice(0, 8);
}

/** Директ: суммарная длина заголовков быстрых ссылок 1–4 — не больше 66 символов, 5–8 — тоже не больше 66 */
export const SITELINK_LIMITS = { title: 30, description: 60, groupTotal: 66 } as const;

/**
 * Подбираем быстрые ссылки так, чтобы набор прошёл проверку Директа: ссылки берём по приоритету,
 * пропуская те, что не влезают в лимит четвёрки. Вторая четвёрка — только если первая заполнена целиком,
 * иначе её ссылки встанут на места 1–4 и превысят лимит.
 */
export function fitSitelinks(list: Sitelink[]): Sitelink[] {
  const L = SITELINK_LIMITS;
  const ok = list
    .map((s) => ({ ...s, title: clean(s.title), description: s.description ? cut(s.description, L.description) : undefined }))
    .filter((s) => s.title && s.title.length <= L.title);
  const a: Sitelink[] = [], b: Sitelink[] = [];
  let la = 0, lb = 0;
  const seen = new Set<string>();
  for (const s of ok) {
    const key = s.title.toLowerCase();
    if (seen.has(key)) continue;
    if (a.length < 4 && la + s.title.length <= L.groupTotal) { a.push(s); la += s.title.length; seen.add(key); }
    else if (b.length < 4 && lb + s.title.length <= L.groupTotal) { b.push(s); lb += s.title.length; seen.add(key); }
  }
  return a.length === 4 ? [...a, ...b] : a;
}

function splitAddress(addr?: string | null) {
  if (!addr) return { street: null, house: null };
  const parts = addr.split(",").map((x) => x.trim()).filter(Boolean);
  const houseIdx = parts.findIndex((p) => /^(д\.?\s*)?\d+[а-яa-z]?(\/\d+)?(\s*(к|корп|стр)\.?\s*\d+)?$/i.test(p));
  if (houseIdx > 0) return { street: parts[houseIdx - 1], house: parts[houseIdx].replace(/^д\.?\s*/i, "") };
  const m = addr.match(/^(.*?)[,\s]+(\d+[а-яa-z]?(?:\/\d+)?)\s*$/i);
  if (m) return { street: m[1].replace(/,$/, "").trim(), house: m[2] };
  return { street: parts[0] ?? addr, house: null };
}

function parsePhone(p?: string | null) {
  if (!p) return null;
  let d = p.replace(/\D/g, "");
  if (d.length === 11 && (d[0] === "8" || d[0] === "7")) d = d.slice(1);
  if (d.length !== 10) return null;
  return { country: "+7", city: d.slice(0, 3), number: d.slice(3) };
}

/** «Пн–Пт 9:00–20:00» → «0;4;09;00;20;00». По умолчанию ежедневно 10–21. */
export function parseHours(h?: string | null) {
  const text = clean(h ?? "") || "Ежедневно 10:00–21:00";
  const t = text.match(/(\d{1,2})[:.](\d{2})\s*[–—-]\s*(\d{1,2})[:.](\d{2})/);
  const from = t ? [t[1], t[2]] : ["10", "00"];
  const to = t ? [t[3], t[4]] : ["21", "00"];
  const weekdays = /будн|пн\s*[–—-]\s*пт/i.test(text) && !/ежедн|без выходных|пн\s*[–—-]\s*вс/i.test(text);
  const q = (m: string) => String(Math.round(Number(m) / 15) * 15 % 60).padStart(2, "0");
  return { text, workTime: `0;${weekdays ? 4 : 6};${from[0].padStart(2, "0")};${q(from[1])};${to[0].padStart(2, "0")};${q(to[1])}` };
}

function withAnchor(href: string, anchor: string) {
  const i = href.indexOf("#");
  return `${i >= 0 ? href.slice(0, i) : href}#${anchor}`;
}

export function adExtras(b: ExtrasBiz, o: { channel: string; href: string; service?: string | null; text?: string }): AdExtras {
  const services = b.services ?? [];
  const svc = (o.service && services.find((s) => s.name === o.service)) || null;
  const priced = services.map((s) => ({ s, p: parsePrice(s.price) })).filter((x) => x.p);
  const price = svc ? parsePrice(svc.price) : priced.sort((a, c) => a.p!.price - c.p!.price)[0]?.p ?? null;
  const priceLabel = price && !svc && price.qualifier === "NONE" ? { ...price, qualifier: "FROM" as const, label: `от ${price.label}` } : price;

  const priceList = services
    .filter((s) => s.price)
    .map((s) => `${s.name.toLowerCase()} ${s.price}`)
    .slice(0, 3)
    .join(", ");
  const { street, house } = splitAddress(b.address);
  const hours = parseHours(b.hours);
  const hasPrices = services.some((s) => s.price);
  const named = services.filter((s) => clean(s.name));
  const adv = (b.advantages ?? []).map(withoutSuperlatives).filter(Boolean);
  const review = withoutSuperlatives(b.review);
  // Только ссылки, за которыми есть содержимое: без цен нет «Цен», без адреса — «Как добраться»
  const cand: (Sitelink | null)[] = [
    hasPrices
      ? { title: "Цены на услуги", href: withAnchor(o.href, "services"), description: priceList ? cap(priceList) : undefined }
      : named.length
        ? { title: "Услуги", href: withAnchor(o.href, "services"), description: cap(named.map((s) => clean(s.name).toLowerCase()).join(", ")) }
        : null,
    { title: "Записаться онлайн", href: withAnchor(o.href, "form"), description: "Выберите удобное время в форме записи" },
    review ? { title: "Отзыв клиента", href: withAnchor(o.href, "reviews"), description: review.length <= 58 ? `«${review}»` : `«${cut(review, 54)}...»` } : null,
    adv.length || withoutSuperlatives(b.description)
      ? { title: "Почему мы", href: withAnchor(o.href, "about"), description: adv.join(". ") || withoutSuperlatives(b.description) }
      : null,
    b.address ? { title: "Как добраться", href: withAnchor(o.href, "contacts"), description: [b.address, b.hours ? hours.text : null].filter(Boolean).join(". ") } : null,
    !b.address && b.hours ? { title: "Часы работы", href: withAnchor(o.href, "contacts"), description: hours.text } : null,
  ];
  // Директ принимает до 8 быстрых ссылок: добавляем другие услуги — каждая ведёт к своей строке прайса
  services.forEach((sv, i) => {
    if (sv.name === o.service) return;
    cand.push({ title: sv.name, href: withAnchor(o.href, `s${i + 1}`), description: [sv.price, sv.note, "запись онлайн"].filter(Boolean).join(", ") });
  });
  const sitelinks = fitSitelinks(cand.filter((x): x is Sitelink => !!x));

  // Отображаемая ссылка: до 20 символов, буквы, цифры и дефис
  const displayPath = (o.service || services[0]?.name || "")
    .toLowerCase()
    .replace(/[^а-яёa-z0-9\s-]/gi, " ")
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .reduce((acc, w) => (acc.done ? acc : (acc.s ? `${acc.s}-${w}` : w).length <= 20 ? { s: acc.s ? `${acc.s}-${w}` : w, done: false } : { ...acc, done: true }), { s: "", done: false })
    .s.replace(/(-(и|в|во|на|для|с|со|по|от|до|к|у|из|или|а|о|за))+$/, "");

  const phone = parsePhone(b.phone);
  const vcard: VCard | null =
    // Директ требует часы работы в визитке — без часов от владельца визитку не создаём, а не выдумываем «10–21»
    (phone || b.address) && clean(b.hours ?? "")
      ? { company: cut(b.name, 255), city: b.city, street, house, phone, phoneText: b.phone ?? null, hoursText: hours.text, workTime: hours.workTime }
      : null;

  const longParts = [
    o.text,
    ...adv.slice(0, 3),
    b.offer ? `${cap(withoutSuperlatives(b.offer))}.` : null,
    b.address ? `Ждём вас: ${b.city}, ${b.address}.` : null,
    "Запишитесь онлайн — это займёт минуту.",
  ];
  // Длинный текст VK: без повторов — каждое предложение один раз
  const seen = new Set<string>();
  const norm = (x: string) => x.toLowerCase().replace(/[^а-яёa-z0-9]/gi, "");
  let longText = "";
  for (const p of longParts) {
    if (!p) continue;
    for (const raw of clean(p).split(/(?<=[.!?…])\s+/)) {
      const t = raw.trim();
      if (!t || seen.has(norm(t)) || hasSuperlative(t)) continue;
      const sentence = /[.!?…»]$/.test(t) ? t : `${t}.`;
      const next = longText ? `${longText} ${sentence}` : sentence;
      if (next.length > 220) continue;
      seen.add(norm(t));
      longText = next;
    }
  }

  const n = nicheById(b.niche);
  const about = cut(`${clean(b.name)} — ${n.label.toLowerCase()} в городе ${b.city}${b.address ? `, ${b.address}` : ""}.`, 115);

  return {
    callouts: factCallouts(b),
    sitelinks,
    displayPath: displayPath || null,
    price: o.channel === "vk" ? null : priceLabel,
    vcard,
    longText,
    about,
  };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

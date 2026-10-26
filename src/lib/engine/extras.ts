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
  const list = [...(planned ?? []), ...x.callouts].map((c) => c.trim()).filter((c) => c && c.length <= 25);
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

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
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

/** Короткие факты не длиннее 25 символов: длинные преимущества сокращаем по смыслу, а не обрезаем на полуслове */
function shortFacts(b: ExtrasBiz) {
  const out: string[] = [];
  const add = (s?: string | null) => {
    if (!s) return;
    const t = clean(s).replace(/[.!]$/, "");
    if (t.length <= 25 && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  for (const a of b.advantages ?? []) {
    add(a);
    // «Покрытие держится 3–4 недели» → «Держится 3–4 недели»
    if (clean(a).length > 25) add(a.replace(/^[А-ЯЁA-Z][а-яёa-z]+\s+/, "").replace(/^./, (c) => c.toUpperCase()));
  }
  if (b.offer) add(b.offer);
  add("Онлайн-запись 24/7");
  if (b.whatsapp || b.telegram) add(`Запись в ${b.whatsapp ? "WhatsApp" : "Telegram"}`);
  if (b.address) add("Удобно добраться");
  const n = nicheById(b.niche);
  if (/стерил/i.test((b.advantages ?? []).join(" ")) === false && ["nails", "brows", "cosmetology", "barber", "hair"].includes(n.id)) add("Стерильные инструменты");
  add("Без очереди");
  return out.slice(0, 8);
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
  const sitelinks: Sitelink[] = [
    { title: "Цены на услуги", href: withAnchor(o.href, "services"), description: priceList ? cut(cap(priceList), 60) : "Все услуги и цены на одной странице" },
    { title: "Записаться онлайн", href: withAnchor(o.href, "form"), description: "Выберите удобное время — займёт минуту" },
    b.review
      ? { title: "Отзывы клиентов", href: withAnchor(o.href, "reviews"), description: clean(b.review).length <= 56 ? `«${clean(b.review)}»` : `«${cut(b.review, 54)}…»` }
      : { title: "Почему мы", href: withAnchor(o.href, "about"), description: cut((b.advantages ?? []).join(". ") || b.description || nicheById(b.niche).proof, 60) },
    { title: "Как добраться", href: withAnchor(o.href, "contacts"), description: cut([b.address, hours.text].filter(Boolean).join(" · ") || b.city, 60) },
  ];

  // Директ принимает до 8 быстрых ссылок: добавляем другие услуги с ценой — каждая ведёт к своей строке прайса
  services.forEach((sv, i) => {
    if (sitelinks.length >= 8 || sv.name === o.service || sv.name.length > 30) return;
    sitelinks.push({ title: sv.name, href: withAnchor(o.href, `s${i + 1}`), description: cut([sv.price, sv.note, "запись онлайн"].filter(Boolean).join(" · "), 60) });
  });

  const displayPath = (o.service || services[0]?.name || "")
    .toLowerCase()
    .replace(/[^а-яёa-z0-9\s-]/gi, "")
    .trim()
    .split(/\s+/)
    .reduce((acc, w) => ((acc ? `${acc}-${w}` : w).length <= 20 ? (acc ? `${acc}-${w}` : w) : acc), "");

  const phone = parsePhone(b.phone);
  const vcard: VCard | null =
    phone || b.address
      ? { company: cut(b.name, 255), city: b.city, street, house, phone, phoneText: b.phone ?? null, hoursText: hours.text, workTime: hours.workTime }
      : null;

  const adv = b.advantages ?? [];
  const longParts = [
    o.text,
    ...adv.slice(0, 3),
    b.offer ? `${cap(b.offer)}.` : null,
    b.address ? `Ждём вас: ${b.city}, ${b.address}.` : null,
    "Запишитесь онлайн — это займёт минуту.",
  ];
  // Длинный текст VK: без повторов — каждое предложение один раз
  const seen = new Set<string>();
  const norm = (x: string) => x.toLowerCase().replace(/[^а-яёa-z0-9]/gi, "");
  let longText = "";
  for (const p of longParts) {
    if (!p) continue;
    for (const raw of p.split(/(?<=[.!?…])\s+/)) {
      const t = raw.trim();
      if (!t || seen.has(norm(t))) continue;
      const sentence = /[.!?…»]$/.test(t) ? t : `${t}.`;
      const next = longText ? `${longText} ${sentence}` : sentence;
      if (next.length > 220) continue;
      seen.add(norm(t));
      longText = next;
    }
  }

  const n = nicheById(b.niche);
  const about = cut(`${b.name} — ${n.label.toLowerCase()} в городе ${b.city}${b.address ? `, ${b.address}` : ""}.`, 115);

  return {
    callouts: shortFacts(b),
    sitelinks,
    displayPath: displayPath || null,
    price: o.channel === "vk" ? null : priceLabel,
    vcard,
    longText,
    about,
  };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

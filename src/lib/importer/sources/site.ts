/**
 * Любой сайт (в т. ч. Tilda, Wix, конструкторы): schema.org JSON-LD, микроразметка, OpenGraph,
 * ссылки tel:/wa.me/t.me, прайс в тексте страницы, фото. Плюс до двух внутренних страниц: «Цены», «Услуги», «Контакты».
 */
import type { Found, ImportService } from "../types";
import { clean, htmlToText, images, jsonLd, ldTypes, links, metaTags, microdata, titleOf } from "../html";
import {
  cityFromAddress, cleanDescription, isName, cleanName, cleanServiceName, formatPhone, formatPrice, hoursFromSchema, hoursFromSpec,
  normalizePrice, phoneInText, pricesFromText, servicesFromJson, stripCity, stripTracking, telegramFrom, uniq, whatsappFrom,
} from "../normalize";

const BUSINESS_TYPES = /(localbusiness|beautysalon|hairsalon|nailsalon|dayspa|healthandbeautybusiness|exercisegym|healthclub|sportsactivitylocation|sportsclub|medicalbusiness|store|organization|professionalservice|danceschool|educationalorganization|yogastudio|spa|salon|studio|gym)$/;

type Ld = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? clean(v) : typeof v === "number" ? String(v) : "");
const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

/** Самый «бизнесовый» объект JSON-LD: LocalBusiness важнее Organization, полнота — при равенстве */
function pickBusiness(list: Ld[]): Ld | null {
  let best: Ld | null = null;
  let bestScore = -1;
  for (const o of list) {
    const t = ldTypes(o);
    if (!t.some((x) => BUSINESS_TYPES.test(x))) continue;
    const local = t.some((x) => x !== "organization" && x !== "corporation");
    const score = (local ? 10 : 0) + ["address", "telephone", "openingHours", "openingHoursSpecification", "makesOffer", "hasOfferCatalog", "aggregateRating", "priceRange"].filter((k) => o[k]).length;
    if (score > bestScore) {
      best = o;
      bestScore = score;
    }
  }
  return best;
}

function ldAddress(a: unknown): { address: string; city: string } {
  const v = first(a);
  if (typeof v === "string") return { address: clean(v), city: cityFromAddress(v) };
  if (v && typeof v === "object") {
    const o = v as Ld;
    const city = str(o.addressLocality);
    const street = str(o.streetAddress);
    return { address: street, city: city || cityFromAddress(street) };
  }
  return { address: "", city: "" };
}

/** Услуги из makesOffer / hasOfferCatalog (вложенные каталоги тоже) */
export function ldServices(o: Ld): ImportService[] {
  const out: ImportService[] = [];
  const visit = (v: unknown, depth: number) => {
    if (!v || depth > 6 || out.length >= 15) return;
    if (Array.isArray(v)) return v.forEach((x) => visit(x, depth + 1));
    if (typeof v !== "object") return;
    const x = v as Ld;
    const item = (x.itemOffered ?? null) as Ld | null;
    const name = cleanServiceName(str(item?.name) || str(x.name));
    const spec = first(x.priceSpecification) as Ld | undefined;
    const min = x.price ?? x.lowPrice ?? spec?.price ?? spec?.minPrice;
    const max = x.highPrice ?? spec?.maxPrice;
    const cur = str(x.priceCurrency ?? spec?.priceCurrency).toUpperCase();
    if (name && min !== undefined && (!cur || cur === "RUB" || cur === "RUR")) {
      const a = Number(String(min).replace(/[^\d.]/g, ""));
      const b = max !== undefined ? Number(String(max).replace(/[^\d.]/g, "")) : null;
      const price = a > 0 ? formatPrice(a, b && b > a ? b : null, Boolean(spec?.minPrice && !spec?.maxPrice)) : normalizePrice(min);
      if (price) out.push({ name, price });
    } else if (name && !x.itemListElement && item) {
      out.push({ name });
    }
    visit(x.itemListElement, depth + 1);
    visit(x.hasOfferCatalog, depth + 1);
  };
  visit(o.makesOffer, 0);
  visit(o.hasOfferCatalog, 0);
  return uniq(out, (s) => s.name.toLowerCase());
}

const PHOTO_SKIP = /(logo|icon|favicon|sprite|avatar|placeholder|blank|pixel|badge|button|arrow|social|vk\.|tg\.|whatsapp|telegram|instagram|payment|visa|mastercard|mir\.|qr|\.svg|\.gif|counter|metrika|mc\.yandex|1x1)/i;

/** Фото: JSON-LD image, og:image и крупные картинки страницы */
function pickPhotos(ld: Ld | null, meta: Record<string, string>, html: string, base: string): string[] {
  const out: string[] = [];
  const push = (u: unknown) => {
    const s = typeof u === "string" ? u : u && typeof u === "object" ? str((u as Ld).url ?? (u as Ld).contentUrl) : "";
    if (!s) return;
    try {
      const abs = new URL(s, base).toString();
      if (!PHOTO_SKIP.test(abs) && /^https?:/.test(abs)) out.push(abs);
    } catch {
      /* пропускаем */
    }
  };
  for (const im of ([] as unknown[]).concat(ld?.image ?? [], ld?.photo ?? [])) push(im);
  push(meta["og:image"] || meta["og:image:secure_url"] || meta["twitter:image"]);
  const imgs = images(html, base).filter((i) => !PHOTO_SKIP.test(i.src) && !PHOTO_SKIP.test(i.cls) && !/\.(svg|gif)(\?|$)/i.test(i.src));
  // Сначала явно крупные (по атрибутам), затем остальные из галерей/фонов — размер проверим при скачивании
  const big = imgs.filter((i) => i.width >= 450 || i.height >= 450);
  const rest = imgs.filter((i) => !(i.width || i.height) && /(gallery|galer|slider|photo|foto|work|portfolio|interior|tild|upload|images?\/|media|bg)/i.test(i.src + " " + i.cls));
  for (const i of [...big, ...rest]) push(i.src);
  return uniq(out, (u) => u.replace(/[?#].*$/, "")).slice(0, 10);
}

const NEXT_PAGE = /(price|prais|prajs|praice|tseny|ceny|stoimost|uslug|services|service|menu|kontakt|contact|контакт|цены|прайс|услуг|стоимост)/i;

/** Внутренние ссылки, которые стоит прочитать: сначала цены/услуги, потом контакты */
export function nextPages(html: string, base: string, limit = 2): string[] {
  let host = "";
  try {
    host = new URL(base).hostname.replace(/^www\./, "");
  } catch {
    return [];
  }
  const baseNoHash = base.replace(/#.*$/, "");
  const cand = links(html, base)
    .filter((l) => /^https?:/.test(l.href))
    .filter((l) => {
      try {
        const u = new URL(l.href);
        return u.hostname.replace(/^www\./, "") === host && u.toString().replace(/#.*$/, "") !== baseNoHash && !/\.(pdf|jpe?g|png|docx?|xlsx?|zip)$/i.test(u.pathname);
      } catch {
        return false;
      }
    })
    .filter((l) => NEXT_PAGE.test(decodeURIComponent(new URL(l.href).pathname)) || NEXT_PAGE.test(l.text));
  const rank = (l: { href: string; text: string }) => (/(price|prais|prajs|tseny|ceny|stoimost|цены|прайс|стоимост)/i.test(l.href + l.text) ? 0 : /(uslug|services?|услуг|menu)/i.test(l.href + l.text) ? 1 : 2);
  return uniq(cand.sort((a, b) => rank(a) - rank(b)).map((l) => l.href.replace(/#.*$/, ""))).slice(0, limit);
}

/** Ссылки на карточки и онлайн-запись внутри сайта: их тоже можно прочитать */
export function externalSources(hrefs: string[]): string[] {
  return uniq(
    hrefs.filter((h) =>
      /yandex\.[a-z.]+\/maps\/(?:\d+\/[^/]+\/)?org\/|2gis\.[a-z]+\/(?:[^/]+\/)?firm\/\d+|dikidi\.(net|ru|app)\/(?:#?\w*\/)?\d{3,}|dikidi\.(net|ru|app)\/.*_\d{3,}|\.yclients\.(com|ru)\//i.test(h),
    ),
    (h) => h.replace(/[?#].*$/, ""),
  ).slice(0, 3);
}

/** Разбор одной страницы сайта */
export function parseSite(html: string, url: string): Found & { next: string[] } {
  const meta = metaTags(html);
  const ld = jsonLd(html);
  const biz = pickBusiness(ld);
  const md = microdata(html);
  const text = htmlToText(html);
  const all = links(html, url);
  const hrefs = all.map((l) => l.href);

  const { address: ldAddr, city: ldCity } = biz ? ldAddress(biz.address) : { address: "", city: "" };
  const mdAddr = md.streetaddress ?? "";
  const city = ldCity || md.addresslocality || cityFromAddress(ldAddr || mdAddr) || cityFromAddress(titleOf(html)) || "";
  const address = stripCity(ldAddr || mdAddr, city);

  const tel = hrefs.find((h) => /^tel:/i.test(h));
  const phone = formatPhone(str(first(biz?.telephone)) || md.telephone || (tel ? decodeURIComponent(tel.slice(4)) : "") || phoneInText(text));
  const whatsapp = hrefs.map(whatsappFrom).find(Boolean) ?? "";
  const telegram = hrefs.map(telegramFrom).find(Boolean) ?? "";
  const hours = (biz && (hoursFromSpec(biz.openingHoursSpecification) || hoursFromSchema(biz.openingHours))) || hoursFromSchema(md.openinghours) || "";

  let services = biz ? ldServices(biz) : [];
  let structured = services.filter((s) => s.price).length >= 2;
  if (!structured) {
    // Встроенный JSON виджетов и магазинов (Tilda Store, конструкторы) — затем прайс в тексте
    const fromJson = jsonBlobs(html).flatMap((j) => servicesFromJson(j));
    const cards = cardPrices(html);
    const fromText = uniq([...cards.services, ...pricesFromText(htmlToText(cards.rest))], (s) => s.name.toLowerCase()).slice(0, 15);
    if (fromJson.length >= 2) {
      services = fromJson;
      structured = true;
    } else if (fromText.length > services.filter((s) => s.price).length) services = fromText;
  }

  const agg = (biz?.aggregateRating ?? null) as Ld | null;
  const rv = Number(str(agg?.ratingValue).replace(",", "."));
  const rc = Number(str(agg?.reviewCount ?? agg?.ratingCount));
  const review = first(biz?.review) as Ld | undefined;
  const reviewText = str(review?.reviewBody ?? review?.description);

  const name = cleanName(str(biz?.name) || md.name || meta["og:site_name"] || meta["og:title"] || titleOf(html));
  const description = cleanDescription(str(biz?.description) || meta["og:description"] || meta.description);

  let siteUrl = url;
  try {
    const u = new URL(url);
    siteUrl = NEXT_PAGE.test(u.pathname) || u.pathname === "/" ? u.origin : stripTracking(u.toString());
  } catch {
    /* как есть */
  }

  const categories = [...ldTypes(biz ?? {}), meta.keywords ?? "", clean(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? "")].filter(Boolean);

  return {
    kind: "site",
    url,
    status: "ok",
    name,
    categories,
    city,
    address,
    phone,
    whatsapp,
    telegram,
    hours,
    siteUrl,
    services: services.slice(0, 15),
    servicesStructured: structured,
    description,
    review: reviewText.length >= 30 ? reviewText.slice(0, 300) : undefined,
    rating: rv > 0 && rv <= 5 ? { value: rv, count: rc || 0 } : undefined,
    photos: pickPhotos(biz, meta, html, url),
    text,
    links: externalSources(hrefs),
    next: nextPages(html, url),
  };
}

/**
 * Карточки услуг конструкторов (Tilda t-card/t-store, «name/title» + «price» в одном блоке):
 * название берём из элемента с классом name/title, а не строку описания над ценой.
 * Возвращает найденное и HTML без этих карточек — остальное разберёт текстовый поиск прайса.
 */
export function cardPrices(html: string): { services: ImportService[]; rest: string } {
  const services: ImportService[] = [];
  const re = /<(div|h[2-6]|span|p|strong)\b[^>]*class=["'][^"']*(?:__title|__name|-title|-name|\bname\b|\btitle\b|t-name)[^"']*["'][^>]*>([\s\S]{2,200}?)<\/\1>((?:(?!class=["'][^"']*(?:title|name))(?!<\/?(?:table|tr|td|th|section|ul|ol)\b)[\s\S]){0,700}?)<(div|span|p|strong)\b[^>]*class=["'][^"']*price[^"']*["'][^>]*>([\s\S]{1,120}?)<\/\4>/gi;
  const rest = html.replace(re, (all, _t, rawName: string, _mid, _t2, rawPrice: string) => {
    const name = cleanServiceName(clean(rawName));
    const price = normalizePrice(clean(rawPrice));
    if (!name || !price || !isName(name)) return all;
    services.push({ name, price });
    return " ";
  });
  return { services: uniq(services, (s) => s.name.toLowerCase()), rest };
}

/** JSON внутри страницы: <script type="application/json">, window.__X__ = {...} */
export function jsonBlobs(html: string): unknown[] {
  const out: unknown[] = [];
  for (const m of html.matchAll(/<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]{20,2000000}?)<\/script>/gi)) {
    try {
      out.push(JSON.parse(m[1]));
    } catch {
      /* пропускаем */
    }
  }
  for (const m of html.matchAll(/window\.(?:__[A-Z_]+__|[a-zA-Z]+Data|data|initialState)\s*=\s*(\{[\s\S]{20,1000000}?\});\s*(?:\n|<\/script>|window\.)/g)) {
    try {
      out.push(JSON.parse(m[1]));
    } catch {
      /* пропускаем */
    }
  }
  return out;
}

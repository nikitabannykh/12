/**
 * Любой сайт (Tilda, Flexbe, WordPress, Битрикс, свой): schema.org JSON-LD, микроразметка, OpenGraph, ссылки tel:/wa.me/t.me,
 * виджеты карт, адреса и часы в тексте, прайс по блокам с категориями по заголовкам, преимущества, юр. данные, все фото.
 * Плюс до четырёх внутренних страниц: цены/услуги, контакты, «О нас», галерея.
 */
import type { Found, ImportService } from "../types";
import { blocks, clean, decodeEntities, htmlToText, jsonLd, ldTypes, links, looseJson, metaTags, microdata, photoCandidates, photoKey, rankPhotos, titleOf } from "../html";
import {
  addressKey, addressesFromBlocks, advantagesFromBlocks, categoryOf, cityFromAddress, cityFromText, cleanAddress, cleanDescription, isName, cleanName, cleanServiceName,
  durationIn, finalizeCategories, formatPhone, isColumnHeader, formatPrice, hoursFromSchema, hoursFromSpec, hoursFromText, legalFromText, normalizePrice, offerFromText, priceNumber, phoneInText,
  priceOfText, pricesFromBlocks, servicesFromJson, shortNote, stripCity, stripTracking, telegramFrom, uniq, whatsappFrom, type AddressCand,
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
  const visit = (v: unknown, depth: number, cat = "") => {
    if (!v || depth > 6 || out.length >= 40) return;
    if (Array.isArray(v)) return v.forEach((x) => visit(x, depth + 1, cat));
    if (typeof v !== "object") return;
    const x = v as Ld;
    const item = (x.itemOffered ?? null) as Ld | null;
    const name = cleanServiceName(str(item?.name) || str(x.name));
    const spec = first(x.priceSpecification) as Ld | undefined;
    const min = x.price ?? x.lowPrice ?? spec?.price ?? spec?.minPrice;
    const max = x.highPrice ?? spec?.maxPrice;
    const cur = str(x.priceCurrency ?? spec?.priceCurrency).toUpperCase();
    if (name && min !== undefined && (!cur || cur === "RUB" || cur === "RUR")) {
      const a = priceNumber(min);
      const b = max !== undefined ? priceNumber(max) : null;
      const price = a >= 50 && a <= 500000 ? formatPrice(a, b && b > a ? b : null, Boolean(spec?.minPrice && !spec?.maxPrice)) : normalizePrice(min);
      if (price) out.push({ name, price, ...(cat ? { category: cat } : {}) });
    } else if (name && !x.itemListElement && item) {
      out.push({ name, ...(cat ? { category: cat } : {}) });
    }
    // Вложенный каталог «Маникюр» → его услуги получают категорию
    const sub = x.itemListElement && depth > 0 ? categoryOf(str(x.name)) || cat : cat;
    visit(x.itemListElement, depth + 1, sub);
    visit(x.hasOfferCatalog, depth + 1, sub);
  };
  visit(o.makesOffer, 0);
  visit(o.hasOfferCatalog, 0);
  return uniq(out, (s) => s.name.toLowerCase());
}

const PHOTO_SKIP = /(logo|icon|favicon|sprite|avatar|placeholder|blank|pixel|badge|button|arrow|social|vk\.|tg\.|whatsapp|telegram|instagram|payment|visa|mastercard|mir\.|qr|\.svg|\.gif|counter|metrika|mc\.yandex|1x1)/i;

/** Фото: JSON-LD image, og:image и все осмысленные картинки страницы (галереи, слайдеры, фоны), по убыванию пользы */
/** Подписи к фото страницы: alt/title картинок и картинки позиций из встроенного JSON меню (name + image) */
function photoCaptionsOf(html: string, base: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of photoCandidates(html, base)) if (c.caption) out[c.url] = c.caption;
  const IMG_KEYS = ["image", "img", "photo", "picture", "preview", "image_url", "imageUrl", "thumbnail", "cover"];
  const visit = (v: unknown, depth: number) => {
    if (depth > 12 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach((x) => visit(x, depth + 1));
    const o = v as Record<string, unknown>;
    const name = ["title", "name", "label"].map((k) => o[k]).find((x) => typeof x === "string" && x.trim().length >= 3) as string | undefined;
    if (name) {
      for (const k of IMG_KEYS) {
        const raw = o[k];
        const u = typeof raw === "string" ? raw : raw && typeof raw === "object" ? ((raw as Record<string, unknown>).url ?? (raw as Record<string, unknown>).src) : null;
        if (typeof u !== "string" || !/\.(jpe?g|png|webp)(?:[?#]|$)/i.test(u)) continue;
        try {
          const abs = new URL(u, base).toString();
          out[abs] ??= name.trim().slice(0, 120);
        } catch {
          /* пропускаем */
        }
      }
    }
    for (const k of Object.keys(o)) if (typeof o[k] === "object") visit(o[k], depth + 1);
  };
  for (const j of jsonBlobs(html)) visit(j, 0);
  return out;
}

function pickPhotos(ld: Ld | null, meta: Record<string, string>, html: string, base: string, limit = 40): string[] {
  const head: string[] = [];
  const push = (u: unknown) => {
    const s = typeof u === "string" ? u : u && typeof u === "object" ? str((u as Ld).url ?? (u as Ld).contentUrl) : "";
    if (!s) return;
    try {
      const abs = new URL(s, base).toString();
      if (!PHOTO_SKIP.test(abs) && /^https?:/.test(abs)) head.push(abs);
    } catch {
      /* пропускаем */
    }
  };
  for (const im of ([] as unknown[]).concat(ld?.image ?? [], ld?.photo ?? [])) push(im);
  const cands = photoCandidates(html, base);
  const og = meta["og:image"] || meta["og:image:secure_url"] || meta["twitter:image"];
  const ranked = rankPhotos(cands, limit * 2);
  // og:image — обычно обложка: ставим после первых фото галереи, а не первой
  const list = [...head, ...ranked.slice(0, 3)];
  if (og) push(og);
  const all = [...list, ...head.slice(list.length), ...ranked.slice(3)];
  return uniq(all, (u) => photoKey(u)).slice(0, limit);
}

const NEXT_PRICE = /(price|prais|prajs|praice|tseny|ceny|czeny|stoimost|цены|прайс|стоимост)/i;
const NEXT_SERVICES = /(uslug|services?|menu|услуг)/i;
const NEXT_CONTACTS = /(kontakt|contact|контакт|address|adres|адрес|kak-proehat|как проехать|как добраться)/i;
const NEXT_ABOUT = /(about|o-nas|onas|o_nas|о нас|о студии|о салоне|o-studii|o-salone|why|pochemu|почему)/i;
const NEXT_GALLERY = /(gallery|galereya|galery|galerei|portfolio|raboty|nashi-raboty|works|foto|photo|галере|наши работы|портфолио|фото)/i;
const NEXT_PAGE = new RegExp([NEXT_PRICE, NEXT_SERVICES, NEXT_CONTACTS, NEXT_ABOUT, NEXT_GALLERY].map((r) => r.source).join("|"), "i");

/**
 * Внутренние ссылки, которые стоит прочитать: до 2 страниц цен/услуг, контакты, «О нас», галерея (всего до limit).
 */
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
    .map((l) => ({ ...l, path: decodeURIComponent(new URL(l.href).pathname) }))
    .filter((l) => NEXT_PAGE.test(l.path) || NEXT_PAGE.test(l.text));
  const kind = (l: { path: string; text: string }) => {
    const s = `${l.path} ${l.text}`;
    return NEXT_PRICE.test(s) ? 0 : NEXT_SERVICES.test(s) ? 1 : NEXT_CONTACTS.test(s) ? 2 : NEXT_ABOUT.test(s) ? 3 : 4;
  };
  const sorted = uniq(cand.sort((a, b) => kind(a) - kind(b)), (l) => l.href.replace(/#.*$/, ""));
  // Не больше двух страниц прайса/услуг — остальное место контактам, «О нас» и галерее
  const out: string[] = [];
  const quota = [2, 2, 1, 1, 1];
  const used = [0, 0, 0, 0, 0];
  for (const l of sorted) {
    const k = kind(l);
    if (k <= 1 && used[0] + used[1] >= 2) continue;
    if (used[k] >= quota[k]) continue;
    used[k]++;
    out.push(l.href.replace(/#.*$/, ""));
  }
  return out.slice(0, limit);
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

/**
 * Карты на сайте: виджет Яндекс Карт (iframe map-widget с oid= — это карточка организации; ll/pt — координаты),
 * конструктор карт, 2ГИС (ссылки firm/ID в виджете), ymaps.Placemark с адресом в подсказке,
 * атрибуты блоков карт (data-address, data-descr, data-map-markers…). Возвращает ссылки на карточки и адреса.
 */
export function mapWidgets(html: string): { links: string[]; addresses: string[] } {
  const out = { links: [] as string[], addresses: [] as string[] };
  for (const m of html.matchAll(/<iframe\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    const src = decodeEntities(m[1]);
    if (/yandex\.[a-z.]+\/(map-widget|maps)/i.test(src)) {
      const oid = /[?&](?:oid|orgid)=(\d{5,20})/i.exec(src)?.[1];
      if (oid) out.links.push(`https://yandex.ru/maps/org/${oid}/`);
      const text = /[?&]text=([^&]+)/i.exec(src)?.[1];
      if (text) {
        try {
          out.addresses.push(decodeURIComponent(text.replace(/\+/g, " ")));
        } catch {
          /* пропускаем */
        }
      }
    }
    const firm = /2gis\.[a-z]+\/(?:[^"'?#]*\/)?firm\/(\d{6,20})/i.exec(src)?.[1];
    if (firm) out.links.push(`https://2gis.ru/firm/${firm}`);
  }
  for (const m of html.matchAll(/https?:\/\/(?:www\.)?2gis\.[a-z]+\/(?:[\w-]+\/)?firm\/(\d{6,20})/gi)) out.links.push(`https://2gis.ru/firm/${m[1]}`);
  for (const m of html.matchAll(/https?:\/\/yandex\.[a-z.]+\/maps\/(?:\d+\/[\w-]+\/)?org\/(?:[\w-]+\/)?(\d{5,20})/gi)) out.links.push(`https://yandex.ru/maps/org/${m[1]}/`);
  // ymaps.Placemark([lat, lng], { balloonContent: "ул. …", hintContent: "…" })
  for (const m of html.matchAll(/(?:balloonContent(?:Header|Body)?|hintContent|iconCaption|address)\s*:\s*(["'`])((?:(?!\1).){6,300})\1/gi)) out.addresses.push(clean(m[2]));
  // Блоки карт конструкторов: data-*address*, data-*descr*, data-map-markers='[{…"address":"…"}]'
  for (const m of html.matchAll(/\sdata-[\w-]*(?:address|addr|descr|balloon|marker|map)[\w-]*\s*=\s*(["'])([\s\S]{6,3000}?)\1/gi)) {
    const v = decodeEntities(m[2]);
    const j = /^[[{]/.test(v.trim()) ? looseJson(v) : null;
    if (j) {
      const walk = (x: unknown, d = 0) => {
        if (!x || d > 5) return;
        if (Array.isArray(x)) x.forEach((y) => walk(y, d + 1));
        else if (typeof x === "object") for (const [k, y] of Object.entries(x as Ld)) {
          if (typeof y === "string" && /(address|addr|descr|title|name|balloon|hint)/i.test(k)) out.addresses.push(clean(y));
          else walk(y, d + 1);
        }
      };
      walk(j);
    } else out.addresses.push(clean(v));
  }
  return { links: uniq(out.links), addresses: uniq(out.addresses.filter((a) => a.length >= 6 && a.length <= 300)) };
}

/**
 * Название бизнеса: из кандидатов (schema.org, og:site_name, части заголовка) выбираем похожее на бренд —
 * с доменом сайта или в кавычках («Город Красоты»), а не SEO-фразу «Маникюр в Казани» и не «Главная» из хлебных крошек.
 */
export function brandName(cands: { v: string; w: number }[], host: string): string {
  const root = host.replace(/^www\./, "").split(".")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  const list: { v: string; w: number }[] = [];
  for (const c of cands) {
    const v = clean(c.v);
    if (!v) continue;
    // Название из schema.org владелец задал сам — берём целиком («Студия «Лак»»), если оно не SEO-фраза
    if (c.w >= 4 && v.length <= 50 && !/[|]/.test(v)) list.push({ v, w: c.w + 4 });
    for (const q of v.matchAll(/[«"“]([^»"”]{2,40})[»"”]/g)) list.push({ v: q[1].trim(), w: c.w + 3 });
    for (const seg of v.split(/\s+[|•·—–-]\s+|\s*\|\s*/)) if (seg.trim().length >= 2 && seg.length <= 80) list.push({ v: seg.trim(), w: c.w });
  }
  const seo = /(в\s+[А-ЯЁ][а-яё]+(е|и|у)\b|цены|онлайн[- ]запись|недорого|рядом|официальный сайт|адреса и телефоны|услуги|прайс|у метро)/i;
  const generic = /^(главная|home|салоны?|студия|о нас|контакты|услуги|цены|прайс|меню|блог|новости|салон красоты|студия красоты)$/i;
  const score = (x: { v: string; w: number }) => {
    const l = x.v.toLowerCase().replace(/[^a-zа-я0-9]/g, "");
    if (generic.test(x.v.replace(/[«»"]/g, "").trim()) || l.length < 2) return -100;
    let sc = x.w;
    if (root.length >= 3 && (l.includes(root) || translit(l).includes(root))) sc += 5;
    if (seo.test(x.v)) sc -= 4;
    if (x.v.split(/\s+/).length <= 4) sc += 1;
    if (x.v.length > 50) sc -= 2;
    return sc;
  };
  const best = [...list].sort((a, b) => score(b) - score(a))[0];
  if (!best || score(best) <= 0) return "";
  // Кавычки снимаем, только если они обрамляют всё название
  return /^[«"].*[»"]$/.test(best.v) && !/[«"]/.test(best.v.slice(1, -1)) ? best.v.slice(1, -1) : best.v;
}

const TR: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
const translit = (s: string) => s.replace(/[а-яё]/g, (c) => TR[c] ?? c);

/** Разбор одной страницы сайта */
export function parseSite(html: string, url: string): Found & { next: string[] } {
  const meta = metaTags(html);
  const ld = jsonLd(html);
  const biz = pickBusiness(ld);
  const md = microdata(html);
  const bl = blocks(html);
  const text = bl.map((b) => b.text).join("\n").slice(0, 60000) || htmlToText(html);
  const all = links(html, url);
  const hrefs = all.map((l) => l.href);
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    /* как есть */
  }

  // Адреса: JSON-LD (в т. ч. несколько филиалов), микроразметка, виджеты карт, текст страницы
  const branches = ld.filter((o) => ldTypes(o).some((x) => BUSINESS_TYPES.test(x)) && o.address).map((o) => ldAddress(o.address)).filter((a) => a.address);
  const { address: ldAddr, city: ldCity } = biz ? ldAddress(biz.address) : { address: "", city: "" };
  const mdAddr = md.streetaddress ?? "";
  const maps = mapWidgets(html);
  const fromText = addressesFromBlocks(bl);
  const fromMaps = maps.addresses.map((a) => cleanAddress(a)).filter(Boolean).map((a) => ({ address: a, city: cityFromAddress(a), score: 4 }));
  const cands: AddressCand[] = [
    ...branches.map((b) => ({ address: b.address, city: b.city, score: 10 })),
    ...(mdAddr ? [{ address: mdAddr, city: md.addresslocality || cityFromAddress(mdAddr), score: 8 }] : []),
    ...fromMaps,
    ...fromText,
  ];
  const textCity = cityFromText(`${titleOf(html)}\n${meta.description ?? ""}\n${text.slice(0, 3000)}`);
  const city = ldCity || md.addresslocality || cands.map((c) => c.city).find(Boolean) || cityFromAddress(titleOf(html)) || textCity || "";
  const addrMap = new Map<string, { address: string; city: string; score: number }>();
  for (const c of cands) {
    const cc = c.city || city;
    const k = addressKey(c.address, cc);
    if (!k || k.length < 4) continue;
    const prev = addrMap.get(k);
    if (prev) prev.score += c.score + 1;
    else addrMap.set(k, { address: stripCity(c.address, cc), city: cc, score: c.score });
  }
  const addresses = [...addrMap.values()].sort((a, b) => b.score - a.score);
  const address = stripCity(ldAddr || mdAddr || addresses[0]?.address || "", city);

  const tel = hrefs.find((h) => /^tel:/i.test(h));
  const phone = formatPhone(str(first(biz?.telephone)) || md.telephone || (tel ? decodeURIComponent(tel.slice(4)) : "") || phoneInText(text));
  const whatsapp = hrefs.map(whatsappFrom).find(Boolean) ?? "";
  const telegram = hrefs.map(telegramFrom).find(Boolean) ?? "";
  let hours = (biz && (hoursFromSpec(biz.openingHoursSpecification) || hoursFromSchema(biz.openingHours))) || hoursFromSchema(md.openinghours) || "";
  if (!hours) for (let i = 0; i < bl.length && !hours; i++) if (!bl[i].nav) hours = hoursFromText(bl[i].text, bl[i - 1]?.text ?? "");

  let services = biz ? ldServices(biz) : [];
  let structured = services.filter((s) => s.price).length >= 2;
  if (!structured) {
    // Встроенный JSON виджетов и магазинов (Tilda Store, конструкторы) — затем карточки и прайс по блокам (с категориями)
    const fromJson = jsonBlobs(html).flatMap((j) => servicesFromJson(j, 40));
    const cards = cardPrices(html);
    const restServices = pricesFromBlocks(blocks(cards.rest), 40, (idx, category, next) => {
      const c = cards.services[idx];
      if (!c) return;
      if (category) c.category = category;
      const note = /^\(\s*([^()]{3,200})\s*\)$/.exec(next)?.[1] ?? durationIn(next);
      if (note) c.note = shortNote(note);
    });
    const fromBlocks = uniq([...cards.services, ...restServices], (s) => s.name.toLowerCase()).slice(0, 40);
    if (fromJson.length >= 2 && fromJson.length >= fromBlocks.filter((s) => s.price).length) {
      services = fromJson;
      structured = true;
    } else if (fromBlocks.length > services.filter((s) => s.price).length) services = fromBlocks;
  }
  services = finalizeCategories(services);

  const agg = (biz?.aggregateRating ?? null) as Ld | null;
  const rv = Number(str(agg?.ratingValue).replace(",", "."));
  const rc = Number(str(agg?.reviewCount ?? agg?.ratingCount));
  const review = first(biz?.review) as Ld | undefined;
  const reviewText = str(review?.reviewBody ?? review?.description);

  const name = cleanName(
    brandName([{ v: str(biz?.name), w: 4 }, { v: meta["og:site_name"] ?? "", w: 3 }, { v: md.name ?? "", w: 1 }, { v: titleOf(html), w: 1 }, { v: meta["og:title"] ?? "", w: 1 }], host) ||
      str(biz?.name) || meta["og:site_name"] || meta["og:title"] || titleOf(html),
  );
  const description = cleanDescription(str(biz?.description) || meta["og:description"] || meta.description);

  let siteUrl = url;
  try {
    const u = new URL(url);
    siteUrl = NEXT_PAGE.test(u.pathname) || u.pathname === "/" ? u.origin : stripTracking(u.toString());
  } catch {
    /* как есть */
  }

  const categories = [...ldTypes(biz ?? {}), meta.keywords ?? "", clean(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? "")].filter(Boolean);
  const exclude = [...services.map((s) => s.name), ...services.map((s) => s.category ?? ""), name];
  const orgLink = [...maps.links, ...externalSources(hrefs)].find((l) => /yandex\.[a-z.]+\/maps\/.*org\//.test(l));

  return {
    kind: "site",
    url,
    status: "ok",
    name,
    categories,
    city,
    address,
    addresses: addresses.slice(0, 8).map((a) => ({ address: a.address, city: a.city })),
    phone,
    whatsapp,
    telegram,
    hours,
    siteUrl,
    orgUrl: orgLink,
    services: services.slice(0, 40),
    servicesStructured: structured,
    advantages: advantagesFromBlocks(bl, exclude),
    legalInfo: legalFromText(text),
    offer: offerFromText(text),
    description,
    review: reviewText.length >= 30 ? reviewText.slice(0, 300) : undefined,
    rating: rv > 0 && rv <= 5 ? { value: rv, count: rc || 0 } : undefined,
    ...(() => {
      const photos = pickPhotos(biz, meta, html, url);
      const caps = photoCaptionsOf(html, url);
      // Картинки позиций из JSON меню, которых нет среди фото страницы, — тоже берём (после основных)
      const extra = Object.keys(caps).filter((u) => !photos.some((p) => photoKey(p) === photoKey(u)));
      const all = uniq([...photos, ...extra], (u) => photoKey(u)).slice(0, 40);
      const byKey = new Map(Object.entries(caps).map(([u, c]) => [photoKey(u), c]));
      const photoCaptions = Object.fromEntries(all.map((u) => [u, byKey.get(photoKey(u)) ?? ""]).filter(([, c]) => c));
      return { photos: all, photoCaptions };
    })(),
    text,
    links: uniq([...externalSources(hrefs), ...maps.links], (h) => h.replace(/[?#].*$/, "")).slice(0, 3),
    next: nextPages(html, url, 4),
  };
}

/**
 * Карточки услуг конструкторов (Tilda t-card/t-store, «name/title» + «price» в одном блоке):
 * название берём из элемента с классом name/title, а не строку описания над ценой.
 * Возвращает найденное и HTML без этих карточек — остальное разберёт текстовый поиск прайса.
 */
export function cardPrices(html: string): { services: ImportService[]; rest: string } {
  const services: ImportService[] = [];
  const seen = new Set<string>();
  const re = /<(div|h[2-6]|span|p|strong)\b[^>]*class=["'][^"']*(?:__title|__name|-title|-name|\bname\b|\btitle\b|t-name)[^"']*["'][^>]*>([\s\S]{2,200}?)<\/\1>((?:(?!class=["'][^"']*(?:title|name))(?!<\/?(?:table|tr|td|th|section|ul|ol)\b)[\s\S]){0,700}?)<(div|span|p|strong)\b[^>]*class=["'][^"']*price[^"']*["'][^>]*>([\s\S]{1,120}?)<\/\4>/gi;
  const rest = html.replace(re, (all, _t, rawName: string, _mid, _t2, rawPrice: string) => {
    // «Маникюр комбинированный <br>(мастер | топ мастер)», «… <br>Руки | Ноги» — колонки прайса не в название, а в примечание
    const segs = rawName.split(/<br\s*\/?>/i).map((x) => clean(x)).filter(Boolean);
    const head = segs.filter((x) => isColumnHeader(x));
    const name = cleanServiceName(segs.filter((x) => !isColumnHeader(x)).join(" ").replace(/\(([^()]*[|/][^()]*)\)/g, " "));
    const price = priceOfText(clean(rawPrice));
    if (!name || !price || !isName(name)) return all;
    const key = name.toLowerCase();
    if (seen.has(key)) return " ";
    seen.add(key);
    services.push({ name, price, ...(head.length ? { note: head[0].replace(/^\(|\)$/g, "").replace(/\s*[|/]\s*/g, " / ") } : {}) });
    // Метка на месте карточки: по ней услуга получит раздел прайса (ближайший заголовок выше) и примечание ниже
    return `<p>⟦svc:${services.length - 1}⟧</p>`;
  });
  return { services, rest };
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

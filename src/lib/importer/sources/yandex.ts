/**
 * Карточка организации в Яндекс Картах: yandex.ru/maps/org/<slug>/<id>/.
 *
 * Публичная страница карточки содержит состояние (script.state-view, JSON): название, адрес, телефоны,
 * часы, категории, рейтинг, фото, мессенджеры, сайт, прайс («Товары и услуги»). Открываем вкладку /prices/ —
 * на ней те же данные плюс полный прайс. Одна страница, честный User-Agent; если Яндекс показал капчу —
 * не обходим её, а возвращаем то, что видно из самой ссылки.
 *
 * Необязательно: YANDEX_PLACES_API_KEY — «API поиска по организациям» (search-maps.yandex.ru/v1, параметр uri=ymapsbm1://org?oid=…).
 */
import type { Found, ImportService } from "../types";
import { parseOrgId, stripEmoji } from "../../engine/extras";
import { looseJson } from "../html";
import { cleanAdvantage, cleanServiceName, cityFromSlug, formatPhone, formatWeek, normalizePrice, stripCity, stripTracking, telegramFrom, uniq, whatsappFrom, type DayHours } from "../normalize";
import { fetchJson, fetchPage, FetchError } from "../fetch";

type O = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const isYandexMaps = (u: URL) => /(^|\.)(yandex\.(ru|com|kz|by|uz|com\.tr|com\.am|az|fr)|ya\.ru)$/i.test(u.hostname) && /^\/(web-)?maps\b/.test(u.pathname);

/** Что видно из самой ссылки: id организации, «слаг» названия, город */
export function yandexFromUrl(url: string): { orgId: string | null; slug: string; city: string } {
  const orgId = parseOrgId(url);
  let slug = "", city = "";
  try {
    const p = decodeURIComponent(new URL(url).pathname);
    slug = /\/org\/([^/]+)\/\d{5,}/.exec(p)?.[1] ?? "";
    city = cityFromSlug(/\/maps\/\d+\/([^/]+)\//.exec(p)?.[1]);
  } catch {
    /* пусто */
  }
  return { orgId, slug, city };
}

export const orgUrlFor = (orgId: string, slug?: string) => `https://yandex.ru/maps/org/${slug ? `${slug}/` : ""}${orgId}/`;

/** Признаки капчи/заглушки для роботов */
export function isYandexCaptcha(html: string, finalUrl: string) {
  return /showcaptcha|checkcaptcha|\/captcha/i.test(finalUrl) || (/smartcaptcha|checkbox-captcha|captcha__image|Подтвердите, что запросы отправляли вы|Вы не робот/i.test(html) && !/class="state-view"/.test(html));
}

/** Состояние страницы → объект организации */
function findOrg(state: O, orgId: string | null): O | null {
  let found: O | null = null;
  const visit = (v: unknown, depth: number) => {
    if (found || !v || typeof v !== "object" || depth > 8) return;
    if (Array.isArray(v)) return v.forEach((x) => visit(x, depth + 1));
    const o = v as O;
    if (typeof o.title === "string" && (o.type === "business" || o.categories) && (o.address || o.fullAddress) && (!orgId || String(o.id ?? "") === orgId || String(o.uri ?? "").includes(orgId))) {
      found = o;
      return;
    }
    for (const k of Object.keys(o)) if (k !== "config") visit(o[k], depth + 1);
  };
  // С id ищем только «свою» организацию — чтобы не взять соседнюю из выдачи
  visit(state.stack ?? state, 0);
  return found;
}

const to24 = (s: string) => s.replace(/(\d{1,2}):(\d{2})\s*(AM|PM)/gi, (_, h: string, m: string, ap: string) => {
  let n = Number(h) % 12;
  if (/pm/i.test(ap)) n += 12;
  return `${String(n).padStart(2, "0")}:${m}`;
});

const t2 = (t?: O) => (t ? `${String(t.hours ?? 0).padStart(2, "0")}:${String(t.minutes ?? 0).padStart(2, "0")}` : "");

/** Часы: массив workingTime (пн…вс, интервалы) → строка анкеты; запасной вариант — текст Яндекса */
export function yandexHours(org: O): string {
  const wt = org.workingTime;
  if (Array.isArray(wt) && wt.length === 7) {
    const week: DayHours[] = wt.map((day: O[] | null) => {
      if (!Array.isArray(day) || !day.length) return null;
      const from = t2(day[0]?.from);
      let to = t2(day[day.length - 1]?.to);
      if (to === "00:00") to = "24:00";
      return from && to ? { open: from, close: to } : null;
    });
    const s = formatWeek(week);
    if (s) return s;
  }
  const text = typeof org.workingTimeText === "string" ? to24(org.workingTimeText).replace(/^daily/i, "ежедневно") : "";
  return text ? (text.charAt(0).toUpperCase() + text.slice(1)).slice(0, 80) : "";
}

/** Прайс: полный (fullObjects) или «популярное» (topObjects) + цены из особенностей («маникюр с покрытием: 1297–2100 ₽») */
export function yandexServices(org: O): ImportService[] {
  const out: ImportService[] = [];
  for (const block of [org.fullObjects, org.topObjects]) {
    for (const cat of block?.categories ?? []) {
      for (const it of cat?.categoryItems ?? []) {
        const name = cleanServiceName(String(it?.title ?? ""));
        const price = normalizePrice(it?.price ? `${it.price} ₽` : "");
        if (name) out.push(price ? { name, price } : { name });
      }
    }
  }
  for (const f of org.features ?? []) {
    if (f?.type === "text" && typeof f.value === "string" && /₽|руб/.test(f.value) && f.name) {
      const price = normalizePrice(f.value);
      if (price) out.push({ name: cleanServiceName(String(f.name)), price });
    }
  }
  return uniq(out, (s) => s.name.toLowerCase().replace(/\s+/g, " ")).slice(0, 15);
}

/**
 * Преимущества из особенностей карточки: только удобства для клиента (парковка, сертификаты, оплата картой…).
 * Остальные «особенности» Яндекса — это услуги («наращивание ногтей»), их в преимущества не берём.
 */
const FEATURE_ADV: [RegExp, string | null][] = [
  [/^парковка$/i, "Есть парковка"],
  [/подарочн[а-яё]* сертификат/i, "Подарочные сертификаты"],
  [/можно с собакой|с животными/i, null],
  [/wi-?fi/i, "Бесплатный Wi-Fi"],
  [/детск[а-яё]* (комнат|уголок)/i, null],
  [/пандус|доступно для инвалидов|доступн[а-яё]* на коляске/i, "Доступно для маломобильных гостей"],
  [/кондиционер/i, null],
];

export function yandexAdvantages(org: O): string[] {
  const out: string[] = [];
  for (const f of (org.features ?? []) as O[]) {
    const name = String(f?.name ?? "");
    if (!name) continue;
    if (f.type === "bool" && f.value === true) {
      const hit = FEATURE_ADV.find(([re]) => re.test(name));
      if (hit) out.push(cleanAdvantage(hit[1] ?? name));
    }
    if (/способ оплаты/i.test(name) && Array.isArray(f.value) && f.value.some((v: O) => v?.id === "payment_card")) out.push("Можно оплатить картой");
  }
  return uniq(out.filter(Boolean)).slice(0, 4);
}

/** Разбор страницы карточки */
export function parseYandexHtml(html: string, url: string): Found | null {
  const m = /<script[^>]*class="state-view"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  const state = looseJson(m[1]) as O | null;
  if (!state) return null;
  const { orgId, slug, city: slugCity } = yandexFromUrl(url);
  const org = findOrg(state, orgId);
  if (!org) return null;
  const id = String(org.id ?? orgId ?? "");

  const comp = (org.compositeAddress ?? {}) as O;
  const city = String(comp.locality ?? org.region?.names?.nominative ?? slugCity ?? "").trim();
  const address = stripCity(String(org.address ?? org.fullAddress ?? ""), city);

  const social = (org.socialLinks ?? []) as O[];
  const wa = social.find((s) => s.type === "whatsapp")?.href;
  const tg = social.find((s) => s.type === "telegram")?.href;

  const rating = org.ratingData?.ratingValue ? { value: Math.round(Number(org.ratingData.ratingValue) * 10) / 10, count: Number(org.ratingData.ratingCount ?? org.ratingData.reviewCount ?? 0) } : undefined;

  const advantages = yandexAdvantages(org);

  // Отзыв: настоящий, 5 звёзд, без ответа-шаблона — 40…300 символов
  const reviews = (org.reviewResults?.reviews ?? []) as O[];
  const good = reviews
    .map((r) => ({ text: stripEmoji(String(r?.text ?? "")).replace(/\s+/g, " ").trim(), rating: Number(r?.rating ?? 0) }))
    .find((r) => r.rating >= 5 && r.text.length >= 40 && r.text.length <= 300);

  const photos: string[] = [];
  for (const p of org.photos?.items ?? []) {
    const t = String(p?.urlTemplate ?? "");
    if (t.includes("%s")) photos.push(t.replace("%s", "XXXL"));
  }

  const sites = ((org.urls ?? []) as string[]).filter((u) => typeof u === "string").map(stripTracking);
  const booking = ((org.businessLinks ?? []) as O[]).map((b) => String(b?.href ?? "")).filter((h) => /^https?:/.test(h));
  const ownSite = sites.find((s) => !/dikidi|yclients|vk\.(com|ru)|taplink|instagram|t\.me|wa\.me/i.test(s));

  return {
    kind: "yandex",
    url,
    status: "ok",
    name: String(org.title ?? "").trim().slice(0, 80),
    categories: ((org.categories ?? []) as O[]).map((c) => String(c?.name ?? "")).filter(Boolean),
    city,
    address,
    phone: formatPhone(org.phones?.[0]?.number ?? org.phones?.[0]?.value),
    whatsapp: wa ? whatsappFrom(wa) || formatPhone(social.find((s) => s.type === "whatsapp")?.readableHref) : "",
    telegram: tg ? telegramFrom(tg) : "",
    hours: yandexHours(org),
    siteUrl: ownSite ?? sites[0] ?? "",
    orgUrl: id ? orgUrlFor(id, String(org.seoname ?? slug ?? "")) : "",
    services: yandexServices(org),
    servicesStructured: true,
    advantages: uniq(advantages).slice(0, 4),
    review: good ? good.text.slice(0, 300) : undefined,
    rating,
    photos: uniq(photos).slice(0, 8),
    text: [org.title, ...(org.categories ?? []).map((c: O) => c?.name)].filter(Boolean).join("\n"),
    links: uniq([...(ownSite ? [ownSite] : []), ...booking, ...sites.filter((s) => /dikidi|yclients|taplink/i.test(s))]).slice(0, 3),
  };
}

const slugTitle = (slug: string) => slug.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().replace(/^./, (c) => c.toUpperCase());

/** Частичный результат из одной ссылки — если страницу прочитать не дали */
export function yandexPartial(url: string, status: "partial" | "blocked" | "error", message: string): Found {
  const { orgId, slug, city } = yandexFromUrl(url);
  return {
    kind: "yandex",
    url,
    status,
    message,
    orgUrl: orgId ? orgUrlFor(orgId, slug) : "",
    city: city || undefined,
    // Слаг — транслит названия («manikyurnaya_studiya»): подставляем как подсказку, если больше взять неоткуда
    name: slug && !/^\d+$/.test(slug) ? slugTitle(slug) : undefined,
  };
}

/** Официальный API поиска по организациям (если задан ключ) */
async function viaPlacesApi(orgId: string, url: string): Promise<Found | null> {
  const key = process.env.YANDEX_PLACES_API_KEY;
  if (!key) return null;
  const q = new URLSearchParams({ apikey: key, lang: "ru_RU", type: "biz", results: "1", text: orgId, uri: `ymapsbm1://org?oid=${orgId}` });
  const { data } = await fetchJson<O>(`https://search-maps.yandex.ru/v1/?${q}`, { timeoutMs: 8000 });
  const meta = data?.features?.[0]?.properties?.CompanyMetaData as O | undefined;
  if (!meta?.name) return null;
  const city = String((meta.Address?.Components ?? []).find((c: O) => c?.kind === "locality")?.name ?? "");
  return {
    kind: "yandex",
    url,
    status: "ok",
    name: String(meta.name).slice(0, 80),
    categories: ((meta.Categories ?? []) as O[]).map((c) => String(c?.name ?? "")).filter(Boolean),
    city,
    address: stripCity(String(meta.address ?? ""), city),
    phone: formatPhone(meta.Phones?.[0]?.formatted),
    hours: typeof meta.Hours?.text === "string" ? String(meta.Hours.text).slice(0, 80) : "",
    siteUrl: meta.url ? stripTracking(String(meta.url)) : "",
    orgUrl: orgUrlFor(orgId),
  };
}

export const YANDEX_BLOCKED = "Карточку не удалось прочитать автоматически — заполните недостающее или вставьте ссылку на сайт";

export async function readYandex(url: string): Promise<Found> {
  const { orgId, slug } = yandexFromUrl(url);
  // Короткая ссылка (yandex.ru/maps/-/…) — раскроется редиректом
  const target = orgId ? `${orgUrlFor(orgId, slug)}prices/?lang=ru` : url;
  try {
    const page = await fetchPage(target, { timeoutMs: 10000, maxBytes: 4 * 1024 * 1024 });
    const finalUrl = page.url;
    if (page.status === 403 || page.status === 429 || isYandexCaptcha(page.html, finalUrl)) {
      const api = orgId ? await viaPlacesApi(orgId, url).catch(() => null) : null;
      return api ?? yandexPartial(url, "blocked", YANDEX_BLOCKED);
    }
    const parsed = parseYandexHtml(page.html, orgId ? finalUrl : page.url);
    if (parsed) return { ...parsed, url };
    const api = orgId ? await viaPlacesApi(orgId, url).catch(() => null) : null;
    if (api) return api;
    if (!orgId && !parseOrgId(finalUrl)) return yandexPartial(url, "error", "Это не карточка организации. Откройте свою организацию в Яндекс Картах и скопируйте ссылку кнопкой «Поделиться».");
    return yandexPartial(finalUrl, "partial", YANDEX_BLOCKED);
  } catch (e) {
    const api = orgId ? await viaPlacesApi(orgId, url).catch(() => null) : null;
    return api ?? yandexPartial(url, "error", e instanceof FetchError && e.code === "timeout" ? "Яндекс Карты отвечают слишком долго — попробуйте ещё раз или заполните недостающее вручную" : YANDEX_BLOCKED);
  }
}

/**
 * Карточка фирмы в 2ГИС: 2gis.ru/<город>/firm/<id>.
 *
 * Без ключа: публичная страница содержит начальное состояние (var initialState = JSON.parse('…')) —
 * название, адрес, телефоны, сайт и мессенджеры, часы, рубрики, рейтинг, фото альбома.
 * С ключом DGIS_API_KEY — официальный Places API (catalog.api.2gis.com/3.0/items/byid), ответ того же вида.
 * Защиту от роботов не обходим: при капче/блокировке — частичный результат из ссылки.
 */
import type { Found } from "../types";
import { cityFromSlug, formatPhone, formatWeek, stripTracking, telegramFrom, uniq, whatsappFrom, type DayHours } from "../normalize";
import { fetchJson, fetchPage } from "../fetch";

type O = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const isDgis = (u: URL) => /(^|\.)2gis\.(ru|kz|kg|uz|com|ae|cy|az|am|ge)$/i.test(u.hostname);

export function dgisFromUrl(url: string): { firmId: string | null; city: string } {
  try {
    const p = decodeURIComponent(new URL(url).pathname);
    const firmId = /\/firm\/(\d{10,20})(?:[/?#]|$)/.exec(p)?.[1] ?? null;
    const slug = /^\/([a-z_-]+)\//.exec(p)?.[1];
    return { firmId, city: slug && slug !== "firm" ? cityFromSlug(slug) : "" };
  } catch {
    return { firmId: null, city: "" };
  }
}

/** Строка JS в одинарных кавычках → обычная строка (\\uXXXX, \\xXX, \\n, \\', \\\\) */
function unescapeJs(s: string, start: number): string {
  let out = "";
  for (let k = start; k < s.length; k++) {
    const c = s[k];
    if (c === "\\") {
      const n = s[k + 1];
      if (n === "u") {
        out += String.fromCharCode(parseInt(s.substr(k + 2, 4), 16));
        k += 5;
      } else if (n === "x") {
        out += String.fromCharCode(parseInt(s.substr(k + 2, 2), 16));
        k += 3;
      } else {
        out += n === "n" ? "\n" : n === "t" ? "\t" : n === "r" ? "\r" : n;
        k++;
      }
      continue;
    }
    if (c === "'") break;
    out += c;
  }
  return out;
}

/** Начальное состояние страницы 2ГИС */
export function dgisState(html: string): O | null {
  const marker = /var\s+initialState\s*=\s*JSON\.parse\('/.exec(html);
  if (marker) {
    try {
      return JSON.parse(unescapeJs(html, marker.index + marker[0].length));
    } catch {
      return null;
    }
  }
  const plain = /var\s+initialState\s*=\s*(\{[\s\S]*?\});\s*<\/script>/.exec(html);
  if (plain) {
    try {
      return JSON.parse(plain[1]);
    } catch {
      return null;
    }
  }
  return null;
}

const DAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function dgisHours(schedule: O | undefined): string {
  if (!schedule || typeof schedule !== "object") return "";
  if (schedule.is_24x7) return "Круглосуточно";
  const week: (DayHours | undefined)[] = DAY_KEYS.map((d) => {
    const wh = schedule[d]?.working_hours as O[] | undefined;
    if (!wh?.length) return null;
    let close = String(wh[wh.length - 1].to ?? "");
    if (close === "00:00" || close === "24:00") close = "24:00";
    return { open: String(wh[0].from ?? ""), close };
  });
  return formatWeek(week);
}

/** Объект фирмы (из страницы или API) → Found */
export function dgisItem(d: O, url: string): Found {
  const city = String(((d.adm_div ?? []) as O[]).find((a) => a?.type === "city")?.name ?? ((d.adm_div ?? []) as O[]).find((a) => a?.type === "settlement")?.name ?? "");
  const contacts = ((d.contact_groups ?? []) as O[]).flatMap((g) => (g?.contacts ?? []) as O[]);
  const phone = contacts.find((c) => c.type === "phone");
  const sites = contacts.filter((c) => c.type === "website").map((c) => String(c.url ?? c.text ?? "")).filter(Boolean).map(stripTracking);
  const whatsapp = contacts.filter((c) => c.type === "whatsapp").map((c) => whatsappFrom(String(c.url ?? c.value ?? ""))).find(Boolean) ?? "";
  const telegram = [...contacts.filter((c) => c.type === "telegram").map((c) => String(c.url ?? c.value ?? "")), ...sites].map(telegramFrom).find(Boolean) ?? "";
  const ownSite = sites.find((s) => !/t\.me|vk\.(com|ru)|instagram|wa\.me|ok\.ru|youtube|dikidi|yclients|taplink/i.test(s));
  const booking = sites.filter((s) => /dikidi|yclients|taplink/i.test(s));
  const reviews = (d.reviews ?? {}) as O;
  const rv = Math.round(Number(reviews.general_rating ?? 0) * 10) / 10;
  const photos = ((d.external_content ?? []) as O[]).filter((x) => x?.type === "photo_album" && x.subtype !== "view" && x.main_photo_url).map((x) => String(x.main_photo_url));
  const name = String(d.name_ex?.primary ?? d.name ?? "").trim();
  return {
    kind: "dgis",
    url,
    status: "ok",
    name: name.slice(0, 80),
    categories: ((d.rubrics ?? []) as O[]).map((r) => String(r?.name ?? "")).filter(Boolean),
    city,
    address: String(d.address_name ?? d.full_address_name ?? "").replace(new RegExp(`^${city},\\s*`), "").slice(0, 200),
    phone: formatPhone(phone?.value ?? phone?.text),
    whatsapp,
    telegram,
    hours: dgisHours(d.schedule),
    siteUrl: ownSite ?? "",
    rating: rv > 0 ? { value: rv, count: Number(reviews.general_review_count ?? 0) } : undefined,
    photos: uniq(photos).slice(0, 4),
    text: [name, d.name_ex?.extension, ...((d.rubrics ?? []) as O[]).map((r) => r?.name)].filter(Boolean).join("\n"),
    links: uniq([...(ownSite ? [ownSite] : []), ...booking]).slice(0, 3),
  };
}

export function parseDgisHtml(html: string, url: string): Found | null {
  const state = dgisState(html);
  const profile = state?.data?.entity?.profile as O | undefined;
  if (!profile) return null;
  const { firmId } = dgisFromUrl(url);
  const entry = (firmId && profile[firmId]) || Object.values(profile)[0];
  const d = (entry as O | undefined)?.data;
  if (!d || (!d.name && !d.name_ex)) return null;
  return dgisItem(d, url);
}

export const DGIS_BLOCKED = "Карточку не удалось прочитать автоматически — заполните недостающее или вставьте ссылку на сайт";

const FIELDS = "items.contact_groups,items.schedule,items.rubrics,items.reviews,items.adm_div,items.name_ex,items.external_content,items.full_address_name,items.address,items.org";

async function viaApi(firmId: string, url: string): Promise<Found | null> {
  const key = process.env.DGIS_API_KEY;
  if (!key) return null;
  const q = new URLSearchParams({ id: firmId, key, locale: "ru_RU", fields: FIELDS });
  const { data } = await fetchJson<O>(`https://catalog.api.2gis.com/3.0/items/byid?${q}`, { timeoutMs: 8000 });
  const item = data?.result?.items?.[0];
  return item ? dgisItem(item, url) : null;
}

export async function readDgis(url: string): Promise<Found> {
  let { firmId, city } = dgisFromUrl(url);
  const partial = (status: Found["status"], message: string, u = url): Found => ({ kind: "dgis", url: u, status, message, city: city || undefined });
  try {
    if (firmId) {
      const api = await viaApi(firmId, url).catch(() => null);
      if (api) return api;
    }
    const page = await fetchPage(url, { timeoutMs: 10000, maxBytes: 4 * 1024 * 1024 });
    if (!firmId) ({ firmId, city } = dgisFromUrl(page.url)); // короткая ссылка go.2gis.com раскрылась редиректом
    if (!firmId) return partial("error", "Это не карточка фирмы. Откройте свою организацию в 2ГИС и скопируйте ссылку — вида 2gis.ru/город/firm/1234567890.");
    if (page.status === 403 || page.status === 429 || /captcha/i.test(page.url)) return partial("blocked", DGIS_BLOCKED);
    const parsed = parseDgisHtml(page.html, page.url);
    return parsed ? { ...parsed, url } : partial(page.status === 404 ? "error" : "partial", page.status === 404 ? "2ГИС не нашёл такую фирму — проверьте ссылку" : DGIS_BLOCKED);
  } catch {
    return partial("error", DGIS_BLOCKED);
  }
}

/**
 * DIKIDI — онлайн-запись: dikidi.net/<id>, dikidi.ru/<id>, dikidi.app/profile/<slug>_<id>.
 *
 * Страница записи отдаёт в HTML название и город (og:title «Название | Город | Online booking»),
 * адрес (блок .nr-address) и обложку. Прайс берём из публичного JSON виджета записи —
 * dikidi.net/mobile/ajax/newrecord/company_services/?company=<id> (без авторизации, его же вызывает
 * страница записи в браузере любого клиента).
 */
import type { Found, ImportService } from "../types";
import { clean, metaTags } from "../html";
import { cleanServiceName, formatPrice, uniq } from "../normalize";
import { fetchJson, fetchPage } from "../fetch";

type O = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const isDikidi = (u: URL) => /(^|\.)dikidi\.(net|ru|app)$/i.test(u.hostname);

export function dikidiId(url: string): string | null {
  try {
    const u = new URL(url);
    const o = u.searchParams.get("o") ?? u.searchParams.get("company");
    if (o && /^\d{3,10}$/.test(o)) return o;
    const p = decodeURIComponent(u.pathname + u.hash);
    return /(?:^\/|_|\/)(\d{3,10})(?:\/|$|[?#])/.exec(p)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** JSON виджета: data.list = { категория: { name, services: [{ name, price, floating }] } } */
export function dikidiServices(json: O | null, limit = 15): { services: ImportService[]; categories: string[] } {
  const list = json?.data?.list;
  const cats = (Array.isArray(list) ? list : list && typeof list === "object" ? Object.values(list) : []) as O[];
  const services: ImportService[] = [];
  for (const c of cats.sort((a, b) => Number(b?.category_custom_sort ?? 0) - Number(a?.category_custom_sort ?? 0))) {
    for (const s of ((c?.services ?? []) as O[]).sort((a, b) => Number(b?.service_custom_sort ?? 0) - Number(a?.service_custom_sort ?? 0))) {
      const name = cleanServiceName(String(s?.name ?? s?.service_value ?? ""));
      const price = Number(s?.price ?? s?.cost ?? 0);
      if (!name || /^(доплата|дополнительн|надбавк)/i.test(name)) continue;
      services.push(price >= 50 ? { name, price: formatPrice(price, null, s?.floating === true) } : { name });
    }
  }
  return {
    services: uniq(services, (s) => s.name.toLowerCase()).slice(0, limit),
    categories: cats.map((c) => String(c?.name ?? "")).filter(Boolean),
  };
}

/** HTML страницы записи: название, город, адрес, обложка */
export function parseDikidiHtml(html: string): Pick<Found, "name" | "city" | "address" | "photos" | "description"> {
  const meta = metaTags(html);
  const parts = (meta["og:title"] ?? "").split("|").map((s) => s.trim());
  const name = /w\.company\s*=\s*\{[^}]*?name:\s*"([^"]+)"/.exec(html)?.[1] ?? parts[0] ?? "";
  const address = [...html.matchAll(/class="nr-address"\s*>([^<]{3,200})</g)].map((m) => clean(m[1])).find((s) => (s.match(/\p{L}/gu) ?? []).length >= 3) ?? "";
  const image = meta["og:image"];
  return {
    name: clean(name.replace(/\\u([0-9a-f]{4})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))).slice(0, 80),
    city: parts.length >= 3 ? parts[1] : "",
    address,
    photos: image && !/company-avatar|no-?photo/i.test(image) ? [image.replace(/\?size=\w+$/, "")] : [],
    description: (meta["og:description"] ?? "").length > 40 ? meta["og:description"] : undefined,
  };
}

export async function readDikidi(url: string): Promise<Found> {
  const id = dikidiId(url);
  if (!id) return { kind: "dikidi", url, status: "error", message: "Не нашли в ссылке номер компании DIKIDI — скопируйте ссылку на страницу записи, вида dikidi.net/123456" };
  const [page, json] = await Promise.all([
    fetchPage(`https://dikidi.ru/${id}`, { timeoutMs: 9000 }).catch(() => null),
    fetchJson<O>(`https://dikidi.net/mobile/ajax/newrecord/company_services/?lang=ru&company=${id}`, { timeoutMs: 9000, headers: { "X-Requested-With": "XMLHttpRequest" } }).catch(() => null),
  ]);
  const info = page && page.status < 400 ? parseDikidiHtml(page.html) : {};
  const { services, categories } = dikidiServices(json?.data ?? null);
  const ok = Boolean(services.length || info.name);
  return {
    kind: "dikidi",
    url,
    status: ok ? "ok" : "partial",
    message: ok ? undefined : "DIKIDI не отдал данные компании — проверьте ссылку или добавьте ссылку на Яндекс Карты",
    ...info,
    siteUrl: `https://dikidi.net/${id}`,
    services,
    servicesStructured: services.length > 0,
    categories,
    text: [info.name, ...categories, ...services.map((s) => s.name)].filter(Boolean).join("\n"),
  };
}

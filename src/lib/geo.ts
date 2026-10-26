import "server-only";
import { createHash } from "crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "./db";
import type { Business } from "./db/schema";

/**
 * Геокодирование адреса салона → координаты для показов VK «в радиусе» (targetings.geo.local_geo).
 *  - YANDEX_GEOCODER_KEY задан → Геокодер Яндекса (HTTP API, https://yandex.ru/dev/geocode/doc/ru/request);
 *  - иначе Nominatim (OSM): по правилам https://operations.osmfoundation.org/policies/nominatim/ — свой User-Agent,
 *    не чаще 1 запроса в секунду, результаты кэшируем (кэш — businesses.geo, промахи — kv на неделю).
 * Принимаем только точку дома/здания или улицы: центр города для радиуса бесполезен (тогда показываем на весь город).
 */
export type LatLng = { lat: number; lng: number };
export type GeoHit = LatLng & { source: string };

const UA = () => process.env.GEOCODER_USER_AGENT || `Polnyzal/1.0 (+${process.env.APP_URL || "https://polnyzal.ru"})`;
const TIMEOUT = 8000;

/** Адрес для геокодера: город + адрес без офиса/этажа/подъезда/ориентиров */
export function geoQuery(city: string, address: string) {
  let a = address.replace(/\s+/g, " ").trim();
  a = a.replace(/[,;]?\s*(офис|оф\.|кабинет|каб\.|помещение|пом\.|этаж|эт\.|подъезд|вход|квартира|кв\.|цоколь\w*)\s*[\w№-]*.*$/i, "").trim();
  a = a.replace(/\([^)]*\)/g, "").replace(/[,\s]+$/, "");
  const c = city.trim();
  const hasCity = c && a.toLowerCase().replace(/ё/g, "е").includes(c.toLowerCase().replace(/ё/g, "е"));
  return hasCity || !c ? a : `${c}, ${a}`;
}

const valid = (p: LatLng) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0);

async function yandex(q: string, key: string): Promise<LatLng | null> {
  const u = new URL("https://geocode-maps.yandex.ru/1.x/");
  u.search = new URLSearchParams({ apikey: key, geocode: q, format: "json", results: "1", lang: "ru_RU" }).toString();
  const res = await fetch(u, { headers: { "User-Agent": UA() }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`Геокодер Яндекса: ${res.status}`);
  const j: any = await res.json();
  const obj = j?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
  if (!obj) return null;
  const meta = obj.metaDataProperty?.GeocoderMetaData ?? {};
  // kind: house | street | metro | district | locality …; precision: exact | number | near | range | street | other
  if (!["house", "street"].includes(meta.kind) || meta.precision === "other") return null;
  const [lng, lat] = String(obj.Point?.pos ?? "").split(" ").map(Number);
  const p = { lat, lng };
  return valid(p) ? p : null;
}

// Nominatim: не чаще 1 запроса в секунду в пределах процесса
let nominatimChain: Promise<unknown> = Promise.resolve();
let nominatimLast = 0;
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = nominatimChain.then(async () => {
    const wait = nominatimLast + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      nominatimLast = Date.now();
    }
  });
  nominatimChain = run.catch(() => undefined);
  return run;
}

async function nominatim(q: string): Promise<LatLng | null> {
  const u = new URL(process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org/search");
  const p: Record<string, string> = { q, format: "jsonv2", limit: "1", "accept-language": "ru", countrycodes: process.env.GEOCODER_COUNTRIES || "ru" };
  if (process.env.NOMINATIM_EMAIL) p.email = process.env.NOMINATIM_EMAIL;
  u.search = new URLSearchParams(p).toString();
  const res = await throttled(() => fetch(u, { headers: { "User-Agent": UA(), "Accept-Language": "ru" }, signal: AbortSignal.timeout(TIMEOUT) }));
  if (!res.ok) throw new Error(`Nominatim: ${res.status}`);
  const list: any[] = await res.json();
  const hit = list?.[0];
  // place_rank: 30 — дом/здание, 26–27 — улица; меньше — район/город
  if (!hit || Number(hit.place_rank) < 26) return null;
  const pt = { lat: Number(hit.lat), lng: Number(hit.lon) };
  return valid(pt) ? pt : null;
}

/** Координаты адреса или null (адрес не найден до дома/улицы). Ошибки сети пробрасываются. */
export async function geocode(city: string, address: string): Promise<GeoHit | null> {
  if (!address?.trim()) return null;
  const q = geoQuery(city ?? "", address);
  const key = process.env.YANDEX_GEOCODER_KEY;
  if (key) {
    const p = await yandex(q, key).catch(() => null);
    if (p) return { ...p, source: "yandex" };
  }
  const p = await nominatim(q);
  return p ? { ...p, source: "osm" } : null;
}

const addrHash = (b: Pick<Business, "city" | "address">) => createHash("sha1").update(`${b.city}|${b.address ?? ""}`.toLowerCase()).digest("hex").slice(0, 10);

/**
 * Координаты бизнеса с кэшем в businesses.geo.
 * geo.source: "yandex#<hash>" / "osm#<hash>" — найдено геокодером для адреса с этим хэшем (адрес поменяли → геокодируем
 * заново); любое другое значение (например "manual" — точка, поставленная на карте) не перезаписываем.
 * Не нашли — запоминаем промах в kv на 7 дней, чтобы каждый запуск не ходил в геокодер. Ошибки не бросает.
 * Обновляет и строку в БД, и переданный объект b.
 */
export async function ensureGeo(b: Business): Promise<LatLng | null> {
  const g = b.geo;
  const h = addrHash(b);
  if (g && valid(g)) {
    const auto = /^(yandex|osm)#/.exec(g.source ?? "");
    if (!auto || g.source!.endsWith(`#${h}`)) return { lat: g.lat, lng: g.lng };
  }
  if (!b.address?.trim()) return g && valid(g) ? { lat: g.lat, lng: g.lng } : null;
  try {
    const db = await getDb();
    const missKey = `geo:miss:${h}`;
    const [miss] = await db.select().from(schema.kv).where(eq(schema.kv.key, missKey));
    if (miss && Date.now() - miss.updatedAt.getTime() < 7 * 864e5) return null;
    const hit = await geocode(b.city, b.address);
    if (!hit) {
      if (miss) await db.update(schema.kv).set({ value: { address: b.address }, updatedAt: new Date() }).where(eq(schema.kv.key, missKey));
      else await db.insert(schema.kv).values({ key: missKey, value: { address: b.address } }).onConflictDoNothing();
      return null;
    }
    const geo = { lat: Math.round(hit.lat * 1e6) / 1e6, lng: Math.round(hit.lng * 1e6) / 1e6, source: `${hit.source}#${h}` };
    await db.update(schema.businesses).set({ geo }).where(eq(schema.businesses.id, b.id));
    b.geo = geo;
    return { lat: geo.lat, lng: geo.lng };
  } catch {
    return null;
  }
}

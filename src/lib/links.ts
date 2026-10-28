/**
 * Ссылки на бизнес (businesses.source_links): сайт, Яндекс Карты, 2ГИС, DIKIDI, YCLIENTS, Taplink, VK и прочее.
 * Чистые функции без серверных зависимостей — их используют форма, API и страница настроек.
 */
import { hostKind } from "./importer/hosts";

export type LinkKind = "site" | "yandex" | "dgis" | "dikidi" | "yclients" | "taplink" | "vk" | "other";
export type SourceLink = { kind: LinkKind; url: string };

export const MAX_SOURCE_LINKS = 10;

/** Подпись площадки: «Сайт», «Яндекс Карты», «2ГИС»… */
export const LINK_LABEL: Record<LinkKind, string> = {
  site: "Сайт",
  yandex: "Яндекс Карты",
  dgis: "2ГИС",
  dikidi: "DIKIDI",
  yclients: "YCLIENTS",
  taplink: "Taplink",
  vk: "VK",
  other: "Ссылка",
};

/** Порядок в списках: сначала сайт и карты */
const ORDER: LinkKind[] = ["site", "yandex", "dgis", "dikidi", "yclients", "taplink", "vk", "other"];

/** Соцсети и агрегаторы, которые не «свой сайт» — им не место в siteUrl */
const OTHER_HOST = /(^|\.)(instagram\.com|t\.me|telegram\.me|wa\.me|whatsapp\.com|ok\.ru|youtube\.com|youtu\.be|tiktok\.com|facebook\.com|avito\.ru|zoon\.ru|profi\.ru|flamp\.ru|google\.[a-z.]+|goo\.gl|maps\.app\.goo\.gl)$/i;

/** «lak-studio.ru», « https://Lak-Studio.ru/ » → «https://lak-studio.ru/»; не http(s) или не ссылка — null */
export function normalizeLink(raw: string | null | undefined): string | null {
  let s = (raw ?? "").trim().replace(/^[<"'«]+|[>"'»,;]+$/g, "");
  if (!s || /\s/.test(s)) return null;
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(s) && !/^https?:\/\//i.test(s)) return null; // javascript:, mailto:, tg: …
  if (!/^https?:\/\//i.test(s)) s = `https://${s.replace(/^\/+/, "")}`;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".") || u.username || u.password) return null;
    u.hash = "";
    const out = u.toString();
    return out.length > 500 ? null : out;
  } catch {
    return null;
  }
}

/** Площадка по ссылке */
export function linkKind(url: string): LinkKind {
  const k = hostKind(url);
  if (k !== "site") return k;
  try {
    return OTHER_HOST.test(new URL(url).hostname) ? "other" : "site";
  } catch {
    return "other";
  }
}

/** Ключ для сравнения: без схемы, www и последнего «/»; карточки в Картах и 2ГИС — по номеру организации */
export function linkKey(url: string): string {
  const kind = linkKind(url);
  const org = kind === "yandex" ? /\/org\/(?:[^/?#]+\/)?(\d{5,20})(?:[/?#]|$)/.exec(url)?.[1] : kind === "dgis" ? /\/firm\/(\d{10,20})(?:[/?#]|$)/.exec(url)?.[1] : undefined;
  if (org) return `${kind}:${org}`;
  return url.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/#.*$/, "").replace(/\/+$/, "").replace(/\/(?=\?)/, "");
}

/** Список ссылок: нормализуем, отбрасываем мусор, убираем повторы, не больше max */
export function cleanLinks(raw: (string | null | undefined)[], max = MAX_SOURCE_LINKS): SourceLink[] {
  const seen = new Set<string>();
  const out: SourceLink[] = [];
  for (const r of raw) {
    const url = normalizeLink(r);
    if (!url) continue;
    const key = linkKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: linkKind(url), url });
    if (out.length >= max) break;
  }
  return out;
}

/** Все ссылки бизнеса для показа: сохранённые + siteUrl и orgUrl (у старых бизнесов есть только они) */
export function businessLinks(b: { sourceLinks?: SourceLink[] | null; siteUrl?: string | null; orgUrl?: string | null }): SourceLink[] {
  const list = cleanLinks([b.siteUrl, b.orgUrl, ...(b.sourceLinks ?? []).map((l) => l.url)], 20);
  return list.sort((a, b2) => ORDER.indexOf(a.kind) - ORDER.indexOf(b2.kind));
}

/** «https://www.lak-studio.ru/price/» → «lak-studio.ru/price» */
export function shortLink(url: string, max = 48): string {
  const s = url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

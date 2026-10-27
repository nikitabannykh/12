/**
 * Склейка нескольких источников в один черновик анкеты — по полям, с приоритетами:
 *  - адрес, часы, телефон, рейтинг — сначала карточки на картах (их владелец обновляет чаще всего);
 *  - услуги и цены — сначала сайт владельца, затем онлайн-запись (DIKIDI/YCLIENTS), затем прайс на картах;
 *  - описание — сайт, затем Taplink/VK.
 * Прочитанные источники (ok) важнее частичных (partial — то, что видно только из ссылки).
 */
import type { Draft, DraftField, Found, ImportReport, ImportService, SourceKind } from "./types";
import { SOURCE_CHIP } from "./types";
import { cityFromAddress, cleanAdvantage, detectNiche, stripCity, uniq } from "./normalize";

type ScalarField = "name" | "city" | "address" | "phone" | "whatsapp" | "telegram" | "hours" | "siteUrl" | "orgUrl" | "description" | "review";

const PRIORITY: Record<ScalarField, SourceKind[]> = {
  name: ["yandex", "dgis", "site", "dikidi", "taplink", "yclients", "vk"],
  city: ["yandex", "dgis", "site", "dikidi", "taplink", "vk", "yclients"],
  address: ["yandex", "dgis", "site", "dikidi", "taplink", "vk"],
  phone: ["yandex", "dgis", "site", "taplink", "vk", "dikidi"],
  whatsapp: ["site", "yandex", "dgis", "taplink", "vk"],
  telegram: ["site", "yandex", "dgis", "taplink", "vk"],
  hours: ["yandex", "dgis", "site", "taplink"],
  siteUrl: ["site", "taplink", "yandex", "dgis", "vk", "dikidi", "yclients"],
  orgUrl: ["yandex", "site"],
  description: ["site", "taplink", "vk", "dikidi"],
  review: ["site", "yandex"],
};

/** Порядок источников услуг: сайт владельца → онлайн-запись → карты → визитки */
const SERVICE_ORDER: SourceKind[] = ["site", "dikidi", "yclients", "yandex", "taplink", "dgis", "vk"];
const RATING_ORDER: SourceKind[] = ["yandex", "dgis", "site"];
const PHOTO_ORDER: SourceKind[] = ["site", "yandex", "dgis", "dikidi", "taplink", "vk"];

const rank = (f: Found) => (f.status === "ok" ? 0 : f.status === "partial" ? 1 : 2);
const byKind = (list: Found[], order: SourceKind[]) =>
  [...list].sort((a, b) => rank(a) - rank(b) || order.indexOf(a.kind) - order.indexOf(b.kind));

const priced = (s: ImportService[] | undefined) => (s ?? []).filter((x) => x.price).length;

export function pickServices(found: Found[]): { services: ImportService[]; from: Found | null } {
  const withServices = found.filter((f) => f.services?.length);
  if (!withServices.length) return { services: [], from: null };
  const ordered = [...withServices].sort((a, b) => SERVICE_ORDER.indexOf(a.kind) - SERVICE_ORDER.indexOf(b.kind));
  // Первый по приоритету источник с настоящим прайсом (структурированным или ≥3 цен из текста)
  const best =
    ordered.find((f) => priced(f.services) >= 2 && (f.servicesStructured || priced(f.services) >= 3)) ??
    [...withServices].sort((a, b) => priced(b.services) - priced(a.services) || (b.services?.length ?? 0) - (a.services?.length ?? 0))[0];
  // Цены, которых нет в выбранном списке, подставляем из других источников по точному совпадению названия
  const priceOf = new Map<string, string>();
  for (const f of withServices) for (const s of f.services ?? []) if (s.price) priceOf.set(s.name.toLowerCase(), s.price);
  const services = (best.services ?? []).map((s) => (s.price ? s : priceOf.has(s.name.toLowerCase()) ? { ...s, price: priceOf.get(s.name.toLowerCase()) } : s));
  return { services: uniq(services, (s) => s.name.toLowerCase()).slice(0, 15), from: best };
}

const ratingText = (v: number) => v.toFixed(1).replace(".", ",");
const RATING_PLACE: Partial<Record<SourceKind, string>> = { yandex: "на Яндекс Картах", dgis: "в 2ГИС", site: "по отзывам клиентов" };

/** Что нашли в одном источнике — для строки прогресса: «адрес, часы, 12 услуг с ценами, 6 фото» */
export function summarize(f: Found): string {
  const parts: string[] = [];
  if (f.name && f.status === "ok") parts.push("название");
  if (f.address) parts.push("адрес");
  if (f.hours) parts.push("часы работы");
  if (f.phone || f.whatsapp || f.telegram) parts.push(f.phone ? "телефон" : "мессенджер");
  const p = priced(f.services);
  const n = f.services?.length ?? 0;
  if (n) parts.push(p ? `${n} ${plural(n, "услуга", "услуги", "услуг")} ${p === n ? "с ценами" : `(${p} с ценами)`}` : `${n} ${plural(n, "услуга", "услуги", "услуг")}`);
  if (f.rating) parts.push(`рейтинг ${ratingText(f.rating.value)}`);
  if (f.photos?.length) parts.push(`${f.photos.length} фото`);
  return parts.join(", ");
}

function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export function report(f: Found): ImportReport {
  return { url: f.url, kind: f.kind, status: f.status, message: f.message, summary: summarize(f) };
}

export function mergeFound(found: Found[]): Draft {
  const sources: Partial<Record<DraftField, string>> = {};
  const pick = (field: ScalarField): string => {
    for (const f of byKind(found, PRIORITY[field])) {
      if (!PRIORITY[field].includes(f.kind)) continue;
      const v = f[field];
      if (typeof v === "string" && v.trim()) {
        // Из непрочитанной карточки — только то, что видно в самой ссылке: так и подписываем, чтобы владелец проверил
        sources[field] = f.status === "ok" ? SOURCE_CHIP[f.kind] : "из ссылки — проверьте";
        return v.trim();
      }
    }
    return "";
  };

  const name = pick("name");
  let city = pick("city");
  let address = pick("address");
  if (!city && address) {
    city = cityFromAddress(address);
    if (city) sources.city = sources.address;
  }
  if (city && address) address = stripCity(address, city);

  const { services, from } = pickServices(found);
  if (from) sources.services = SOURCE_CHIP[from.kind];

  let rating: Draft["rating"] = null;
  for (const f of byKind(found, RATING_ORDER)) {
    if (f.rating && f.rating.value > 0) {
      rating = f.rating;
      sources.rating = SOURCE_CHIP[f.kind];
      break;
    }
  }

  const advantages: string[] = [];
  const ratingFrom = found.find((f) => f.rating === rating);
  if (rating && rating.value >= 4.5 && rating.count >= 10 && ratingFrom && RATING_PLACE[ratingFrom.kind]) {
    advantages.push(`Рейтинг ${ratingText(rating.value)} ${RATING_PLACE[ratingFrom.kind]}`);
  }
  for (const f of found) for (const a of f.advantages ?? []) {
    const c = cleanAdvantage(a);
    if (c) advantages.push(c);
  }
  const adv = uniq(advantages).slice(0, 5);
  if (adv.length) sources.advantages = SOURCE_CHIP[(found.find((f) => f.advantages?.length) ?? ratingFrom ?? found[0]).kind];

  const photos = uniq(byKind(found, PHOTO_ORDER).flatMap((f) => f.photos ?? []), (u) => u.replace(/[?#].*$/, "")).slice(0, 10);
  if (photos.length) sources.photos = SOURCE_CHIP[byKind(found, PHOTO_ORDER).find((f) => f.photos?.length)!.kind];

  const phone = pick("phone");
  const whatsapp = pick("whatsapp");
  const telegram = pick("telegram");

  const niche = detectNiche({
    categories: found.flatMap((f) => f.categories ?? []),
    name,
    services: services.map((s) => s.name),
    text: found.map((f) => f.text ?? "").join("\n"),
  });
  if (niche) sources.niche = SOURCE_CHIP[(byKind(found.filter((f) => f.categories?.length), ["yandex", "dgis", "site", "dikidi", "taplink"])[0] ?? found[0])?.kind ?? "site"];

  const draft: Draft = {
    name,
    niche,
    city,
    address,
    phone,
    whatsapp,
    telegram,
    hours: pick("hours"),
    siteUrl: pick("siteUrl"),
    orgUrl: pick("orgUrl"),
    services,
    advantages: adv,
    description: pick("description"),
    review: pick("review") || null,
    rating,
    photos,
    sources,
    reports: found.map(report),
    missing: [],
  };
  draft.missing = missingOf(draft);
  return draft;
}

export function missingOf(d: Pick<Draft, "name" | "niche" | "city" | "phone" | "whatsapp" | "telegram" | "services">): Draft["missing"] {
  const m: Draft["missing"] = [];
  if (!d.name.trim()) m.push("name");
  if (!d.niche) m.push("niche");
  if (d.city.trim().length < 2) m.push("city");
  if (!d.phone.trim() && !d.whatsapp.trim() && !d.telegram.trim()) m.push("contact");
  if (!d.services.some((s) => s.name.trim())) m.push("services");
  return m;
}

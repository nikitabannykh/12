import "server-only";
/**
 * Автозаполнение анкеты «по ссылке»: сайт, Яндекс Карты, 2ГИС, Taplink, VK, DIKIDI, YCLIENTS.
 *
 * 1. Каждую ссылку читает свой адаптер (sources/*) — параллельно, через safeFetch (защита от SSRF, таймауты, лимиты).
 * 2. Ссылки, найденные внутри (сайт и онлайн-запись из карточки Карт), читаем тоже — до 3 штук.
 * 3. У сайта дочитываем до 4 внутренних страниц (цены/услуги, контакты, «О нас», галерея).
 * 4. Склеиваем по полям с приоритетами (merge.ts), определяем сферу и город.
 * 5. Если подключён YandexGPT — заполняем пробелы (услуги, преимущества, описание) по собранному тексту,
 *    оставляя только то, что подтверждается текстом источников. Без YandexGPT — только правила.
 */
import type { Draft, Found, ImportEvent, ImportService, SourceKind } from "./types";
import { SOURCE_NAME } from "./types";
import { fetchPage, FetchError } from "./fetch";
import { parseSite } from "./sources/site";
import { readYandex } from "./sources/yandex";
import { readDgis } from "./sources/dgis";
import { readDikidi } from "./sources/dikidi";
import { readTaplink, readVk, readYclients } from "./sources/social";
import { hostKind } from "./hosts";
import { mergeFound, missingOf, report, summarize } from "./merge";
import { addressKey, categoryFromName, dedupeAdvantages, finalizeCategories, cleanAdvantage, cleanDescription, cleanServiceName, normalizePrice, uniq } from "./normalize";
import { photoKey } from "./html";
import { aiConfigured, gptJson } from "../ai/yandex";
import { extractFromSite, supportedBy } from "../ai/copy";

export type { Draft, ImportEvent } from "./types";

export const MAX_URLS = 5;

/** Ссылка владельца → нормальный URL (добавляем https://, убираем пробелы) или null */
export function normalizeInput(raw: string): string | null {
  let s = raw.trim().replace(/^[<"'«]+|[>"'»,.;]+$/g, "");
  if (!s) return null;
  if (/^@?[\w.]{3,}$/.test(s) && !s.includes(".")) return null; // «@lak_studio» — это не ссылка
  if (!/^https?:\/\//i.test(s)) s = `https://${s.replace(/^\/+/, "")}`;
  try {
    const u = new URL(s);
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function kindOf(url: string): SourceKind {
  return hostKind(url);
}

const siteError = (url: string, e: unknown): Found => {
  const msg =
    e instanceof FetchError
      ? e.code === "timeout"
        ? "Сайт отвечает слишком долго — попробуйте ещё раз или заполните вручную"
        : e.code === "blocked_host" || e.code === "invalid_url"
          ? `Эту ссылку открыть нельзя: ${e.message.toLowerCase()}`
          : e.message
      : "Не получилось открыть сайт — проверьте адрес";
  return { kind: "site", url, status: "error", message: msg };
};

/**
 * Сайт: присланная страница + до maxNext внутренних (цены/услуги, контакты, «О нас», галерея).
 * Услуги — с присланной страницы, если там настоящий прайс (≥5 цен): владелец дал ссылку на нужный раздел;
 * иначе — со страницы, где цен больше всего. Адреса, преимущества, фото и реквизиты — со всех страниц.
 */
async function readSite(url: string, maxNext = 4): Promise<Found> {
  let page;
  try {
    page = await fetchPage(url, { timeoutMs: 9000 });
  } catch (e) {
    return siteError(url, e);
  }
  if (page.status >= 400) return { kind: "site", url, status: "error", message: page.status === 404 ? "Такой страницы нет (ошибка 404) — проверьте адрес" : `Сайт ответил ошибкой ${page.status}` };
  const main = parseSite(page.html, page.url);
  const subs = (
    await Promise.all(
      main.next.slice(0, maxNext).map((u) =>
        fetchPage(u, { timeoutMs: 7000, maxBytes: 2 * 1024 * 1024 })
          .then((p) => (p.status < 400 ? parseSite(p.html, p.url) : null))
          .catch(() => null),
      ),
    )
  ).filter(Boolean) as ReturnType<typeof parseSite>[];
  return combinePages(main, subs, url);
}

/** Склейка страниц одного сайта (вынесено отдельно — проверяется тестами без сети) */
export function combinePages(main: Found & { next?: string[] }, subs: Found[], url = main.url): Found {
  const priced = (f: Found) => (f.services ?? []).filter((s) => s.price).length;
  let best: Found = main;
  if (priced(main) < 5) for (const s of subs) if (priced(s) > priced(best) || (s.servicesStructured && !best.servicesStructured && priced(s) >= 2)) best = s;
  const pages = [main, ...subs];
  const pickStr = (k: "address" | "city" | "phone" | "whatsapp" | "telegram" | "hours" | "offer" | "orgUrl") => main[k] || subs.map((s) => s[k]).find(Boolean) || "";
  // Реквизиты: самые полные (с ФИО/названием)
  const legal = pages.map((p) => p.legalInfo ?? "").filter(Boolean).sort((a, b) => b.length - a.length)[0] ?? "";
  const addresses = uniq(pages.flatMap((p) => p.addresses ?? []), (a) => addressKey(a.address, a.city));
  const { next: _n, ...rest } = main; // eslint-disable-line @typescript-eslint/no-unused-vars
  return {
    ...rest,
    url,
    address: pickStr("address") || addresses[0]?.address || "",
    addresses,
    city: pickStr("city"),
    phone: pickStr("phone"),
    whatsapp: pickStr("whatsapp"),
    telegram: pickStr("telegram"),
    hours: pickStr("hours"),
    offer: pickStr("offer"),
    orgUrl: pickStr("orgUrl") || undefined,
    legalInfo: legal,
    services: best.services,
    servicesStructured: best.servicesStructured,
    advantages: dedupeAdvantages(pages.flatMap((p) => p.advantages ?? [])).slice(0, 15),
    rating: main.rating ?? subs.find((s) => s.rating)?.rating,
    review: main.review ?? subs.find((s) => s.review)?.review,
    photos: uniq(pages.flatMap((p) => p.photos ?? []), photoKey).slice(0, 40),
    text: pages.map((p) => p.text).filter(Boolean).join("\n").slice(0, 80000),
    links: uniq(pages.flatMap((p) => p.links ?? []), (h) => h.replace(/[?#].*$/, "")).slice(0, 3),
  };
}

export function readOne(url: string, kind: SourceKind = kindOf(url), opts: { maxNext?: number } = {}): Promise<Found> {
  switch (kind) {
    case "yandex":
      return readYandex(url);
    case "dgis":
      return readDgis(url);
    case "dikidi":
      return readDikidi(url);
    case "yclients":
      return readYclients(url);
    case "taplink":
      return readTaplink(url);
    case "vk":
      return readVk(url);
    default:
      return readSite(url, opts.maxNext ?? 4);
  }
}

/** Ключ «того же источника»: одна организация в Картах = одна ссылка, один сайт = один хост */
function sourceKey(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m)\./, "");
    const id = /(\d{5,20})/.exec(u.pathname)?.[1];
    return ["yandex", "dgis", "dikidi"].includes(kindOf(url)) && id ? `${kindOf(url)}:${id}` : kindOf(url) === "site" ? host : `${host}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

const progressText = (kind: SourceKind) => (kind === "site" ? "Читаем сайт…" : `Читаем ${SOURCE_NAME[kind]}…`);

/**
 * YandexGPT заполняет пробелы по собранному тексту. Всё, что он вернул, проверяем по тексту источников:
 * услуга остаётся, только если её слова есть в тексте, цена — если такие цифры есть в тексте;
 * преимущества и описание — если в них нет чисел и «обещаний», которых нет в источниках.
 */
async function aiFill(draft: Draft, found: Found[]): Promise<boolean> {
  const text = found.map((f) => f.text ?? "").filter(Boolean).join("\n").slice(0, 12000);
  if (text.length < 200) return false;
  const needServices = !draft.services.some((s) => s.price);
  const needAdv = draft.advantages.length < 2;
  const needDesc = !draft.description;
  if (!needServices && !needAdv && !needDesc) return false;
  const r = await extractFromSite(text, { city: draft.city || undefined }).catch(() => null);
  if (!r) return false;
  const lower = text.toLowerCase().replace(/ё/g, "е");
  const digits = text.replace(/[\s  ]/g, "");
  let used = false;
  if (needServices && r.services?.length) {
    const ok = r.services
      .map((s) => ({ name: cleanServiceName(String(s.name ?? "")), price: s.price ? normalizePrice(s.price) : "" }))
      .filter((s) => s.name && s.name.toLowerCase().replace(/ё/g, "е").split(/\s+/).filter((w) => w.length >= 4).every((w) => lower.includes(w.slice(0, Math.max(4, w.length - 2)))))
      .map((s): ImportService => (s.price && digits.includes(s.price.replace(/\D/g, "").slice(0, 6)) ? s : { name: s.name }))
      .map((s) => ({ ...s, ...(categoryFromName(s.name) ? { category: categoryFromName(s.name) } : {}) }))
      .slice(0, 40);
    if (ok.filter((s) => s.price).length > draft.services.filter((s) => s.price).length) {
      draft.services = ok;
      draft.sources.services = "по тексту сайта (YandexGPT)";
      used = true;
    }
  }
  if (needAdv && r.advantages?.length) {
    const add = r.advantages.map(cleanAdvantage).filter((a) => a && supportedBy(a, text));
    if (add.length) {
      draft.advantages = uniq([...draft.advantages, ...add]).slice(0, 5);
      draft.advantagesFound = uniq([...draft.advantagesFound, ...add]).slice(0, 15);
      draft.sources.advantages ??= "по тексту сайта (YandexGPT)";
      used = true;
    }
  }
  if (needDesc && r.description) {
    const sentences = r.description.split(/(?<=[.!?])\s+/).filter((s) => supportedBy(s, text));
    const d = cleanDescription(sentences.join(" "));
    if (d) {
      draft.description = d;
      draft.sources.description = "по тексту сайта (YandexGPT)";
      used = true;
    }
  }
  return used;
}

/**
 * YandexGPT только раскладывает уже найденные услуги по разделам прайса (если разделов на сайте не нашли).
 * Услуги не добавляет и не переименовывает: принимаем только номера существующих услуг и короткие названия разделов.
 */
async function aiCategorize(draft: Draft): Promise<boolean> {
  const list = draft.services;
  if (list.length < 6 || list.some((s) => s.category)) return false;
  const r = await gptJson<{ groups?: { name?: string; items?: number[] }[] }>(
    "Ты раскладываешь прайс салона по разделам. Ничего не придумывай: только номера услуг из списка. Ответ — JSON.",
    `Услуги:\n${list.map((s, i) => `${i + 1}. ${s.name}`).join("\n")}\n\nРазложи на 2–6 разделов («Маникюр», «Педикюр», «Стрижки»…). JSON: {"groups":[{"name":"","items":[номера]}]}`,
    { temperature: 0, maxTokens: 800 },
  ).catch(() => null);
  const groups = (r?.groups ?? []).filter((g) => g && typeof g.name === "string" && /^[\p{L}\s«»"-]{3,30}$/u.test(g.name.trim()) && Array.isArray(g.items));
  if (groups.length < 2) return false;
  const cat = new Map<number, string>();
  for (const g of groups) for (const n of g.items ?? []) if (Number.isInteger(n) && n >= 1 && n <= list.length && !cat.has(n - 1)) cat.set(n - 1, g.name!.trim());
  if (cat.size < list.length * 0.7) return false;
  draft.services = finalizeCategories(list.map((s, i) => ({ ...s, category: cat.get(i) })));
  return draft.services.some((s) => s.category);
}

/**
 * Главная функция: ссылки → черновик анкеты. onEvent получает прогресс для живой строки статуса.
 */
export async function importFromUrls(rawUrls: string[], onEvent: (e: ImportEvent) => void = () => {}): Promise<Draft> {
  const started = Date.now();
  const urls = uniq(rawUrls.map(normalizeInput).filter((u): u is string => Boolean(u)), sourceKey).slice(0, MAX_URLS);
  const seen = new Set(urls.map(sourceKey));
  const found: Found[] = [];

  const run = async (url: string, opts: { maxNext?: number } = {}) => {
    const kind = kindOf(url);
    onEvent({ type: "progress", text: progressText(kind), kind, url });
    const f = await readOne(url, kind, opts).catch((e): Found => (kind === "site" ? siteError(url, e) : { kind, url, status: "error", message: "Не получилось открыть ссылку" }));
    found.push(f);
    onEvent({ type: "source", report: report(f) });
    return f;
  };

  const first = await Promise.all(urls.map((u) => run(u)));

  // Сайт и онлайн-запись, найденные в карточках и на сайте, — если владелец их не прислал
  const extra = uniq(first.flatMap((f) => (f.status === "ok" ? (f.links ?? []) : [])), sourceKey)
    .filter((u) => !seen.has(sourceKey(u)) && kindOf(u) !== "yclients" && kindOf(u) !== "vk")
    .slice(0, 3);
  if (extra.length && Date.now() - started < 20000) {
    for (const u of extra) seen.add(sourceKey(u));
    await Promise.all(extra.map((u) => run(u, { maxNext: 1 })));
  }

  onEvent({ type: "progress", text: "Собираем анкету…" });
  const usable = found.filter((f) => f.status !== "error" || f.orgUrl || f.siteUrl);
  const draft = mergeFound(usable.length ? usable : found);
  draft.reports = found.map(report);

  if (aiConfigured() && Date.now() - started < 35000) {
    onEvent({ type: "progress", text: "Уточняем услуги и преимущества…" });
    draft.ai = await aiFill(draft, found).catch(() => false);
    if (await aiCategorize(draft).catch(() => false)) draft.ai = true;
    draft.missing = missingOf(draft);
  }

  return draft;
}

export { summarize };

import "server-only";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { Ad, Business, Campaign } from "../db/schema";
import { DemoPlatform, demoNow } from "../platforms/demo";
import { MetricaError, metricaDirectDaily, metricaDirectSlices, metricaUtmDaily, type MetricaDayRow, type MetricaGoals, type MetricaSliceRow } from "../platforms/metrica";
import { decrypt } from "../crypto";
import { addDays, errorText, isoDay, uid } from "../util";
import { displayKeyword } from "./semantics";

/**
 * Ежедневная выгрузка Яндекс Метрики (Reporting API) — визиты из рекламы за последние 30 дней по дням,
 * кампаниям, объявлениям и ключевым фразам, плюс срезы за период по площадкам РСЯ и поисковым запросам.
 * Нужна, чтобы робот видел не только клики, но и что люди делали на сайте: «качественный визит» — визит без отказа.
 *
 * Источники: данные Директа в Метрике (счётчик привязан к кампании), а если их нет — UTM-метки наших ссылок
 * (так же считаются визиты из VK). Демо-кабинет — смоделированные визиты (DemoPlatform.metricaDaily).
 * Нет счётчика, нет доступа, лимит запросов, ошибка API — шаг пропускается с пояснением и ничего не ломает.
 */

export type MetricaReason = "no_counter" | "no_account" | "scope" | "counter" | "quota" | "error" | "no_campaigns";
export type MetricaStatus = {
  at: string;
  ok: boolean;
  source?: "metrica" | "demo";
  reason?: MetricaReason;
  /** Пояснение для владельца (почему данных нет или что взяли вместо разбивки Директа) */
  note?: string;
  rows?: number;
  via?: { direct: number; utm: number };
  from?: string;
  to?: string;
};

const KEY = (businessId: string) => `metrica:${businessId}`;
/** Настоящая Метрика — не чаще раза в 20 часов; после «лимита запросов» — через час */
const EVERY_MS = 20 * 3600e3;
const QUOTA_RETRY_MS = 3600e3;
const WINDOW_DAYS = 30;

export const METRICA_REASON_TEXT: Record<MetricaReason, string> = {
  no_counter: "Счётчик Метрики ещё не создан — он появляется при запуске рекламы в Директе. Можно выбрать свой счётчик в настройках.",
  no_account: "Чтобы читать Метрику, нужен подключённый Яндекс Директ (тот же аккаунт Яндекса, где счётчик).",
  scope: "Нет доступа к статистике Метрики. Подключите Яндекс заново в настройках и разрешите доступ к Метрике.",
  counter: "Счётчик Метрики не найден в подключённом аккаунте Яндекса — возможно, он принадлежит другому аккаунту.",
  quota: "Метрика временно ограничила число запросов — данные обновятся при следующей проверке.",
  error: "Метрика не ответила — попробуем при следующей проверке.",
  no_campaigns: "Реклама ещё не запущена.",
};

export async function metricaStatus(businessId: string): Promise<MetricaStatus | null> {
  const db = await getDb();
  const [row] = await db.select().from(schema.kv).where(eq(schema.kv.key, KEY(businessId)));
  return (row?.value as MetricaStatus | undefined) ?? null;
}

async function saveStatus(businessId: string, st: MetricaStatus) {
  const db = await getDb();
  await db.insert(schema.kv).values({ key: KEY(businessId), value: st }).onConflictDoUpdate({ target: schema.kv.key, set: { value: st, updatedAt: new Date() } });
}

/** ID из Метрики → наш объект: точное совпадение или первое длинное число в строке (Метрика может добавлять префиксы) */
function matchId<T>(key: string, map: Map<string, T>): T | undefined {
  if (!key) return undefined;
  const exact = map.get(key);
  if (exact) return exact;
  for (const d of key.match(/\d{4,}/g) ?? []) {
    const x = map.get(d);
    if (x) return x;
  }
  return undefined;
}

type Agg = { campaignId: string; adId: string; phrase: string; day: string; source: string; visits: number; bounces: number; durationSum: number; pageviews: number; leads: number; goals: Record<string, number> };
type SliceAgg = { campaignId: string; kind: "site" | "query"; key: string; visits: number; bounces: number; durationSum: number; leads: number };

const normSite = (s: string) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
const normQuery = (s: string) => s.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
export const sliceKey = (kind: "site" | "query", s: string) => (kind === "site" ? normSite(s) : normQuery(s)).slice(0, 300);
export const phraseKeyOf = (p: string) => displayKeyword(p).slice(0, 200);

function mapRows(rows: MetricaDayRow[], camps: Campaign[], ads: Ad[], source: string) {
  const campByExt = new Map(camps.filter((c) => c.externalId).map((c) => [c.externalId!, c]));
  const adByExt = new Map(ads.filter((a) => a.externalId).map((a) => [a.externalId!, a]));
  const out = new Map<string, Agg>();
  const withDirect = new Set<string>();
  // Сначала строки по данным Директа: кампании, по которым они есть, по UTM уже не считаем (иначе визиты задвоятся)
  const ordered = [...rows.filter((r) => r.via === "direct"), ...rows.filter((r) => r.via === "utm")];
  for (const r of ordered) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.day)) continue;
    let ad = matchId(r.adKey, adByExt);
    let camp = r.via === "utm" ? (ad ? camps.find((c) => c.id === ad!.campaignId) : undefined) ?? matchId(r.campaignKey, campByExt) : matchId(r.campaignKey, campByExt);
    if (!camp) continue;
    if (ad && ad.campaignId !== camp.id) ad = undefined;
    if (r.via === "utm") {
      // utm_source должен соответствовать площадке кампании (yandex ↔ Директ, vk ↔ VK)
      if (r.utmSource && r.utmSource !== camp.platform) continue;
      if (withDirect.has(camp.id)) continue;
    } else withDirect.add(camp.id);
    const phrase = camp.channel === "search" ? phraseKeyOf(r.phrase) : "";
    const key = `${camp.id}|${ad?.id ?? ""}|${phrase}|${r.day}`;
    const cur = out.get(key) ?? { campaignId: camp.id, adId: ad?.id ?? "", phrase, day: r.day, source: source === "demo" ? "demo" : r.via, visits: 0, bounces: 0, durationSum: 0, pageviews: 0, leads: 0, goals: {} };
    cur.visits += r.visits;
    cur.bounces += r.bounces;
    cur.durationSum += r.durationSum;
    cur.pageviews += r.pageviews;
    for (const [k, v] of Object.entries(r.goals)) cur.goals[k] = (cur.goals[k] ?? 0) + v;
    cur.leads = cur.goals.lead ?? 0;
    out.set(key, cur);
  }
  return [...out.values()];
}

function mapSlices(rows: MetricaSliceRow[], kind: "site" | "query", camps: Campaign[]) {
  const campByExt = new Map(camps.filter((c) => c.externalId).map((c) => [c.externalId!, c]));
  const out = new Map<string, SliceAgg>();
  for (const r of rows) {
    const camp = matchId(r.campaignKey, campByExt);
    const key = sliceKey(kind, r.key);
    if (!camp || !key) continue;
    const k = `${camp.id}|${key}`;
    const cur = out.get(k) ?? { campaignId: camp.id, kind, key, visits: 0, bounces: 0, durationSum: 0, leads: 0 };
    cur.visits += r.visits;
    cur.bounces += r.bounces;
    cur.durationSum += r.durationSum;
    cur.leads += r.goals.lead ?? 0;
    out.set(k, cur);
  }
  return [...out.values()];
}

/** Перезаписать окно [from, to]: строки Метрики за прошлые дни уточняются задним числом (поздние визиты, цели) */
async function store(b: Business, from: string, to: string, daily: Agg[], slices: SliceAgg[] | null) {
  const db = await getDb();
  await db.delete(schema.metricaDaily).where(and(eq(schema.metricaDaily.businessId, b.id), gte(schema.metricaDaily.day, from), lte(schema.metricaDaily.day, to)));
  for (let i = 0; i < daily.length; i += 500) {
    await db.insert(schema.metricaDaily).values(daily.slice(i, i + 500).map((r) => ({ id: uid("m_"), businessId: b.id, ...r }))).onConflictDoNothing();
  }
  if (slices) {
    await db.delete(schema.metricaSlices).where(eq(schema.metricaSlices.businessId, b.id));
    for (let i = 0; i < slices.length; i += 500) {
      await db.insert(schema.metricaSlices).values(slices.slice(i, i + 500).map((r) => ({ id: uid("ms_"), businessId: b.id, ...r, periodFrom: from, periodTo: to }))).onConflictDoNothing();
    }
  }
}

/**
 * Выгрузить Метрику для бизнеса. Ошибки не бросает: возвращает строки для журнала и сохраняет статус
 * (его показывает страница статистики: есть ли данные Метрики и почему нет).
 */
export async function syncMetrica(b: Business, opts: { force?: boolean } = {}): Promise<{ log: string[]; status: MetricaStatus }> {
  const db = await getDb();
  const camps = (await db.select().from(schema.campaigns).where(eq(schema.campaigns.businessId, b.id))).filter((c) => c.externalId);
  const done = async (st: Omit<MetricaStatus, "at">, log: string[] = []) => {
    const status = { at: new Date().toISOString(), ...st };
    await saveStatus(b.id, status);
    return { log, status };
  };
  if (!camps.length) return done({ ok: false, reason: "no_campaigns" });
  const ads = await db.select().from(schema.ads).where(inArray(schema.ads.campaignId, camps.map((c) => c.id)));

  // ─── Демо: смоделированные визиты поверх смоделированных кликов ───
  const demoCamps = camps.filter((c) => c.platform === "demo");
  if (demoCamps.length) {
    try {
      const now = await demoNow({ businessId: b.id });
      const from = isoDay(addDays(now, -(WINDOW_DAYS - 1))), to = isoDay(now);
      const groups = await db.select().from(schema.adGroups).where(inArray(schema.adGroups.campaignId, demoCamps.map((c) => c.id)));
      const phrasesByGroup = Object.fromEntries(groups.filter((g) => g.externalId).map((g) => [g.externalId!, (g.keywords ?? []).map(phraseKeyOf).filter(Boolean)]));
      const daily: Agg[] = [];
      const slices: SliceAgg[] = [];
      for (const accountId of [...new Set(demoCamps.map((c) => c.accountId))]) {
        const list = demoCamps.filter((c) => c.accountId === accountId);
        const client = new DemoPlatform(accountId);
        const exts = list.map((c) => c.externalId!);
        daily.push(...mapRows(await client.metricaDaily(exts, from, to, phrasesByGroup), list, ads, "demo"));
        const sl = await client.metricaSlices(exts, from, to);
        slices.push(...mapSlices(sl.sites, "site", list), ...mapSlices(sl.queries, "query", list));
      }
      await store(b, from, to, daily, slices);
      return done({ ok: true, source: "demo", rows: daily.length, via: { direct: daily.length, utm: 0 }, from, to, note: "Демо-кабинет: визиты и отказы смоделированы, это не данные Метрики." });
    } catch (e) {
      return done({ ok: false, source: "demo", reason: "error", note: errorText(e) }, [`Метрика (демо): ${errorText(e)}`]);
    }
  }

  // ─── Настоящая Метрика ───
  const prev = await metricaStatus(b.id);
  const since = prev ? Date.now() - new Date(prev.at).getTime() : Infinity;
  if (!opts.force && prev?.source === "metrica" && ((prev.ok && since < EVERY_MS) || (prev.reason === "quota" && since < QUOTA_RETRY_MS))) return { log: [], status: prev };
  if (!b.counterId) return done({ ok: false, reason: "no_counter", note: METRICA_REASON_TEXT.no_counter });
  const accs = await db.select().from(schema.adAccounts).where(and(eq(schema.adAccounts.userId, b.userId), eq(schema.adAccounts.platform, "yandex")));
  const acc = accs.find((a) => a.status === "ok") ?? accs[0];
  if (!acc) return done({ ok: false, reason: "no_account", note: METRICA_REASON_TEXT.no_account });

  const now = new Date();
  // Сутки — московские, как у площадок: в 00:00–03:00 МСК UTC-дата ещё вчерашняя
  const to = isoDay(new Date(now.getTime() + 3 * 3600e3));
  const from = isoDay(addDays(new Date(now.getTime() + 3 * 3600e3), -(WINDOW_DAYS - 1)));
  const goals: MetricaGoals = { lead: b.goalIds?.lead, booked: b.goalIds?.booked };
  const notes: string[] = [];
  try {
    const token = decrypt(acc.accessToken);
    const hasYandex = camps.some((c) => c.platform === "yandex");
    // Разбивка Директа: если Метрика её не отдаёт (счётчик не привязан, группировка недоступна) — остаёмся на UTM-метках
    let direct: MetricaDayRow[] = [];
    if (hasYandex) {
      try {
        direct = await metricaDirectDaily(token, b.counterId, from, to, goals);
      } catch (e) {
        if (!(e instanceof MetricaError) || e.code !== "bad_request") throw e;
        notes.push("Метрика не отдала разбивку по объявлениям Директа — визиты считаем по UTM-меткам ссылок.");
      }
    }
    const utm = await metricaUtmDaily(token, b.counterId, from, to, goals).catch((e) => {
      if (e instanceof MetricaError && e.code === "bad_request") {
        notes.push(`UTM-метки: ${e.message}`);
        return [] as MetricaDayRow[];
      }
      throw e;
    });
    const daily = mapRows([...direct, ...utm], camps, ads, "metrica");
    // Срезы по площадкам РСЯ и поисковым запросам: необязательны, их сбой не отменяет дневные данные
    let slices: SliceAgg[] | null = null;
    if (hasYandex) {
      try {
        const yc = camps.filter((c) => c.platform === "yandex");
        const sites = yc.some((c) => c.channel === "network") ? await metricaDirectSlices(token, b.counterId, from, to, goals, "site") : [];
        const queries = yc.some((c) => c.channel === "search") ? await metricaDirectSlices(token, b.counterId, from, to, goals, "query") : [];
        slices = [...mapSlices(sites, "site", yc), ...mapSlices(queries, "query", yc)];
      } catch (e) {
        if (e instanceof MetricaError && (e.code === "scope" || e.code === "counter")) throw e;
        notes.push(`Площадки и запросы по Метрике не получены: ${errorText(e)}`);
      }
    }
    await store(b, from, to, daily, slices);
    const via = { direct: daily.filter((r) => r.source === "direct").length, utm: daily.filter((r) => r.source === "utm").length };
    return done({ ok: true, source: "metrica", rows: daily.length, via, from, to, note: notes.join(" ") || undefined }, notes.map((n) => `Метрика: ${n}`));
  } catch (e) {
    const reason: MetricaReason = e instanceof MetricaError ? (e.code === "bad_request" || e.code === "api" ? "error" : e.code) : "error";
    const note = `${METRICA_REASON_TEXT[reason]}${reason === "error" ? ` (${errorText(e)})` : ""}`;
    return done({ ok: false, source: "metrica", reason, note }, [`Метрика: ${errorText(e)}`]);
  }
}

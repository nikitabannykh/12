import "server-only";
import { createHash } from "crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { AdAccount, Business } from "../db/schema";
import type { WordstatPhrase } from "../platforms/types";
import { PlatformError } from "../platforms/types";
import { clientFor } from "../platforms";
import { YandexDirect } from "../platforms/yandex";
import { DemoPlatform } from "../platforms/demo";
import { cloudWordstat, cloudWordstatConfigured, CloudWordstatError } from "../platforms/wordstat-cloud";
import { buildSemanticCore, phraseKey, type SemanticCore } from "./semantics";
import { cityIn, demandSeeds, summarizeDemand, type DemandSeedGroup, type DemandSummary } from "./wordstat";
import { regionIdsFor, yandexRegionIds } from "./regions";
import { isMedical } from "../niches";
import { errorText, sleep } from "../util";

/**
 * Сбор спроса по Wordstat для бизнеса — возобновляемая задача (kv `demand:<businessId>`), которую двигает
 * POST /api/launch/demand порциями, не дольше ~40 с за вызов (лимит функции на Vercel — 60 с).
 *
 * Источники (по порядку, при ошибке — следующий):
 *  - cloud — Search API v2 Wordstat в Yandex Cloud (YANDEX_CLOUD_API_KEY + YANDEX_CLOUD_FOLDER_ID): синхронно, по фразе;
 *  - direct — отчёты Wordstat API Директа v4 с токеном кабинета владельца: создаём до 4 отчётов по ≤10 фраз
 *    (у пользователя не больше 5 отчётов — 6-й даёт ошибку 31), ждём готовности, читаем и сразу удаляем;
 *  - demo — демо-кабинет: детерминированные «частоты» (не данные Яндекса, так и подписываем).
 * Лимиты: не больше DEMAND_MAX_PHRASES фраз за сбор (семена — главные фразы групп) и не больше DIRECT_DAILY_SAFE фраз
 * в сутки на кабинет Директа (у Wordstat v4 — 1000/сутки на пользователя). Каждая фраза кэшируется на 14 дней
 * (kv `ws:<регионы>:<ключ фразы>`), повторный сбор и другие бизнесы в том же городе берут её из кэша бесплатно.
 */

type Source = "cloud" | "direct" | "demo";
type Report = { id: number; phrases: string[]; at: string };

export type DemandJob = {
  v: 1;
  rev: number;
  key: string;
  regionIds: number[];
  city: string;
  status: "running" | "done" | "unavailable";
  /** Какие источники ещё пробуем, по порядку */
  sources: Source[];
  /** Источник, давший данные (cache — всё нашлось в кэше) */
  used: Source | "cache" | null;
  accountId: string | null;
  groups: DemandSeedGroup[];
  negatives: string[];
  queue: string[];
  reports: Report[];
  failed: string[];
  tries: Record<string, number>;
  results: Record<string, WordstatPhrase>;
  total: number;
  note: string | null;
  lockUntil: number;
  /** Ошибку 31 (5 отчётов) лечили уборкой чужих готовых отчётов — один раз за сбор */
  cleaned?: boolean;
  /** Последняя настоящая ошибка источника — для понятной причины владельцу и диагностики */
  lastError?: DemandError | null;
  /** Сырые ответы v4 по методам (первые 500 символов) — диагностика */
  raw?: Record<string, string>;
  /** Неудачный сбор: когда можно начать заново (мс epoch) */
  retryAt?: number;
  startedAt: string;
  updatedAt: string;
};

export type DemandError = { source: Source; method: string; code: number | null; message: string; sample?: string | null; at: string };

export type DemandView = {
  status: "running" | "done" | "unavailable";
  source: Source | "cache" | null;
  city: string;
  cityIn: string;
  regionIds: number[];
  medical: boolean;
  progress: { done: number; total: number };
  summary: DemandSummary | null;
  note: string | null;
  /** Диагностика для владельца бизнеса (его собственная задача): последняя ошибка и сырые ответы API */
  debug?: { lastError: DemandError | null; raw: Record<string, string>; sources: Source[]; failed: string[]; reports: { id: number; at: string; phrases: number }[]; retryAt: string | null; startedAt: string; updatedAt: string };
};

const JOB_KEY = (businessId: string) => `demand:${businessId}`;
const CACHE_TTL_DAYS = 14;
const CACHE_KEY = (regionIds: number[], phrase: string) => `ws:${[...regionIds].sort((a, b) => a - b).join(",")}:${phraseKey(phrase)}`;
const DAY_KEY = (accountId: string) => `wsday:${accountId}:${new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10)}`;
/** Директ v4: 1000 фраз в сутки на пользователя — оставляем запас на ручные проверки владельца */
const DIRECT_DAILY_SAFE = 900;
/** Одновременных отчётов v4: у пользователя хранится не больше 5 */
const DIRECT_PARALLEL = 4;
/** Хвостов фразы храним не больше — для ядра и пересечений хватает */
const TAILS_KEEP = 40;
const LOCK_MS = 50_000;
/** Неудачная попытка сбора: через сколько пробуем заново */
const RETRY_UNAVAILABLE_MS = 3600e3;
/** Все фразы упали с непонятной ошибкой — можно перезапустить почти сразу (после исправления/выкладки) */
const RETRY_FAILED_MS = 2 * 60e3;

const now = () => new Date().toISOString();
const trim = (r: WordstatPhrase): WordstatPhrase => ({ phrase: r.phrase, shows: r.shows, searchedWith: r.searchedWith.slice(0, TAILS_KEEP) });

// ─── kv ──────────────────────────────────────────────────────────────

async function readJob(businessId: string): Promise<DemandJob | null> {
  const db = await getDb();
  const [row] = await db.select().from(schema.kv).where(eq(schema.kv.key, JOB_KEY(businessId)));
  const v = row?.value as DemandJob | undefined;
  return v && v.v === 1 ? v : null;
}

/** Запись с проверкой ревизии: false — задачу за это время поменял другой запрос */
async function saveJob(businessId: string, job: DemandJob, expectRev: number | null): Promise<boolean> {
  const db = await getDb();
  const next = { ...job, rev: (expectRev ?? 0) + 1, updatedAt: now() };
  if (expectRev === null) {
    const rows = await db.insert(schema.kv).values({ key: JOB_KEY(businessId), value: next }).onConflictDoNothing().returning({ key: schema.kv.key });
    if (!rows.length) return false;
  } else {
    const rows = await db
      .update(schema.kv)
      .set({ value: next, updatedAt: new Date() })
      .where(and(eq(schema.kv.key, JOB_KEY(businessId)), sql`coalesce((${schema.kv.value}->>'rev')::int, 0) = ${expectRev}`))
      .returning({ key: schema.kv.key });
    if (!rows.length) return false;
  }
  Object.assign(job, next);
  return true;
}

async function readCache(regionIds: number[], phrases: string[]): Promise<Record<string, WordstatPhrase & { source?: string }>> {
  if (!phrases.length) return {};
  const db = await getDb();
  const keys = phrases.map((p) => CACHE_KEY(regionIds, p));
  const rows = await db.select().from(schema.kv).where(inArray(schema.kv.key, keys));
  const out: Record<string, WordstatPhrase & { source?: string }> = {};
  for (const r of rows) {
    if (Date.now() - r.updatedAt.getTime() > CACHE_TTL_DAYS * 864e5) continue;
    const v = r.value as (WordstatPhrase & { source?: string }) | null;
    if (v && typeof v.shows === "number" && Array.isArray(v.searchedWith)) out[phraseKey(v.phrase)] = v;
  }
  return out;
}

async function writeCache(regionIds: number[], r: WordstatPhrase, source: Source) {
  const db = await getDb();
  const value = { ...trim(r), source };
  await db.insert(schema.kv).values({ key: CACHE_KEY(regionIds, r.phrase), value }).onConflictDoUpdate({ target: schema.kv.key, set: { value, updatedAt: new Date() } });
}

/** Сколько фраз уже ушло в Wordstat v4 с этого кабинета сегодня (по Москве); add — прибавить */
async function directDaily(accountId: string, add = 0): Promise<number> {
  const db = await getDb();
  const key = DAY_KEY(accountId);
  if (!add) {
    const [row] = await db.select().from(schema.kv).where(eq(schema.kv.key, key));
    return Number((row?.value as { n?: number } | undefined)?.n ?? 0);
  }
  const [row] = await db
    .insert(schema.kv)
    .values({ key, value: { n: add } })
    .onConflictDoUpdate({ target: schema.kv.key, set: { value: sql`jsonb_build_object('n', coalesce((${schema.kv.value}->>'n')::int, 0) + ${add})`, updatedAt: new Date() } })
    .returning({ value: schema.kv.value });
  return Number((row?.value as { n?: number } | undefined)?.n ?? add);
}

// ─── Подготовка ───────────────────────────────────────────────────────

type Ctx = { sources: Source[]; regionIds: number[] | null; yandex: AdAccount | null; demo: AdAccount | null; note: string | null };

async function context(b: Business, accounts: AdAccount[]): Promise<Ctx> {
  const yandex = accounts.find((a) => a.platform === "yandex" && a.status === "ok") ?? null;
  const demo = accounts.find((a) => a.platform === "demo") ?? null;
  const real = accounts.some((a) => a.platform !== "demo");
  const sources: Source[] = [];
  // Демо-посетители — только демо-данные: не тратим квоту настоящего Wordstat на анонимные демо
  if (!real && demo) sources.push("demo");
  else {
    if (cloudWordstatConfigured()) sources.push("cloud");
    if (yandex) sources.push("direct");
  }
  let regionIds: number[] | null = null;
  const own = (b.regionIds ?? {}) as { yandex?: number[] };
  if (own.yandex?.length) regionIds = own.yandex;
  else if (yandex) {
    try {
      regionIds = await regionIdsFor(b, "yandex", await clientFor(yandex));
    } catch {
      regionIds = await yandexRegionIds(b.city).catch(() => null);
    }
  } else regionIds = await yandexRegionIds(b.city).catch(() => null);
  let note: string | null = null;
  if (!sources.length) note = "Спрос по Wordstat посчитаем, когда подключите Яндекс Директ.";
  else if (!regionIds?.length) note = `Не нашли «${b.city}» в справочнике регионов Яндекса — спрос посчитать не можем. Уточните город в настройках.`;
  return { sources, regionIds, yandex, demo, note };
}

function seedsOf(b: Business): { groups: DemandSeedGroup[]; negatives: string[]; phrases: string[] } {
  const core = buildSemanticCore(b);
  const groups = demandSeeds(core);
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const g of groups) for (const s of g.seeds) if (!seen.has(phraseKey(s))) { seen.add(phraseKey(s)); phrases.push(s); }
  return { groups, negatives: core.negatives, phrases };
}

async function newJob(b: Business, ctx: Ctx): Promise<DemandJob> {
  const { groups, negatives, phrases } = seedsOf(b);
  const regionIds = ctx.regionIds ?? [];
  const key = createHash("sha1").update(JSON.stringify(["v2-live", regionIds, phrases.map(phraseKey).sort(), ctx.sources])).digest("hex").slice(0, 16);
  const base: DemandJob = {
    v: 1, rev: 0, key, regionIds, city: b.city, status: "running", sources: ctx.sources, used: null, accountId: ctx.yandex?.id ?? ctx.demo?.id ?? null,
    groups, negatives, queue: [], reports: [], failed: [], tries: {}, results: {}, total: phrases.length, note: ctx.note, lockUntil: 0, startedAt: now(), updatedAt: now(),
  };
  if (ctx.note || !phrases.length) return { ...base, status: "unavailable", note: ctx.note ?? "Нет услуг, по которым считать спрос." };
  const cached = await readCache(regionIds, phrases);
  // Демо-данные не смешиваем с настоящими: в демо — только демо-кэш, в реальном кабинете — только реальный
  const fits = (s?: string) => (ctx.sources[0] === "demo" ? s === "demo" : s !== "demo");
  for (const [k, v] of Object.entries(cached)) if (fits(v.source)) base.results[k] = trim(v);
  base.queue = phrases.filter((p) => !base.results[phraseKey(p)]);
  if (!base.queue.length) {
    const src = Object.values(cached)[0]?.source as Source | undefined;
    return { ...base, status: "done", used: src ?? "cache" };
  }
  return base;
}

function view(job: DemandJob | null, b: Business, fallbackNote?: string | null): DemandView {
  const medical = isMedical(b);
  if (!job) return { status: "unavailable", source: null, city: b.city, cityIn: cityIn(b.city), regionIds: [], medical, progress: { done: 0, total: 0 }, summary: null, note: fallbackNote ?? null };
  const has = Object.keys(job.results).length > 0;
  return {
    status: job.status,
    source: job.used,
    city: job.city,
    cityIn: cityIn(job.city),
    regionIds: job.regionIds,
    medical,
    progress: { done: Object.keys(job.results).length + job.failed.length, total: job.total },
    // Пока идёт сбор, итог не показываем: частичная сумма занижала бы спрос
    summary: has && job.status !== "running" ? summarizeDemand(job.groups, job.results, job.negatives) : null,
    note: job.note,
    debug: {
      lastError: job.lastError ?? null,
      raw: job.raw ?? {},
      sources: job.sources,
      failed: job.failed,
      reports: job.reports.map((r) => ({ id: r.id, at: r.at, phrases: r.phrases.length })),
      retryAt: job.retryAt ? new Date(job.retryAt).toISOString() : null,
      startedAt: job.startedAt,
      updatedAt: job.updatedAt,
    },
  };
}

// ─── Шаги источников ────────────────────────────────────────────────

function store(job: DemandJob, r: WordstatPhrase, src: Source, asked?: string) {
  // Ответ может вернуть фразу в другой форме (нижний регистр, без операторов) — ключ берём от той, что спрашивали
  const key = phraseKey(asked ?? r.phrase);
  job.results[key] = trim({ ...r, phrase: asked ?? r.phrase });
  job.queue = job.queue.filter((p) => phraseKey(p) !== key);
  job.used = job.used && job.used !== src ? job.used : src;
}

function fail(job: DemandJob, phrase: string, max = 2) {
  const k = phraseKey(phrase);
  job.tries[k] = (job.tries[k] ?? 0) + 1;
  if (job.tries[k] >= max) {
    job.queue = job.queue.filter((p) => phraseKey(p) !== k);
    if (!job.failed.includes(phrase)) job.failed.push(phrase);
  }
}

/** Источник не работает (ключ, права, баллы, лимит): переходим к следующему, отчёты его — бросаем */
function dropSource(job: DemandJob, src: Source, why: string) {
  job.sources = job.sources.filter((s) => s !== src);
  job.note = why;
  if (src === "direct") job.reports = [];
  console.warn("wordstat source off", src, why);
}

const SOURCE_NAME: Record<Source, string> = { direct: "Wordstat Директа", cloud: "Wordstat в Yandex Cloud", demo: "Демо-Wordstat" };

const sampleOf = (e: unknown) => {
  const d = e instanceof PlatformError ? (e.detail as { sample?: string } | undefined) : undefined;
  return typeof d?.sample === "string" ? d.sample.slice(0, 300) : null;
};

/** Запоминаем ошибку источника (любую — и PlatformError, и неожиданную) */
function record(job: DemandJob, source: Source, method: string, e: unknown, sample?: string | null) {
  const code = v4Code(e);
  job.lastError = { source, method, code: Number.isFinite(code) ? code : null, message: errorText(e).slice(0, 300), sample: sample ?? sampleOf(e), at: now() };
  console.warn("wordstat error", source, method, job.lastError.code, job.lastError.message);
}

async function stepDemo(job: DemandJob, accounts: AdAccount[]) {
  const demo = accounts.find((a) => a.platform === "demo");
  if (!demo) return dropSource(job, "demo", "Демо-кабинет не подключён.");
  const client = (await clientFor(demo)) as DemoPlatform;
  const asked = [...job.queue];
  const res = await client.wordstat(asked, job.regionIds);
  for (let i = 0; i < asked.length; i++) {
    if (!res[i]) continue;
    store(job, res[i], "demo", asked[i]);
    await writeCache(job.regionIds, { ...res[i], phrase: asked[i] }, "demo");
  }
}

async function stepCloud(job: DemandJob, deadline: number) {
  const PAR = 3;
  while (job.queue.length && job.sources[0] === "cloud" && Date.now() < deadline - 12_000) {
    const batch = job.queue.slice(0, PAR);
    const settled = await Promise.allSettled(batch.map((p) => cloudWordstat(p, job.regionIds, { timeoutMs: Math.min(10_000, deadline - Date.now() - 2_000) })));
    for (let i = 0; i < batch.length; i++) {
      const s = settled[i];
      if (s.status === "fulfilled") {
        store(job, s.value, "cloud", batch[i]);
        await writeCache(job.regionIds, { ...s.value, phrase: batch[i] }, "cloud");
      } else {
        record(job, "cloud", "wordstat/topRequests", s.reason);
        if (s.reason instanceof CloudWordstatError && s.reason.fatal) return dropSource(job, "cloud", `Wordstat в Yandex Cloud не ответил: ${s.reason.message}`);
        fail(job, batch[i]);
      }
    }
  }
}

const v4Code = (e: unknown) => (e instanceof PlatformError && e.detail && typeof e.detail === "object" ? Number((e.detail as { error_code?: number }).error_code) : NaN);
/**
 * Коды v4, при которых повторять бессмысленно: 53 — авторизация, 54 — нет прав, 58 — приложению не дан доступ,
 * 513 — пользователь не подключён к API; 152 — не хватает баллов, 506/509 — превышены лимиты.
 */
const V4_FATAL = new Set([53, 54, 58, 513, 152, 506, 509]);
const directFatal = (e: unknown) => V4_FATAL.has(v4Code(e)) || /лимит|limit/i.test(errorText(e));
/** Отчёт со статусом Pending дольше — считаем зависшим */
const REPORT_STUCK_MS = 10 * 60e3;
/** Статус отчёта неизвестен (список пришёл в другом виде) — пробуем читать его так долго */
const REPORT_UNKNOWN_MS = 3 * 60e3;

/** Строки отчёта → фразы запроса: по ключу фразы, остальные — по порядку (Яндекс может нормализовать написание) */
export function matchRows(asked: string[], rows: WordstatPhrase[]): (WordstatPhrase | null)[] {
  const used = new Set<number>();
  const out = asked.map((p) => {
    const i = rows.findIndex((r, j) => !used.has(j) && phraseKey(r.phrase) === phraseKey(p));
    if (i < 0) return null;
    used.add(i);
    return rows[i];
  });
  const rest = rows.map((r, j) => (used.has(j) ? null : { r, j })).filter((x): x is { r: WordstatPhrase; j: number } => !!x);
  if (rows.length === asked.length) {
    // Та же длина — порядок строк совпадает с порядком фраз
    return out.map((m, i) => m ?? (used.has(i) ? null : rows[i]));
  }
  return out.map((m) => m ?? rest.shift()?.r ?? null);
}

async function stepDirect(job: DemandJob, accounts: AdAccount[], deadline: number, save: () => Promise<boolean>) {
  const acc = accounts.find((a) => a.platform === "yandex" && a.status === "ok");
  if (!acc) return dropSource(job, "direct", "Кабинет Яндекс Директа не подключён.");
  const client = (await clientFor(acc)) as YandexDirect;
  job.accountId = acc.id;
  const keepRaw = () => { job.raw = { ...(job.raw ?? {}), ...(client.v4Raw ?? {}) }; };
  const off = (method: string, e: unknown) => {
    record(job, "direct", method, e);
    dropSource(job, "direct", `Wordstat Директа не ответил: ${errorText(e)}`);
  };
  try {
    for (;;) {
      // 1) Готовые отчёты — читаем и удаляем
      if (job.reports.length) {
        let list: { id: number; status: string }[] | null = null;
        try {
          list = await client.wordstatList();
        } catch (e) {
          if (directFatal(e)) return off("GetWordstatReportList", e);
          record(job, "direct", "GetWordstatReportList", e);
        }
        for (const rep of [...job.reports]) {
          const age = Date.now() - new Date(rep.at).getTime();
          const st = list?.find((r) => String(r.id) === String(rep.id))?.status ?? null;
          if (st === "Pending" && age < REPORT_STUCK_MS) continue;
          let done = false;
          if (st === "Failed" || st === "Pending") {
            record(job, "direct", "GetWordstatReportList", new Error(st === "Failed" ? `отчёт Wordstat ${rep.id} не сформировался (Failed)` : `отчёт Wordstat ${rep.id} готовится дольше 10 минут`), job.raw?.GetWordstatReportList ?? client.v4Raw.GetWordstatReportList);
            for (const p of rep.phrases) fail(job, p);
            done = true;
          } else if (st !== "Done" && age < 15_000) {
            continue; // статус неизвестен — дадим отчёту время, потом попробуем прочитать напрямую
          } else {
            // Done или статус неизвестен (список в другом виде): читаем отчёт
            let rows: WordstatPhrase[] | null = null;
            try {
              rows = await client.wordstatGet(rep.id);
            } catch (e) {
              if (directFatal(e)) return off("GetWordstatReport", e);
              record(job, "direct", "GetWordstatReport", e, client.v4Raw.GetWordstatReport);
              if (st !== "Done" && age < REPORT_UNKNOWN_MS) continue;
            }
            if (rows?.length) {
              const matched = matchRows(rep.phrases, rows);
              const missed: string[] = [];
              for (let i = 0; i < rep.phrases.length; i++) {
                const p = rep.phrases[i], row = matched[i];
                if (row) {
                  store(job, row, "direct", p);
                  await writeCache(job.regionIds, { ...row, phrase: p }, "direct");
                } else {
                  missed.push(p);
                  fail(job, p);
                }
              }
              if (missed.length) record(job, "direct", "GetWordstatReport", new Error(`в отчёте нет строк для ${missed.length} из ${rep.phrases.length} фраз («${missed[0]}»)`), client.v4Raw.GetWordstatReport);
              done = true;
            } else {
              if (rows) record(job, "direct", "GetWordstatReport", new Error(`отчёт ${rep.id} пришёл без строк — неожиданный формат ответа`), client.v4Raw.GetWordstatReport);
              if (st !== "Done" && age < REPORT_UNKNOWN_MS) continue;
              for (const p of rep.phrases) fail(job, p);
              done = true;
            }
          }
          if (done) {
            await client.wordstatDelete(rep.id).catch((e) => record(job, "direct", "DeleteWordstatReport", e));
            job.reports = job.reports.filter((r) => r.id !== rep.id);
            keepRaw();
            await save();
          }
        }
      }
      // 2) Новые отчёты: до 4 одновременно, по 10 фраз; фразы, что уже в отчётах, не дублируем
      const inFlight = new Set(job.reports.flatMap((r) => r.phrases.map(phraseKey)));
      let waiting = job.queue.filter((p) => !inFlight.has(phraseKey(p)));
      while (job.reports.length < DIRECT_PARALLEL && waiting.length && Date.now() < deadline - 6_000) {
        const batch = waiting.slice(0, 10);
        const used = await directDaily(acc.id);
        if (used + batch.length > DIRECT_DAILY_SAFE) {
          if (!job.reports.length) {
            dropSource(job, "direct", "Дневной лимит Wordstat в Директе исчерпан — досчитаем спрос завтра.");
            job.retryAt = Date.now() + RETRY_UNAVAILABLE_MS;
            return;
          }
          break;
        }
        try {
          const id = await client.wordstatCreate(batch, job.regionIds);
          await directDaily(acc.id, batch.length);
          job.reports.push({ id, phrases: batch, at: now() });
          waiting = waiting.slice(batch.length);
          keepRaw();
          // ID отчёта сохраняем сразу: оборвись функция — следующий вызов его прочитает и удалит
          if (!(await save())) return;
        } catch (e) {
          const code = v4Code(e);
          if (code === 31 && !job.cleaned) {
            // 5 отчётов уже лежат (наши брошенные или созданные вручную) — убираем готовые и неудачные, кроме своих
            job.cleaned = true;
            record(job, "direct", "CreateNewWordstatReport", e);
            const mine = new Set(job.reports.map((r) => String(r.id)));
            for (const r of await client.wordstatList().catch(() => [])) if (!mine.has(String(r.id)) && r.status !== "Pending") await client.wordstatDelete(r.id).catch(() => {});
            continue;
          }
          if (code === 31) {
            record(job, "direct", "CreateNewWordstatReport", e);
            break; // подождём, пока освободятся
          }
          if (directFatal(e)) return off("CreateNewWordstatReport", e);
          // Неизвестная ошибка (в том числе не PlatformError) — запоминаем, фразы получат ещё попытку
          record(job, "direct", "CreateNewWordstatReport", e, client.v4Raw.CreateNewWordstatReport);
          for (const p of batch) fail(job, p);
          waiting = waiting.slice(batch.length);
        }
      }
      if (!job.reports.length && !job.queue.length) return;
      if (!job.reports.length && !waiting.length) return;
      if (Date.now() > deadline - 5_000) return;
      await sleep(3_000);
    }
  } finally {
    keepRaw();
  }
}

// ─── Публичное ───────────────────────────────────────────────────────

/**
 * Состояние сбора спроса; advance — продвинуть его (не дольше deadline). Задачу начинаем заново, если поменялись
 * услуги или регион (другие семена), данным больше 14 дней или прошлый сбор не удался больше часа назад.
 * Параллельные вызовы (две вкладки) не дублируют отчёты: шаг берёт задачу под блокировку (lockUntil) с проверкой ревизии.
 */
export async function demandState(b: Business, accounts: AdAccount[], opts: { advance?: boolean; deadline?: number } = {}): Promise<DemandView> {
  const deadline = opts.deadline ?? Date.now() + 40_000;
  let job = await readJob(b.id);
  if (!opts.advance) return view(job, b);
  const ctx = await context(b, accounts);
  const fresh = await newJob(b, ctx);
  const age = job ? Date.now() - new Date(job.startedAt).getTime() : Infinity;
  const stale = !job || job.key !== fresh.key || age > CACHE_TTL_DAYS * 864e5 || (job.status === "unavailable" && Date.now() > (job.retryAt ?? new Date(job.updatedAt).getTime() + (job.failed.length ? RETRY_FAILED_MS : RETRY_UNAVAILABLE_MS)));
  if (stale) {
    // Отчёты брошенной задачи Директа не ждём — освобождаем место (у пользователя их не больше 5)
    if (job?.reports.length && ctx.yandex) {
      const client = (await clientFor(ctx.yandex)) as YandexDirect;
      for (const r of job.reports) await client.wordstatDelete(r.id).catch(() => {});
    }
    if (!(await saveJob(b.id, fresh, job ? job.rev : null))) return view(await readJob(b.id), b);
    job = fresh;
  }
  if (!job || job.status !== "running") return view(job, b);
  if (job.lockUntil > Date.now()) return view(job, b);
  // Берём задачу под блокировку
  job.lockUntil = Date.now() + LOCK_MS;
  if (!(await saveJob(b.id, job, job.rev))) return view(await readJob(b.id), b);
  const save = () => saveJob(b.id, job!, job!.rev);
  try {
    while (job.sources.length && (job.queue.length || job.reports.length) && Date.now() < deadline - 5_000) {
      const src = job.sources[0];
      const before = job.sources.length;
      try {
        if (src === "demo") await stepDemo(job, accounts);
        else if (src === "cloud") await stepCloud(job, deadline);
        else await stepDirect(job, accounts, deadline, save);
      } catch (e) {
        record(job, src, "step", e);
        dropSource(job, src, `${SOURCE_NAME[src]} не ответил: ${errorText(e)}`);
      }
      // Источник ничего не сделал и не отключился — значит, ждёт (отчёты, время): выходим до следующего вызова
      if (job.sources.length === before && src !== "demo") break;
    }
    if (!job.queue.length && !job.reports.length) job.status = Object.keys(job.results).length ? "done" : "unavailable";
    else if (!job.sources.length) {
      job.status = Object.keys(job.results).length ? "done" : "unavailable";
      job.queue = [];
    }
    if (job.status === "done" && !job.failed.length && job.note && job.sources.length) job.note = null;
    if (job.status === "done" && job.failed.length) job.note ??= `По ${job.failed.length} из ${job.total} фраз Wordstat не ответил — спрос может быть занижен.${job.lastError ? ` Причина: ${job.lastError.message}` : ""}`;
    if (job.status === "unavailable") {
      const le = job.lastError;
      // Причина — всегда: из отключения источника или из последней ошибки
      if (!job.note) job.note = le ? `${SOURCE_NAME[le.source]} не ответил: ${le.message}` : "Wordstat не вернул данных ни по одной фразе.";
      else if (le && !job.note.includes(le.message) && !/лимит/i.test(job.note)) job.note = `${job.note} (${le.method}: ${le.message})`;
      // Непонятная ошибка по всем фразам — даём перезапустить почти сразу; лимиты — через час
      job.retryAt ??= Date.now() + (le && !V4_FATAL.has(le.code ?? -1) ? RETRY_FAILED_MS : RETRY_UNAVAILABLE_MS);
    }
  } finally {
    job.lockUntil = 0;
    await save().catch(() => false);
  }
  return view(job, b);
}

/**
 * Данные Wordstat для ядра запуска — без сети: из задачи бизнеса и кэша фраз (семена текущего ядра).
 * Нет данных — пустой объект и причина (ядро останется как было).
 */
export async function demandForCore(b: Business, core: SemanticCore): Promise<{ results: Record<string, WordstatPhrase>; source: string | null; note: string | null }> {
  const job = await readJob(b.id);
  const results: Record<string, WordstatPhrase> = { ...(job?.results ?? {}) };
  const real = job?.used !== "demo";
  if (job?.regionIds.length) {
    const seeds = demandSeeds(core).flatMap((g) => g.seeds).filter((s) => !results[phraseKey(s)]);
    const cached = await readCache(job.regionIds, seeds);
    for (const [k, v] of Object.entries(cached)) if ((v.source === "demo") !== real) results[k] = trim(v);
  }
  const note = Object.keys(results).length ? null : job?.status === "running" ? "Спрос по Wordstat ещё считается — запросы подобраны без него." : job?.note ?? "Нет данных Wordstat — запросы подобраны без частотности.";
  return { results, source: job?.used ?? null, note };
}

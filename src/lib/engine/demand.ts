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
  startedAt: string;
  updatedAt: string;
};

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
  const key = createHash("sha1").update(JSON.stringify([regionIds, phrases.map(phraseKey).sort(), ctx.sources])).digest("hex").slice(0, 16);
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
      } else if (s.reason instanceof CloudWordstatError && s.reason.fatal) {
        return dropSource(job, "cloud", `Wordstat в Yandex Cloud недоступен: ${s.reason.message}`);
      } else fail(job, batch[i]);
    }
  }
}

const v4Code = (e: unknown) => (e instanceof PlatformError && e.detail && typeof e.detail === "object" ? Number((e.detail as { error_code?: number }).error_code) : NaN);

async function stepDirect(job: DemandJob, accounts: AdAccount[], deadline: number, save: () => Promise<boolean>) {
  const acc = accounts.find((a) => a.platform === "yandex" && a.status === "ok");
  if (!acc) return dropSource(job, "direct", "Кабинет Яндекс Директа не подключён.");
  const client = (await clientFor(acc)) as YandexDirect;
  job.accountId = acc.id;
  for (;;) {
    // 1) Готовые отчёты — читаем и удаляем
    if (job.reports.length) {
      let list: { id: number; status: string }[];
      try {
        list = await client.wordstatList();
      } catch (e) {
        if ([53, 58, 152, 513].includes(v4Code(e))) return dropSource(job, "direct", `Wordstat Директа недоступен: ${errorText(e)}`);
        list = [];
      }
      for (const rep of [...job.reports]) {
        const st = list.find((r) => r.id === rep.id)?.status;
        if (st === "Pending") continue;
        if (st === "Done") {
          try {
            const rows = await client.wordstatGet(rep.id);
            for (const p of rep.phrases) {
              const row = rows.find((r) => phraseKey(r.phrase) === phraseKey(p));
              if (row) {
                store(job, row, "direct", p);
                await writeCache(job.regionIds, { ...row, phrase: p }, "direct");
              } else fail(job, p);
            }
          } catch {
            for (const p of rep.phrases) fail(job, p);
          }
        } else {
          // Failed или отчёта нет (удалён, истёк через 5 ч) — фразы вернутся в очередь, но не больше 2 попыток
          for (const p of rep.phrases) fail(job, p);
          if (!list.length) continue; // список не получили — не знаем, что с отчётом: подождём
        }
        await client.wordstatDelete(rep.id).catch(() => {});
        job.reports = job.reports.filter((r) => r.id !== rep.id);
        await save();
      }
    }
    // 2) Новые отчёты: до 4 одновременно, по 10 фраз; фразы, что уже в отчётах, не дублируем
    const inFlight = new Set(job.reports.flatMap((r) => r.phrases.map(phraseKey)));
    let waiting = job.queue.filter((p) => !inFlight.has(phraseKey(p)));
    while (job.reports.length < DIRECT_PARALLEL && waiting.length && Date.now() < deadline - 6_000) {
      const batch = waiting.slice(0, 10);
      const used = await directDaily(acc.id);
      if (used + batch.length > DIRECT_DAILY_SAFE) {
        if (!job.reports.length) return dropSource(job, "direct", "Дневной лимит Wordstat в Директе исчерпан — досчитаем спрос завтра.");
        break;
      }
      try {
        const id = await client.wordstatCreate(batch, job.regionIds);
        await directDaily(acc.id, batch.length);
        job.reports.push({ id, phrases: batch, at: now() });
        waiting = waiting.slice(batch.length);
        // ID отчёта сохраняем сразу: оборвись функция — следующий вызов его прочитает и удалит
        if (!(await save())) return;
      } catch (e) {
        const code = v4Code(e);
        if (code === 31 && !job.cleaned) {
          // 5 отчётов уже лежат (наши брошенные или созданные вручную) — убираем готовые и неудачные, кроме своих
          job.cleaned = true;
          const mine = new Set(job.reports.map((r) => r.id));
          for (const r of await client.wordstatList().catch(() => [])) if (!mine.has(r.id) && r.status !== "Pending") await client.wordstatDelete(r.id).catch(() => {});
          continue;
        }
        if (code === 31) break; // подождём, пока освободятся
        if ([53, 58, 152, 513].includes(code) || /лимит|limit/i.test(errorText(e))) return dropSource(job, "direct", `Wordstat Директа недоступен: ${errorText(e)}`);
        for (const p of batch) fail(job, p);
        waiting = waiting.slice(batch.length);
      }
    }
    if (!job.reports.length && !job.queue.length) return;
    if (!job.reports.length && !waiting.length) return;
    if (Date.now() > deadline - 5_000) return;
    await sleep(3_000);
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
  const stale = !job || job.key !== fresh.key || age > CACHE_TTL_DAYS * 864e5 || (job.status === "unavailable" && Date.now() - new Date(job.updatedAt).getTime() > RETRY_UNAVAILABLE_MS);
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
        dropSource(job, src, `Wordstat недоступен: ${errorText(e)}`);
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
    if (job.status === "done" && job.failed.length) job.note ??= `По ${job.failed.length} из ${job.total} фраз Wordstat не ответил — спрос может быть занижен.`;
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

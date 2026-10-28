import "server-only";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { syncBusiness, syncOfflineConversions } from "./sync";
import { checkBalances } from "./balance";
import { optimizeBusiness } from "./optimizer";
import { accountsFor, launchStalled, publishStep, type LaunchPlan } from "./launch";
import { errorText, uid } from "../util";

/**
 * Атомарная блокировка на бизнес (строка jobs с уникальным ключом business_id + kind).
 * Один запрос: вставить строку или продлить чужую просроченную; вернулась строка — блокировка наша.
 * Так два параллельных прохода (Vercel Cron, GitHub Actions, «Проверить сейчас», перемотка демо) не работают одновременно.
 */
export async function tryLock(businessId: string, kind: string, ms: number): Promise<boolean> {
  const db = await getDb();
  const until = new Date(Date.now() + ms);
  const rows = await db
    .insert(schema.jobs)
    .values({ id: uid("j_"), businessId, kind, lockedUntil: until })
    .onConflictDoUpdate({
      target: [schema.jobs.businessId, schema.jobs.kind],
      set: { lockedUntil: until },
      setWhere: or(isNull(schema.jobs.lockedUntil), lt(schema.jobs.lockedUntil, sql`now()`)),
    })
    .returning({ id: schema.jobs.id });
  return rows.length > 0;
}

export async function releaseLock(businessId: string, kind: string, result?: string) {
  const db = await getDb();
  const set: Partial<typeof schema.jobs.$inferInsert> = { lockedUntil: null };
  if (result !== undefined) {
    set.lastRunAt = new Date();
    set.lastResult = result.slice(0, 2000);
  }
  await db.update(schema.jobs).set(set).where(and(eq(schema.jobs.businessId, businessId), eq(schema.jobs.kind, kind)));
}

export const ROBOT_LOCK = "lock";
const ROBOT_LOCK_MS = 4 * 60e3;

export async function runBusiness(businessId: string, opts: { optimize?: boolean } = {}) {
  const db = await getDb();
  const [b] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
  if (!b) return { ok: false, log: ["нет бизнеса"] };
  if (!(await tryLock(b.id, ROBOT_LOCK, ROBOT_LOCK_MS))) return { ok: false, busy: true, log: ["уже выполняется"] };
  const log: string[] = [];
  try {
    const s = await syncBusiness(b);
    log.push(...s.errors.map((e) => `синхронизация: ${e}`));
    // Баланс кабинетов и офлайн-конверсии «Записался» в Метрику — их ошибки не мешают роботу
    const bal = await checkBalances(b).catch((e) => ({ balances: [], errors: [errorText(e)] }));
    log.push(...bal.errors);
    const off = await syncOfflineConversions(b).catch((e) => ({ uploaded: 0, error: errorText(e) }));
    if (off.error) log.push(`офлайн-конверсии: ${off.error}`);
    else if (off.uploaded) log.push(`офлайн-конверсии: загружено в Метрику ${off.uploaded}`);
    if (opts.optimize !== false && b.status === "active") {
      const o = await optimizeBusiness(b);
      log.push(...o.log);
    }
  } catch (e) {
    log.push(errorText(e));
  } finally {
    await releaseLock(b.id, ROBOT_LOCK, log.join("\n") || "ok");
  }
  return { ok: true, log };
}

/**
 * Проход по активным бизнесам — вызывается по расписанию.
 * Сначала те, кого дольше не обрабатывали; несколько бизнесов параллельно; новый бизнес не начинаем,
 * если до дедлайна осталось меньше, чем обычно занимает один (по замеру в этом проходе, минимум 15 с), —
 * иначе функцию убьют посреди операций. Необработанные пойдут первыми в следующий раз.
 */
export const LAUNCH_LOCK = "launch";
/** Дольше maxDuration маршрута запуска: если функцию убьют, блокировка истечёт сама */
export const LAUNCH_LOCK_MS = 75_000;
/** Запуск считаем брошенным, если шагов не было столько времени (мастер шлёт шаги каждые несколько секунд) */
const LAUNCH_IDLE_MS = 5 * 60e3;

/**
 * Доводит брошенный запуск (владелец закрыл вкладку посреди запуска): те же шаги publishStep, что и мастер,
 * под той же блокировкой. Кампании до конца запуска выключены, так что до этого момента деньги не тратятся.
 */
export async function resumeLaunch(businessId: string, budgetMs = 40_000) {
  const started = Date.now();
  const log: string[] = [];
  if (!(await tryLock(businessId, LAUNCH_LOCK, LAUNCH_LOCK_MS))) return { ok: false, busy: true, log: ["запуск уже идёт"] };
  try {
    const db = await getDb();
    for (;;) {
      const [b] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
      const plan = b?.launchPlan as LaunchPlan | null;
      if (!b || b.status !== "launching" || !plan?.launch || plan.stage !== "ready") break;
      const left = budgetMs - (Date.now() - started);
      if (left < 15_000) break;
      const r = await publishStep(b, plan, await accountsFor(b.userId), { deadline: Date.now() + Math.min(left, 45_000) });
      if (r.done) {
        log.push(r.ok ? "запуск доведён до конца" : `запуск не удался: ${r.warnings.join("; ")}`);
        break;
      }
    }
  } catch (e) {
    log.push(`запуск: ${errorText(e)}`);
  } finally {
    await releaseLock(businessId, LAUNCH_LOCK);
  }
  return { ok: true, log };
}

export async function runAll(deadlineMs = 50_000, concurrency = 3) {
  const started = Date.now();
  const db = await getDb();
  // На паузе тоже синхронизируем (статистика, баланс), но робот ничего не меняет — см. runBusiness
  const rows = await db.select().from(schema.businesses).where(inArray(schema.businesses.status, ["active", "launching", "paused"]));
  const stalled = new Set(rows.filter((b) => launchStalled(b, LAUNCH_IDLE_MS)).map((b) => b.id));
  // Бизнесы в запуске тоже синхронизируем: если кампания всё же тратит, расход должен попасть в статистику
  const list = rows.map((b) => ({ id: b.id }));
  const jobs = await db.select().from(schema.jobs).where(eq(schema.jobs.kind, ROBOT_LOCK));
  const last = new Map(jobs.map((j) => [j.businessId, j.lastRunAt?.getTime() ?? 0]));
  list.sort((a, b) => (last.get(a.id) ?? 0) - (last.get(b.id) ?? 0));

  const done: { id: string; log: string[]; ms: number }[] = [];
  let next = 0;
  let slowest = 15_000;
  const worker = async () => {
    for (;;) {
      const left = deadlineMs - (Date.now() - started);
      if (next >= list.length || left < slowest) return;
      const { id } = list[next++];
      const t0 = Date.now();
      const pre: string[] = [];
      if (stalled.has(id)) {
        const l = await resumeLaunch(id, Math.max(15_000, Math.min(40_000, left - 5_000))).catch((e) => ({ ok: false, log: [errorText(e)] }));
        pre.push(...l.log);
      }
      const r = await runBusiness(id).then((x) => ({ ...x, log: [...pre, ...x.log] })).catch((e) => ({ ok: false, log: [...pre, errorText(e)] }));
      const ms = Date.now() - t0;
      slowest = Math.max(slowest, ms);
      done.push({ id, log: r.log, ms });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return { processed: done.length, total: list.length, done };
}

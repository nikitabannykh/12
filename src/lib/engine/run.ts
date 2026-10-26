import "server-only";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { syncBusiness } from "./sync";
import { optimizeBusiness } from "./optimizer";
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
export async function runAll(deadlineMs = 50_000, concurrency = 3) {
  const started = Date.now();
  const db = await getDb();
  const list = await db.select({ id: schema.businesses.id }).from(schema.businesses).where(inArray(schema.businesses.status, ["active"]));
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
      const r = await runBusiness(id).catch((e) => ({ ok: false, log: [errorText(e)] }));
      const ms = Date.now() - t0;
      slowest = Math.max(slowest, ms);
      done.push({ id, log: r.log, ms });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return { processed: done.length, total: list.length, done };
}

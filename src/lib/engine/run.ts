import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import { syncBusiness } from "./sync";
import { optimizeBusiness } from "./optimizer";
import { errorText, uid } from "../util";

async function lock(businessId: string, minutes: number) {
  const db = await getDb();
  const [j] = await db.select().from(schema.jobs).where(and(eq(schema.jobs.businessId, businessId), eq(schema.jobs.kind, "lock")));
  if (j?.lockedUntil && j.lockedUntil.getTime() > Date.now()) return false;
  const until = new Date(Date.now() + minutes * 60e3);
  if (j) await db.update(schema.jobs).set({ lockedUntil: until }).where(eq(schema.jobs.id, j.id));
  else await db.insert(schema.jobs).values({ id: uid("j_"), businessId, kind: "lock", lockedUntil: until });
  return true;
}

async function unlock(businessId: string, result: string) {
  const db = await getDb();
  await db.update(schema.jobs).set({ lockedUntil: null, lastRunAt: new Date(), lastResult: result.slice(0, 2000) }).where(and(eq(schema.jobs.businessId, businessId), eq(schema.jobs.kind, "lock")));
}

export async function runBusiness(businessId: string, opts: { optimize?: boolean } = {}) {
  const db = await getDb();
  const [b] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
  if (!b) return { ok: false, log: ["нет бизнеса"] };
  if (!(await lock(b.id, 4))) return { ok: false, log: ["уже выполняется"] };
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
    await unlock(b.id, log.join("\n") || "ok");
  }
  return { ok: true, log };
}

/** Проход по всем активным бизнесам — вызывается по расписанию */
export async function runAll(deadlineMs = 50_000) {
  const started = Date.now();
  const db = await getDb();
  const list = await db.select({ id: schema.businesses.id }).from(schema.businesses).where(inArray(schema.businesses.status, ["active"]));
  // Сначала те, кого дольше не обрабатывали
  const jobs = await db.select().from(schema.jobs).where(eq(schema.jobs.kind, "lock"));
  const last = new Map(jobs.map((j) => [j.businessId, j.lastRunAt?.getTime() ?? 0]));
  list.sort((a, b) => (last.get(a.id) ?? 0) - (last.get(b.id) ?? 0));
  const done: { id: string; log: string[] }[] = [];
  for (const { id } of list) {
    if (Date.now() - started > deadlineMs) break;
    const r = await runBusiness(id);
    done.push({ id, log: r.log });
  }
  return { processed: done.length, total: list.length, done };
}

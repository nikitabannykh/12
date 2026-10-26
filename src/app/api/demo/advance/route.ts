import { route, json, fail, needBusiness } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { shiftDemoClock } from "@/lib/platforms/demo";
import { runBusiness } from "@/lib/engine/run";

export const maxDuration = 60;

/** Только для демо-кабинета: промотать время вперёд и дать роботу поработать */
export const POST = route(async ({ business, req }) => {
  needBusiness(business);
  const db = await getDb();
  const camps = await db.select().from(schema.campaigns).where(eq(schema.campaigns.businessId, business.id));
  if (!camps.length || camps.some((c) => c.platform !== "demo")) return fail("Перемотка времени доступна только в демо-кабинете");
  const { days } = await req.json().catch(() => ({ days: 3 }));
  const d = Math.max(1, Math.min(14, Number(days) || 3));
  // Робот проверяет рекламу несколько раз в день — имитируем проверку раз в сутки
  const logs: string[] = [];
  for (let i = 0; i < d; i++) {
    await shiftDemoClock(1);
    const r = await runBusiness(business.id);
    logs.push(...r.log);
  }
  return json({ ok: true, days: d, log: logs });
});

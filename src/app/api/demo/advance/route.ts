import { z } from "zod";
import { route, json, fail, needBusiness } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { DEMO_MAX_SHIFT_DAYS, shiftDemoClock } from "@/lib/platforms/demo";
import { runBusiness } from "@/lib/engine/run";
import { pl } from "@/lib/util";

export const maxDuration = 60;

/** Только для демо-кабинета: промотать время вперёд (часы у каждого демо-кабинета свои) и дать роботу поработать */
export const POST = route(async ({ business, req }) => {
  needBusiness(business);
  const db = await getDb();
  const camps = await db.select().from(schema.campaigns).where(eq(schema.campaigns.businessId, business.id));
  if (!camps.length || camps.some((c) => c.platform !== "demo")) return fail("Перемотка времени доступна только в демо-кабинете");
  const scope = { accountId: camps[0].accountId };
  // Пустое тело — по умолчанию 3 дня; null, строка, массив и т. п. — ошибка запроса
  const text = await req.text();
  let body: unknown = {};
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      return fail("Не удалось прочитать запрос");
    }
  }
  const parsed = z.object({ days: z.coerce.number().finite().optional() }).safeParse(body);
  if (!parsed.success) return fail("Укажите, на сколько дней промотать время: от 1 до 14");
  const d = Math.max(1, Math.min(14, Math.round(parsed.data.days ?? 3)));
  // Робот проверяет рекламу несколько раз в день — имитируем проверку раз в сутки.
  // Не дольше ~45 с: остаток дней можно промотать следующим нажатием.
  const started = Date.now();
  const logs: string[] = [];
  let done = 0;
  let offset = await shiftDemoClock(0, scope);
  if (offset >= DEMO_MAX_SHIFT_DAYS) return fail(`Демо-время уже промотано на ${pl(DEMO_MAX_SHIFT_DAYS, "день", "дня", "дней")} — дальше нельзя. Создайте новый демо-аккаунт, чтобы начать сначала.`);
  for (let i = 0; i < d; i++) {
    if (Date.now() - started > 45_000 || offset >= DEMO_MAX_SHIFT_DAYS) break;
    offset = await shiftDemoClock(1, scope);
    const r = await runBusiness(business.id);
    if ((r as { busy?: boolean }).busy) {
      offset = await shiftDemoClock(-1, scope);
      if (!done) return fail("Робот как раз проверяет рекламу — повторите через минуту", 409);
      break;
    }
    logs.push(...r.log);
    done++;
  }
  return json({ ok: true, days: done, offsetDays: offset, limitReached: offset >= DEMO_MAX_SHIFT_DAYS, log: logs });
});

import { NextResponse } from "next/server";
import { and, isNotNull, lt, or } from "drizzle-orm";
import { runAll } from "@/lib/engine/run";
import { pollUpdates, sendDigests } from "@/lib/notify";
import { getDb, schema } from "@/lib/db";
import { macEqual } from "@/lib/crypto";
import { errorText } from "@/lib/util";
import { collectGarbageImages } from "@/lib/engine/images";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Плановая уборка: просроченные счётчики лимитов и персональные данные старше 3 лет (см. /privacy) */
async function cleanup() {
  const db = await getDb();
  await db.delete(schema.rateLimits).where(lt(schema.rateLimits.resetAt, new Date()));
  await collectGarbageImages({ minAgeMin: 120, recompress: 40 }).catch(() => 0);
  await db
    .update(schema.leads)
    .set({ name: null, contact: null, visitorId: null })
    .where(and(lt(schema.leads.createdAt, new Date(Date.now() - 3 * 365 * 864e5)), or(isNotNull(schema.leads.name), isNotNull(schema.leads.contact), isNotNull(schema.leads.visitorId))));
}

/**
 * Оптимизатор по расписанию. Вызывается:
 *  - Vercel Cron (заголовок Authorization: Bearer CRON_SECRET — переменную CRON_SECRET нужно создать в проекте),
 *  - GitHub Actions / любой внешний планировщик: заголовок Authorization: Bearer CRON_SECRET
 * После прохода робота рассылает утренние сводки в Telegram. Внутри прохода (run.ts) — проверка баланса кабинетов
 * с предупреждением в Telegram и пачечная загрузка офлайн-конверсий «Записался» в Метрику.
 * Без https (локально) сначала забирает нажатия кнопок в Telegram (getUpdates) — на https они приходят вебхуком.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Без CRON_SECRET вызов не отличить от чужого (User-Agent подделывается) — в проде робот не запускается
    if (process.env.VERCEL || process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "CRON_SECRET не задан: добавьте переменную окружения CRON_SECRET (Vercel Cron пришлёт её сам), иначе робот по расписанию не запускается" }, { status: 503 });
    }
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!macEqual(req.headers.get("authorization") || "", `Bearer ${secret}`)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const started = Date.now();
  await pollUpdates().catch(() => {});
  const r = await runAll(45_000);
  let digests: unknown = null;
  try {
    digests = await sendDigests(Math.max(3000, 55_000 - (Date.now() - started)));
  } catch (e) {
    digests = { error: errorText(e) };
  }
  await cleanup().catch((e) => console.error("cleanup", e));
  return NextResponse.json({ ...r, digests });
}

import { NextResponse } from "next/server";
import { and, isNotNull, lt, or } from "drizzle-orm";
import { runAll } from "@/lib/engine/run";
import { pollUpdates, sendDigests } from "@/lib/notify";
import { getDb, schema } from "@/lib/db";
import { macEqual } from "@/lib/crypto";
import { hit } from "@/lib/ratelimit";
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
  const url = new URL(req.url);
  const auth = req.headers.get("authorization") || "";
  void url;
  let allowed = Boolean(secret) && macEqual(auth, `Bearer ${secret}`);
  if (!secret && process.env.VERCEL && (req.headers.get("user-agent") || "").startsWith("vercel-cron")) {
    // Без CRON_SECRET заголовок User-Agent легко подделать — поэтому не чаще раза в 30 минут
    allowed = (await hit("cron:ua", 1, 1800)).ok;
  }
  if (!allowed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

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

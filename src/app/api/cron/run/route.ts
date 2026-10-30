import { hit } from "@/lib/ratelimit";
import { NextResponse } from "next/server";
import { and, eq, inArray, isNotNull, like, lt, or } from "drizzle-orm";
import { runAll } from "@/lib/engine/run";
import { pollUpdates, sendDigests } from "@/lib/notify";
import { getDb, schema } from "@/lib/db";
import { macEqual } from "@/lib/crypto";
import { errorText } from "@/lib/util";
import { collectGarbageImages } from "@/lib/engine/images";
import { DEMO_DOMAIN } from "@/lib/auth";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const DAY = 864e5;
/** Демо-аккаунты живут 14 дней: потом удаляем их со всеми данными (за проход — не больше DEMO_BATCH аккаунтов) */
const DEMO_TTL_DAYS = 14;
const DEMO_BATCH = 50;

/** Удаляет демо-аккаунты старше DEMO_TTL_DAYS вместе с бизнесами, кабинетами и всем, что к ним привязано */
async function purgeDemoUsers(): Promise<number> {
  const db = await getDb();
  const users = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(like(schema.users.email, `%@${DEMO_DOMAIN}`), lt(schema.users.createdAt, new Date(Date.now() - DEMO_TTL_DAYS * DAY))))
    .limit(DEMO_BATCH);
  for (const { id: userId } of users) {
    const bids = (await db.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.userId, userId))).map((b) => b.id);
    const accIds = (await db.select({ id: schema.adAccounts.id }).from(schema.adAccounts).where(eq(schema.adAccounts.userId, userId))).map((a) => a.id);
    if (bids.length) {
      const campIds = (await db.select({ id: schema.campaigns.id }).from(schema.campaigns).where(inArray(schema.campaigns.businessId, bids))).map((c) => c.id);
      if (campIds.length) await db.delete(schema.adGroups).where(inArray(schema.adGroups.campaignId, campIds));
      // Внешних ключей в схеме нет — порядок не важен; пользователя удаляем последним, чтобы прерванный проход повторился
      for (const t of [schema.ads, schema.campaigns, schema.images, schema.statsDaily, schema.metricaDaily, schema.metricaSlices, schema.experiments, schema.changes, schema.leads, schema.clientMarks, schema.jobs]) {
        await db.delete(t).where(inArray(t.businessId, bids));
      }
      await db.delete(schema.notifySettings).where(inArray(schema.notifySettings.businessId, bids));
    }
    // kv по бизнесу и кабинету: demand:<id>, metrica:<id>, mo:<id>, addch:<id>, demo:<acc>, demo:clock:<acc>, wsday:<acc>:… и т. п.
    for (const x of [...bids, ...accIds]) await db.delete(schema.kv).where(like(schema.kv.key, `%:${x.replace(/[\\%_]/g, "\\$&")}%`));
    if (bids.length) await db.delete(schema.businesses).where(inArray(schema.businesses.id, bids));
    await db.delete(schema.adAccounts).where(eq(schema.adAccounts.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  }
  return users.length;
}

/**
 * Плановая уборка: просроченные счётчики лимитов, сроки хранения и персональные данные старше 3 лет (см. /privacy).
 *  - кэш Wordstat (kv ws:…) и дневные счётчики фраз (kv wsday:…) — старше 30 дней (кэш действует 14);
 *  - metrica_daily — старше 400 дней (отчёты смотрят максимум год назад); changes (история) — старше 2 лет;
 *  - демо-аккаунты — старше 14 дней со всеми данными.
 */
async function cleanup() {
  const db = await getDb();
  const out: Record<string, number | string> = {};
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      const r = await fn();
      out[name] = typeof r === "number" ? r : Array.isArray(r) ? r.length : 0;
    } catch (e) {
      console.error("cleanup", name, e);
      out[name] = "error";
    }
  };
  await step("rateLimits", () => db.delete(schema.rateLimits).where(lt(schema.rateLimits.resetAt, new Date())).returning({ k: schema.rateLimits.key }));
  await step("images", () => collectGarbageImages({ minAgeMin: 120, recompress: 40 }).then(() => 0));
  await step("leadsPii", () =>
    db
      .update(schema.leads)
      .set({ name: null, contact: null, visitorId: null })
      .where(and(lt(schema.leads.createdAt, new Date(Date.now() - 3 * 365 * DAY)), or(isNotNull(schema.leads.name), isNotNull(schema.leads.contact), isNotNull(schema.leads.visitorId))))
      .returning({ id: schema.leads.id }),
  );
  await step("wordstatCache", () =>
    db
      .delete(schema.kv)
      .where(and(or(like(schema.kv.key, "ws:%"), like(schema.kv.key, "wsday:%")), lt(schema.kv.updatedAt, new Date(Date.now() - 30 * DAY))))
      .returning({ k: schema.kv.key }),
  );
  const iso = (d: number) => new Date(Date.now() - d * DAY).toISOString().slice(0, 10);
  await step("metricaDaily", () => db.delete(schema.metricaDaily).where(lt(schema.metricaDaily.day, iso(400))).returning({ id: schema.metricaDaily.id }));
  await step("changes", () => db.delete(schema.changes).where(lt(schema.changes.at, new Date(Date.now() - 2 * 365 * DAY))).returning({ id: schema.changes.id }));
  await step("demoUsers", purgeDemoUsers);
  return out;
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
    // Переходный режим, пока переменную не добавили: пускаем только Vercel Cron по User-Agent и не чаще раза в 30 минут
    // (заголовок подделывается — поэтому CRON_SECRET обязательно нужно задать)
    const ua = (req.headers.get("user-agent") || "").startsWith("vercel-cron");
    if (!(process.env.VERCEL && ua && (await hit("cron:ua", 1, 1800)).ok)) {
      return NextResponse.json({ error: "CRON_SECRET не задан: добавьте переменную окружения CRON_SECRET (Vercel Cron пришлёт её сам)" }, { status: process.env.VERCEL ? 503 : 401 });
    }
    console.warn("cron: CRON_SECRET не задан — запуск по User-Agent vercel-cron. Добавьте CRON_SECRET в переменные окружения.");
  } else if (!macEqual(req.headers.get("authorization") || "", `Bearer ${secret}`)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const started = Date.now();
  await pollUpdates().catch(() => {});
  const r = await runAll(45_000);
  let digests: unknown = null;
  try {
    digests = await sendDigests(Math.max(3000, 55_000 - (Date.now() - started)));
  } catch (e) {
    digests = { error: errorText(e) };
  }
  const cleaned = await cleanup().catch((e) => (console.error("cleanup", e), null));
  const summary = { at: new Date().toISOString(), processed: r.processed, total: r.total, failed: r.failed, ms: Date.now() - started };
  // Последний проход — для /api/health (только числа и время)
  await (await getDb())
    .insert(schema.kv)
    .values({ key: "cron:last", value: summary })
    .onConflictDoUpdate({ target: schema.kv.key, set: { value: summary, updatedAt: new Date() } })
    .catch((e) => console.error("cron:last", e));
  // Ответ уходит в логи планировщика (GitHub Actions публичного репозитория видны всем) — только счётчики.
  // Подробности по бизнесам — с ?debug=1 (секрет уже проверен выше)
  if (new URL(req.url).searchParams.get("debug") === "1") return NextResponse.json({ ...summary, done: r.done, digests, cleanup: cleaned });
  return NextResponse.json(summary);
}

/** То же для планировщиков, которые умеют только POST */
export const POST = GET;

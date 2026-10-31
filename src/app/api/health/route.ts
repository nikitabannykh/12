import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { secretError } from "@/lib/crypto";
import { googleConfigured } from "@/lib/auth";
import { mailConfigured } from "@/lib/mail";
import { aiConfigured } from "@/lib/ai/yandex";
import { tgConfigured } from "@/lib/notify";
import { yandexConfigured } from "@/lib/platforms/yandex";
import { vkConfigured } from "@/lib/platforms/vk";
import { cloudWordstatConfigured } from "@/lib/platforms/wordstat-cloud";

export const dynamic = "force-dynamic";

/**
 * Проверка живости для мониторинга (UptimeRobot, healthchecks): без входа, поэтому только булевы флаги,
 * время и числа — ни значений переменных, ни данных бизнесов. 200 — база отвечает и секрет настроен, иначе 503.
 */
export async function GET(req: Request) {
  const t0 = Date.now();
  let db: { ok: boolean; ms: number; sizeMb: number | null; error?: string } = { ok: false, ms: 0, sizeMb: null };
  let cron: unknown = null;
  try {
    const d = await getDb();
    await d.execute(sql`select 1`);
    db = { ok: true, ms: Date.now() - t0, sizeMb: null };
    try {
      const r = (await d.execute(sql`select pg_database_size(current_database())::bigint as size`)) as unknown;
      const rows = (Array.isArray(r) ? r : (r as { rows?: unknown[] }).rows ?? []) as { size?: number | string }[];
      const size = Number(rows[0]?.size);
      if (Number.isFinite(size)) db.sizeMb = Math.round((size / 1048576) * 10) / 10;
    } catch {
      /* не у всех ролей есть право — не критично */
    }
    const [row] = await d.select({ value: schema.kv.value }).from(schema.kv).where(eq(schema.kv.key, "cron:last"));
    const v = row?.value as { at?: string; processed?: number; total?: number; failed?: number; ms?: number } | undefined;
    if (v) cron = { at: v.at ?? null, processed: v.processed ?? null, total: v.total ?? null, failed: v.failed ?? null, ms: v.ms ?? null };
  } catch {
    db = { ok: false, ms: Date.now() - t0, sizeMb: null, error: "database unavailable" };
  }
  const secretOk = secretError() === null;
  const body = {
    ok: db.ok && secretOk,
    at: new Date().toISOString(),
    db,
    secret: secretOk,
    appSecretSet: Boolean(process.env.APP_SECRET && process.env.APP_SECRET.trim().length >= 16),
    cronSecretSet: Boolean(process.env.CRON_SECRET),
    integrations: {
      postgres: Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL),
      google: googleConfigured(),
      mail: mailConfigured(),
      yandexDirect: yandexConfigured(),
      vk: vkConfigured(),
      yandexCloudAi: aiConfigured(),
      wordstatCloud: cloudWordstatConfigured(),
      telegram: tgConfigured(),
    },
    cron,
    version: process.env.APP_VERSION ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null,
  };
  // Подробности (какие интеграции включены, размер базы, крон) — только с CRON_SECRET; без него — лишь «живы/нет»
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") === `Bearer ${secret}` || new URL(req.url).searchParams.get("key") === secret;
  if (!secret || !auth) return NextResponse.json({ ok: body.ok, at: body.at }, { status: body.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
  return NextResponse.json(body, { status: body.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}

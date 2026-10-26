import { NextResponse } from "next/server";
import { runAll } from "@/lib/engine/run";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Оптимизатор по расписанию. Вызывается:
 *  - Vercel Cron (заголовок Authorization: Bearer CRON_SECRET),
 *  - GitHub Actions / любой внешний планировщик: /api/cron/run?key=CRON_SECRET
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  const auth = req.headers.get("authorization");
  // Без CRON_SECRET принимаем только расписание самого Vercel
  const vercelCron = !secret && (req.headers.get("user-agent") || "").startsWith("vercel-cron");
  if (!vercelCron && (!secret || (auth !== `Bearer ${secret}` && url.searchParams.get("key") !== secret))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const r = await runAll(50_000);
  return NextResponse.json(r);
}

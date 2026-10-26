import { eq } from "drizzle-orm";
import { route, json, fail, needBusiness } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { accountsFor, addableChannels, addChannelStep, PUBLISH_BUDGET_MS } from "@/lib/engine/launch";
import { LAUNCH_LOCK, LAUNCH_LOCK_MS, releaseLock, runBusiness, tryLock } from "@/lib/engine/run";
import type { Channel } from "@/lib/platforms/types";

/**
 * Добавить канал к работающей рекламе (например, VK после увеличения бюджета).
 * GET — какие каналы можно добавить: [{ channel, name, fits, minMonthly, inProgress }].
 * POST {channel} — шаг добавления; повторять (можно без тела), пока не придёт done=true:
 *   stage copy → images → publish → done. 409 — не хватает бюджета (в тексте — сколько нужно) или идёт другой запуск.
 */
export const maxDuration = 60;
const CHANNELS: Channel[] = ["search", "network", "vk"];

export const GET = route(async ({ user, business }) => {
  needBusiness(business);
  return json({ channels: await addableChannels(business, await accountsFor(user.id)) });
});

export const POST = route(async ({ user, business, req }) => {
  const started = Date.now();
  needBusiness(business);
  const body = await req.json().catch(() => ({}));
  const channel = body?.channel ? String(body.channel) : null;
  if (channel && !CHANNELS.includes(channel as Channel)) return fail("Неизвестный канал");
  if (!(await tryLock(business.id, LAUNCH_LOCK, LAUNCH_LOCK_MS))) return fail("Идёт запуск — подождите несколько секунд", 409);
  try {
    const db = await getDb();
    const [b] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, business.id));
    if (!b) return fail("Бизнес не найден", 404);
    const accounts = await accountsFor(user.id);
    const res = await addChannelStep(b, accounts, channel as Channel | null, { deadline: started + PUBLISH_BUDGET_MS });
    if (res.done && !res.ok) return fail(res.warnings.join("\n") || "Не удалось добавить канал");
    if (res.done && accounts.some((a) => a.platform === "demo") && !accounts.some((a) => a.platform !== "demo")) {
      await runBusiness(b.id, { optimize: false }).catch(() => null);
    }
    return json(res);
  } finally {
    await releaseLock(business.id, LAUNCH_LOCK);
  }
});

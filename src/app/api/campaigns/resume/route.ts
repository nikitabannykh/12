import { and, eq, inArray } from "drizzle-orm";
import { route, json, fail, needBusiness } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { act, applyBudgetTrims, assertFitsBudget } from "@/lib/engine/ops";
import { CHANNEL_NAME } from "@/lib/platforms";

/** «Включить» с главной: владелец возвращает все каналы на паузе (или выбранные) */
export const POST = route(async ({ business, req }) => {
  needBusiness(business);
  const body = await req.json().catch(() => ({}));
  const only: string[] | null = Array.isArray(body?.ids) ? body.ids.map(String) : null;
  const db = await getDb();
  let paused = await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, business.id), inArray(schema.campaigns.status, ["paused"])));
  if (only) paused = paused.filter((c) => only.includes(c.id));
  if (!paused.length) return fail("Все каналы уже работают");
  const accounts = await db.select().from(schema.adAccounts).where(inArray(schema.adAccounts.id, [...new Set(paused.map((c) => c.accountId))]));
  const okAcc = new Set(accounts.filter((a) => a.status === "ok").map((a) => a.id));
  const ready = paused.filter((c) => okAcc.has(c.accountId));
  if (!ready.length) return fail("Кабинет площадки отключён — подключите его заново в настройках, потом включите рекламу");
  const names = ready.map((c) => `«${CHANNEL_NAME[c.channel] ?? c.channel}»`).join(", ");
  // Канал не должен вывести рекламу за бюджет месяца: иначе робот остановит его снова, а деньги уже уйдут
  const trims = await assertFitsBudget(business.id, ready.map((c) => ({ campaignId: c.id, status: "active" as const })), "resume");
  await applyBudgetTrims(business.id, trims, "Вы включаете рекламу");
  await act(
    {
      businessId: business.id, actor: "owner", kind: "resume",
      title: ready.length === 1 ? `Включили канал ${names}` : `Включили каналы ${names}`,
      reason: "Вы включили рекламу — показы начнутся в течение часа.",
    },
    ready.map((c) => ({ op: "campaignStatus" as const, campaignId: c.id, status: "active" as const })),
  );
  // Решение владельца важнее прошлой паузы по бюджету: снимаем отметку, чтобы робот не путал причины
  for (const c of ready) {
    const [fresh] = await db.select({ meta: schema.campaigns.meta }).from(schema.campaigns).where(eq(schema.campaigns.id, c.id));
    if ((fresh?.meta as any)?.pausedByGuard) await db.update(schema.campaigns).set({ meta: { ...(fresh!.meta ?? {}), pausedByGuard: null } }).where(eq(schema.campaigns.id, c.id));
  }
  return json({ ok: true, resumed: ready.length });
});

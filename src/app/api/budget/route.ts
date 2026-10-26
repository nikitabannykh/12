import { and, eq, inArray } from "drizzle-orm";
import { route, json, fail, needBusiness } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { applyMonthlyBudget } from "@/lib/engine/optimizer";
import { accountsFor, channelsFor } from "@/lib/engine/launch";
import { firstChannel, MAX_MONTHLY, minMonthlyFor } from "@/lib/engine/budget";
import { CHANNEL_NAME } from "@/lib/platforms";
import type { Channel } from "@/lib/platforms/types";
import { errorText, rub } from "@/lib/util";

/** Каналы, под которые считаем минимум: запущенные кампании, а до запуска — подключённые кабинеты (как на странице настроек) */
async function budgetChannels(businessId: string, userId: string): Promise<Channel[]> {
  const db = await getDb();
  const camps = await db.select({ channel: schema.campaigns.channel }).from(schema.campaigns).where(and(eq(schema.campaigns.businessId, businessId), inArray(schema.campaigns.status, ["active", "paused"])));
  const list = camps.length ? camps.map((c) => c.channel as Channel) : channelsFor(await accountsFor(userId)).map((c) => c.channel);
  return list.length ? list : ["search"];
}

/** Текст ошибки для владельца: свои сообщения показываем, технические (SQL, сеть) — нет */
function safeError(e: unknown) {
  const msg = errorText(e);
  return /[а-яё]/i.test(msg) && !/failed query|select |update |insert /i.test(msg) ? msg : "Не удалось изменить бюджет. Попробуйте ещё раз через минуту.";
}

export const PATCH = route(async ({ user, business, req }) => {
  needBusiness(business);
  const body = await req.json().catch(() => null);
  const m = Math.round(Number(body?.monthly));
  if (!Number.isFinite(m) || m <= 0) return fail("Укажите бюджет в рублях числом, например 15000");
  if (m > MAX_MONTHLY) return fail(`Максимальный бюджет — ${rub(MAX_MONTHLY)} в месяц`);
  const channels = await budgetChannels(business.id, user.id);
  const min = minMonthlyFor(channels);
  if (m < min) {
    return fail(`Минимальный бюджет — ${rub(min)} в месяц: меньше площадка «${CHANNEL_NAME[firstChannel(channels)]}» не принимает. На остальные каналы нужно больше — если не хватит, робот поставит их на паузу.`);
  }
  if (m === business.monthlyBudget) return json({ ok: true });
  try {
    if (business.status !== "active") {
      const db = await getDb();
      await db.update(schema.businesses).set({ monthlyBudget: m, updatedAt: new Date() }).where(eq(schema.businesses.id, business.id));
      return json({ ok: true });
    }
    await applyMonthlyBudget(business, m);
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return fail(safeError(e), 500);
  }
});

import { isLaunched } from "@/lib/util";
import { and, eq, inArray } from "drizzle-orm";
import { route, json, fail, needBusiness } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { applyMonthlyBudget } from "@/lib/engine/optimizer";
import { accountsFor, addableChannels, channelsFor } from "@/lib/engine/launch";
import { act, applyBudgetTrims, assertFitsBudget, ROBOT_BUSY } from "@/lib/engine/ops";
import { releaseLock, ROBOT_LOCK, tryLock } from "@/lib/engine/run";
import { pausedForBudget } from "@/lib/engine/budget-guard";
import { audienceMeta, isRetarget } from "@/lib/channels";
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
  // Под той же блокировкой, что и проход робота: иначе проход со старым бюджетом снова поднимет лимиты
  if (!(await tryLock(business.id, ROBOT_LOCK, 60_000))) return fail(ROBOT_BUSY, 409);
  try {
    if (!isLaunched(business.status)) {
      const db = await getDb();
      await db.update(schema.businesses).set({ monthlyBudget: m, updatedAt: new Date() }).where(eq(schema.businesses.id, business.id));
      return json({ ok: true });
    }
    const raising = m > business.monthlyBudget;
    if (business.status === "paused") {
      // Реклама остановлена целиком: только запоминаем бюджет — ничего не включаем, лимиты пересчитаем при возобновлении
      const db = await getDb();
      await db.update(schema.businesses).set({ monthlyBudget: m, updatedAt: new Date() }).where(eq(schema.businesses.id, business.id));
      return json({ ok: true, activated: [], addable: [], paused: true });
    }
    await applyMonthlyBudget(business, m);
    // Бюджет вырос — включаем и остальные типы кампаний: выключенные каналы, ретаргетинг без автозапуска,
    // и подсказываем, какие ещё не созданные каналы теперь помещаются (мастер создаст их сам)
    const activated: string[] = [];
    let addable: { channel: string; name: string }[] = [];
    if (raising && body?.activate !== false) {
      const db = await getDb();
      const [fresh] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, business.id));
      const camps = await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, business.id), eq(schema.campaigns.status, "paused")));
      for (const c of camps) {
        const aud = isRetarget(c.channel) ? audienceMeta(c) : null;
        if (aud && aud.state === "off") {
          // Ретаргетинг с выключенным автозапуском: снова ждёт аудиторию и включится сам
          await db.update(schema.campaigns).set({ meta: { ...(c.meta ?? {}), audience: { ...aud, state: "collecting", at: new Date().toISOString() } } }).where(eq(schema.campaigns.id, c.id));
          activated.push(CHANNEL_NAME[c.channel]);
          continue;
        }
        if (aud && aud.state !== "on") continue; // копит аудиторию — включится сам
        if (pausedForBudget(c) || !c.externalId || (c.meta as { pausedAll?: boolean } | null)?.pausedAll) continue;
        // Канал владелец остановил сам — не включаем (в истории так и написано: «вы остановили сами — не включали»)
        if ((c.meta as { pausedBy?: string } | null)?.pausedBy === "owner") continue;
        try {
          const trims = await assertFitsBudget(business.id, [{ campaignId: c.id, status: "active" }], "resume");
          await applyBudgetTrims(business.id, trims, "Вы увеличили бюджет");
          await act(
            { businessId: business.id, actor: "owner", kind: "resume", title: `Включили канал «${CHANNEL_NAME[c.channel]}»`, reason: "Вы увеличили бюджет — включили и этот канал. Выключить можно в разделе «Реклама»." },
            [{ op: "campaignStatus", campaignId: c.id, status: "active" }],
          );
          activated.push(CHANNEL_NAME[c.channel]);
        } catch {
          /* не помещается в бюджет — останется на паузе */
        }
      }
      if (fresh) addable = (await addableChannels(fresh, await accountsFor(user.id))).filter((x) => x.fits && !x.inProgress).map((x) => ({ channel: x.channel, name: x.name }));
    }
    return json({ ok: true, activated, addable });
  } catch (e) {
    console.error(e);
    return fail(safeError(e), 500);
  } finally {
    await releaseLock(business.id, ROBOT_LOCK);
  }
});

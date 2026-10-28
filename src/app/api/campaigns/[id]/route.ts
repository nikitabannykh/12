import { and, eq } from "drizzle-orm";
import { route, json, fail, needBusiness } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { act, applyBudgetTrims, assertFitsBudget, logChange } from "@/lib/engine/ops";
import { audienceMeta, isRetarget } from "@/lib/channels";
import { CHANNEL_NAME } from "@/lib/platforms";
import { MIN_WEEKLY } from "@/lib/engine/budget";
import { rub } from "@/lib/util";
import type { Channel } from "@/lib/platforms/types";

export const PATCH = route<{ id: string }>(async ({ business, params, req }) => {
  needBusiness(business);
  const db = await getDb();
  const [c] = await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.id, params.id), eq(schema.campaigns.businessId, business.id)));
  if (!c) return fail("Кампания не найдена", 404);
  const body = await req.json();
  const name = CHANNEL_NAME[c.channel];

  if (body.status === "active" || body.status === "paused") {
    // Ретаргетинг, который ещё копит аудиторию: «включить» — значит ждать и включиться самому, «выключить» — не включаться
    const aud = isRetarget(c.channel) ? audienceMeta(c) : null;
    if (aud && aud.state !== "on" && c.status === "paused") {
      const state = body.status === "active" ? "collecting" : "off";
      if (aud.state === state) return json({ ok: true });
      await db.update(schema.campaigns).set({ meta: { ...(c.meta ?? {}), audience: { ...aud, state, at: new Date().toISOString() } } }).where(eq(schema.campaigns.id, c.id));
      await logChange({
        businessId: business.id, actor: "owner", kind: state === "off" ? "pause" : "resume",
        title: state === "off" ? `Отключили автозапуск «${name}»` : `Вернули автозапуск «${name}»`,
        reason: state === "off"
          ? "Ретаргетинг не включится сам, даже когда наберётся аудитория. Вернуть можно в разделе «Реклама»."
          : `Ретаргетинг включится сам, когда наберётся ${aud.need} человек, которые были на сайте, но не записались.`,
      });
      return json({ ok: true, waiting: state === "collecting" });
    }
    if (body.status === c.status) return json({ ok: true });
    if (body.status === "active" && business.status === "paused") return fail("Вся реклама остановлена — нажмите «Возобновить рекламу», а лишние каналы потом выключите");
    const trims = body.status === "active" ? await assertFitsBudget(business.id, [{ campaignId: c.id, status: "active" }], "resume") : [];
    await applyBudgetTrims(business.id, trims, `Вы включаете канал «${name}»`);
    await act(
      {
        businessId: business.id, actor: "owner", kind: body.status === "active" ? "resume" : "pause",
        title: body.status === "active" ? `Включили канал «${name}»` : `Поставили на паузу канал «${name}»`,
        reason: body.status === "active" ? "Вы включили канал — показы начнутся в течение часа." : "Вы остановили канал. Деньги на нём больше не тратятся, настройки и статистика сохранены.",
      },
      [{ op: "campaignStatus", campaignId: c.id, status: body.status }],
    );
    // Решение владельца важнее прошлой паузы по бюджету и общей паузы: снимаем отметки,
    // иначе 1-го числа или при «Возобновить рекламу» канал включится против воли владельца
    const [fresh] = await db.select({ meta: schema.campaigns.meta }).from(schema.campaigns).where(eq(schema.campaigns.id, c.id));
    if ((fresh?.meta as any)?.pausedByGuard || (fresh?.meta as any)?.pausedAll) await db.update(schema.campaigns).set({ meta: { ...(fresh!.meta ?? {}), pausedByGuard: null, pausedAll: null } }).where(eq(schema.campaigns.id, c.id));
    return json({ ok: true });
  }

  if (typeof body.weeklyBudget === "number") {
    const min = MIN_WEEKLY[c.channel as Channel];
    const next = Math.round(body.weeklyBudget);
    if (next < min) return fail(`Минимум для этого канала — ${rub(min)} в неделю`);
    if (!Number.isFinite(next) || next > 10_000_000) return fail("Укажите лимит в рублях числом");
    // Новый лимит должен помещаться в остаток бюджета этого месяца (для канала на паузе проверим при включении)
    const trims = c.status === "active" ? await assertFitsBudget(business.id, [{ campaignId: c.id, weekly: next }], "limit") : [];
    await applyBudgetTrims(business.id, trims, `Вы меняете лимит канала «${name}»`);
    await act(
      {
        businessId: business.id, actor: "owner", kind: "budget", title: `Лимит канала «${name}»: ${rub(c.weeklyBudget)} → ${rub(next)} в неделю`,
        reason: "Вы изменили недельный лимит вручную.",
      },
      [{ op: "campaignBudget", campaignId: c.id, weeklyBudget: next }],
    );
    return json({ ok: true });
  }
  return fail("Нечего менять");
});

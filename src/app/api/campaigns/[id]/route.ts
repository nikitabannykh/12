import { and, eq } from "drizzle-orm";
import { route, json, fail, needBusiness } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { act } from "@/lib/engine/ops";
import { CHANNEL_NAME } from "@/lib/platforms";
import { MIN_WEEKLY, WEEKS_IN_MONTH } from "@/lib/engine/budget";
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
    if (body.status === c.status) return json({ ok: true });
    await act(
      {
        businessId: business.id, actor: "owner", kind: body.status === "active" ? "resume" : "pause",
        title: body.status === "active" ? `Включили канал «${name}»` : `Поставили на паузу канал «${name}»`,
        reason: body.status === "active" ? "Вы включили канал — показы начнутся в течение часа." : "Вы остановили канал. Деньги на нём больше не тратятся, настройки и статистика сохранены.",
      },
      [{ op: "campaignStatus", campaignId: c.id, status: body.status }],
    );
    return json({ ok: true });
  }

  if (typeof body.weeklyBudget === "number") {
    const min = MIN_WEEKLY[c.channel as Channel];
    const next = Math.round(body.weeklyBudget);
    if (next < min) return fail(`Минимум для этого канала — ${rub(min)} в неделю`);
    const others = (await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, business.id), eq(schema.campaigns.status, "active")))).filter((x) => x.id !== c.id);
    const monthly = Math.round((others.reduce((s, x) => s + x.weeklyBudget, 0) + next) * WEEKS_IN_MONTH);
    if (monthly > business.monthlyBudget * 1.02) {
      return fail(`С таким лимитом расходы составят ≈ ${rub(monthly)} в месяц — больше вашего бюджета ${rub(business.monthlyBudget)}. Сначала увеличьте месячный бюджет.`);
    }
    await act(
      { businessId: business.id, actor: "owner", kind: "budget", title: `Лимит канала «${name}»: ${rub(c.weeklyBudget)} → ${rub(next)} в неделю`, reason: "Вы изменили недельный лимит вручную." },
      [{ op: "campaignBudget", campaignId: c.id, weeklyBudget: next }],
    );
    return json({ ok: true });
  }
  return fail("Нечего менять");
});

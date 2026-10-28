import { and, eq, inArray } from "drizzle-orm";
import { route, json, fail, needBusiness } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { applyBudgetTrims, applyOps, assertFitsBudget, logChange } from "@/lib/engine/ops";
import { pl } from "@/lib/util";

export const maxDuration = 60;

/**
 * Вся реклама разом: { paused: true } — останавливаем все идущие кампании во всех кабинетах, робот ничего не включает;
 * { paused: false } — включаем ровно те, что остановили этой кнопкой (ваши ручные паузы и ждущий ретаргетинг не трогаем).
 * Одна запись в «Истории», её можно отменить.
 */
export const POST = route(async ({ business, req }) => {
  needBusiness(business);
  const body = await req.json().catch(() => ({}));
  const db = await getDb();
  if (business.status !== "active" && business.status !== "paused") return fail("Реклама ещё не запущена");

  if (body.paused === true) {
    if (business.status === "paused") return json({ ok: true, already: true });
    const live = await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, business.id), eq(schema.campaigns.status, "active")));
    for (const c of live) {
      await db.update(schema.campaigns).set({ meta: { ...(c.meta ?? {}), pausedAll: true } }).where(eq(schema.campaigns.id, c.id));
    }
    if (live.length) {
      await applyOps(live.map((c) => ({ op: "campaignStatus" as const, campaignId: c.id, status: "paused" as const })), "owner");
      await logChange(
        {
          businessId: business.id, actor: "owner", kind: "pause",
          title: "Остановили всю рекламу",
          reason: `Вы остановили ${pl(live.length, "кампанию", "кампании", "кампаний")} во всех кабинетах. Деньги больше не тратятся, настройки и статистика сохранены. Робот ничего не включит, пока вы не нажмёте «Возобновить рекламу».`,
        },
      );
    } else {
      await logChange({ businessId: business.id, actor: "owner", kind: "pause", title: "Остановили всю рекламу", reason: "Идущих кампаний не было — робот ничего не включит, пока вы не возобновите рекламу." });
    }
    await db.update(schema.businesses).set({ status: "paused", updatedAt: new Date() }).where(eq(schema.businesses.id, business.id));
    return json({ ok: true, stopped: live.length });
  }

  if (body.paused === false) {
    if (business.status === "active") return json({ ok: true, already: true });
    const all = await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, business.id), inArray(schema.campaigns.status, ["paused"])));
    const back = all.filter((c) => (c.meta as { pausedAll?: boolean } | null)?.pausedAll);
    // Сначала бизнес снова активен — иначе проверка бюджета считает кампании «чужими»
    await db.update(schema.businesses).set({ status: "active", updatedAt: new Date() }).where(eq(schema.businesses.id, business.id));
    if (back.length) {
      let trims;
      try {
        trims = await assertFitsBudget(business.id, back.map((c) => ({ campaignId: c.id, status: "active" as const })), "resume");
      } catch (e) {
        await db.update(schema.businesses).set({ status: "paused" }).where(eq(schema.businesses.id, business.id));
        return fail((e as Error).message);
      }
      await applyBudgetTrims(business.id, trims, "Вы возобновляете рекламу");
      await applyOps(back.map((c) => ({ op: "campaignStatus" as const, campaignId: c.id, status: "active" as const })), "owner");
      await logChange(
        {
          businessId: business.id, actor: "owner", kind: "resume",
          title: "Возобновили рекламу",
          reason: `Включили ${pl(back.length, "кампанию", "кампании", "кампаний")}, которые остановили кнопкой «Остановить всю рекламу». Показы начнутся в течение часа.`,
        },
      );
    } else {
      await logChange({ businessId: business.id, actor: "owner", kind: "resume", title: "Возобновили рекламу", reason: "Робот снова управляет рекламой." });
    }
    for (const c of back) {
      const [fresh] = await db.select({ meta: schema.campaigns.meta }).from(schema.campaigns).where(eq(schema.campaigns.id, c.id));
      const { pausedAll: _drop, ...rest } = (fresh?.meta ?? {}) as Record<string, unknown>;
      void _drop;
      await db.update(schema.campaigns).set({ meta: rest }).where(eq(schema.campaigns.id, c.id));
    }
    return json({ ok: true, resumed: back.length });
  }
  return fail("Нечего менять");
});

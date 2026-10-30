import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { route, json, fail, needBusiness } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { accountsFor } from "@/lib/engine/launch";
import { clientFor } from "@/lib/platforms";
import { decrypt } from "@/lib/crypto";
import { ensureGoals, listCounters } from "@/lib/platforms/metrica";
import { applyOps, logChange } from "@/lib/engine/ops";
import { errorText } from "@/lib/util";

export const maxDuration = 60;

async function yandexToken(userId: string) {
  const accs = (await accountsFor(userId)).filter((a) => a.platform === "yandex");
  const acc = accs.find((a) => a.status === "ok") ?? accs[0];
  return acc ? decrypt(acc.accessToken) : null;
}

/** Счётчики Метрики в подключённом аккаунте Яндекса — чтобы выбрать свой счётчик сайта вместо нового */
export const GET = route(async ({ user, business }) => {
  needBusiness(business);
  const token = await yandexToken(user.id);
  if (!token) return fail("Сначала подключите Яндекс Директ — счётчики берём из того же аккаунта Яндекса");
  try {
    const counters = await listCounters(token);
    return json({ counters, current: business.counterId ?? null });
  } catch (e) {
    return fail(`${errorText(e)}. Если нет доступа к Метрике — подключите Яндекс заново и разрешите доступ к Метрике.`);
  }
});

/**
 * Выбрать свой счётчик сайта. Только с согласия владельца: в счётчике создаются цели Самохода (JavaScript-события
 * pz_lead, pz_form, pz_phone, pz_messenger, pz_booked); существующие цели и настройки счётчика не меняются.
 * Идущим кампаниям Директа меняем счётчик и ключевую цель; ошибки — предупреждениями, выбор всё равно сохраняется.
 */
export const POST = route(async ({ user, business, req }) => {
  needBusiness(business);
  const body = z.object({ counterId: z.coerce.number().int().positive(), consent: z.literal(true) }).safeParse(await req.json());
  if (!body.success) return fail("Выберите счётчик и подтвердите, что можно добавить в него цели");
  if (!business.siteUrl) return fail("Свой счётчик нужен, когда реклама ведёт на ваш сайт. Сейчас она ведёт на страницу записи — там счётчик настроен автоматически.");
  const token = await yandexToken(user.id);
  if (!token) return fail("Сначала подключите Яндекс Директ");
  const counters = await listCounters(token);
  const counter = counters.find((c) => c.id === body.data.counterId);
  if (!counter) return fail("Этого счётчика нет в подключённом аккаунте Яндекса");
  let goals: Record<string, number>;
  try {
    goals = await ensureGoals(token, counter.id);
  } catch (e) {
    return fail(`Не удалось добавить цели в счётчик: ${errorText(e)}. Нужны права на редактирование счётчика (владелец или доступ «редактирование»).`);
  }
  const db = await getDb();
  const prev = business.counterId ?? null;
  await db.update(schema.businesses).set({ counterId: counter.id, goalIds: goals, updatedAt: new Date() }).where(eq(schema.businesses.id, business.id));
  const consent = { counterId: counter.id, previous: prev, consentAt: new Date().toISOString(), userId: user.id, goals };
  await db.insert(schema.kv).values({ key: `metrica:own:${business.id}`, value: consent }).onConflictDoUpdate({ target: schema.kv.key, set: { value: consent, updatedAt: new Date() } });
  // Метрику перечитаем при следующей проверке робота, уже из нового счётчика
  await db.delete(schema.kv).where(eq(schema.kv.key, `metrica:${business.id}`));

  const warnings: string[] = [];
  const camps = await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, business.id), eq(schema.campaigns.platform, "yandex"), inArray(schema.campaigns.status, ["active", "paused"])));
  for (const c of camps.filter((x) => x.externalId)) {
    try {
      const [acc] = await db.select().from(schema.adAccounts).where(eq(schema.adAccounts.id, c.accountId));
      const client = acc ? await clientFor(acc) : null;
      if (client?.setCounters) warnings.push(...(await client.setCounters(c.externalId!, [counter.id], goals.lead)));
      // Стратегия «по заявкам» оптимизирует цель старого счётчика — переставляем на «обращение» нового
      if (c.strategy === "conversions") await applyOps([{ op: "campaignBudget", campaignId: c.id, weeklyBudget: c.weeklyBudget }], "owner");
    } catch (e) {
      warnings.push(`${c.name}: ${errorText(e)}`);
    }
  }
  await logChange({
    businessId: business.id, actor: "owner", kind: "settings",
    title: `Подключили ваш счётчик Метрики № ${counter.id}`,
    reason: `Визиты, отказы и обращения с сайта ${counter.site || business.siteUrl} теперь считаются в вашем счётчике${counter.name ? ` «${counter.name}»` : ""}. С вашего согласия в него добавлены цели Самохода (обращение, заявка, звонок, мессенджер, «записался»); ваши цели и настройки не менялись.${prev && prev !== counter.id ? ` Прежний счётчик № ${prev} больше не используется.` : ""}${warnings.length ? ` Предупреждения: ${warnings.join("; ")}` : ""}`,
    details: { counterId: counter.id, previous: prev },
  });
  return json({ ok: true, counterId: counter.id, warnings });
});

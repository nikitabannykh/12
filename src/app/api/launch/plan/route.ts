import { route, json, fail, needBusiness } from "@/lib/api";
import { rebalancePlan, savePlan, type LaunchPlan } from "@/lib/engine/launch";
import { tidyText, validateAdText } from "@/lib/ai/copy";

export const GET = route(async ({ business }) => {
  needBusiness(business);
  return json({ plan: business.launchPlan ?? null });
});

/** Правки владельца перед запуском: текст объявления, вкл/выкл объявления или канала */
export const PATCH = route(async ({ business, req }) => {
  needBusiness(business);
  if (business.status === "active") return fail("Реклама уже запущена — объявления меняются на странице «Реклама»");
  const plan = business.launchPlan as LaunchPlan | null;
  if (!plan) return fail("План не найден — начните подготовку заново");
  if (plan.launch) return fail("Запуск уже начат — дождитесь окончания", 409);
  const body = await req.json().catch(() => ({}));
  let channelToggled = false;
  for (const ch of plan.channels) {
    if (body.channel === ch.channel && typeof body.channelEnabled === "boolean") {
      channelToggled = ch.enabled !== body.channelEnabled;
      ch.enabled = body.channelEnabled;
    }
    for (const g of ch.groups) {
      for (const ad of g.ads) {
        if (ad.id !== body.adId) continue;
        if (typeof body.enabled === "boolean") ad.enabled = body.enabled;
        if (typeof body.title === "string" || typeof body.title2 === "string" || typeof body.text === "string") {
          const next = {
            title: typeof body.title === "string" ? body.title : ad.title,
            title2: typeof body.title2 === "string" ? body.title2 : ad.title2,
            text: typeof body.text === "string" ? body.text : ad.text,
          };
          // Текст владельца не обрезаем молча — объясняем, что поправить
          const errs = validateAdText(ch.channel, next);
          if (errs.length) return fail(errs.join(" "));
          ad.title = tidyText(next.title);
          ad.title2 = tidyText(next.title2) || null;
          ad.text = tidyText(next.text);
        }
      }
    }
  }
  if (!plan.channels.some((c) => c.enabled)) return fail("Оставьте хотя бы один канал");
  // Доля выключенного канала переходит оставшимся (и возвращается, если канал включили обратно)
  if (channelToggled) rebalancePlan(plan, business.monthlyBudget);
  await savePlan(business.id, plan);
  return json({ plan });
});

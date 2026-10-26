import { route, json, fail, needBusiness } from "@/lib/api";
import { savePlan, type LaunchPlan } from "@/lib/engine/launch";
import { fit, LIMITS } from "@/lib/ai/copy";

export const GET = route(async ({ business }) => {
  needBusiness(business);
  return json({ plan: business.launchPlan ?? null });
});

/** Правки владельца перед запуском: текст объявления, вкл/выкл объявления или канала */
export const PATCH = route(async ({ business, req }) => {
  needBusiness(business);
  const plan = business.launchPlan as LaunchPlan | null;
  if (!plan) return fail("План не найден — начните подготовку заново");
  const body = await req.json();
  for (const ch of plan.channels) {
    if (body.channel === ch.channel && typeof body.channelEnabled === "boolean") ch.enabled = body.channelEnabled;
    for (const g of ch.groups) {
      for (const ad of g.ads) {
        if (ad.id !== body.adId) continue;
        const L = LIMITS[ch.channel];
        if (typeof body.enabled === "boolean") ad.enabled = body.enabled;
        if (typeof body.title === "string") ad.title = fit(body.title, L.title);
        if (typeof body.title2 === "string") ad.title2 = fit(body.title2, L.title2) || null;
        if (typeof body.text === "string") ad.text = fit(body.text, L.text);
      }
    }
  }
  if (!plan.channels.some((c) => c.enabled)) return fail("Оставьте хотя бы один канал");
  await savePlan(business.id, plan);
  return json({ plan });
});

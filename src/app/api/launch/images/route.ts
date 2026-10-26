import { route, json, fail, needBusiness } from "@/lib/api";
import { prepareImages, savePlan, type LaunchPlan } from "@/lib/engine/launch";

export const maxDuration = 60;

export const POST = route(async ({ business }) => {
  needBusiness(business);
  const plan = business.launchPlan as LaunchPlan | null;
  if (!plan) return fail("Сначала подготовьте объявления");
  const next = await prepareImages(business, plan);
  await savePlan(business.id, next);
  return json({ plan: next });
});

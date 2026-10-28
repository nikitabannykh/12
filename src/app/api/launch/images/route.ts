import { route, json, fail, needBusiness } from "@/lib/api";
import { prepareImages, savePlan, type LaunchPlan } from "@/lib/engine/launch";

export const maxDuration = 60;

export const POST = route(async ({ business }) => {
  needBusiness(business);
  if (business.status === "active") return fail("Реклама уже запущена");
  const plan = business.launchPlan as LaunchPlan | null;
  if (!plan) return fail("Сначала подготовьте объявления");
  if (plan.launch) return fail("Запуск уже начат — дождитесь окончания или продолжите его", 409);
  // Не больше ~40 секунд за вызов (лимит функции — 60): если не успели, клиент вызовет ещё раз и мы продолжим
  const r = await prepareImages(business, plan, Date.now() + 40_000);
  await savePlan(business.id, r.plan);
  return json({ plan: r.plan, done: r.done, ready: r.total });
});

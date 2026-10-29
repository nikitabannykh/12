import { isLaunched } from "@/lib/util";
import { route, json, fail, needBusiness } from "@/lib/api";
import { prepareImages, saveImagesStep, type LaunchPlan } from "@/lib/engine/launch";

export const maxDuration = 60;

export const POST = route(async ({ business }) => {
  needBusiness(business);
  if (isLaunched(business.status)) return fail("Реклама уже запущена");
  const plan = business.launchPlan as LaunchPlan | null;
  if (!plan) return fail("Сначала подготовьте объявления");
  if (plan.launch) return fail("Запуск уже начат — дождитесь окончания или продолжите его", 409);
  // Не больше ~40 секунд за вызов (лимит функции — 60): если не успели, клиент вызовет ещё раз и мы продолжим
  // Порция ~20 секунд: одна картинка с большим фото рисуется до нескольких секунд, оставляем запас до лимита в 60
  const r = await prepareImages(business, plan, Date.now() + 20_000);
  // Пока рисовали, владелец мог править план — переносим в свежий план только картинки
  const saved = await saveImagesStep(business.id, plan, r.plan, r.done);
  return json({ plan: saved.plan, done: saved.done, ready: saved.done ? r.steps : r.stepsDone, total: r.steps, adsWithImages: r.total });
});

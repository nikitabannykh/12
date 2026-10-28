import { isLaunched } from "@/lib/util";
import { route, json, fail, needBusiness } from "@/lib/api";
import { collectGarbageImages } from "@/lib/engine/images";
import { accountsFor, prepareCopy, savePlan, type LaunchPlan } from "@/lib/engine/launch";

export const maxDuration = 60;

export const POST = route(async ({ user, business }) => {
  needBusiness(business);
  if (isLaunched(business.status)) return fail("Реклама уже запущена");
  if ((business.launchPlan as LaunchPlan | null)?.launch) return fail("Запуск уже начат — дождитесь окончания или продолжите его", 409);
  // Старый черновик сейчас заменим — его картинки больше не нужны
  const gc = await collectGarbageImages({ ignorePlanOf: business.id, minAgeMin: 15 }).catch((e) => String(e));
  console.log("image gc", JSON.stringify(gc));
  const accounts = await accountsFor(user.id);
  const plan = await prepareCopy(business, accounts);
  await savePlan(business.id, plan);
  return json({ plan });
});

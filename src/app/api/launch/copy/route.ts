import { route, json, fail, needBusiness } from "@/lib/api";
import { accountsFor, prepareCopy, savePlan, type LaunchPlan } from "@/lib/engine/launch";

export const maxDuration = 60;

export const POST = route(async ({ user, business }) => {
  needBusiness(business);
  if (business.status === "active") return fail("Реклама уже запущена");
  if ((business.launchPlan as LaunchPlan | null)?.launch) return fail("Запуск уже начат — дождитесь окончания или продолжите его", 409);
  const accounts = await accountsFor(user.id);
  const plan = await prepareCopy(business, accounts);
  await savePlan(business.id, plan);
  return json({ plan });
});

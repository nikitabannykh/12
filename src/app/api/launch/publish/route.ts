import { route, json, fail, needBusiness } from "@/lib/api";
import { accountsFor, publish, type LaunchPlan } from "@/lib/engine/launch";
import { runBusiness } from "@/lib/engine/run";

export const maxDuration = 60;

export const POST = route(async ({ user, business }) => {
  needBusiness(business);
  const plan = business.launchPlan as LaunchPlan | null;
  if (!plan || plan.stage !== "ready") return fail("Сначала подготовьте объявления и картинки");
  if (business.status === "active") return fail("Реклама уже запущена");
  const accounts = await accountsFor(user.id);
  const res = await publish(business, plan, accounts);
  if (!res.ok) return fail(res.warnings.join("\n") || "Не удалось создать кампании");
  // Сразу подтягиваем статусы модерации (и статистику — для демо)
  await runBusiness(business.id, { optimize: false }).catch(() => null);
  return json(res);
});

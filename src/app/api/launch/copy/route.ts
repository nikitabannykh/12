import { isLaunched } from "@/lib/util";
import { route, json, fail, needBusiness } from "@/lib/api";
import { collectGarbageImages } from "@/lib/engine/images";
import { accountsFor, prepareCopy, replacePlan, type LaunchPlan } from "@/lib/engine/launch";
import { isDemoEmail } from "@/lib/auth";
import { useQuota } from "@/lib/ratelimit";

export const maxDuration = 60;

export const POST = route(async ({ user, business }) => {
  const started = Date.now();
  needBusiness(business);
  if (isLaunched(business.status)) return fail("Реклама уже запущена");
  if ((business.launchPlan as LaunchPlan | null)?.launch) return fail("Запуск уже начат — дождитесь окончания или продолжите его", 409);
  const accounts = await accountsFor(user.id);
  if (!accounts.length) return fail("Подключите хотя бы один рекламный кабинет");
  const over = await useQuota("copy", user);
  if (over) return fail(over, 429);
  // Демо — только шаблонные объявления: модель не вызываем (дедлайн в прошлом — сразу шаблоны)
  const demo = isDemoEmail(user.email);
  // Модели — не дольше, чем позволяет лимит функции (60 с): не успела — шаблонные объявления
  const plan = await prepareCopy(business, accounts, { deadline: demo ? 1 : started + 45_000 });
  // Сохраняем, только если запуск за это время не начался (иначе он потерял бы свой ход)
  await replacePlan(business.id, plan);
  // Старый черновик заменён — его картинки больше не нужны. Чистим после сохранения: упади оно — старые картинки целы
  const gc = await collectGarbageImages({ ignorePlanOf: business.id, minAgeMin: 15 }).catch((e) => String(e));
  console.log("image gc", JSON.stringify(gc));
  return json({ plan });
});

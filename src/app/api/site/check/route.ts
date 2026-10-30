import { route, json, fail, needBusiness } from "@/lib/api";
import { hit } from "@/lib/ratelimit";
import { checkSiteInstall, siteTrackingStatus } from "@/lib/engine/site-tracking";

export const maxDuration = 30;

/**
 * «Проверить установку»: сервер открывает сайт владельца (безопасный загрузчик, без внутренних адресов) и ищет код
 * Самохода с ключом этого бизнеса и код счётчика; заодно проверяет цели Самохода в счётчике (с согласия владельца).
 */
export const POST = route(async ({ user, business }) => {
  needBusiness(business);
  if (!business.siteUrl) return fail("Сайт не указан — добавьте ссылку на сайт в описании бизнеса");
  if (!(await hit(`site:check:${business.id}`, 12, 600)).ok) return fail("Слишком много проверок подряд — попробуйте через несколько минут", 429);
  const check = await checkSiteInstall(business, user.id);
  return json({ check, status: await siteTrackingStatus(business.id) });
});

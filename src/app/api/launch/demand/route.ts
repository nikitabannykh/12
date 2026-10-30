import { route, json, needBusiness } from "@/lib/api";
import { accountsFor } from "@/lib/engine/launch";
import { demandState } from "@/lib/engine/demand";

/**
 * Спрос по Wordstat для блока «Бюджет»: GET — состояние сбора; POST — продвинуть сбор (не дольше ~40 с; функция живёт 60 с)
 * и вернуть состояние. Мастер запуска вызывает POST, пока status === "running" (отчёты Директа v4 готовятся до минуты).
 * Ответ: { status, source, city, cityIn, regionIds, medical, progress, summary: { total, raw, groups } | null, note }.
 */
export const maxDuration = 60;

export const GET = route(async ({ user, business }) => {
  needBusiness(business);
  return json(await demandState(business, await accountsFor(user.id)));
});

export const POST = route(async ({ user, business }) => {
  const started = Date.now();
  needBusiness(business);
  return json(await demandState(business, await accountsFor(user.id), { advance: true, deadline: started + 40_000 }));
});

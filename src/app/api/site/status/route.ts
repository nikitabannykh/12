import { route, json, needBusiness } from "@/lib/api";
import { siteTrackingStatus } from "@/lib/engine/site-tracking";

/** Состояние подключения сайта: сигнал от кода, последнее событие, последняя проверка (для опроса из настроек) */
export const GET = route(async ({ business }) => {
  needBusiness(business);
  return json({ status: await siteTrackingStatus(business.id) });
});

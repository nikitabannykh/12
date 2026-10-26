import { route, json, needBusiness } from "@/lib/api";
import { runBusiness } from "@/lib/engine/run";

export const maxDuration = 60;

/** «Проверить сейчас»: синхронизация и проход оптимизатора по требованию владельца */
export const POST = route(async ({ business }) => {
  needBusiness(business);
  const r = await runBusiness(business.id);
  return json(r);
});

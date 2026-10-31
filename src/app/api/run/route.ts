import { route, json, fail, needBusiness } from "@/lib/api";
import { runBusiness } from "@/lib/engine/run";
import { hit } from "@/lib/ratelimit";

export const maxDuration = 60;

/** «Проверить сейчас»: синхронизация и проход оптимизатора по требованию владельца */
export const POST = route(async ({ business }) => {
  needBusiness(business);
  // Каждый проход — десятки запросов к API площадок (у Директа суточные баллы). Чаще 6 раз за 10 минут не нужно
  const { ok } = await hit(`run:${business.id}`, 6, 600);
  if (!ok) return fail("Проверка уже запускалась несколько раз подряд. Подождите пару минут — робот и так проверяет рекламу сам.", 429);
  const r = await runBusiness(business.id);
  return json(r);
});

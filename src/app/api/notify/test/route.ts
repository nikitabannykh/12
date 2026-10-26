import { route, json, fail, needBusiness } from "@/lib/api";
import { esc, sendToBusiness } from "@/lib/notify";
import { hit } from "@/lib/ratelimit";

/** Пробное сообщение — проверить, что уведомления доходят */
export const POST = route(async ({ business }) => {
  needBusiness(business);
  if (!(await hit(`notify-test:${business.id}`, 5, 600)).ok) return fail("Слишком много проверок подряд. Попробуйте через 10 минут.", 429);
  const r = await sendToBusiness(business.id, `<b>Проверка</b> · ${esc(business.name)}\n\nУведомления работают: так будут выглядеть новые заявки.`);
  if (!r.ok) return fail(r.error || "Сообщение не отправилось");
  return json({ ok: true });
});

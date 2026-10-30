import { route, json, fail, needBusiness } from "@/lib/api";
import { linkUrl, tgConfigured, tgErrorText } from "@/lib/notify";
import { hit } from "@/lib/ratelimit";
import { emailGate } from "@/lib/auth";

/** Ссылка на бота с одноразовым кодом привязки (действует 15 минут, в боте нужно подтвердить подключение) */
export const POST = route(async ({ user, business }) => {
  needBusiness(business);
  // Заявки клиентов — только в Telegram владельца с подтверждённой почтой (если почта на сервере настроена)
  const gate = await emailGate(user);
  if (gate) return fail(gate, 403);
  if (!tgConfigured()) return fail("Telegram-уведомления не настроены на сервере: нет TELEGRAM_BOT_TOKEN", 503);
  if (!(await hit(`notify-link:${business.id}`, 10, 600)).ok) return fail("Слишком много попыток подряд. Попробуйте через 10 минут.", 429);
  try {
    const url = await linkUrl(business.id);
    if (!url) return fail("Не удалось узнать имя бота. Проверьте TELEGRAM_BOT_TOKEN.", 502);
    return json({ url });
  } catch (e) {
    return fail(tgErrorText(e), 502);
  }
});

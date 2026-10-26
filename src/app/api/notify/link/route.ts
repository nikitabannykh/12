import { route, json, fail, needBusiness } from "@/lib/api";
import { linkUrl, tgConfigured } from "@/lib/notify";
import { errorText } from "@/lib/util";

/** Ссылка на бота с подписанным кодом привязки (действует час) */
export const POST = route(async ({ business }) => {
  needBusiness(business);
  if (!tgConfigured()) return fail("Telegram-уведомления не настроены на сервере: нет TELEGRAM_BOT_TOKEN");
  try {
    const url = await linkUrl(business.id);
    if (!url) return fail("Не удалось узнать имя бота. Проверьте TELEGRAM_BOT_TOKEN.", 502);
    return json({ url });
  } catch (e) {
    return fail(`Telegram не ответил: ${errorText(e)}`, 502);
  }
});

import { route, json, fail } from "@/lib/api";
import { extractFromSite } from "@/lib/ai/copy";
import { aiConfigured } from "@/lib/ai/yandex";
import { normalizeUrl } from "@/lib/util";

export const maxDuration = 60;

function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(br|p|div|li|h\d|tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/** Заполняем описание бизнеса по сайту владельца */
export const POST = route(async ({ req }) => {
  const { url, niche, city } = await req.json();
  const href = normalizeUrl(url);
  if (!href) return fail("Укажите адрес сайта");
  if (!aiConfigured()) return fail("Автозаполнение по сайту работает, когда подключён YandexGPT. Заполните поля вручную — это займёт пару минут.");
  let html = "";
  try {
    const res = await fetch(href, { headers: { "User-Agent": "Mozilla/5.0 (compatible; PolnyZalBot/1.0)" }, signal: AbortSignal.timeout(12000) });
    html = await res.text();
  } catch {
    return fail("Не получилось открыть сайт. Проверьте адрес или заполните поля вручную.");
  }
  const text = htmlToText(html);
  if (text.length < 80) return fail("На странице почти нет текста — заполните поля вручную.");
  const data = await extractFromSite(text, { niche, city });
  return json(data ?? {});
});

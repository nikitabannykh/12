import { after } from "next/server";
import { json, fail, publicRoute } from "@/lib/api";
import { emailKey, emailProblem, findUserByEmail, magicToken, magicUrl, MSG, normEmail } from "@/lib/account";
import { devMail, magicMail, mailConfigured, sendMail } from "@/lib/mail";
import { ipKey, within } from "@/lib/ratelimit";

/**
 * «Войти по ссылке на почту». Работает и для новой почты — аккаунт создастся при входе по ссылке.
 * Ответ одинаковый для любых адресов, письмо уходит после ответа.
 */
export const POST = publicRoute(async (req) => {
  if (!mailConfigured()) return fail("Вход по ссылке пока не настроен — войдите по паролю.", 503);
  const body = await req.json();
  const email = normEmail(body?.email);
  const problem = emailProblem(email);
  if (problem) return fail(problem);
  const ok = await within([
    { key: ipKey("magic", req), limit: 10, windowSec: 900 },
    { key: emailKey("magic", email), limit: 5, windowSec: 3600 },
  ]);
  if (!ok) return fail(MSG.tooMany, 429);
  const user = await findUserByEmail(email);
  const url = magicUrl(magicToken(email, user));
  after(() => sendMail(magicMail(email, url)).catch((e) => {
    console.error("[mail] ссылка для входа:", e);
    if (devMail()) console.log(`[mail:dev] Ссылка для входа ${email}: ${url}`);
  }));
  return json({ ok: true, message: `Отправили ссылку для входа на ${email}. Она действует 15 минут. Не пришло — проверьте «Спам».` });
});

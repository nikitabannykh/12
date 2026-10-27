import { after } from "next/server";
import { json, fail, publicRoute } from "@/lib/api";
import { isDemoEmail } from "@/lib/auth";
import { emailKey, emailProblem, findUserByEmail, MSG, normEmail, resetToken, resetUrl } from "@/lib/account";
import { devMail, mailConfigured, resetMail, sendMail } from "@/lib/mail";
import { ipKey, within } from "@/lib/ratelimit";

/**
 * Запрос ссылки для сброса пароля. Ответ одинаковый, есть такой адрес или нет;
 * письмо отправляется после ответа — по времени ответа тоже ничего не понять.
 */
export const POST = publicRoute(async (req) => {
  const body = await req.json();
  const email = normEmail(body?.email);
  const problem = emailProblem(email);
  if (problem) return fail(problem);
  const ok = await within([
    { key: ipKey("reset", req), limit: 10, windowSec: 900 },
    { key: emailKey("reset", email), limit: 5, windowSec: 3600 },
  ]);
  if (!ok) return fail(MSG.tooMany, 429);
  const configured = mailConfigured();
  if (!configured && !devMail()) return fail(MSG.mailOff, 503);
  const user = isDemoEmail(email) ? null : await findUserByEmail(email);
  if (user) {
    const url = resetUrl(resetToken(user));
    if (configured) after(() => sendMail(resetMail(email, url)).catch((e) => console.error("[mail] письмо сброса пароля:", e)));
    else console.log(`[mail:dev] SMTP не настроен. Ссылка для сброса пароля ${email}: ${url}`);
  }
  if (!configured) return fail(MSG.mailOff, 503);
  return json({ ok: true, message: MSG.resetSent });
});

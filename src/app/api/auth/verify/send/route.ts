import { json, fail, route } from "@/lib/api";
import { findUserById, verifyToken, verifyUrl } from "@/lib/account";
import { mailConfigured, sendMail, welcomeMail } from "@/lib/mail";
import { within } from "@/lib/ratelimit";

/** Отправить письмо с подтверждением почты ещё раз (из «Настроек → Аккаунт») */
export const POST = route(async ({ user }) => {
  if (!mailConfigured()) return fail("Отправка писем пока не настроена", 503);
  const u = await findUserById(user.id);
  if (!u || u.emailVerifiedAt) return json({ ok: true, message: "Почта уже подтверждена" });
  if (!(await within([{ key: `verify-send:${u.id}`, limit: 3, windowSec: 3600 }]))) return fail("Письмо уже отправлено — подождите час или проверьте «Спам»", 429);
  await sendMail(welcomeMail(u.email, verifyUrl(verifyToken(u))));
  return json({ ok: true, message: `Отправили письмо на ${u.email}` });
});

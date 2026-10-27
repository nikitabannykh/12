import { json, fail, publicRoute } from "@/lib/api";
import { googleConfigured, isDemoEmail, startSession } from "@/lib/auth";
import { emailKey, findUserByEmail, MSG, normEmail } from "@/lib/account";
import { burnPasswordCheck, PASSWORD_MAX, verifyPassword } from "@/lib/password";
import { ipKey, within } from "@/lib/ratelimit";

/** Вход по почте и паролю. Ответ на неверную почту и неверный пароль одинаковый */
export const POST = publicRoute(async (req) => {
  const body = await req.json();
  const email = normEmail(body?.email);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) return fail("Введите почту и пароль");
  if (password.length > PASSWORD_MAX || email.length > 254) return fail(MSG.badLogin, 401);
  // 10 попыток за 15 минут с одного IP и на одну почту (подбор пароля)
  const ok = await within([
    { key: ipKey("login", req), limit: 10, windowSec: 900 },
    { key: emailKey("login", email), limit: 10, windowSec: 900 },
  ]);
  if (!ok) return fail(MSG.tooMany, 429);
  const user = isDemoEmail(email) ? null : await findUserByEmail(email);
  if (!user) {
    await burnPasswordCheck(password);
    return fail(MSG.badLogin, 401);
  }
  if (!user.passwordHash) {
    await burnPasswordCheck(password);
    return json({ error: googleConfigured() ? MSG.noPassword : MSG.noPasswordNoGoogle, code: "no_password" }, 409);
  }
  if (!(await verifyPassword(password, user.passwordHash))) return fail(MSG.badLogin, 401);
  await startSession(user);
  return json({ ok: true, redirect: "/app" });
});

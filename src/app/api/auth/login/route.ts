import { and, eq, gt } from "drizzle-orm";
import { json, fail, publicRoute } from "@/lib/api";
import { googleConfigured, isDemoEmail, startSession } from "@/lib/auth";
import { emailKey, findUserByEmail, MSG, normEmail } from "@/lib/account";
import { fingerprint } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { burnPasswordCheck, PASSWORD_MAX, verifyPassword } from "@/lib/password";
import { clientIp, hit, ipKey, within } from "@/lib/ratelimit";

const WINDOW = 900;
/** Неудачные попытки: на почту с одного IP — строго, на почту вообще — мягче (иначе чужой перебор запирал бы владельца) */
const FAIL_EMAIL_IP = 10;
const FAIL_EMAIL = 50;

/**
 * Один ответ на любую неудачу — неверная почта, неверный пароль или аккаунт без пароля (Google / вход по ссылке):
 * по нему нельзя узнать, зарегистрирован ли адрес.
 */
const badLogin = () =>
  json(
    {
      error: googleConfigured()
        ? `${MSG.badLogin}. Если вы входили через Google или по ссылке из письма — войдите так же.`
        : `${MSG.badLogin}. Если вы входили по ссылке из письма — войдите так же.`,
      code: "bad_login",
    },
    401,
  );

/** Счётчик достиг лимита (не увеличивая его) */
async function reached(key: string, limit: number) {
  const db = await getDb();
  const [row] = await db
    .select({ count: schema.rateLimits.count })
    .from(schema.rateLimits)
    .where(and(eq(schema.rateLimits.key, key), gt(schema.rateLimits.resetAt, new Date())));
  return Number(row?.count ?? 0) >= limit;
}

/** Вход по почте и паролю */
export const POST = publicRoute(async (req) => {
  const body = await req.json();
  const email = normEmail(body?.email);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) return fail("Введите почту и пароль");
  if (password.length > PASSWORD_MAX || email.length > 254) return badLogin();
  // С одного IP — 10 попыток за 15 минут (любых); на почту считаем только неудачные
  if (!(await within([{ key: ipKey("login", req), limit: 10, windowSec: WINDOW }]))) return fail(MSG.tooMany, 429);
  const ip = clientIp(req);
  const failEmailIp = ip ? `login-fail:email-ip:${fingerprint(email + "|" + ip)}` : null;
  const failEmail = emailKey("login-fail", email);
  if ((failEmailIp && (await reached(failEmailIp, FAIL_EMAIL_IP))) || (await reached(failEmail, FAIL_EMAIL))) return fail(MSG.tooMany, 429);
  const failed = async () => {
    if (failEmailIp) await hit(failEmailIp, FAIL_EMAIL_IP, WINDOW);
    await hit(failEmail, FAIL_EMAIL, WINDOW);
    return badLogin();
  };
  const user = isDemoEmail(email) ? null : await findUserByEmail(email);
  if (!user?.passwordHash) {
    await burnPasswordCheck(password);
    return failed();
  }
  if (!(await verifyPassword(password, user.passwordHash))) return failed();
  await startSession(user);
  return json({ ok: true, redirect: "/app" });
});

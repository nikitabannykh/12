import { eq } from "drizzle-orm";
import { after } from "next/server";
import { json, fail, route } from "@/lib/api";
import { isDemoEmail, startSession } from "@/lib/auth";
import { findUserById } from "@/lib/account";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/password";
import { mailConfigured, passwordChangedMail, sendMail } from "@/lib/mail";
import { within } from "@/lib/ratelimit";
import { getDb, schema } from "@/lib/db";

/**
 * Сменить пароль (нужен текущий) или задать его впервые — для аккаунтов, созданных через Google или по ссылке.
 * Остальные устройства выходят из аккаунта, это — остаётся в нём.
 */
export const POST = route(async ({ user, req }) => {
  if (isDemoEmail(user.email)) return fail("В демо-аккаунте пароль не задаётся");
  const body = await req.json();
  const problem = passwordProblem(body?.password);
  if (problem) return fail(problem);
  if (!(await within([{ key: `password:${user.id}`, limit: 10, windowSec: 900 }]))) return fail("Слишком много попыток. Подождите 15 минут.", 429);
  const u = await findUserById(user.id);
  if (!u) return fail("Нужно войти", 401);
  if (u.passwordHash) {
    const current = typeof body?.current === "string" ? body.current : "";
    if (!current) return fail("Введите текущий пароль");
    if (!(await verifyPassword(current, u.passwordHash))) return fail("Текущий пароль неверный", 400);
  }
  const db = await getDb();
  const [updated] = await db
    .update(schema.users)
    .set({ passwordHash: await hashPassword(body.password), sessionVersion: u.sessionVersion + 1 })
    .where(eq(schema.users.id, u.id))
    .returning();
  await startSession(updated);
  if (mailConfigured()) after(() => sendMail(passwordChangedMail(u.email)).catch((e) => console.error("[mail] уведомление о смене пароля:", e)));
  return json({ ok: true, message: u.passwordHash ? "Пароль изменён. Другие устройства вышли из аккаунта." : "Пароль задан — теперь можно входить по почте и паролю" });
});

import { eq } from "drizzle-orm";
import { after } from "next/server";
import { json, fail, publicRoute } from "@/lib/api";
import { resetUnverifiedLinks, startSession } from "@/lib/auth";
import { checkResetToken, consumeToken, MSG } from "@/lib/account";
import { hashPassword, passwordProblem } from "@/lib/password";
import { mailConfigured, passwordChangedMail, sendMail } from "@/lib/mail";
import { getDb, schema } from "@/lib/db";

/** Новый пароль по ссылке из письма. Все прежние сессии перестают действовать, текущая — входит */
export const POST = publicRoute(async (req) => {
  const body = await req.json();
  const problem = passwordProblem(body?.password);
  if (problem) return fail(problem);
  const checked = await checkResetToken(body?.token);
  if (!checked || !(await consumeToken(checked.token))) return fail(MSG.linkExpired, 410);
  const { user } = checked;
  const db = await getDb();
  const [updated] = await db
    .update(schema.users)
    .set({
      passwordHash: await hashPassword(body.password),
      sessionVersion: user.sessionVersion + 1,
      // Ссылка пришла на эту почту — значит, адрес подтверждён
      emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
    })
    .where(eq(schema.users.id, user.id))
    .returning();
  // Владелец почты забирает аккаунт, пароль к которому задали до подтверждения: отвязываем Telegram и кабинеты захватчика
  if (!user.emailVerifiedAt && user.passwordHash) await resetUnverifiedLinks(user.id);
  await startSession(updated);
  if (mailConfigured()) after(() => sendMail(passwordChangedMail(user.email)).catch((e) => console.error("[mail] уведомление о смене пароля:", e)));
  return json({ ok: true, redirect: "/app" });
});

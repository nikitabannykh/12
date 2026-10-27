import { after } from "next/server";
import { json, fail, publicRoute } from "@/lib/api";
import { googleConfigured, startSession } from "@/lib/auth";
import { emailKey, emailProblem, findUserByEmail, MSG, normEmail, verifyToken, verifyUrl } from "@/lib/account";
import { hashPassword, passwordProblem } from "@/lib/password";
import { mailConfigured, sendMail, welcomeMail } from "@/lib/mail";
import { ipKey, within } from "@/lib/ratelimit";
import { getDb, schema } from "@/lib/db";
import { uid } from "@/lib/util";

/** Регистрация по почте и паролю. Подтверждение почты необязательно — войти можно сразу */
export const POST = publicRoute(async (req) => {
  const body = await req.json();
  const email = normEmail(body?.email);
  const password = body?.password;
  const problem = emailProblem(email) ?? passwordProblem(password);
  if (problem) return fail(problem);
  const ok = await within([
    { key: ipKey("signup", req), limit: 10, windowSec: 900 },
    { key: emailKey("signup", email), limit: 10, windowSec: 900 },
  ]);
  if (!ok) return fail(MSG.tooMany, 429);
  const existing = await findUserByEmail(email);
  if (existing) {
    if (!existing.passwordHash) return json({ error: googleConfigured() ? MSG.noPassword : MSG.noPasswordNoGoogle, code: "no_password" }, 409);
    return json({ error: MSG.exists, code: "exists" }, 409);
  }
  const passwordHash = await hashPassword(password as string);
  const db = await getDb();
  const rows = await db
    .insert(schema.users)
    .values({ id: uid("u_"), email, passwordHash })
    .onConflictDoNothing()
    .returning();
  const user = rows[0];
  if (!user) return json({ error: MSG.exists, code: "exists" }, 409); // одновременная регистрация на ту же почту
  await startSession(user);
  if (mailConfigured()) {
    // Письмо уходит после ответа: регистрация не ждёт SMTP и не падает, если он недоступен
    after(() => sendMail(welcomeMail(email, verifyUrl(verifyToken(user)))).catch((e) => console.error("[mail] приветственное письмо:", e)));
  }
  return json({ ok: true, redirect: "/app/start" });
});

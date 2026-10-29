import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { consumeToken, findUserById, readVerifyToken } from "@/lib/account";
import { sameOrigin } from "@/lib/api";
import { createSession, getUser } from "@/lib/auth";
import { secretError } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { appUrl } from "@/lib/util";

/**
 * Подтверждение почты из приветственного письма. Повторный переход безвреден, поэтому GET.
 * Если у неподтверждённого аккаунта уже есть пароль, а ссылку открыл не тот, кто сейчас в нём (по cookie, например
 * с телефона), — пароль мог задать кто-то другой, зарегистрировавшись на чужую почту. Тогда спрашиваем на странице
 * /verify: «это я регистрировался» (подтверждаем, пароль остаётся) или «я не регистрировался» (стираем чужой пароль
 * и старые сессии, владелец почты входит). Решение — только кнопкой (POST): почтовые сканеры открывают ссылки сами.
 */
async function markVerified(id: string, email: string) {
  const db = await getDb();
  await db
    .update(schema.users)
    .set({ emailVerifiedAt: new Date() })
    .where(and(eq(schema.users.id, id), eq(schema.users.email, email), isNull(schema.users.emailVerifiedAt)));
}

async function load(token: unknown) {
  const t = readVerifyToken(token);
  if (!t) return null;
  const u = await findUserById(t.u);
  if (!u || u.email !== t.e) return null;
  return { t, u };
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("token");
  const found = await load(raw);
  if (!found) return NextResponse.redirect(`${appUrl()}/login?error=link`);
  const { t, u } = found;
  if (!u.emailVerifiedAt && u.passwordHash) {
    const me = await getUser();
    if (me?.id !== u.id) return NextResponse.redirect(`${appUrl()}/verify?token=${encodeURIComponent(raw ?? "")}`);
  }
  await markVerified(t.u, t.e);
  return NextResponse.redirect(`${appUrl()}/app/settings?verified=1`);
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.redirect(`${appUrl()}/login?error=origin`, 303);
  if (secretError()) return NextResponse.redirect(`${appUrl()}/login?error=secret`, 303);
  const form = await req.formData().catch(() => null);
  const raw = form?.get("token");
  const found = await load(raw);
  if (!found || typeof raw !== "string") return NextResponse.redirect(`${appUrl()}/login?error=link`, 303);
  const { t, u } = found;
  if (u.emailVerifiedAt) return NextResponse.redirect(`${appUrl()}/login?verified=1`, 303);
  if (form?.get("action") === "notme") {
    // Одноразово: эта кнопка входит в аккаунт, поэтому ссылку после неё больше не принимаем
    if (!(await consumeToken({ n: "verify:" + raw, exp: t.exp }))) return NextResponse.redirect(`${appUrl()}/login?error=link`, 303);
    // createSession с verified стирает пароль, заданный до подтверждения, и завершает все прежние сессии
    await createSession({ email: u.email, verified: true });
    return NextResponse.redirect(`${appUrl()}/app/settings?verified=1`, 303);
  }
  await markVerified(t.u, t.e);
  return NextResponse.redirect(`${appUrl()}/login?verified=1`, 303);
}

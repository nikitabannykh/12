import { NextResponse } from "next/server";
import { sameOrigin } from "@/lib/api";
import { createSession } from "@/lib/auth";
import { checkMagicToken, consumeToken } from "@/lib/account";
import { secretError } from "@/lib/crypto";
import { appUrl } from "@/lib/util";

/**
 * Вход по ссылке из письма. Ссылка ведёт на страницу с кнопкой «Войти» (/login/link/…), а вход — только по POST:
 * почтовые сканеры открывают ссылки из писем сами и иначе «сжигали» бы одноразовую ссылку.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.redirect(`${appUrl()}/login?error=origin`, 303);
  if (secretError()) return NextResponse.redirect(`${appUrl()}/login?error=secret`, 303);
  const form = await req.formData().catch(() => null);
  const checked = await checkMagicToken(form?.get("token"));
  if (!checked || !(await consumeToken(checked.token))) return NextResponse.redirect(`${appUrl()}/login?error=link`, 303);
  // Владелец почты подтвердил её, перейдя по ссылке: новый аккаунт создаётся, у существующего почта отмечается подтверждённой
  await createSession({ email: checked.token.e, verified: true });
  return NextResponse.redirect(`${appUrl()}${checked.user ? "/app" : "/app/start"}`, 303);
}

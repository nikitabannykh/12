import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { appUrl } from "@/lib/util";
import { cookieOptions, yandexLoginConfigured, yandexLoginId } from "@/lib/auth";

/** Вход и регистрация через Яндекс ID (oauth.yandex.ru, права login:email и login:info) */
export async function GET() {
  if (!yandexLoginConfigured()) return NextResponse.redirect(`${appUrl()}/login?error=yandex_not_configured`);
  const state = randomBytes(16).toString("base64url");
  (await cookies()).set("pz_oauth_state", state, cookieOptions(600));
  const params = new URLSearchParams({
    response_type: "code",
    client_id: yandexLoginId(),
    redirect_uri: `${appUrl()}/api/auth/yandex/callback`,
    scope: "login:email login:info",
    state,
    force_confirm: "no",
  });
  return NextResponse.redirect(`https://oauth.yandex.ru/authorize?${params}`);
}

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { appUrl } from "@/lib/util";
import { cookieOptions, emailGate, getUser } from "@/lib/auth";
import { safeBack, withQuery } from "@/lib/api";
import { yandexAuthUrl, yandexConfigured } from "@/lib/platforms/yandex";

export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(`${appUrl()}/login`);
  const back = safeBack(new URL(req.url).searchParams.get("back"));
  const gate = await emailGate(user);
  if (gate) return NextResponse.redirect(`${appUrl()}${withQuery(back, `error=${encodeURIComponent(gate)}`)}`);
  if (!yandexConfigured()) return NextResponse.redirect(`${appUrl()}${withQuery(back, `error=${encodeURIComponent("Подключение Яндекса не настроено на сервере: нет YANDEX_CLIENT_ID")}`)}`);
  const state = randomBytes(16).toString("base64url");
  (await cookies()).set("pz_ya_state", JSON.stringify({ state, back }), cookieOptions(900));
  return NextResponse.redirect(yandexAuthUrl(state, `${appUrl()}/api/connect/yandex/callback`));
}

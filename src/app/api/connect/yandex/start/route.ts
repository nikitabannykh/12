import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { appUrl } from "@/lib/util";
import { getUser } from "@/lib/auth";
import { yandexAuthUrl, yandexConfigured } from "@/lib/platforms/yandex";

export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(`${appUrl()}/login`);
  const back = new URL(req.url).searchParams.get("back") || "/app/settings";
  if (!yandexConfigured()) return NextResponse.redirect(`${appUrl()}${back}?error=${encodeURIComponent("Подключение Яндекса не настроено на сервере: нет YANDEX_CLIENT_ID")}`);
  const state = randomBytes(16).toString("base64url");
  (await cookies()).set("pz_ya_state", JSON.stringify({ state, back }), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 900, secure: process.env.NODE_ENV === "production" });
  return NextResponse.redirect(yandexAuthUrl(state, `${appUrl()}/api/connect/yandex/callback`));
}

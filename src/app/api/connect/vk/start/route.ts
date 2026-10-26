import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { appUrl } from "@/lib/util";
import { getUser } from "@/lib/auth";
import { vkAuthUrl, vkConfigured } from "@/lib/platforms/vk";

export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(`${appUrl()}/login`);
  const back = new URL(req.url).searchParams.get("back") || "/app/settings";
  if (!vkConfigured()) return NextResponse.redirect(`${appUrl()}${back}?error=${encodeURIComponent("Подключение VK Рекламы не настроено на сервере: нет VK_ADS_CLIENT_ID")}`);
  const state = randomBytes(16).toString("base64url");
  (await cookies()).set("pz_vk_state", JSON.stringify({ state, back }), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 900, secure: process.env.NODE_ENV === "production" });
  return NextResponse.redirect(vkAuthUrl(state, `${appUrl()}/api/connect/vk/callback`));
}

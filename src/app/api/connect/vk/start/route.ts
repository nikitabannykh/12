import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { appUrl } from "@/lib/util";
import { cookieOptions, emailGate, getUser } from "@/lib/auth";
import { safeBack, withQuery } from "@/lib/api";
import { vkAuthUrl, vkConfigured } from "@/lib/platforms/vk";

export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(`${appUrl()}/login`);
  const back = safeBack(new URL(req.url).searchParams.get("back"));
  const gate = await emailGate(user);
  if (gate) return NextResponse.redirect(`${appUrl()}${withQuery(back, `error=${encodeURIComponent(gate)}`)}`);
  if (!vkConfigured()) return NextResponse.redirect(`${appUrl()}${withQuery(back, `error=${encodeURIComponent("Подключение VK Рекламы не настроено на сервере: нет VK_ADS_CLIENT_ID")}`)}`);
  const state = randomBytes(16).toString("base64url");
  (await cookies()).set("pz_vk_state", JSON.stringify({ state, back }), cookieOptions(900));
  return NextResponse.redirect(vkAuthUrl(state, `${appUrl()}/api/connect/vk/callback`));
}

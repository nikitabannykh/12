import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { appUrl } from "@/lib/util";
import { createSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const jar = await cookies();
  const expected = jar.get("pz_oauth_state")?.value;
  jar.delete("pz_oauth_state");
  if (!code || !state || state !== expected) {
    return NextResponse.redirect(`${appUrl()}/login?error=state`);
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${appUrl()}/api/auth/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  const tok = await res.json();
  if (!res.ok || !tok.id_token) {
    return NextResponse.redirect(`${appUrl()}/login?error=google`);
  }
  // id_token получен напрямую от Google по TLS — подпись можно не перепроверять
  let payload: { aud?: string; iss?: string; exp?: number; email?: string; email_verified?: boolean; name?: string; picture?: string };
  try {
    payload = JSON.parse(Buffer.from(String(tok.id_token).split(".")[1], "base64url").toString("utf8"));
  } catch {
    return NextResponse.redirect(`${appUrl()}/login?error=google`);
  }
  // Токен должен быть выпущен Google именно для нашего приложения
  if (payload.aud !== process.env.GOOGLE_CLIENT_ID || !["https://accounts.google.com", "accounts.google.com"].includes(String(payload.iss))) {
    return NextResponse.redirect(`${appUrl()}/login?error=google`);
  }
  if (!payload.email || payload.email_verified !== true) {
    return NextResponse.redirect(`${appUrl()}/login?error=email`);
  }
  await createSession({ email: payload.email, name: payload.name, image: payload.picture });
  return NextResponse.redirect(`${appUrl()}/app`);
}

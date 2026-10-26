import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { appUrl } from "@/lib/util";
import { googleConfigured } from "@/lib/auth";

export async function GET() {
  if (!googleConfigured()) {
    return NextResponse.redirect(`${appUrl()}/login?error=google_not_configured`);
  }
  const state = randomBytes(16).toString("base64url");
  (await cookies()).set("pz_oauth_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600, secure: process.env.NODE_ENV === "production" });
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${appUrl()}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

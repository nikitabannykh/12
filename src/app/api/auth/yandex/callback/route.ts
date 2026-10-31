import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { appUrl } from "@/lib/util";
import { createSession, yandexLoginId, yandexLoginSecret } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const jar = await cookies();
  const expected = jar.get("pz_oauth_state")?.value;
  jar.delete("pz_oauth_state");
  if (!code || !state || state !== expected) return NextResponse.redirect(`${appUrl()}/login?error=state`);
  const res = await fetch("https://oauth.yandex.ru/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: yandexLoginId(), client_secret: yandexLoginSecret() }),
    signal: AbortSignal.timeout(15_000),
  });
  const tok = await res.json().catch(() => ({}));
  if (!res.ok || !tok.access_token) return NextResponse.redirect(`${appUrl()}/login?error=yandex`);
  // Профиль берём у Яндекса по токену, выданному нашему приложению; почта Яндекс ID подтверждена Яндексом
  const info = await fetch("https://login.yandex.ru/info?format=json", { headers: { Authorization: `OAuth ${tok.access_token}` }, signal: AbortSignal.timeout(15_000) })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null) as { default_email?: string; emails?: string[]; real_name?: string; display_name?: string; default_avatar_id?: string; is_avatar_empty?: boolean; client_id?: string } | null;
  const email = info?.default_email || info?.emails?.[0];
  if (!email) return NextResponse.redirect(`${appUrl()}/login?error=yandex_email`);
  await createSession({
    email,
    name: info?.real_name || info?.display_name || null,
    image: info?.default_avatar_id && !info.is_avatar_empty ? `https://avatars.yandex.net/get-yapic/${info.default_avatar_id}/islands-200` : null,
    verified: true,
  });
  return NextResponse.redirect(`${appUrl()}/app`);
}

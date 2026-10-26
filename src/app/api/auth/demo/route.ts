import { NextResponse } from "next/server";
import { appUrl, uid } from "@/lib/util";
import { createSession, demoAllowed } from "@/lib/auth";
import { sameOrigin } from "@/lib/api";
import { secretError } from "@/lib/crypto";
import { ipKey, within } from "@/lib/ratelimit";

/** Демо-вход: у каждого посетителя свой изолированный аккаунт */
export async function POST(req: Request) {
  if (!demoAllowed()) return NextResponse.redirect(`${appUrl()}/login`, 303);
  if (!sameOrigin(req)) return NextResponse.redirect(`${appUrl()}/login?error=origin`, 303);
  if (secretError()) return NextResponse.redirect(`${appUrl()}/login?error=secret`, 303);
  // Каждый демо-вход создаёт аккаунт в базе — ограничиваем, чтобы её нельзя было забить мусором
  if (!(await within([{ key: ipKey("demo", req), limit: 20, windowSec: 3600 }]))) {
    return NextResponse.redirect(`${appUrl()}/login?error=toomany`, 303);
  }
  await createSession({ email: `demo-${uid().toLowerCase()}@demo.polny-zal.local`, name: "Демо-владелец" });
  return NextResponse.redirect(`${appUrl()}/app`, 303);
}

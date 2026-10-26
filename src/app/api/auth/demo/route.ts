import { NextResponse } from "next/server";
import { appUrl, uid } from "@/lib/util";
import { createSession, demoAllowed } from "@/lib/auth";

/** Демо-вход: у каждого посетителя свой изолированный аккаунт */
export async function POST() {
  if (!demoAllowed()) return NextResponse.redirect(`${appUrl()}/login`, 303);
  await createSession({ email: `demo-${uid().toLowerCase()}@demo.polny-zal.local`, name: "Демо-владелец" });
  return NextResponse.redirect(`${appUrl()}/app`, 303);
}

import { NextResponse } from "next/server";
import { appUrl } from "@/lib/util";
import { destroySession } from "@/lib/auth";

export async function POST() {
  await destroySession();
  return NextResponse.redirect(`${appUrl()}/`, 303);
}

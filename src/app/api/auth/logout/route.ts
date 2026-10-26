import { NextResponse } from "next/server";
import { appUrl } from "@/lib/util";
import { destroySession } from "@/lib/auth";
import { sameOrigin } from "@/lib/api";

export async function POST(req: Request) {
  // Чужой сайт не может разлогинить владельца скрытой формой
  if (!sameOrigin(req)) return NextResponse.redirect(`${appUrl()}/app`, 303);
  await destroySession();
  return NextResponse.redirect(`${appUrl()}/`, 303);
}

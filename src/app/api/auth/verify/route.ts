import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { readVerifyToken } from "@/lib/account";
import { getDb, schema } from "@/lib/db";
import { appUrl } from "@/lib/util";

/** Подтверждение почты из приветственного письма. Повторный переход безвреден, поэтому GET */
export async function GET(req: NextRequest) {
  const t = readVerifyToken(req.nextUrl.searchParams.get("token"));
  if (!t) return NextResponse.redirect(`${appUrl()}/login?error=link`);
  const db = await getDb();
  await db
    .update(schema.users)
    .set({ emailVerifiedAt: new Date() })
    .where(and(eq(schema.users.id, t.u), eq(schema.users.email, t.e), isNull(schema.users.emailVerifiedAt)));
  return NextResponse.redirect(`${appUrl()}/app/settings?verified=1`);
}

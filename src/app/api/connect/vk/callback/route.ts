import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { appUrl, errorText, uid } from "@/lib/util";
import { getUser } from "@/lib/auth";
import { safeBack, withQuery } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { VkAds, vkToken } from "@/lib/platforms/vk";

export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(`${appUrl()}/login`);
  const jar = await cookies();
  let saved: { state?: string; back?: string } = {};
  try {
    saved = JSON.parse(jar.get("pz_vk_state")?.value || "{}");
  } catch {
    /* испорченная cookie — как будто её нет */
  }
  jar.delete("pz_vk_state");
  const back = safeBack(saved.back);
  const go = (q: string) => NextResponse.redirect(`${appUrl()}${withQuery(back, q)}`);

  const code = req.nextUrl.searchParams.get("code");
  if (!code || !saved.state || req.nextUrl.searchParams.get("state") !== saved.state) return go(`error=${encodeURIComponent("Подключение VK не завершено — попробуйте ещё раз")}`);
  try {
    const t = await vkToken({ grant_type: "authorization_code", code });
    let login = req.nextUrl.searchParams.get("user_id") ? `vk-${req.nextUrl.searchParams.get("user_id")}` : "VK Реклама";
    try {
      const u = await new VkAds({ accessToken: t.accessToken, refreshToken: t.refreshToken }).user();
      login = u.username || u.additional_info?.client_name || login;
    } catch {
      /* имя кабинета — не критично */
    }
    const db = await getDb();
    const [existing] = await db.select().from(schema.adAccounts).where(and(eq(schema.adAccounts.userId, user.id), eq(schema.adAccounts.platform, "vk"), eq(schema.adAccounts.login, login)));
    const values = {
      accessToken: encrypt(t.accessToken),
      refreshToken: t.refreshToken ? encrypt(t.refreshToken) : null,
      expiresAt: new Date(Date.now() + t.expiresIn * 1000),
      status: "ok",
      statusNote: null,
    };
    if (existing) await db.update(schema.adAccounts).set(values).where(eq(schema.adAccounts.id, existing.id));
    else await db.insert(schema.adAccounts).values({ id: uid("acc_"), userId: user.id, platform: "vk", login, ...values });
    return go("connected=vk");
  } catch (e) {
    return go(`error=${encodeURIComponent(errorText(e))}`);
  }
}

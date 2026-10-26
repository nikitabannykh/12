import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { appUrl, errorText, uid } from "@/lib/util";
import { getUser } from "@/lib/auth";
import { safeBack, withQuery } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { YandexDirect, yandexExchange, yandexLogin } from "@/lib/platforms/yandex";

export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(`${appUrl()}/login`);
  const jar = await cookies();
  let saved: { state?: string; back?: string } = {};
  try {
    saved = JSON.parse(jar.get("pz_ya_state")?.value || "{}");
  } catch {
    /* испорченная cookie — как будто её нет */
  }
  jar.delete("pz_ya_state");
  const back = safeBack(saved.back);
  const go = (q: string) => NextResponse.redirect(`${appUrl()}${withQuery(back, q)}`);

  const err = req.nextUrl.searchParams.get("error");
  if (err) return go(`error=${encodeURIComponent(err === "access_denied" ? "Вы отменили доступ к Яндексу" : `Яндекс не выдал доступ (${err.replace(/[^a-z_]/gi, "").slice(0, 40)}). Попробуйте ещё раз.`)}`);
  const code = req.nextUrl.searchParams.get("code");
  if (!code || !saved.state || req.nextUrl.searchParams.get("state") !== saved.state) return go(`error=${encodeURIComponent("Сессия подключения устарела — попробуйте ещё раз")}`);

  try {
    const t = await yandexExchange(code);
    const who = await yandexLogin(t.accessToken);
    // Проверяем, что у аккаунта есть доступ к Директу
    let note: string | null = null;
    try {
      await new YandexDirect(t.accessToken).clientInfo();
    } catch (e) {
      note = errorText(e);
    }
    const db = await getDb();
    const [existing] = await db.select().from(schema.adAccounts).where(and(eq(schema.adAccounts.userId, user.id), eq(schema.adAccounts.platform, "yandex"), eq(schema.adAccounts.login, who.login)));
    const values = {
      accessToken: encrypt(t.accessToken),
      refreshToken: t.refreshToken ? encrypt(t.refreshToken) : null,
      expiresAt: new Date(Date.now() + t.expiresIn * 1000),
      status: note ? "error" : "ok",
      statusNote: note,
      externalId: who.id,
    };
    if (existing) await db.update(schema.adAccounts).set(values).where(eq(schema.adAccounts.id, existing.id));
    else await db.insert(schema.adAccounts).values({ id: uid("acc_"), userId: user.id, platform: "yandex", login: who.login, ...values });
    if (note) return go(`error=${encodeURIComponent(`Аккаунт ${who.login} подключён, но Директ не отвечает: ${note}. Проверьте, что в аккаунте создан рекламный кабинет Директа и принята оферта.`)}`);
    return go(`connected=yandex`);
  } catch (e) {
    return go(`error=${encodeURIComponent(errorText(e))}`);
  }
}

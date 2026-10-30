import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { sign, verify } from "./crypto";
import { appUrl, uid } from "./util";
import { mailConfigured } from "./mail";

const COOKIE = "pz_session";
const MONTH = 30 * 24 * 3600 * 1000;

/** Флаги служебных cookie: недоступны из JS, только HTTPS (если сервис на HTTPS), не уходят с чужих POST */
export function cookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: appUrl().startsWith("https://") || (process.env.NODE_ENV === "production" && Boolean(process.env.VERCEL)),
    path: "/",
    maxAge: maxAgeSec,
  };
}

export type SessionUser = { id: string; email: string; name: string | null; image: string | null };

type UserRow = typeof schema.users.$inferSelect;

/** Выдать cookie сессии. sv — версия сессий пользователя: после смены пароля старые cookie не принимаются */
export async function startSession(user: { id: string; sessionVersion: number }) {
  const jar = await cookies();
  jar.set(COOKIE, sign({ uid: user.id, sv: user.sessionVersion, exp: Date.now() + MONTH }), cookieOptions(MONTH / 1000));
}

/**
 * Вход по подтверждённой почте (Google, ссылка из письма, демо): находит или создаёт пользователя.
 * verified — владение почтой подтверждено: тогда отмечаем почту, а пароль, заданный кем-то до подтверждения
 * (регистрация на чужой адрес), стираем вместе со старыми сессиями — иначе он остался бы «запасным ключом».
 * Заодно отвязываем то, что мог привязать захватчик до подтверждения: Telegram-чаты бизнесов (куда шли бы заявки)
 * и рекламные кабинеты (робот тратил бы через них деньги) — см. resetUnverifiedLinks. Анкеты и статистика остаются.
 */
export async function createSession(user: { email: string; name?: string | null; image?: string | null; verified?: boolean }) {
  const db = await getDb();
  const email = user.email.trim().toLowerCase();
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  let row: UserRow;
  if (!existing) {
    const id = uid("u_");
    [row] = await db
      .insert(schema.users)
      .values({ id, email, name: user.name ?? null, image: user.image ?? null, emailVerifiedAt: user.verified ? new Date() : null })
      .returning();
  } else {
    const set: Partial<UserRow> = {};
    if (user.name || user.image) Object.assign(set, { name: user.name ?? existing.name, image: user.image ?? existing.image });
    if (user.verified && !existing.emailVerifiedAt) {
      set.emailVerifiedAt = new Date();
      if (existing.passwordHash) Object.assign(set, { passwordHash: null, sessionVersion: existing.sessionVersion + 1 });
    }
    if (user.verified && !existing.emailVerifiedAt && existing.passwordHash) await resetUnverifiedLinks(existing.id);
    row = Object.keys(set).length ? (await db.update(schema.users).set(set).where(eq(schema.users.id, existing.id)).returning())[0] : existing;
  }
  await startSession(row);
  return row.id;
}

/**
 * Владелец подтвердил почту, а пароль к аккаунту задал кто-то до подтверждения. Всё, что тот мог привязать, отвязываем:
 *  - Telegram: chat_id в уведомлениях бизнесов и неиспользованные коды привязки (kv tg:link:*);
 *  - рекламные кабинеты: токены стираем, кабинет помечаем «переподключите» (status=error) — кампании и история остаются.
 */
export async function resetUnverifiedLinks(userId: string) {
  const db = await getDb();
  const own = await db.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.userId, userId));
  const ids = own.map((b) => b.id);
  if (ids.length) {
    await db.update(schema.notifySettings).set({ telegramChatId: null, telegramName: null, linkedAt: null, updatedAt: new Date() }).where(inArray(schema.notifySettings.businessId, ids));
    await db.delete(schema.kv).where(and(sql`${schema.kv.key} like 'tg:link:%'`, inArray(sql`${schema.kv.value}->>'businessId'`, ids)));
  }
  await db
    .update(schema.adAccounts)
    .set({
      accessToken: "",
      refreshToken: null,
      clientSecret: null,
      expiresAt: null,
      status: "error",
      statusNote: "Кабинет подключили до подтверждения почты — подключите его заново, чтобы робот продолжил работу.",
    })
    .where(and(eq(schema.adAccounts.userId, userId), sql`${schema.adAccounts.platform} <> 'demo'`));
}

/**
 * Пока почта не подтверждена, нельзя привязать Telegram и рекламные кабинеты (иначе зарегистрировавшийся на чужой адрес
 * получал бы заявки и управлял бы деньгами владельца). Действует, только если на сервере настроена почта (SMTP_URL):
 * без неё подтвердить адрес невозможно. Демо-аккаунты не ограничиваем. null — можно; иначе — текст отказа.
 */
export const VERIFY_FIRST = "Подтвердите почту — ссылка в письме. Не пришло — отправьте ещё раз в «Настройках».";
export async function emailGate(user: { id: string; email: string }): Promise<string | null> {
  if (!mailConfigured() || isDemoEmail(user.email)) return null;
  const db = await getDb();
  const [u] = await db.select({ v: schema.users.emailVerifiedAt }).from(schema.users).where(eq(schema.users.id, user.id));
  return u?.v ? null : VERIFY_FIRST;
}

export async function destroySession() {
  (await cookies()).set(COOKIE, "", { ...cookieOptions(0), maxAge: 0 });
}

export async function getUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  let data: { uid: string; sv?: number } | null = null;
  try {
    data = verify<{ uid: string; sv?: number }>(token);
  } catch (e) {
    // Не настроен APP_SECRET в проде: считаем, что не вошли; причину покажет страница входа
    if ((e as { code?: string })?.code === "PZ_SECRET") return null;
    throw e;
  }
  if (!data) return null;
  const db = await getDb();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, data.uid));
  // Cookie, выданные до появления версии сессий, считаются версией 0
  if (!u || (data.sv ?? 0) !== u.sessionVersion) return null;
  return { id: u.id, email: u.email, name: u.name, image: u.image };
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getUser();
  if (!u) redirect("/login");
  return u;
}

export const googleConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const demoAllowed = () => process.env.ALLOW_DEMO !== "false";
export const DEMO_DOMAIN = "demo.polny-zal.local";
export const isDemoEmail = (email: string) => email.endsWith("@" + DEMO_DOMAIN);

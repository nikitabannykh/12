import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "./db";
import { sign, verify } from "./crypto";
import { appUrl, uid } from "./util";

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

export async function createSession(user: { email: string; name?: string | null; image?: string | null }) {
  const db = await getDb();
  const email = user.email.toLowerCase();
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  let id = existing?.id;
  if (!existing) {
    id = uid("u_");
    await db.insert(schema.users).values({ id, email, name: user.name ?? null, image: user.image ?? null });
  } else if (user.name || user.image) {
    await db.update(schema.users).set({ name: user.name ?? existing.name, image: user.image ?? existing.image }).where(eq(schema.users.id, existing.id));
  }
  const jar = await cookies();
  jar.set(COOKIE, sign({ uid: id, exp: Date.now() + MONTH }), cookieOptions(MONTH / 1000));
  return id!;
}

export async function destroySession() {
  (await cookies()).set(COOKIE, "", { ...cookieOptions(0), maxAge: 0 });
}

export async function getUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  let data: { uid: string } | null = null;
  try {
    data = verify<{ uid: string }>(token);
  } catch (e) {
    // Не настроен APP_SECRET в проде: считаем, что не вошли; причину покажет страница входа
    if ((e as { code?: string })?.code === "PZ_SECRET") return null;
    throw e;
  }
  if (!data) return null;
  const db = await getDb();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, data.uid));
  return u ? { id: u.id, email: u.email, name: u.name, image: u.image } : null;
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getUser();
  if (!u) redirect("/login");
  return u;
}

export const googleConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const demoAllowed = () => process.env.ALLOW_DEMO !== "false";

import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, like, lt, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { fingerprint, mac, macEqual, sign, verify } from "./crypto";
import { isDemoEmail } from "./auth";
import { appUrl } from "./util";

/** Почта: обрезаем пробелы и приводим к нижнему регистру — так она и хранится в users.email */
export const normEmail = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");

/** Текст ошибки или null, если адрес подходит */
export function emailProblem(email: string): string | null {
  if (!email) return "Введите почту";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/.test(email)) return "Похоже, в адресе почты опечатка — проверьте его";
  if (isDemoEmail(email)) return "Этот адрес занят демо-режимом — укажите свою почту";
  return null;
}

export async function findUserByEmail(email: string) {
  const db = await getDb();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  return u ?? null;
}

export async function findUserById(id: string) {
  const db = await getDb();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  return u ?? null;
}

/** Ключ лимита по почте: саму почту в rate_limits не храним */
export const emailKey = (scope: string, email: string) => `${scope}:email:${fingerprint(email)}`;

// --- Подписанные ссылки из писем ---

/** Отпечаток текущего пароля: ссылка сброса перестаёт работать, как только пароль сменился */
export const passwordTag = (hash: string | null) => mac("pw:" + (hash ?? "none"), 16);

export type ResetToken = { p: "reset"; u: string; sv: number; ph: string; n: string; exp: number };
export type MagicToken = { p: "magic"; e: string; sv: number | null; n: string; exp: number };
export type VerifyToken = { p: "verify"; u: string; e: string; exp: number };

export const RESET_TTL = 3600e3;
export const MAGIC_TTL = 15 * 60e3;
const VERIFY_TTL = 7 * 864e5;
const nonce = () => randomBytes(12).toString("base64url");

export function resetToken(u: { id: string; sessionVersion: number; passwordHash: string | null }): string {
  return sign({ p: "reset", u: u.id, sv: u.sessionVersion, ph: passwordTag(u.passwordHash), n: nonce(), exp: Date.now() + RESET_TTL } satisfies ResetToken);
}
export function magicToken(email: string, u: { sessionVersion: number } | null): string {
  return sign({ p: "magic", e: email, sv: u ? u.sessionVersion : null, n: nonce(), exp: Date.now() + MAGIC_TTL } satisfies MagicToken);
}
export function verifyToken(u: { id: string; email: string }): string {
  return sign({ p: "verify", u: u.id, e: u.email, exp: Date.now() + VERIFY_TTL } satisfies VerifyToken);
}

const read = <T extends { p: string }>(token: unknown, p: T["p"]): T | null => {
  const v = typeof token === "string" && token.length < 1000 ? verify<T>(token) : null;
  return v && v.p === p ? v : null;
};

/** Ссылка сброса действительна: подпись, срок, пользователь, версия сессий и пароль не менялись, не использована */
export async function checkResetToken(token: unknown) {
  const t = read<ResetToken>(token, "reset");
  if (!t || typeof t.n !== "string") return null;
  const u = await findUserById(t.u);
  if (!u || u.sessionVersion !== t.sv || !macEqual(passwordTag(u.passwordHash), t.ph)) return null;
  if (await tokenUsed(t.n)) return null;
  return { token: t, user: u };
}

export async function checkMagicToken(token: unknown) {
  const t = read<MagicToken>(token, "magic");
  if (!t || typeof t.n !== "string" || typeof t.e !== "string") return null;
  const u = await findUserByEmail(t.e);
  // Ссылка выдана существующему аккаунту — после смены пароля (новая версия сессий) она не действует
  if (t.sv !== null && (!u || u.sessionVersion !== t.sv)) return null;
  if (await tokenUsed(t.n)) return null;
  return { token: t, user: u };
}

export const readVerifyToken = (token: unknown) => read<VerifyToken>(token, "verify");

// --- Одноразовость: отпечаток использованного nonce лежит в kv до истечения срока ссылки ---

const usedKey = (n: string) => "auth:used:" + createHash("sha256").update(n).digest("base64url");

async function tokenUsed(n: string): Promise<boolean> {
  const db = await getDb();
  const [row] = await db.select({ key: schema.kv.key }).from(schema.kv).where(eq(schema.kv.key, usedKey(n)));
  return Boolean(row);
}

/** Погасить ссылку: true — если ею ещё не пользовались. Атомарно (INSERT … ON CONFLICT DO NOTHING) */
export async function consumeToken(t: { n: string; exp: number }): Promise<boolean> {
  const db = await getDb();
  const rows = await db.insert(schema.kv).values({ key: usedKey(t.n), value: { exp: t.exp } }).onConflictDoNothing().returning({ key: schema.kv.key });
  // Изредка подчищаем отметки о ссылках, срок которых уже истёк
  if (Math.random() < 0.05) {
    await db
      .delete(schema.kv)
      .where(and(like(schema.kv.key, "auth:used:%"), lt(sql`(${schema.kv.value}->>'exp')::bigint`, Date.now() - 3600e3)))
      .catch(() => {});
  }
  return rows.length > 0;
}

export const resetUrl = (token: string) => `${appUrl()}/reset/${token}`;
export const magicUrl = (token: string) => `${appUrl()}/login/link/${token}`;
export const verifyUrl = (token: string) => `${appUrl()}/api/auth/verify?token=${encodeURIComponent(token)}`;

/** Тексты для владельца (единые для API и страниц) */
export const MSG = {
  badLogin: "Неверная почта или пароль",
  noPassword: "Для этой почты пароль ещё не задан. Войдите через Google или восстановите пароль, чтобы задать его.",
  noPasswordNoGoogle: "Для этой почты пароль ещё не задан. Восстановите пароль, чтобы задать его.",
  exists: "Аккаунт с этой почтой уже есть. Войдите или восстановите пароль.",
  tooMany: "Слишком много попыток. Подождите 15 минут и попробуйте снова.",
  mailOff: "Восстановление по почте пока не настроено — напишите в поддержку.",
  resetSent: "Если такой адрес есть, мы отправили письмо со ссылкой. Она действует 1 час. Не пришло — проверьте «Спам».",
  linkExpired: "Ссылка устарела или уже использована. Запросите новую.",
};

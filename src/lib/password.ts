import "server-only";
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Хеш пароля: scrypt (встроен в Node) со своей случайной солью у каждого пользователя.
 * Формат строки: scrypt$N$r$p$<соль base64url>$<хеш base64url> — параметры хранятся рядом,
 * чтобы их можно было усилить позже, не ломая старые хеши.
 */
const N = 16384, R = 8, P = 1, KEYLEN = 64;

function derive(password: string, salt: Buffer, opts: ScryptOptions & { N: number }, keylen = KEYLEN): Promise<Buffer> {
  return new Promise((ok, bad) =>
    scrypt(password.normalize("NFKC"), salt, keylen, { ...opts, maxmem: 64 * 1024 * 1024 }, (e, key) => (e ? bad(e) : ok(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, { N, r: R, p: P });
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** Сравнение за постоянное время. Неизвестный формат — false */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const got = await derive(password, Buffer.from(salt, "base64url"), { N: Number(n), r: Number(r), p: Number(p) }, expected.length);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

let dummy: Promise<string> | null = null;
/** Для неизвестной почты всё равно считаем scrypt — по времени ответа не понять, есть ли такой аккаунт */
export async function burnPasswordCheck(password: string) {
  dummy ??= hashPassword("dummy-password-for-timing");
  await verifyPassword(password, await dummy);
}

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

/** Текст ошибки или null, если пароль подходит */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length < PASSWORD_MIN) return `Пароль должен быть не короче ${PASSWORD_MIN} символов`;
  if (password.length > PASSWORD_MAX) return `Пароль слишком длинный — не больше ${PASSWORD_MAX} символов`;
  if (!password.trim()) return "Пароль не может состоять из одних пробелов";
  return null;
}

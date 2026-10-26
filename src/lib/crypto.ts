import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

function secret() {
  // Если APP_SECRET не задан — выводим его из строки подключения к базе (она и так секретная).
  // Удобно для деплоя в один клик: Vercel + Neon сами подставляют DATABASE_URL.
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  const s = process.env.APP_SECRET || (dbUrl ? createHash("sha256").update("pz-secret:" + dbUrl).digest("hex") : undefined);
  if (!s || s.length < 16) {
    // Временный режим на Vercel без базы: только демо, данные всё равно не сохраняются
    if (process.env.VERCEL && process.env.VERCEL_PROJECT_ID) return createHash("sha256").update("pz-tmp:" + process.env.VERCEL_PROJECT_ID).digest("hex");
    if (process.env.NODE_ENV === "production" && !process.env.ALLOW_INSECURE_SECRET) {
      throw new Error("APP_SECRET не задан: укажите случайную строку из 32+ символов в переменных окружения");
    }
    return "dev-secret-change-me-dev-secret-change-me";
  }
  return s;
}

const key = () => createHash("sha256").update("enc:" + secret()).digest();

/** AES-256-GCM: токены рекламных кабинетов храним только в зашифрованном виде */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function decrypt(token: string): string {
  const [v, iv, tag, data] = token.split(".");
  if (v !== "v1") return token; // незашифрованное значение (демо)
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}

export function sign(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verify<T>(token: string | undefined | null): T | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret()).update(body).digest();
  const got = Buffer.from(mac, "base64url");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (data.exp && Date.now() > data.exp) return null;
    return data as T;
  } catch {
    return null;
  }
}

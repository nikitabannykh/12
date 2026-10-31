import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * Откуда берётся секрет для сессий, подписей и шифрования токенов:
 *  1. APP_SECRET (≥16 символов) — основной и рекомендуемый вариант.
 *  2. sha256 от DATABASE_URL / POSTGRES_URL — строка подключения к базе секретна сама по себе;
 *     на этом сейчас работает прод на Vercel + Neon, поэтому вариант сохранён: старые сессии и токены не ломаются.
 *     В production при этом в лог пишется громкое предупреждение: задайте APP_SECRET (старые сессии и токены
 *     продолжат открываться — см. legacySecret).
 *  3. Без того и другого — только при разработке (next dev) или с явным ALLOW_INSECURE (показ демо).
 *     Любая production-сборка (NODE_ENV=production: next start, Docker, Vercel), в том числе без APP_URL
 *     и на localhost, без ALLOW_INSECURE работать отказывается: константа из репозитория и производные
 *     от несекретных значений (VERCEL_PROJECT_ID) секретом не являются.
 */
const isProductionBuild = () => process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";

const insecureAllowed = () => Boolean(process.env.ALLOW_INSECURE || process.env.ALLOW_INSECURE_SECRET);

type SecretResult = { secret: string; error: null } | { secret: null; error: string };

let warnedLegacy = false;

function resolveSecret(): SecretResult {
  const app = process.env.APP_SECRET?.trim();
  if (app && app.length >= 16) return { secret: app, error: null };
  const dbUrl = (process.env.DATABASE_URL || process.env.POSTGRES_URL)?.trim();
  // (как и раньше: короткий APP_SECRET при наличии базы игнорируется — чтобы не сломать действующие сессии)
  if (dbUrl) {
    if (isProductionBuild() && !warnedLegacy) {
      warnedLegacy = true;
      console.warn(
        "⚠️  SECURITY: APP_SECRET не задан — секрет сессий и шифрования токенов выводится из DATABASE_URL. " +
          "Утечка или смена строки подключения = подделка сессий / потеря токенов. Задайте APP_SECRET (openssl rand -hex 32): " +
          "старые сессии и токены продолжат работать (проверяются прежним ключом).",
      );
    }
    return { secret: createHash("sha256").update("pz-secret:" + dbUrl).digest("hex"), error: null };
  }
  if (isProductionBuild() && !insecureAllowed()) {
    return {
      secret: null,
      error: app
        ? "APP_SECRET слишком короткий: нужна случайная строка из 32+ символов."
        : "Не задан APP_SECRET. Добавьте в переменные окружения случайную строку из 32+ символов (например, `openssl rand -hex 32`) и перезапустите сервис.",
    };
  }
  // Разработка (next dev) или явно разрешённый небезопасный режим (ALLOW_INSECURE) — только для демо
  if (isProductionBuild() && !warnedLegacy) {
    warnedLegacy = true;
    console.warn("⚠️  SECURITY: ALLOW_INSECURE — сессии подписываются несекретным ключом. Только для демо!");
  }
  if (process.env.VERCEL && process.env.VERCEL_PROJECT_ID) return { secret: createHash("sha256").update("pz-tmp:" + process.env.VERCEL_PROJECT_ID).digest("hex"), error: null };
  return { secret: "dev-secret-change-me-dev-secret-change-me", error: null };
}

/** Текст ошибки настройки секрета (для страницы входа) или null, если всё в порядке */
export function secretError(): string | null {
  return resolveSecret().error;
}

function secret() {
  const r = resolveSecret();
  if (r.error !== null) throw Object.assign(new Error(r.error), { code: "PZ_SECRET" });
  return r.secret;
}

const key = () => createHash("sha256").update("enc:" + secret()).digest();

/**
 * Прежний секрет (от строки подключения к базе), если теперь задан APP_SECRET: им проверяем старые сессии и
 * расшифровываем старые токены — переход на APP_SECRET никого не разлогинивает и не отключает кабинеты.
 */
function legacySecret(): string | null {
  const app = process.env.APP_SECRET?.trim();
  // После переезда на другую базу старый ключ выводится из прежней строки подключения: NEON_DATABASE_URL
  // (её же берёт перенос данных) или LEGACY_DATABASE_URL — ровно то значение DATABASE_URL, что было на старом сервере
  const dbUrl = (process.env.LEGACY_DATABASE_URL || process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL)?.trim();
  if (!app || app.length < 16 || !dbUrl) return null;
  return createHash("sha256").update("pz-secret:" + dbUrl).digest("hex");
}
const legacyKey = () => {
  const l = legacySecret();
  return l ? createHash("sha256").update("enc:" + l).digest() : null;
};

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
  const open = (k: Buffer) => {
    const d = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
  };
  try {
    return open(key());
  } catch (e) {
    const old = legacyKey();
    if (!old) throw e;
    return open(old);
  }
}

export function sign(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verify<T>(token: string | undefined | null): T | null {
  if (!token || typeof token !== "string") return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const got = Buffer.from(mac, "base64url");
  const ok = (sec: string) => {
    const expected = createHmac("sha256", sec).update(body).digest();
    return got.length === expected.length && timingSafeEqual(got, expected);
  };
  const legacy = legacySecret();
  if (!ok(secret()) && !(legacy && ok(legacy))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (data.exp && Date.now() > data.exp) return null;
    return data as T;
  } catch {
    return null;
  }
}

/** Короткий HMAC для мест, где длина ограничена (например, параметр start в Telegram) */
export function mac(data: string, len = 16): string {
  return createHmac("sha256", secret()).update("mac:" + data).digest("base64url").slice(0, len);
}

export function macEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Необратимый отпечаток (IP и т. п.) — чтобы не хранить исходное значение */
export function fingerprint(value: string): string {
  return mac("fp:" + value, 22);
}

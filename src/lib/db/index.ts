import "server-only";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { MIGRATION_SQL } from "./migrate";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

type Holder = { db?: DB; ready?: Promise<DB> };
const g = globalThis as unknown as { __pz_db?: Holder };
const holder: Holder = (g.__pz_db ??= {});

/**
 * Шифрование соединения с Postgres.
 *  - PG_CA_CERT — сертификат центра, которым подписан сервер (PEM-текст, путь к файлу или PEM в base64).
 *    Тогда проверяем и сертификат, и имя хоста (как sslmode=verify-full). Нужен для Yandex Managed PostgreSQL:
 *    https://storage.yandexcloud.net/cloud-certs/CA.pem. С sslmode=verify-ca в строке подключения имя хоста не сверяем.
 *  - Без PG_CA_CERT, но с sslmode в строке подключения — режим из строки (disable, require, verify-full с системными сертификатами).
 *  - Иначе: localhost — без шифрования, остальные — шифрование без проверки сертификата (sslmode=require, как раньше: Neon, Supabase).
 */
type SslObject = { ca: string; rejectUnauthorized: true; checkServerIdentity?: (host: string, cert: import("tls").PeerCertificate) => Error | undefined };
async function sslFor(url: string): Promise<false | "require" | SslObject | undefined> {
  let mode: string | null = null;
  let host = "";
  try {
    const u = new URL(url);
    mode = u.searchParams.get("sslmode");
    host = u.hostname;
  } catch {
    /* строка не в формате URL — решит сам драйвер */
  }
  const raw = process.env.PG_CA_CERT?.trim();
  if (raw && mode !== "disable") {
    let pem = raw.replace(/\\n/g, "\n");
    if (!pem.includes("-----BEGIN")) {
      const { existsSync, readFileSync } = await import("fs");
      if (existsSync(pem)) pem = readFileSync(pem, "utf8");
      else pem = Buffer.from(pem, "base64").toString("utf8");
    }
    if (!pem.includes("-----BEGIN CERTIFICATE-----")) throw new Error("PG_CA_CERT: не похоже на сертификат (ожидается PEM, путь к .pem или PEM в base64)");
    if (mode === "verify-ca") return { ca: pem, rejectUnauthorized: true, checkServerIdentity: () => undefined };
    // Для IP-адреса драйвер не передаёт имя сервера, и Node сверил бы сертификат с «localhost» — сверяем с адресом сами
    const tls = await import("tls");
    const { isIP } = await import("net");
    return isIP(host) ? { ca: pem, rejectUnauthorized: true, checkServerIdentity: (_h: string, cert: import("tls").PeerCertificate) => tls.checkServerIdentity(host, cert) } : { ca: pem, rejectUnauthorized: true };
  }
  if (mode) return undefined;
  return host === "localhost" || host === "127.0.0.1" || host === "::1" ? false : "require";
}

async function create(): Promise<DB> {
  const url = (process.env.DATABASE_URL || process.env.POSTGRES_URL)?.trim();
  if (url) {
    const postgres = (await import("postgres")).default;
    const { drizzle } = await import("drizzle-orm/postgres-js");
    // prepare:false — совместимо с пулерами (Neon, Supabase, PgBouncer, Odyssey в Yandex Managed PostgreSQL)
    const ssl = await sslFor(url);
    const client = postgres(url, { prepare: false, max: Number(process.env.PG_POOL_MAX) || 5, ...(ssl === undefined ? {} : { ssl }) });
    await client.unsafe(MIGRATION_SQL);
    return drizzle(client, { schema }) as unknown as DB;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  // На Vercel без Postgres — временная база в /tmp (только чтобы посмотреть демо; данные не сохраняются)
  const dir = process.env.PGLITE_DIR || (process.env.VERCEL ? "/tmp/pglite" : ".data/pglite");
  const { mkdirSync } = await import("fs");
  mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  await client.exec(MIGRATION_SQL);
  return drizzle(client, { schema }) as unknown as DB;
}

export async function getDb(): Promise<DB> {
  if (holder.db) return holder.db;
  holder.ready ??= create().then((db) => (holder.db = db)).catch((e) => {
    holder.ready = undefined;
    throw e;
  });
  return holder.ready;
}

export { schema };

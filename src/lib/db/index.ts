import "server-only";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { MIGRATION_SQL } from "./migrate";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

type Holder = { db?: DB; ready?: Promise<DB> };
const g = globalThis as unknown as { __pz_db?: Holder };
const holder: Holder = (g.__pz_db ??= {});

async function create(): Promise<DB> {
  const url = (process.env.DATABASE_URL || process.env.POSTGRES_URL)?.trim();
  if (url) {
    const postgres = (await import("postgres")).default;
    const { drizzle } = await import("drizzle-orm/postgres-js");
    // prepare:false — совместимо с пулерами (Neon, Supabase, PgBouncer)
    const client = postgres(url, { prepare: false, max: 5, ssl: url.includes("localhost") ? false : "require" });
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

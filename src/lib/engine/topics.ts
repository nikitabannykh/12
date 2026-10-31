import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { Business } from "../db/schema";
import { businessTopics } from "../ai/topics";
import { aiConfigured } from "../ai/yandex";

/**
 * Общие запросы бизнеса (searchTopics) для проектов, сохранённых до появления этой функции: считаем один раз
 * перед сбором спроса или подготовкой объявлений и сохраняем. Пустой результат запоминаем пометкой, чтобы не спрашивать модель каждый раз.
 */
export async function ensureTopics<T extends Business>(b: T): Promise<T> {
  if ((b.searchTopics ?? []).length || !aiConfigured()) return b;
  const db = await getDb();
  const key = `topics-tried:${b.id}`;
  const [tried] = await db.select({ k: schema.kv.key }).from(schema.kv).where(eq(schema.kv.key, key));
  if (tried) return b;
  const searchTopics = await businessTopics(b);
  await db.insert(schema.kv).values({ key, value: { at: new Date().toISOString() } }).onConflictDoNothing();
  if (!searchTopics.length) return b;
  await db.update(schema.businesses).set({ searchTopics }).where(eq(schema.businesses.id, b.id));
  return { ...b, searchTopics };
}

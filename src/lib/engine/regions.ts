import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { CITY_REGIONS } from "../niches";
import { YandexDirect } from "../platforms/yandex";
import { VkAds } from "../platforms/vk";

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/^г\.?\s*/, "").trim();

async function cached<T>(key: string, ttlDays: number, load: () => Promise<T>): Promise<T> {
  const db = await getDb();
  const [row] = await db.select().from(schema.kv).where(eq(schema.kv.key, key));
  if (row && Date.now() - row.updatedAt.getTime() < ttlDays * 864e5) return row.value as T;
  const value = await load();
  if (row) await db.update(schema.kv).set({ value, updatedAt: new Date() }).where(eq(schema.kv.key, key));
  else await db.insert(schema.kv).values({ key, value });
  return value;
}

export async function yandexRegionIds(city: string, client?: YandexDirect): Promise<number[] | null> {
  const n = norm(city);
  if (CITY_REGIONS[n]) return [CITY_REGIONS[n]];
  if (!client) return null;
  const list = await cached("yandex:georegions", 30, () => client.geoRegions().then((l) => l.filter((r) => ["City", "Village", "Region", "District"].includes(r.type))));
  const exact = list.filter((r) => norm(r.name) === n);
  const pick = exact.find((r) => r.type === "City") ?? exact[0];
  return pick ? [pick.id] : null;
}

export async function vkRegionIds(city: string, client: VkAds): Promise<number[] | null> {
  const n = norm(city);
  const list = await cached("vk:regions", 30, async () => {
    const all: { id: number; name: string; type?: string }[] = [];
    for (let offset = 0; offset < 20000; offset += 250) {
      const j = await client.req("GET", "v2/regions.json", { query: { fields: "id,name,type", limit: 250, offset } });
      const items = j.items ?? [];
      all.push(...items.map((x: any) => ({ id: Number(x.id), name: String(x.name), type: x.type })));
      if (items.length < 250) break;
    }
    return all;
  });
  const exact = list.filter((r) => norm(r.name) === n);
  const pick = exact.find((r) => r.type === "city") ?? exact[0];
  return pick ? [pick.id] : null;
}

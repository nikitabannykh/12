// Проверка: схема Drizzle совпадает с SQL-миграцией. Запуск: npx tsx scripts/check-schema.ts
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../src/lib/db/schema";
import { MIGRATION_SQL } from "../src/lib/db/migrate";
const tables: Record<string, Set<string>> = {};
for (const m of MIGRATION_SQL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g)) {
  tables[m[1]] = new Set(m[2].split("\n").map((l) => l.trim().split(" ")[0]).filter(Boolean));
}
for (const v of Object.values(schema)) {
  try {
    const c = getTableConfig(v as any);
    const cols = c.columns.map((x) => x.name);
    const mig = tables[c.name];
    if (!mig) { console.log("MISSING TABLE", c.name); continue; }
    for (const col of cols) if (!mig.has(col)) console.log("MISSING COL", c.name, col);
    for (const col of mig) if (!cols.includes(col)) console.log("EXTRA COL in SQL", c.name, col);
  } catch {}
}
console.log("checked", Object.keys(tables).length);

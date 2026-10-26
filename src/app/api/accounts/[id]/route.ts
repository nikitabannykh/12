import { and, eq, inArray } from "drizzle-orm";
import { route, json, fail } from "@/lib/api";
import { getDb, schema } from "@/lib/db";

export const DELETE = route<{ id: string }>(async ({ user, params }) => {
  const db = await getDb();
  const [acc] = await db.select().from(schema.adAccounts).where(and(eq(schema.adAccounts.id, params.id), eq(schema.adAccounts.userId, user.id)));
  if (!acc) return fail("Кабинет не найден", 404);
  const live = await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.accountId, acc.id), inArray(schema.campaigns.status, ["active"])));
  if (live.length) return fail("В этом кабинете идёт реклама. Сначала остановите кампании — иначе мы не сможем ими управлять, а деньги продолжат списываться.");
  await db.delete(schema.adAccounts).where(eq(schema.adAccounts.id, acc.id));
  return json({ ok: true });
});

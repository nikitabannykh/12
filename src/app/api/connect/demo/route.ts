import { and, eq } from "drizzle-orm";
import { route, json, fail } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { demoAllowed } from "@/lib/auth";
import { uid } from "@/lib/util";

export const POST = route(async ({ user }) => {
  if (!demoAllowed()) return fail("Демо-кабинет отключён на этом сервере");
  const db = await getDb();
  const [existing] = await db.select().from(schema.adAccounts).where(and(eq(schema.adAccounts.userId, user.id), eq(schema.adAccounts.platform, "demo")));
  if (!existing) await db.insert(schema.adAccounts).values({ id: uid("acc_"), userId: user.id, platform: "demo", login: "Демо-кабинет", accessToken: "demo" });
  return json({ ok: true });
});

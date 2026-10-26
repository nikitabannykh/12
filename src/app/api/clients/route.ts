import { route, json, fail, needBusiness } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { uid } from "@/lib/util";

/** Владелец отмечает, сколько обращений за неделю стали клиентами */
export const POST = route(async ({ business, req }) => {
  needBusiness(business);
  const { weekStart, clients } = await req.json();
  const n = Math.round(Number(clients));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(weekStart)) || !Number.isFinite(n) || n < 0 || n > 10000) return fail("Проверьте число");
  const db = await getDb();
  await db
    .insert(schema.clientMarks)
    .values({ id: uid("cm_"), businessId: business.id, weekStart, clients: n })
    .onConflictDoUpdate({ target: [schema.clientMarks.businessId, schema.clientMarks.weekStart], set: { clients: n } });
  return json({ ok: true });
});

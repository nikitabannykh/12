import { z } from "zod";
import { route, json, fail, needBusiness } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { uid } from "@/lib/util";

const Body = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  clients: z.coerce.number().finite().min(0).max(10000),
});

/** Владелец отмечает, сколько обращений за неделю стали клиентами */
export const POST = route(async ({ business, req }) => {
  needBusiness(business);
  const body = await req.json().catch(() => undefined);
  if (body === undefined) return fail("Не удалось прочитать запрос");
  const parsed = Body.safeParse(body);
  if (!parsed.success) return fail("Проверьте число: сколько клиентов пришло за неделю (от 0 до 10 000)");
  const { weekStart } = parsed.data;
  const n = Math.round(parsed.data.clients);
  const db = await getDb();
  await db
    .insert(schema.clientMarks)
    .values({ id: uid("cm_"), businessId: business.id, weekStart, clients: n })
    .onConflictDoUpdate({ target: [schema.clientMarks.businessId, schema.clientMarks.weekStart], set: { clients: n } });
  return json({ ok: true });
});

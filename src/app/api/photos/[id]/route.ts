import { and, eq } from "drizzle-orm";
import { route, json, fail, needBusiness } from "@/lib/api";
import { getDb, schema } from "@/lib/db";

export const DELETE = route<{ id: string }>(async ({ business, params }) => {
  needBusiness(business);
  const db = await getDb();
  const used = await db.select({ id: schema.ads.id }).from(schema.ads).where(and(eq(schema.ads.businessId, business.id), eq(schema.ads.imageId, params.id)));
  if (used.length) return fail("Это фото уже используется в объявлениях");
  await db.delete(schema.images).where(and(eq(schema.images.id, params.id), eq(schema.images.businessId, business.id)));
  return json({ ok: true });
});

import { and, eq } from "drizzle-orm";
import { route, json, fail, needBusiness } from "@/lib/api";
import { getDb, schema } from "@/lib/db";

/** Удалить своё фото. Чужое или несуществующее — 404, ничего не трогаем. */
export const DELETE = route<{ id: string }>(async ({ business, params }) => {
  needBusiness(business);
  const db = await getDb();
  const id = String(params.id);
  const [img] = await db.select({ id: schema.images.id, kind: schema.images.kind }).from(schema.images).where(and(eq(schema.images.id, id), eq(schema.images.businessId, business.id)));
  if (!img) return fail("Фото не найдено — возможно, его уже удалили. Обновите страницу.", 404);
  if (img.kind !== "photo" && img.kind !== "generated") return fail("Это не фото из галереи — его нельзя удалить здесь.", 400);
  const used = await db.select({ id: schema.ads.id }).from(schema.ads).where(and(eq(schema.ads.businessId, business.id), eq(schema.ads.imageId, id)));
  if (used.length) return fail("Это фото уже используется в объявлениях — сначала замените его там.", 409);
  await db.delete(schema.images).where(and(eq(schema.images.id, id), eq(schema.images.businessId, business.id)));
  return json({ ok: true });
});

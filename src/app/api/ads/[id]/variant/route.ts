import { and, eq } from "drizzle-orm";
import { route, json, fail, needBusiness } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { ownerVariant } from "@/lib/engine/optimizer";
import { errorText } from "@/lib/util";

export const maxDuration = 60;

/** Владелец просит новый вариант объявления — A/B-тест против текущего */
export const POST = route<{ id: string }>(async ({ business, params }) => {
  needBusiness(business);
  const db = await getDb();
  const [ad] = await db.select({ id: schema.ads.id, status: schema.ads.status }).from(schema.ads).where(and(eq(schema.ads.id, String(params.id)), eq(schema.ads.businessId, business.id)));
  if (!ad) return fail("Объявление не найдено — возможно, его уже заменил робот. Обновите страницу.", 404);
  if (ad.status !== "active") return fail("A/B-тест можно запустить только для работающего объявления. Сначала включите его.", 409);
  try {
    return json({ ad: await ownerVariant(business, ad.id) });
  } catch (e) {
    const msg = errorText(e);
    // Ожидаемые отказы — понятным текстом и не как сбой сервера
    if (/уже идёт тест|ещё не создана|не найдено/i.test(msg)) return fail(msg, /не найдено/i.test(msg) ? 404 : 409);
    throw e;
  }
});

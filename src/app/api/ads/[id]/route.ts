import { and, eq } from "drizzle-orm";
import { route, json, fail, needBusiness } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { act } from "@/lib/engine/ops";
import { validateAdText } from "@/lib/ai/copy";

const clean = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

export const PATCH = route<{ id: string }>(async ({ business, params, req }) => {
  needBusiness(business);
  const db = await getDb();
  const [ad] = await db.select().from(schema.ads).where(and(eq(schema.ads.id, params.id), eq(schema.ads.businessId, business.id)));
  if (!ad) return fail("Объявление не найдено", 404);
  const [camp] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, ad.campaignId));
  const body = await req.json().catch(() => ({}));

  if (body.status === "active" || body.status === "paused") {
    await act(
      { businessId: business.id, actor: "owner", kind: body.status === "active" ? "resume" : "pause", title: body.status === "active" ? `Включили объявление «${ad.title}»` : `Отключили объявление «${ad.title}»`, reason: "Вы изменили это вручную." },
      [{ op: "adStatus", adId: ad.id, status: body.status }],
    );
    return json({ ok: true });
  }

  if (typeof body.title === "string" && typeof body.text === "string") {
    const channel = camp?.channel ?? "search";
    const title = clean(body.title), text = clean(body.text);
    // Второй заголовок есть у Поиска и РСЯ, у VK — нет
    const title2 = channel !== "vk" ? clean(body.title2) || null : ad.title2;
    const problems = validateAdText(channel, { title, title2, text });
    if (problems.length) return fail(problems.join(" "), 422);
    if (title === ad.title && title2 === ad.title2 && text === ad.text) return json({ ok: true, unchanged: true });
    await act(
      { businessId: business.id, actor: "owner", kind: "ad_text", title: `Изменили текст объявления «${ad.title}»`, reason: "Вы поправили текст. Площадка заново проверит объявление — обычно это занимает несколько часов, всё это время работает старая версия.", details: { before: { title: ad.title, title2: ad.title2, text: ad.text }, after: { title, title2, text } } },
      [{ op: "adText", adId: ad.id, title, title2, text }],
    );
    return json({ ok: true });
  }
  return fail("Нечего менять");
});

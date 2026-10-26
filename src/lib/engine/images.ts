import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import { uid } from "../util";
import { imageSize } from "../creative/imagesize";
import { renderCreative, renderLogo, type Layout } from "../creative/render";
import type { Business } from "../db/schema";
import { aiConfigured, art } from "../ai/yandex";
import { nicheById } from "../niches";

export async function saveImage(businessId: string, kind: "photo" | "generated" | "creative", data: Buffer, meta: { prompt?: string; layout?: string } = {}) {
  const size = imageSize(data);
  if (!size || !size.width) throw new Error("Нужна картинка в формате JPEG или PNG");
  const db = await getDb();
  const id = uid("img_");
  await db.insert(schema.images).values({ id, businessId, kind, mime: size.mime, width: size.width, height: size.height, data, prompt: meta.prompt ?? null, layout: meta.layout ?? null });
  return { id, ...size };
}

export async function getImage(id: string) {
  const db = await getDb();
  const [img] = await db.select().from(schema.images).where(eq(schema.images.id, id));
  return img ?? null;
}

export async function listPhotos(businessId: string) {
  const db = await getDb();
  return db
    .select({ id: schema.images.id, kind: schema.images.kind, width: schema.images.width, height: schema.images.height, prompt: schema.images.prompt, createdAt: schema.images.createdAt })
    .from(schema.images)
    .where(and(eq(schema.images.businessId, businessId), inArray(schema.images.kind, ["photo", "generated"])));
}

/**
 * Промпты для фото по услугам бизнеса: каждая услуга — свой кадр (маникюр → руки с покрытием,
 * педикюр → ухоженные стопы, йога для начинающих → зал с ковриками). YandexART понимает русский.
 */
export function photoPrompts(b: Business, ideas: string[] = []) {
  const n = nicheById(b.niche);
  const services = (b.services ?? []).map((s) => s.name).filter(Boolean);
  const scene = n.visuals[0];
  const fromServices = services.slice(0, 3).map(
    (svc, i) =>
      `Реалистичная рекламная фотография для ${n.label.toLowerCase()}: «${svc}». Крупный план результата услуги или процесса, ` +
      `руки мастера или клиента без лица, интерьер уютного салона в ${b.city}. ${i === 0 ? "Мягкий утренний свет из окна." : i === 1 ? "Тёплый вечерний свет, детали материалов." : "Светлый минималистичный фон, акцент на результате."}`,
  );
  return [...fromServices, ...ideas, scene].slice(0, 3);
}

/** Реалистичные фото через YandexART: детали процесса, атмосфера места. Без текста и крупных лиц. */
export async function generatePhotos(b: Business, ideas: string[], count: number) {
  if (!aiConfigured() || count <= 0) return { ids: [] as string[], errors: [] as string[] };
  const prompts = photoPrompts(b, ideas).slice(0, count);
  const style = "Фотореализм, естественный свет, настоящие материалы, полнокадровая камера, объектив 35 мм. Без текста, без надписей, без логотипов, без водяных знаков";
  const results = await Promise.allSettled(prompts.map((p, i) => art(`${p}. ${style}`, { w: 1, h: 1 }, 1000 + i)));
  const ids: string[] = [];
  const errors: string[] = [];
  for (const [i, r] of results.entries()) {
    if (r.status === "fulfilled") ids.push((await saveImage(b.id, "generated", r.value, { prompt: prompts[i] })).id);
    else errors.push(String((r.reason as Error)?.message ?? r.reason));
  }
  return { ids, errors };
}

export async function makeCreative(b: Business, p: { layout: Layout; photoId?: string | null; width: number; height: number; headline?: string; price?: string }) {
  const photo = p.photoId ? await getImage(p.photoId) : null;
  const png = await renderCreative({
    layout: p.layout,
    width: p.width,
    height: p.height,
    business: b,
    photo: photo ? { data: photo.data, mime: photo.mime } : null,
    headline: p.headline,
    price: p.price,
  });
  return saveImage(b.id, "creative", png, { layout: p.layout, prompt: p.photoId ?? undefined });
}

/** Логотип бизнеса для VK: создаём один раз и переиспользуем */
export async function ensureLogo(b: Business) {
  const db = await getDb();
  const [found] = await db.select().from(schema.images).where(and(eq(schema.images.businessId, b.id), eq(schema.images.layout, "logo")));
  if (found) return found;
  const saved = await saveImage(b.id, "creative", await renderLogo(b), { layout: "logo" });
  return getImage(saved.id);
}

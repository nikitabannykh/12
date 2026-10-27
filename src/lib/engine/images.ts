import "server-only";
import { spreadServices } from "../services";
import { and, asc, count, eq, inArray } from "drizzle-orm";
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

/** Сколько своих фото можно держать в сервисе: больше в объявления всё равно не поместится */
export const MAX_PHOTOS = 20;

/** Свои фото владельца (без сгенерированных ИИ), старые первыми */
export async function ownerPhotoIds(businessId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select({ id: schema.images.id }).from(schema.images).where(and(eq(schema.images.businessId, businessId), eq(schema.images.kind, "photo"))).orderBy(asc(schema.images.createdAt));
  return rows.map((r) => r.id);
}

/**
 * Фото владельца как картинка объявления без надписей (макет «Чистое фото») нужного размера.
 * Рендерим один раз на фото и размер (kv `ownphoto:<id>:<w>x<h>`), дальше переиспользуем.
 */
export async function ownerPhotoCreative(b: Business, photoId: string, size: { width: number; height: number }) {
  const db = await getDb();
  const key = `ownphoto:${photoId}:${size.width}x${size.height}`;
  const [row] = await db.select().from(schema.kv).where(eq(schema.kv.key, key));
  const known = (row?.value as { id?: string } | undefined)?.id;
  if (known) {
    const img = await getImage(known);
    if (img) return img;
  }
  if (!(await getImage(photoId))) return null;
  const made = await makeCreative(b, { layout: "photo", photoId, width: size.width, height: size.height });
  await db.insert(schema.kv).values({ key, value: { id: made.id } }).onConflictDoUpdate({ target: schema.kv.key, set: { value: { id: made.id }, updatedAt: new Date() } });
  return getImage(made.id);
}

/**
 * Промпты для фото по услугам бизнеса: каждая услуга — свой кадр (маникюр → руки с покрытием,
 * педикюр → ухоженные стопы, йога для начинающих → зал с ковриками). YandexART понимает русский.
 */
export function photoPrompts(b: Business, ideas: string[] = []) {
  const n = nicheById(b.niche);
  const services = spreadServices((b.services ?? []).filter((s) => s.name), 3).map((s) => s.name);
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

/**
 * variant — сюжет иллюстрации для картинок без фото. Если не передан, берём следующий по счёту
 * для этого бизнеса: так объявления в группе и между группами получают разные картинки.
 */
export async function makeCreative(b: Business, p: { layout: Layout; photoId?: string | null; width: number; height: number; headline?: string; price?: string; variant?: number }) {
  const photo = p.photoId ? await getImage(p.photoId) : null;
  let variant = p.variant;
  if (variant === undefined && !photo) {
    const db = await getDb();
    const [row] = await db.select({ n: count() }).from(schema.images).where(and(eq(schema.images.businessId, b.id), eq(schema.images.kind, "creative")));
    variant = Number(row?.n ?? 0);
  }
  const png = await renderCreative({
    layout: p.layout,
    width: p.width,
    height: p.height,
    business: b,
    photo: photo ? { data: photo.data, mime: photo.mime } : null,
    headline: p.headline,
    price: p.price,
    variant,
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

/**
 * Пропорции картинок для комбинаторного объявления Директа (до 5 в ResponsiveAd.AdImageHashes):
 * 1:1 и 4:3/3:4 — тип REGULAR (450–5000 px по стороне), 16:9 — WIDE (от 1080×607),
 * https://yandex.ru/dev/direct/doc/ru/objects/adimage. Разные пропорции — больше мест показа в РСЯ и на поиске.
 */
export const DIRECT_IMAGE_SIZES = [
  { width: 1080, height: 1080 },
  { width: 1080, height: 607 },
  { width: 1080, height: 810 },
  { width: 810, height: 1080 },
] as const;

const ratioKey = (w: number, h: number) => (Math.abs(w / h - 16 / 9) < 0.05 ? "16:9" : Math.abs(w / h - 1) < 0.02 ? "1:1" : w > h ? "4:3" : "3:4");

/**
 * Та же картинка в других пропорциях: тот же макет и то же фото (а для поиска — та же услуга и цена).
 * Набор запоминается (kv `imgset:<id>`), поэтому при запуске, у робота и при повторах он одинаковый.
 * Возвращает картинки без исходной; ошибки рендера не мешают — просто меньше пропорций.
 */
export async function imageSet(b: Business, baseImageId: string, ctx: { headline?: string; price?: string } = {}) {
  const db = await getDb();
  const key = `imgset:${baseImageId}`;
  const base = await getImage(baseImageId);
  if (!base || !base.layout || base.layout === "logo") return [];
  const [row] = await db.select().from(schema.kv).where(eq(schema.kv.key, key));
  const known = { ...((row?.value as Record<string, string> | undefined) ?? {}) };
  const own = ratioKey(base.width, base.height);
  const srcPhoto = base.prompt?.startsWith("img_") ? base.prompt : null;
  // Владелец удалил исходное фото — новые пропорции без него получились бы другой картинкой, не дорисовываем
  const photoGone = srcPhoto ? !(await getImage(srcPhoto)) : false;
  let changed = false;
  for (const sz of DIRECT_IMAGE_SIZES) {
    const r = ratioKey(sz.width, sz.height);
    if (r === own || known[r] || photoGone) continue;
    try {
      const img = await makeCreative(b, { layout: base.layout as Layout, photoId: srcPhoto, width: sz.width, height: sz.height, headline: ctx.headline, price: ctx.price, variant: 0 });
      known[r] = img.id;
      changed = true;
    } catch {
      /* без этой пропорции */
    }
  }
  if (changed) {
    if (row) await db.update(schema.kv).set({ value: known, updatedAt: new Date() }).where(eq(schema.kv.key, key));
    else await db.insert(schema.kv).values({ key, value: known }).onConflictDoUpdate({ target: schema.kv.key, set: { value: known, updatedAt: new Date() } });
  }
  const ids = Object.entries(known).filter(([r]) => r !== own).map(([, id]) => id);
  const imgs = await Promise.all(ids.map((id) => getImage(id)));
  return imgs.filter((x): x is NonNullable<typeof x> => !!x);
}

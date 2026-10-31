import "server-only";
import { spreadServices } from "../services";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import { uid } from "../util";
import { imageSize } from "../creative/imagesize";
import { renderCreative, renderLogo, shortHeadline, type Layout } from "../creative/render";
import { withoutSuperlatives } from "./extras";
import type { Business } from "../db/schema";
import { aiConfigured, art, gptJson } from "../ai/yandex";
import { isMedical, nicheById } from "../niches";

/**
 * Сжимаем перед записью в базу: PNG из рендера весит 1–3 МБ, тот же кадр в JPEG — 150–300 КБ.
 * Фото владельца уменьшаем до 1600 px по длинной стороне — и база меньше, и макеты рисуются быстрее.
 */
async function compact(kind: string, data: Buffer): Promise<Buffer> {
  try {
    const sharp = (await import("sharp")).default;
    const img = sharp(data, { failOn: "none" }).rotate();
    if (kind === "photo" || kind === "generated") img.resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true });
    const out = await img.flatten({ background: "#ffffff" }).jpeg({ quality: kind === "creative" ? 88 : 85, mozjpeg: true }).toBuffer();
    return out.length < data.length ? out : data;
  } catch {
    return data; // без sharp сохраняем как есть
  }
}

export async function saveImage(businessId: string, kind: "photo" | "generated" | "creative", raw: Buffer, meta: { prompt?: string; layout?: string } = {}) {
  const data = await compact(kind, raw);
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
      `Реалистичная рекламная фотография для ${n.label.toLowerCase()}: «${svc}». Крупный план результата услуги или процесса — ` +
      `то, что увидит клиент именно этой услуги; люди без лиц в кадре. ${i === 0 ? "Мягкий утренний свет из окна." : i === 1 ? "Тёплый вечерний свет, детали материалов." : "Светлый минималистичный фон, акцент на результате."}`,
  );
  return [...fromServices, ...ideas, scene].slice(0, 3);
}

/**
 * Нешаблонные сюжеты: YandexGPT придумывает разные кадры под услуги этого бизнеса — деталь, атмосфера,
 * результат, эмоция, необычный ракурс. Не вышло — запасные промпты по нише.
 */
async function creativeConcepts(b: Business, ideas: string[], count: number): Promise<string[]> {
  const n = nicheById(b.niche);
  const services = spreadServices((b.services ?? []).filter((s) => s.name), 5).map((s) => s.name);
  try {
    const r = await gptJson<{ scenes: string[] }>(
      "Ты арт-директор рекламы для малого бизнеса. Придумываешь кадры для рекламных фото, которые цепляют в ленте: живые, конкретные, не стоковые. " +
        "Каждый кадр — свой приём: макро-деталь, атмосфера места, результат «после», момент процесса, необычный ракурс сверху, натюрморт с инструментами, игра света и цвета. " +
        "Нельзя: текст, надписи, логотипы, лица крупным планом, медицинские страшилки, обнажёнка. Люди — только руки, силуэты, спина, размытый фон. " +
        'Ответ — JSON {"scenes": ["...", ...]}, каждая сцена — 1–2 предложения на русском: что в кадре, свет, цвет, ракурс.',
      `Бизнес: ${b.name}, ${n.label}, город ${b.city}.\nУслуги: ${services.join("; ") || "основные услуги ниши"}.\n${ideas.length ? `Идеи из плана: ${ideas.join("; ")}.\n` : ""}Нужно ${count} разных кадров, у каждого — своя услуга или свой приём.`,
      { temperature: 0.9, maxTokens: 1200, timeoutMs: 15_000 },
    );
    const scenes = (r.scenes ?? []).map((x) => String(x).trim()).filter((x) => x.length > 20);
    if (scenes.length >= Math.min(2, count)) return scenes.slice(0, count);
  } catch {
    // запасной вариант ниже
  }
  return photoPrompts(b, ideas);
}

/** Сюжет картинки под конкретную услугу: человеческий заголовок, выгода именно этой услуги и кадр для YandexART */
export type ServiceArt = { service: string; headline: string; benefit: string; scene: string; photoId?: string | null; /** не сгенерировалось и после повтора — больше не пробуем */ failed?: boolean };

/** Строка для картинки: без кавычек и лишних пробелов, не длиннее max, без хвостовой пунктуации */
const cleanLine = (s: unknown, max: number) => String(s ?? "").replace(/[«»"]/g, "").replace(/\s+/g, " ").trim().slice(0, max).replace(/[\s,.;:–—-]+$/, "");

/**
 * Для каждой услуги — свой арт-концепт (одним запросом к YandexGPT): заголовок для картинки так, как сказал бы клиент
 * («Остеопатия (новорождённые и дети до 14 лет)» → «Остеопат для малышей с рождения»), выгода этой услуги для её аудитории
 * и кадр, который снимал бы фотограф именно под эту услугу (малыш и руки мамы, блюдо крупно, зал с ковриками…).
 * Не вышло — заголовок из названия без скобок, кадр по шаблону ниши.
 */
export async function serviceArt(b: Business, ideas: string[], count: number, opts: { until?: number; subjects?: string[]; queries?: Record<string, string[]> } = {}): Promise<ServiceArt[]> {
  const n = nicheById(b.niche);
  // subjects — то, под что реально идут объявления (группы поиска: «Доставка еды», услуги), по важности; иначе — услуги прайса
  const services = (opts.subjects?.length ? [...new Set(opts.subjects)] : spreadServices((b.services ?? []).filter((s) => s.name), Math.max(1, count)).map((s) => s.name)).slice(0, Math.max(1, count));
  const list = services.length ? services : [n.id === "other" ? b.name : n.generic];
  const fallback = (): ServiceArt[] => {
    const prompts = photoPrompts(b, ideas);
    return list.map((svc, i) => ({ service: svc, headline: shortHeadline(svc), benefit: "", scene: prompts[i % prompts.length] }));
  };
  if (!aiConfigured()) return fallback();
  try {
    const r = await gptJson<{ items: { service: number; headline: string; benefit: string; scene: string }[] }>(
      "Ты арт-директор и копирайтер рекламы малого бизнеса. Для каждой услуги или запроса (это то, что человек искал перед тем, как увидел объявление) готовишь рекламную картинку, которая выглядит как работа живого фотографа и дизайнера, а не нейросети.\n" +
        "headline — подпись на картинке, до 32 символов: услуга так, как её назвал бы клиент, живо и кликабельно. Не копируй название из прайса: без скобок, кодов, перечислений, канцелярита. «Остеопатия (новорождённые и дети до 14 лет)» → «Остеопат для малышей с рождения».\n" +
        "benefit — до 45 символов: зачем эта услуга именно её аудитории, по смыслу услуги. Только факты из описания бизнеса или очевидная суть услуги; нельзя выдумывать рейтинги, цифры, скидки, сроки, гарантии и «лучший».\n" +
        "scene — 1–2 предложения для фотогенератора: что в кадре под ЭТУ услугу или запрос и его аудиторию («доставка пиццы» — пицца в коробке у двери, а не десерт) (дети — ребёнок и руки взрослого; еда — само блюдо; спорт — движение в зале), свет, цвет, ракурс. Каждая сцена — свой приём: макро-деталь, процесс, результат, атмосфера места, натюрморт. " +
        "Нельзя: текст и надписи в кадре, логотипы, крупные лица, обнажённое тело, медицинские страшилки, стоковые улыбки. Дети — только руки, ножки, со спины или издалека. Главный объект занимает центр и треть кадра: картинку смотрят размером с марку.\n" +
        "Все кадры одного бизнеса — как одна фотосессия: одинаковый свет и цветовая гамма, но разные планы и сюжеты.\n" +
        (isMedical(b) ? "Это медицинские услуги: в headline и benefit не обещай излечение, результат и безопасность, не пиши «без боли», «эффективно», «поможем», не предполагай болезнь у читателя. Можно — для кого приём и что в него входит.\n" : "") +
        'Ответ — JSON {"items": [{"service": номер, "headline": "...", "benefit": "...", "scene": "..."}]}.',
      `Бизнес: ${b.name}, ${n.label}, город ${b.city}.\n${b.description ? `Описание: ${b.description.slice(0, 500)}\n` : ""}${(b.advantages ?? []).length ? `Преимущества: ${(b.advantages ?? []).join("; ")}\n` : ""}${ideas.length ? `Идеи для картинок: ${ideas.join("; ")}\n` : ""}Услуги и группы объявлений (в скобках — что ищут люди):\n${list.map((x, i) => `${i + 1}. ${x}${opts.queries?.[x]?.length ? ` (ищут: ${opts.queries[x].join("; ")})` : ""}`).join("\n")}`,
      { temperature: 0.8, maxTokens: Math.min(6000, 600 + list.length * 220), timeoutMs: 30_000, until: opts.until },
    );
    const base = fallback();
    const out = base.map((f, i) => {
      const it = (r.items ?? []).find((x) => Number(x.service) === i + 1) ?? (r.items ?? [])[i];
      if (!it) return f;
      const headline = cleanLine(it.headline, 34);
      const scene = String(it.scene ?? "").trim();
      return { service: f.service, headline: headline.length >= 6 ? headline : f.headline, benefit: withoutSuperlatives(cleanLine(it.benefit, 48)) || "", scene: scene.length > 20 ? scene : f.scene };
    });
    return out;
  } catch {
    return fallback();
  }
}

/** Фото YandexART под каждую услугу (кадр из serviceArt). Каждое сохраняем сразу — оплаченные кадры не пропадут при обрыве */
export async function generateServicePhotos(b: Business, items: ServiceArt[], opts: { until?: number } = {}): Promise<{ items: ServiceArt[]; errors: string[] }> {
  if (!aiConfigured() || !items.length) return { items, errors: [] };
  const style = "Рекламная фотосъёмка, фотореализм, как снял живой фотограф: естественный свет, настоящие материалы, лёгкая плёночная зернистость, неидеальные детали. Без текста, без надписей, без логотипов, без водяных знаков";
  const seed = Math.floor(Math.random() * 1e6);
  const errors: string[] = [];
  // Запасной кадр, если генератор отказался рисовать сюжет (дети, тело, медицина): нейтральный кадр ниши без людей
  const safe = photoPrompts(b, []);
  const out = [...items];
  let next = 0;
  const one = async (i: number) => {
    const it = out[i];
    if (it.photoId || it.failed) return;
    let last: unknown = null;
    let scene = it.scene;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const img = await art(`${style}. ${scene}`, { w: 1, h: 1 }, seed + i + attempt * 1000);
        out[i] = { ...it, photoId: (await saveImage(b.id, "generated", img, { prompt: `${it.service} :: ${it.scene}` })).id };
        return;
      } catch (e) {
        last = e;
        const msg = String((e as Error)?.message ?? e);
        if (/не могу|cannot|can't|policy|запрещ|другую тему/i.test(msg) && scene === it.scene && safe.length) {
          scene = `${safe[i % safe.length]}. Без людей в кадре`;
          continue;
        }
        if (!/endpoint|unavailable|internal|timeout|429|resource/i.test(msg)) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    out[i] = { ...out[i], failed: true };
    errors.push(String((last as Error)?.message ?? last));
  };
  // По 3 одновременно; после until новые кадры не начинаем — продолжим следующим шагом
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < out.length && (!opts.until || Date.now() < opts.until)) await one(next++);
  }));
  return { items: out, errors };
}

/** Реалистичные фото через YandexART: каждый кадр — свой сюжет и приём. Без текста и крупных лиц. */
export async function generatePhotos(b: Business, ideas: string[], count: number) {
  if (!aiConfigured() || count <= 0) return { ids: [] as string[], errors: [] as string[] };
  const prompts = (await creativeConcepts(b, ideas, count)).slice(0, count);
  const style = "Рекламная фотосъёмка, фотореализм, выразительная композиция, живые цвета, глубина резкости, настоящие материалы. Без текста, без надписей, без логотипов, без водяных знаков";
  const seed = Math.floor(Math.random() * 1e6);
  // Стиль — первым: промпт режется до 500 символов, и «без текста» не должно потеряться. Каждый кадр сохраняем сразу,
  // как он готов: если запрос оборвётся по времени, оплаченные картинки не пропадут
  const ids: string[] = [];
  const errors: string[] = [];
  await Promise.all(prompts.map(async (p, i) => {
    try {
      const img = await art(`${style}. ${p}`, { w: 1, h: 1 }, seed + i);
      ids.push((await saveImage(b.id, "generated", img, { prompt: prompts[i] })).id);
    } catch (e) {
      errors.push(String((e as Error)?.message ?? e));
    }
  }));
  return { ids, errors };
}

/**
 * variant — сюжет иллюстрации для картинок без фото. Если не передан, берём следующий по счёту
 * для этого бизнеса: так объявления в группе и между группами получают разные картинки.
 */
export async function makeCreative(b: Business, p: { layout: Layout; photoId?: string | null; width: number; height: number; headline?: string; price?: string; variant?: number; benefit?: string }) {
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
    benefit: p.benefit,
  });
  const saved = await saveImage(b.id, "creative", png, { layout: p.layout, prompt: p.photoId ?? undefined });
  // Подпись и выгода картинки — чтобы те же пропорции (imageSet) рисовались с тем же текстом, кто бы их ни дорисовывал
  if (p.headline || p.benefit) {
    const db = await getDb();
    const value = { headline: p.headline ?? null, benefit: p.benefit ?? null, variant: variant ?? 0 };
    await db.insert(schema.kv).values({ key: `imgctx:${saved.id}`, value }).onConflictDoUpdate({ target: schema.kv.key, set: { value, updatedAt: new Date() } });
  }
  return saved;
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
export async function imageSet(b: Business, baseImageId: string, ctx: { headline?: string; price?: string; until?: number } = {}) {
  const db = await getDb();
  const key = `imgset:${baseImageId}`;
  const base = await getImage(baseImageId);
  if (!base || !base.layout || base.layout === "logo") return [];
  const [row] = await db.select().from(schema.kv).where(eq(schema.kv.key, key));
  const known = { ...((row?.value as Record<string, string> | undefined) ?? {}) };
  for (const [r, id] of Object.entries(known)) if (!(await db.select({ id: schema.images.id }).from(schema.images).where(eq(schema.images.id, id))).length) delete known[r];
  const [ctxRow] = await db.select().from(schema.kv).where(eq(schema.kv.key, `imgctx:${baseImageId}`));
  const saved = ctxRow?.value as { headline?: string | null; benefit?: string | null; variant?: number } | undefined;
  const own = ratioKey(base.width, base.height);
  const srcPhoto = base.prompt?.startsWith("img_") ? base.prompt : null;
  // Владелец удалил исходное фото — новые пропорции без него получились бы другой картинкой, не дорисовываем
  const photoGone = srcPhoto ? !(await getImage(srcPhoto)) : false;
  let changed = false;
  for (const sz of DIRECT_IMAGE_SIZES) {
    const r = ratioKey(sz.width, sz.height);
    if (r === own || known[r] || photoGone) continue;
    if (ctx.until && Date.now() > ctx.until) break; // не успеваем — остальные пропорции дорисуем в следующем шаге
    try {
      const img = await makeCreative(b, { layout: base.layout as Layout, photoId: srcPhoto, width: sz.width, height: sz.height, headline: saved?.headline ?? ctx.headline, benefit: saved?.benefit ?? undefined, price: ctx.price, variant: saved?.variant ?? 0 });
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


/**
 * Уборка базы (на бесплатном Neon всего 512 МБ):
 *  - удаляем нарисованные картинки, на которые больше ничего не ссылается (старые черновики после перегенерации);
 *  - наборы пропорций (kv imgset:*) живут, пока жива исходная картинка; кэш фото-макетов (ownphoto:*) не держит картинки;
 *  - крупные фото владельца пережимаем в JPEG до 1600 px. Сами фото владельца не удаляем никогда.
 * ignorePlanOf — бизнес, черновик которого сейчас будет заменён.
 */
export async function collectGarbageImages(opts: { ignorePlanOf?: string; minAgeMin?: number; recompress?: number } = {}) {
  const db = await getDb();
  const { sql, like } = await import("drizzle-orm");
  const minAge = opts.minAgeMin ?? 30;
  const refs = new Set<string>();
  const add = (v: unknown) => { for (const m of JSON.stringify(v ?? null).matchAll(/img_[A-Za-z0-9_-]+/g)) refs.add(m[0]); };
  const biz = await db.select({ id: schema.businesses.id, plan: schema.businesses.launchPlan }).from(schema.businesses);
  for (const b of biz) if (b.id !== opts.ignorePlanOf) add(b.plan);
  add(await db.select().from(schema.ads));
  add(await db.select().from(schema.adGroups));
  add(await db.select().from(schema.campaigns));
  add(await db.select().from(schema.experiments));
  add(await db.select({ d: schema.changes.details, u: schema.changes.undo }).from(schema.changes));
  // Черновики добавления канала (kv addch:*) — их картинки ещё понадобятся при публикации
  add(await db.select({ v: schema.kv.value }).from(schema.kv).where(like(schema.kv.key, "addch:%")));
  const sets = await db.select().from(schema.kv).where(like(schema.kv.key, "imgset:%"));
  for (const r of sets) if (refs.has(r.key.slice(7))) add(r.value);
  const cands = await db
    .select({ id: schema.images.id, layout: schema.images.layout })
    .from(schema.images)
    .where(and(eq(schema.images.kind, "creative"), sql`${schema.images.createdAt} < now() - (${minAge} || ' minutes')::interval`));
  const dead = new Set(cands.filter((c) => c.layout !== "logo" && !refs.has(c.id)).map((c) => c.id));
  const ids = [...dead];
  for (let i = 0; i < ids.length; i += 200) await db.delete(schema.images).where(inArray(schema.images.id, ids.slice(i, i + 200)));
  // Кэш-записи, указывающие на удалённое, больше не нужны
  const caches = [...sets, ...(await db.select().from(schema.kv).where(like(schema.kv.key, "ownphoto:%"))), ...(await db.select().from(schema.kv).where(like(schema.kv.key, "imgctx:%")))];
  const staleKeys = caches.filter((r) => dead.has(r.key.split(":")[1]) || [...JSON.stringify(r.value).matchAll(/img_[A-Za-z0-9_-]+/g)].some((m) => dead.has(m[0]))).map((r) => r.key);
  for (let i = 0; i < staleKeys.length; i += 200) await db.delete(schema.kv).where(inArray(schema.kv.key, staleKeys.slice(i, i + 200)));
  // Тяжёлые фото владельца → JPEG
  let squeezed = 0;
  const heavy = await db
    .select({ id: schema.images.id })
    .from(schema.images)
    .where(and(inArray(schema.images.kind, ["photo", "generated"]), sql`octet_length(${schema.images.data}) > 700000`))
    .limit(opts.recompress ?? 15);
  for (const h of heavy) {
    const img = await getImage(h.id);
    if (!img) continue;
    const data = await compact(img.kind, Buffer.from(img.data));
    const size = imageSize(data);
    if (size && data.length < img.data.length) {
      await db.update(schema.images).set({ data, mime: size.mime, width: size.width, height: size.height }).where(eq(schema.images.id, h.id));
      squeezed++;
    }
  }
  if (ids.length || squeezed) {
    try { await db.execute(sql`VACUUM images`); } catch { /* PGlite / внутри транзакции — не страшно */ }
  }
  return { deleted: ids.length, squeezed };
}

import "server-only";
/**
 * Фото из найденных источников: скачиваем после сохранения анкеты (бизнесу нужен id),
 * только из подписанного списка, который вернул импорт, — сервер не качает произвольные ссылки.
 * Ограничения: JPEG/PNG, до 8 МБ, не меньше 450×450 (иначе площадки не примут), не больше 20 штук (и не больше места в галерее).
 */
import { safeFetch } from "./fetch";
import { imageSize } from "../creative/imagesize";
import { sign, verify } from "../crypto";
import { MAX_PHOTOS, ownerPhotoIds, saveImage } from "../engine/images";

export const IMPORT_PHOTOS = 20;
/** Сколько найденных фото подписываем в токене — из них владелец выбирает */
export const FOUND_PHOTOS = 40;
const MIN_SIDE = 450;

type PhotoToken = { k: "import-photos"; u: string; p: string[]; exp: number };

export function photoToken(userId: string, urls: string[]): string | null {
  return urls.length ? sign({ k: "import-photos", u: userId, p: urls.slice(0, FOUND_PHOTOS), exp: Date.now() + 6 * 3600e3 } satisfies PhotoToken) : null;
}

export function readPhotoToken(token: unknown, userId: string): string[] | null {
  const v = typeof token === "string" && token.length < 20000 ? verify<PhotoToken>(token) : null;
  return v && v.k === "import-photos" && v.u === userId && Array.isArray(v.p) ? v.p.filter((x) => typeof x === "string") : null;
}

/** Скачать одну картинку с проверками; null — не подошла */
export async function downloadPhoto(url: string): Promise<Buffer | null> {
  try {
    const f = await safeFetch(url, {
      timeoutMs: 7000,
      maxBytes: 8 * 1024 * 1024,
      accept: "image/jpeg,image/png;q=0.9,image/*;q=0.5",
      expect: (ct) => !ct || /^image\/|octet-stream/i.test(ct),
    });
    if (f.status >= 400) return null;
    const size = imageSize(f.body);
    if (!size || !/jpeg|png/.test(size.mime) || size.width < MIN_SIDE || size.height < MIN_SIDE) return null;
    return f.body;
  } catch {
    return null;
  }
}

/** Скачать и сохранить фото бизнеса (kind "photo" — как загруженные владельцем) */
export async function importPhotos(businessId: string, urls: string[], limit = IMPORT_PHOTOS): Promise<{ saved: number; skipped: number }> {
  const room = Math.max(0, MAX_PHOTOS - (await ownerPhotoIds(businessId)).length);
  const want = Math.min(limit, room);
  if (!want) return { saved: 0, skipped: urls.length };
  let saved = 0;
  const list = urls.slice(0, FOUND_PHOTOS);
  // По 4 параллельно — быстрее, но без лавины запросов к одному хосту
  for (let i = 0; i < list.length && saved < want; i += 4) {
    const bufs = await Promise.all(list.slice(i, i + 4).map(downloadPhoto));
    for (const b of bufs) {
      if (!b || saved >= want) continue;
      await saveImage(businessId, "photo", b);
      saved++;
    }
  }
  return { saved, skipped: list.length - saved };
}

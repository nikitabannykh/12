import { route, json, fail, needBusiness } from "@/lib/api";
import { saveImage, listPhotos, ownerPhotoIds, MAX_PHOTOS } from "@/lib/engine/images";
import { imageSize } from "@/lib/creative/imagesize";

export const GET = route(async ({ business }) => {
  if (!business) return json({ photos: [] });
  return json({ photos: await listPhotos(business.id) });
});

/** Фото владельца: приходят уже уменьшенными в браузере (JPEG до 1600 px) */
export const POST = route(async ({ business, req }) => {
  needBusiness(business);
  const { dataUrl } = await req.json();
  const m = /^data:image\/(jpeg|png);base64,(.+)$/.exec(String(dataUrl || ""));
  if (!m) return fail("Нужна фотография в формате JPEG или PNG");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 6 * 1024 * 1024) return fail("Фото слишком большое — до 6 МБ");
  const size = imageSize(buf);
  if (!size) return fail("Не получилось прочитать фото");
  if (size.width < 450 || size.height < 450) return fail("Фото маловато: нужно хотя бы 450×450 пикселей, иначе площадки его не примут");
  if ((await ownerPhotoIds(business.id)).length >= MAX_PHOTOS) return fail(`Загружено уже ${MAX_PHOTOS} фото — удалите старое, чтобы добавить новое`);
  const img = await saveImage(business.id, "photo", buf);
  return json({ id: img.id });
});

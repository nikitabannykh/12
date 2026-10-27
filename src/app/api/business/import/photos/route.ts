import { route, json, fail, needBusiness } from "@/lib/api";
import { importPhotos, readPhotoToken, IMPORT_PHOTOS } from "@/lib/importer/photos";
import { within } from "@/lib/ratelimit";

export const maxDuration = 60;

/**
 * Фото из найденных при автозаполнении источников — после сохранения анкеты.
 * Принимает только подписанный список (photoToken из /api/business/import), выбранные владельцем ссылки
 * должны быть из этого списка. Скачивает до 6 подходящих (JPEG/PNG от 450×450).
 */
export const POST = route(async ({ user, business, req }) => {
  needBusiness(business);
  const body = (await req.json().catch(() => ({}))) as { token?: unknown; urls?: unknown };
  const allowed = readPhotoToken(body.token, user.id);
  if (!allowed) return fail("Ссылка на фото устарела — запустите автозаполнение ещё раз или загрузите фото в разделе «Реклама»");
  const chosen = Array.isArray(body.urls) ? body.urls.filter((u): u is string => typeof u === "string" && allowed.includes(u)) : allowed;
  if (!chosen.length) return json({ saved: 0, skipped: 0 });
  if (!(await within([{ key: `import-photos:${user.id}`, limit: 10, windowSec: 3600 }]))) return fail("Слишком много попыток — попробуйте через час", 429);
  const r = await importPhotos(business.id, chosen, IMPORT_PHOTOS);
  return json(r);
});

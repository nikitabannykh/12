import { route, json, fail, needBusiness } from "@/lib/api";
import { importPhotos, readPhotoToken, IMPORT_PHOTOS } from "@/lib/importer/photos";
import { within } from "@/lib/ratelimit";

export const maxDuration = 60;

/**
 * Фото из найденных при автозаполнении источников — после сохранения анкеты.
 * Принимает только подписанный список (photoToken из /api/business/import), выбранные владельцем ссылки
 * должны быть из этого списка. Скачивает до 20 подходящих (JPEG/PNG от 450×450), сколько поместится в галерею.
 */
export const POST = route(async ({ user, business, req }) => {
  needBusiness(business);
  const body = (await req.json().catch(() => ({}))) as { token?: unknown; urls?: unknown; captions?: unknown };
  const allowed = readPhotoToken(body.token, user.id);
  if (!allowed) return fail("Ссылка на фото устарела — запустите автозаполнение ещё раз или загрузите фото в разделе «Реклама»");
  const chosen = Array.isArray(body.urls) ? body.urls.filter((u): u is string => typeof u === "string" && allowed.includes(u)) : allowed;
  if (!chosen.length) return json({ saved: 0, skipped: 0 });
  if (!(await within([{ key: `import-photos:${user.id}`, limit: 10, windowSec: 3600 }]))) return fail("Слишком много попыток — попробуйте через час", 429);
  // Подписи — только как метки «что на фото» (не ссылки и не команды): строка до 120 символов
  const raw = body.captions && typeof body.captions === "object" ? (body.captions as Record<string, unknown>) : {};
  const captions = Object.fromEntries(chosen.map((u) => [u, typeof raw[u] === "string" ? String(raw[u]).replace(/\s+/g, " ").trim().slice(0, 120) : ""]).filter(([, c]) => c));
  const r = await importPhotos(business.id, chosen, IMPORT_PHOTOS, captions);
  return json(r);
});

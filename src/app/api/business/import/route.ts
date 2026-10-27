import { z } from "zod";
import { route, json, fail } from "@/lib/api";
import { importFromUrls, normalizeInput, MAX_URLS, type ImportEvent } from "@/lib/importer";
import { photoToken } from "@/lib/importer/photos";
import { ipKey, within } from "@/lib/ratelimit";

export const maxDuration = 60;

/**
 * Черновик анкеты по ссылкам: сайт, Яндекс Карты, 2ГИС, Taplink, VK, DIKIDI, YCLIENTS.
 * Работает без YandexGPT (с ним — дополнительно заполняет пробелы по тексту сайта).
 * Ответ — Draft (JSON). С заголовком Accept: application/x-ndjson — поток событий
 * {type:"progress"|"source"|"done"|"error"} по строке, чтобы показывать «Читаем сайт… нашли 12 услуг».
 */
const Body = z.object({
  urls: z.array(z.string().trim().max(500)).max(10).optional(),
  url: z.string().trim().max(500).optional(), // старый формат: одна ссылка
});

export const POST = route(async ({ user, req }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Пришлите ссылки списком — например, на сайт и на Яндекс Карты");
  const raw = [...(parsed.data.urls ?? []), ...(parsed.data.url ? [parsed.data.url] : [])].filter(Boolean);
  if (!raw.length) return fail("Вставьте ссылку на сайт, Яндекс Карты, 2ГИС, Taplink, VK или YCLIENTS");
  const urls = raw.map(normalizeInput);
  const bad = raw.find((_, i) => !urls[i]);
  if (bad) return fail(`«${bad.slice(0, 60)}» не похоже на ссылку. Скопируйте адрес из браузера — например, studio-lak.ru или yandex.ru/maps/org/…`);
  if (urls.length > MAX_URLS) return fail(`Не больше ${MAX_URLS} ссылок за раз`);

  const ok = await within([
    { key: `import:u10m:${user.id}`, limit: 12, windowSec: 600 },
    { key: `import:uday:${user.id}`, limit: 60, windowSec: 86400 },
    { key: ipKey("import", req), limit: 40, windowSec: 3600 },
  ]);
  if (!ok) return fail("Слишком много попыток подряд. Подождите 10 минут или заполните поля вручную.", 429);

  const finish = <T extends { photos: string[]; photoToken?: string | null }>(d: T) => ({ ...d, photoToken: photoToken(user.id, d.photos) });

  if (!/application\/x-ndjson/.test(req.headers.get("accept") ?? "")) {
    return json(finish(await importFromUrls(urls as string[])));
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: ImportEvent) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          /* клиент ушёл */
        }
      };
      try {
        const draft = await importFromUrls(urls as string[], send);
        send({ type: "done", draft: finish(draft) });
      } catch (e) {
        console.error(e);
        send({ type: "error", error: "Не получилось прочитать ссылки. Попробуйте ещё раз или заполните поля вручную." });
      } finally {
        try {
          controller.close();
        } catch {
          /* уже закрыт */
        }
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
});

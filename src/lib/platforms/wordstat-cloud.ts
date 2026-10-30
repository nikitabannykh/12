import "server-only";
import type { WordstatPhrase } from "./types";

/**
 * Wordstat через Yandex Cloud AI Studio Search API v2 (POST /v2/wordstat/topRequests): синхронно, по одной фразе.
 * Нужны те же YANDEX_CLOUD_API_KEY и YANDEX_CLOUD_FOLDER_ID, что и для YandexGPT (src/lib/ai/yandex.ts), и роль
 * search-api.webSearch.user у сервисного аккаунта. Ответ: {totalCount, results:[{phrase, count}], associations}; числа — строками.
 * https://aistudio.yandex.ru/docs/en/search-api/operations/wordstat-gettop.html
 */
const URL_TOP = () => process.env.YANDEX_WORDSTAT_URL || "https://searchapi.api.cloud.yandex.net/v2/wordstat/topRequests";

export const cloudWordstatConfigured = () => Boolean(process.env.YANDEX_CLOUD_API_KEY && process.env.YANDEX_CLOUD_FOLDER_ID) && process.env.YANDEX_WORDSTAT_CLOUD !== "off";

export class CloudWordstatError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
  /** Ключ, права или квота: повторять бессмысленно — переключаемся на Директ */
  get fatal() {
    return this.status === 401 || this.status === 403 || this.status === 404 || this.status === 429;
  }
}

export async function cloudWordstat(phrase: string, regionIds: number[], opts: { numPhrases?: number; timeoutMs?: number } = {}): Promise<WordstatPhrase> {
  const body: Record<string, unknown> = {
    folderId: process.env.YANDEX_CLOUD_FOLDER_ID,
    phrase,
    numPhrases: opts.numPhrases ?? 50,
    devices: ["DEVICE_ALL"],
  };
  const regions = regionIds.filter((r) => r > 0).map(String);
  if (regions.length) body.regions = regions;
  let res: Response;
  try {
    res = await fetch(URL_TOP(), {
      method: "POST",
      headers: { Authorization: `Api-Key ${process.env.YANDEX_CLOUD_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
  } catch (e) {
    throw new CloudWordstatError(`Wordstat (Cloud): нет ответа (${(e as Error).name})`, 0);
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new CloudWordstatError(`Wordstat (Cloud): ${j?.message || j?.error?.message || res.status}`, res.status);
  const n = (v: unknown) => Math.max(0, Number(v ?? 0) || 0);
  const results = (Array.isArray(j?.results) ? j.results : []).map((x: any) => ({ phrase: String(x?.phrase ?? "").trim(), shows: n(x?.count) })).filter((x: { phrase: string }) => x.phrase);
  const shows = j?.totalCount !== undefined ? n(j.totalCount) : Math.max(0, ...results.map((x: { shows: number }) => x.shows));
  return { phrase, shows, searchedWith: results };
}

import "server-only";
import { sleep } from "../util";

/**
 * YandexGPT (тексты, семантика, разбор запросов) и YandexART (картинки) из Yandex Cloud Foundation Models.
 * Нужны YANDEX_CLOUD_API_KEY и YANDEX_CLOUD_FOLDER_ID. Без них сервис работает на шаблонах из базы ниш.
 */
const LLM = "https://llm.api.cloud.yandex.net/foundationModels/v1";
const OPS = "https://llm.api.cloud.yandex.net/operations";

export const aiConfigured = () => Boolean(process.env.YANDEX_CLOUD_API_KEY && process.env.YANDEX_CLOUD_FOLDER_ID);

const headers = () => ({
  Authorization: `Api-Key ${process.env.YANDEX_CLOUD_API_KEY}`,
  "x-folder-id": process.env.YANDEX_CLOUD_FOLDER_ID || "",
  "Content-Type": "application/json",
});

/** Сколько ждём ответа модели по умолчанию: функции живут до 60 с, зависший запрос не должен съесть всё время */
export const GPT_TIMEOUT_MS = 25_000;

export async function gpt(system: string, user: string, opts: { temperature?: number; maxTokens?: number; json?: boolean; timeoutMs?: number } = {}): Promise<string> {
  const model = process.env.YANDEX_GPT_MODEL || "yandexgpt/latest";
  const body: Record<string, unknown> = {
    modelUri: `gpt://${process.env.YANDEX_CLOUD_FOLDER_ID}/${model}`,
    completionOptions: { stream: false, temperature: opts.temperature ?? 0.5, maxTokens: String(opts.maxTokens ?? 3000) },
    messages: [
      { role: "system", text: system },
      { role: "user", text: user },
    ],
  };
  if (opts.json) body.jsonObject = true;
  const timeoutMs = Math.max(1_000, opts.timeoutMs ?? GPT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${LLM}/completion`, { method: "POST", headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    if ((e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError") throw new Error(`YandexGPT: нет ответа за ${Math.round(timeoutMs / 1000)} с`);
    throw e;
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`YandexGPT: ${j?.error?.message || j?.message || res.status}`);
  return String(j?.result?.alternatives?.[0]?.message?.text ?? "");
}

/** Достаём JSON из ответа модели, даже если он обёрнут в ```json */
export function parseJson<T>(text: string): T {
  const cleaned = text.replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.search(/[\[{]/);
    const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as T;
    throw new Error("Модель вернула не JSON");
  }
}

/**
 * JSON от модели, до двух попыток. until — к какому моменту (Date.now()) ответ нужен обязательно:
 * ожидание каждой попытки урезаем до оставшегося времени, на новую попытку без запаса времени не идём.
 */
export async function gptJson<T>(system: string, user: string, opts: { temperature?: number; maxTokens?: number; timeoutMs?: number; until?: number } = {}): Promise<T> {
  let lastErr: unknown;
  const { until, ...rest } = opts;
  for (let i = 0; i < 2; i++) {
    const left = until ? until - Date.now() : Infinity;
    if (left < 3_000) {
      lastErr ??= new Error("YandexGPT: не хватило времени на ответ");
      break;
    }
    try {
      const text = await gpt(system, user, { ...rest, timeoutMs: Math.min(rest.timeoutMs ?? GPT_TIMEOUT_MS, left), json: true });
      return parseJson<T>(text);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/** YandexART: асинхронная генерация, опрашиваем операцию до готовности. Возвращает JPEG. */
export async function art(prompt: string, aspect: { w: number; h: number }, seed?: number): Promise<Buffer> {
  const res = await fetch(`${LLM}/imageGenerationAsync`, {
    signal: AbortSignal.timeout(20_000),
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      modelUri: `art://${process.env.YANDEX_CLOUD_FOLDER_ID}/yandex-art/latest`,
      generationOptions: {
        seed: String(seed ?? Math.floor(Math.random() * 1e9)),
        aspectRatio: { widthRatio: String(aspect.w), heightRatio: String(aspect.h) },
        mimeType: "image/jpeg",
      },
      messages: [{ weight: "1", text: prompt.slice(0, 500) }],
    }),
  });
  const op = await res.json().catch(() => ({}));
  if (!res.ok || !op.id) throw new Error(`YandexART: ${op?.error?.message || op?.message || res.status}`);
  const deadline = Date.now() + 55_000;
  while (Date.now() < deadline) {
    await sleep(3000);
    const r = await fetch(`${OPS}/${op.id}`, { headers: headers(), signal: AbortSignal.timeout(20_000) });
    const j = await r.json().catch(() => ({}));
    if (j.done) {
      if (j.error) throw new Error(`YandexART: ${j.error.message}`);
      return Buffer.from(j.response.image, "base64");
    }
  }
  throw new Error("YandexART: генерация заняла больше минуты");
}

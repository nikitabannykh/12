import "server-only";

/**
 * Авторизация в Yandex Cloud (YandexGPT, YandexART, Wordstat):
 *  - API-ключ сервисного аккаунта — YANDEX_CLOUD_API_KEY (Vercel и любой хостинг);
 *  - на ВМ в Yandex Cloud ключ не нужен: YANDEX_CLOUD_METADATA_IAM=1 — берём IAM-токен сервисного аккаунта ВМ
 *    из сервиса метаданных (роли ai.languageModels.user, ai.imageGeneration.user, search-api.webSearch.user).
 *    Секрета в настройках тогда нет вовсе — токен живёт ~12 часов и обновляется сам.
 */
const MD_TOKEN = "http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token";
let cached: { token: string; until: number } | null = null;

export const cloudAuthConfigured = () =>
  Boolean((process.env.YANDEX_CLOUD_API_KEY || process.env.YANDEX_CLOUD_METADATA_IAM === "1") && process.env.YANDEX_CLOUD_FOLDER_ID);

export async function cloudAuthHeader(): Promise<string> {
  if (process.env.YANDEX_CLOUD_API_KEY) return `Api-Key ${process.env.YANDEX_CLOUD_API_KEY}`;
  if (cached && cached.until > Date.now()) return `Bearer ${cached.token}`;
  const r = await fetch(MD_TOKEN, { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`Yandex Cloud: не удалось получить IAM-токен ВМ (${r.status})`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  // Обновляем заранее: за 5 минут до истечения
  cached = { token: j.access_token, until: Date.now() + Math.max(60, j.expires_in - 300) * 1000 };
  return `Bearer ${cached.token}`;
}

import { FetchError, safeFetch } from "@/lib/importer/fetch";
import type { LandingSettings } from "@/lib/engine/landing";

/**
 * Сайт владельца становится ссылкой объявлений по умолчанию, только если он открывается. Сайт, которого нет
 * («Такого сайта нет»), сохраняем как есть (владелец мог опечататься — поправит), но реклама по умолчанию
 * ведёт на страницу записи. Метки в настройках ссылки (landing):
 *  siteBad — адрес сайта, который не открылся; autoPage — страницу записи поставили мы, а не владелец.
 */
export type SiteMarks = { siteBad?: string; siteOk?: string; autoPage?: boolean };

/** true — сайт ответил; false — сайта нет или он не открывается; null — не узнали (например, долго отвечает) */
export async function siteReachable(url: string): Promise<boolean | null> {
  try {
    const r = await safeFetch(url, { timeoutMs: 5000, maxBytes: 64 * 1024, truncate: true });
    return r.status < 500;
  } catch (e) {
    if (e instanceof FetchError) return e.code === "timeout" || e.code === "too_big" ? null : false;
    return null;
  }
}

/**
 * Новые настройки ссылки после проверки сайта (или null — менять нечего).
 * Проверяем, когда сайт новый или реклама по умолчанию ведёт на непроверенный сайт.
 */
export async function landingAfterSiteCheck(siteUrl: string | null, prevSite: string | null | undefined, landing: unknown): Promise<{ landing: LandingSettings & SiteMarks; bad: boolean } | null> {
  const l = ((landing && typeof landing === "object" ? landing : {}) as LandingSettings & SiteMarks);
  const mode = l.mode ?? "auto";
  if (!siteUrl) {
    // Сайт убрали — наши метки больше не нужны
    if (!l.siteBad && !l.siteOk && !l.autoPage) return null;
    const { siteBad: _b, siteOk: _o, autoPage, ...rest } = l;
    return { landing: { ...rest, mode: autoPage && mode === "page" ? "auto" : mode }, bad: false };
  }
  const usesSite = mode === "auto" || mode === "site" || Object.values(l.channels ?? {}).some((t) => t?.mode === "site") || l.autoPage;
  const checked = l.siteOk === siteUrl || l.siteBad === siteUrl;
  if (!usesSite || (siteUrl === prevSite && checked)) return null;
  const ok = await siteReachable(siteUrl);
  if (ok === null) return null;
  const { siteBad: _b, siteOk: _o, autoPage, ...rest } = l;
  if (ok) {
    // Сайт открылся: если страницу записи ставили мы — возвращаем «как обычно» (сайт)
    return { landing: { ...rest, mode: autoPage && mode === "page" ? "auto" : mode, siteOk: siteUrl }, bad: false };
  }
  const channels = Object.fromEntries(Object.entries(rest.channels ?? {}).filter(([, t]) => t?.mode !== "site"));
  return {
    landing: {
      ...rest,
      mode: mode === "auto" || mode === "site" ? "page" : mode,
      ...(Object.keys(channels).length ? { channels } : { channels: undefined }),
      siteBad: siteUrl,
      autoPage: mode === "auto" || mode === "site" || autoPage,
    },
    bad: true,
  };
}

export const siteWarning = (url: string) =>
  `Сайт ${url.replace(/^https?:\/\//, "").replace(/\/$/, "")} не открылся — проверьте адрес. Пока реклама будет вести на вашу страницу записи.`;

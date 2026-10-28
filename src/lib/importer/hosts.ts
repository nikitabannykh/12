/**
 * Какая площадка по ссылке — по адресу, без сети. Модуль без серверных зависимостей:
 * его используют и адаптеры импорта, и форма, и сохранение ссылок бизнеса.
 */
import type { SourceKind } from "./types";

export const isYandexMaps = (u: URL) => /(^|\.)(yandex\.(ru|com|kz|by|uz|com\.tr|com\.am|az|fr)|ya\.ru)$/i.test(u.hostname) && /^\/(web-)?maps\b/.test(u.pathname);
export const isDgis = (u: URL) => /(^|\.)2gis\.(ru|kz|kg|uz|com|ae|cy|az|am|ge)$/i.test(u.hostname);
export const isDikidi = (u: URL) => /(^|\.)dikidi\.(net|ru|app)$/i.test(u.hostname);
export const isTaplink = (u: URL) => /(^|\.)taplink\.(cc|ru|at|me|ws)$/i.test(u.hostname);
export const isVk = (u: URL) => /(^|\.)(vk\.com|vk\.ru|vkontakte\.ru)$/i.test(u.hostname);
export const isYclients = (u: URL) => /(^|\.)yclients\.(com|ru)$/i.test(u.hostname);

/** Площадка по ссылке; всё незнакомое — «site» */
export function hostKind(url: string | URL): SourceKind {
  try {
    const u = typeof url === "string" ? new URL(url) : url;
    if (isYandexMaps(u)) return "yandex";
    if (isDgis(u)) return "dgis";
    if (isDikidi(u)) return "dikidi";
    if (isYclients(u)) return "yclients";
    if (isTaplink(u)) return "taplink";
    if (isVk(u)) return "vk";
  } catch {
    /* сайт */
  }
  return "site";
}

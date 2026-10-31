/**
 * Общие типы автозаполнения «по ссылке». Модуль без серверных зависимостей — его импортирует и форма.
 */

export type ImportService = { name: string; price?: string; category?: string; note?: string };

/** Откуда пришли данные */
export type SourceKind = "site" | "yandex" | "dgis" | "dikidi" | "yclients" | "taplink" | "vk";

/** Подпись на чипе у поля: «с сайта», «из 2ГИС» */
export const SOURCE_CHIP: Record<SourceKind, string> = {
  site: "с сайта",
  yandex: "из Яндекс Карт",
  dgis: "из 2ГИС",
  dikidi: "из DIKIDI",
  yclients: "из YCLIENTS",
  taplink: "из Taplink",
  vk: "из VK",
};

/** Название источника в строке прогресса: «Читаем Яндекс Карты…» */
export const SOURCE_NAME: Record<SourceKind, string> = {
  site: "сайт",
  yandex: "Яндекс Карты",
  dgis: "2ГИС",
  dikidi: "DIKIDI",
  yclients: "YCLIENTS",
  taplink: "Taplink",
  vk: "VK",
};

export type Rating = { value: number; count: number };

export type AddressOption = { address: string; city: string };

/** Что нашёл один источник (адаптер). Пустые поля — не нашли. */
export type Found = {
  kind: SourceKind;
  url: string;
  /** ok — прочитали; partial — только то, что видно из самой ссылки; blocked — защита от роботов; error — не открылось */
  status: "ok" | "partial" | "blocked" | "error";
  message?: string;
  name?: string;
  categories?: string[];
  city?: string;
  address?: string;
  /** Все найденные адреса (филиалы) — владелец выберет основной */
  addresses?: AddressOption[];
  phone?: string;
  whatsapp?: string;
  telegram?: string;
  hours?: string;
  siteUrl?: string;
  orgUrl?: string;
  services?: ImportService[];
  /** Услуги из структурированных данных (schema.org, прайс площадки), а не из угадывания по тексту */
  servicesStructured?: boolean;
  advantages?: string[];
  /** «ИП Иванова А. С., ИНН …» — если на сайте есть реквизиты */
  legalInfo?: string;
  /** Предложение для новых клиентов, если оно написано на странице */
  offer?: string;
  description?: string;
  review?: string;
  rating?: Rating;
  photos?: string[];
  /** Подписи к фото (ссылка → что на нём: alt картинки или название позиции, к которой она приложена) */
  photoCaptions?: Record<string, string>;
  /** Видимый текст страницы — для определения сферы и для YandexGPT */
  text?: string;
  /** Ссылки, найденные внутри источника (сайт из карточки Карт, онлайн-запись), — прочитаем их тоже */
  links?: string[];
};

export type DraftField =
  | "name" | "niche" | "city" | "address" | "phone" | "whatsapp" | "telegram" | "hours" | "siteUrl" | "orgUrl"
  | "services" | "advantages" | "description" | "review" | "rating" | "photos" | "legalInfo" | "offer";

/** Отчёт по одной ссылке — для строки прогресса и подсказок */
export type ImportReport = { url: string; kind: SourceKind; status: Found["status"]; message?: string; summary: string };

export type Draft = {
  name: string;
  niche: string | null;
  city: string;
  address: string;
  /** Несколько адресов (филиалы): основной — address, остальные можно выбрать */
  addresses: AddressOption[];
  phone: string;
  whatsapp: string;
  telegram: string;
  hours: string;
  siteUrl: string;
  orgUrl: string;
  services: ImportService[];
  /** Выбранные преимущества (первые) — в анкету */
  advantages: string[];
  /** Все найденные преимущества — владелец отметит нужные */
  advantagesFound: string[];
  legalInfo: string;
  offer: string;
  description: string;
  review: string | null;
  rating: Rating | null;
  photos: string[];
  /** Подписи к фото — сохраняем вместе с фото, чтобы позиция получала свою картинку */
  photoCaptions?: Record<string, string>;
  /** Поле → подпись источника («из 2ГИС») */
  sources: Partial<Record<DraftField, string>>;
  reports: ImportReport[];
  /** Обязательные поля, которых не нашли: name, niche, city, contact, services */
  missing: ("name" | "niche" | "city" | "contact" | "services")[];
  /** Подписанный список фото: при сохранении сервер скачает только их */
  photoToken?: string | null;
  /** Помог ли YandexGPT */
  ai?: boolean;
};

/** События потока /api/business/import (NDJSON) */
export type ImportEvent =
  | { type: "progress"; text: string; kind?: SourceKind; url?: string }
  | { type: "source"; report: ImportReport }
  | { type: "done"; draft: Draft }
  | { type: "error"; error: string };

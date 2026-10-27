/**
 * Каналы и типы кампаний — один справочник для сервера и интерфейса (без server-only).
 *
 * Канал (`campaigns.channel`) — это отдельная кампания на площадке со своим бюджетом:
 *   search          — Директ, ЕПК, только поиск (и Карты, если привязана организация);
 *   network         — Директ, ЕПК, только сети (РСЯ): картинки похожим людям на сайтах и в приложениях;
 *   vk              — VK Реклама: лента ВКонтакте и Одноклассников, люди рядом (радиус/возраст);
 *   retarget_yandex — Директ, ЕПК в сетях с условием ретаргетинга Метрики «были на сайте, но не оставили заявку»;
 *   retarget_vk     — VK Реклама с сегментом по пикселю «были на сайте, но не оставили заявку».
 *
 * Тип (`CampaignType`) — как кампанию видит владелец: «Поиск», «Сети», «Соцсети», «Ретаргетинг», «Карты».
 * «Карты» — не отдельная кампания: это места показа поисковой ЕПК (PlacementTypes Maps / SearchOrganizationList)
 * при привязанной организации (business.orgId), поэтому в интерфейсе это карточка без своего бюджета.
 *
 * Формат (`format`) — какие объявления и лимиты текста у канала: ретаргетинг Яндекса — как РСЯ, ретаргетинг VK — как VK.
 */
export type Channel = "search" | "network" | "vk" | "retarget_yandex" | "retarget_vk";
export type CampaignType = "search" | "network" | "feed" | "retarget" | "maps";
export type Family = "yandex" | "vk";
export type AdFormat = "search" | "network" | "vk";

export const CHANNELS: Channel[] = ["search", "network", "vk", "retarget_yandex", "retarget_vk"];
export const isChannel = (x: unknown): x is Channel => typeof x === "string" && (CHANNELS as string[]).includes(x);

export const CHANNEL_INFO: Record<Channel, { family: Family; type: CampaignType; format: AdFormat; name: string; short: string; hint: string }> = {
  search: {
    family: "yandex", type: "search", format: "search",
    name: "Поиск Яндекса", short: "Поиск Яндекса",
    hint: "Показываем тем, кто прямо сейчас ищет услугу в Яндексе",
  },
  network: {
    family: "yandex", type: "network", format: "network",
    name: "Сайты и приложения (РСЯ)", short: "РСЯ: сайты и приложения",
    hint: "Показываем картинку тем, кто недавно интересовался услугой, — на сайтах, в Дзене и приложениях",
  },
  vk: {
    family: "vk", type: "feed", format: "vk",
    name: "ВКонтакте и Одноклассники", short: "ВКонтакте и ОК",
    hint: "Показываем в ленте ВКонтакте и Одноклассников людям рядом с вами",
  },
  retarget_yandex: {
    family: "yandex", type: "retarget", format: "network",
    name: "Ретаргетинг в Яндексе", short: "Ретаргетинг Яндекса",
    hint: "Напоминаем о вас тем, кто был на странице записи или сайте, но не записался, — на сайтах и в приложениях Яндекса",
  },
  retarget_vk: {
    family: "vk", type: "retarget", format: "vk",
    name: "Ретаргетинг ВКонтакте", short: "Ретаргетинг VK",
    hint: "Напоминаем о вас в ленте ВКонтакте и Одноклассников тем, кто уже заходил на сайт, но не записался",
  },
};

export const TYPE_INFO: Record<CampaignType, { label: string; purpose: string; cls: string }> = {
  search: { label: "Поиск", purpose: "ловим тех, кто ищет сейчас", cls: "bg-mark-soft text-ink" },
  network: { label: "Сети", purpose: "показываем похожим людям на сайтах", cls: "bg-info-soft text-ink-2" },
  feed: { label: "Соцсети", purpose: "лента соцсетей рядом с вами", cls: "bg-[#e8eefb] text-[#2b4c9b]" },
  retarget: { label: "Ретаргетинг", purpose: "возвращаем тех, кто уже был", cls: "bg-good-soft text-good" },
  maps: { label: "Карты", purpose: "ваша точка на Яндекс Картах", cls: "bg-warn-soft text-warn" },
};
export const TYPE_ORDER: CampaignType[] = ["search", "network", "feed", "retarget", "maps"];

export const FAMILY_NAME: Record<Family, string> = { yandex: "Яндекс", vk: "VK" };

export const familyOf = (channel: string): Family => CHANNEL_INFO[channel as Channel]?.family ?? (channel === "vk" ? "vk" : "yandex");
export const typeOf = (channel: string): CampaignType => CHANNEL_INFO[channel as Channel]?.type ?? "search";
/** Формат объявлений канала: лимиты текста, превью, картинки, логотип VK */
export const formatOf = (channel: string): AdFormat => CHANNEL_INFO[channel as Channel]?.format ?? (channel === "vk" ? "vk" : channel === "network" ? "network" : "search");
export const isRetarget = (channel: string) => channel === "retarget_yandex" || channel === "retarget_vk";
/** Основной канал той же площадки, по чьим текстам и картинкам делается ретаргетинг */
export const baseOf = (channel: Channel): Channel => (channel === "retarget_yandex" ? "network" : channel === "retarget_vk" ? "vk" : channel);
export const retargetOf = (family: Family): Channel => (family === "vk" ? "retarget_vk" : "retarget_yandex");

/**
 * Ретаргетинг включается сам, когда аудитория «были, но не записались» наберёт столько человек: на меньшей
 * аудитории Директ и VK не показывают (Директ — условия ретаргетинга с охватом меньше ~100 человек не работают).
 */
export const RETARGET_MIN_AUDIENCE = 100;
/** Доля уникальных людей среди переходов из рекламы (часть людей кликает несколько раз) */
export const UNIQUE_SHARE = 0.7;
/** Окно аудитории ретаргетинга: «были на сайте за последние 30 дней» */
export const RETARGET_WINDOW_DAYS = 30;

/** Состояние ретаргетинга в campaigns.meta.audience */
export type AudienceMeta = {
  /** collecting — копим аудиторию (кампания создана, но стоит); on — включён; off — владелец выключил автовключение */
  state: "collecting" | "on" | "off";
  need: number;
  size?: number;
  /** С какого дня считаем аудиторию (YYYY-MM-DD, по часам бизнеса) */
  since?: string;
  /** Почему ещё не включили, хотя аудитории хватает (например, бюджет) */
  note?: string | null;
  at?: string;
  activatedAt?: string;
};
export const audienceMeta = (c: { meta?: Record<string, unknown> | null }) => ((c.meta ?? {}) as { audience?: AudienceMeta }).audience ?? null;
/** Кампания ретаргетинга создана, но ждёт аудиторию (или владелец отключил автовключение) — стоит не из-за бюджета */
export const waitingAudience = (c: { channel: string; status: string; meta?: Record<string, unknown> | null }) =>
  isRetarget(c.channel) && c.status === "paused" && (audienceMeta(c)?.state === "collecting" || audienceMeta(c)?.state === "off");

/**
 * Ссылка на кампанию в кабинете площадки. Документированного формата у площадок нет — используем адреса
 * нового интерфейса: Директ открывает список кампаний с фильтром по ID (campaigns-ids) под нужным логином (ulogin),
 * VK — список кампаний (ad_plans) кабинета; номер кампании показываем рядом со ссылкой.
 */
export function cabinetUrl(platform: string, externalId: string | null | undefined, login?: string | null): string | null {
  if (!externalId) return null;
  if (platform === "yandex") {
    const q = new URLSearchParams();
    if (login) q.set("ulogin", login);
    q.set("campaigns-ids", externalId);
    return `https://direct.yandex.ru/dna/grid/campaigns?${q.toString()}`;
  }
  if (platform === "vk") return `https://ads.vk.com/hq/dashboard/ad_plans?ad_plan_id=${encodeURIComponent(externalId)}`;
  return null;
}

/** Фильтры страницы «Реклама»: ?p=yandex|vk&t=search|network|feed|retarget|maps */
export function adsHref(p?: Family | null, t?: CampaignType | null, anchor?: string) {
  const q = new URLSearchParams();
  if (p) q.set("p", p);
  if (t) q.set("t", t);
  const s = q.toString();
  return `/app/ads${s ? `?${s}` : ""}${anchor ? `#${anchor}` : ""}`;
}

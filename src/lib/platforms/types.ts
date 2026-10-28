import type { AdExtras } from "../engine/extras";
export type Platform = "yandex" | "vk" | "demo";
import type { Channel } from "../channels";
export type { Channel } from "../channels";
export type Strategy = "clicks" | "conversions";

export type ImageInput = { imageId: string; data: Buffer; mime: string; width: number; height: number; cachedRef?: string };

export type AdSpec = {
  localId: string;
  title: string; // Директ: до 56 символов; VK: до 40
  title2?: string | null; // Директ: до 30
  text: string; // Директ: до 81; VK: до 90
  href: string;
  image?: ImageInput | null;
  /** Уточнения, быстрые ссылки, цена, визитка, длинный текст — см. engine/extras */
  extras?: AdExtras | null;
  /** Логотип 256×256 для VK */
  logo?: ImageInput | null;
  marking?: string; // описание объекта рекламы для ЕРИР
  /**
   * Директ (комбинаторное объявление ResponsiveAd): все заголовки и тексты, из которых Яндекс собирает показ.
   * Первый элемент — основной (title/text выше). Не задано — шлём только основные. Строятся детерминированно
   * из анкеты (extras.responsiveAssets), поэтому в БД хранится только основной заголовок/текст.
   */
  titles?: string[];
  texts?: string[];
  /** Директ: дополнительные картинки других пропорций (1:1, 16:9, 4:3, 3:4) — до 5 вместе с image */
  images?: ImageInput[];
};

export type GroupSpec = {
  localId: string;
  name: string;
  keywords: string[];
  /** Минус-слова группы (Директ: AdGroup.NegativeKeywords, до 4096 символов вместе) — кросс-минусовка между группами */
  negatives?: string[];
  autotargeting: boolean;
  regionIds: number[];
  ageFrom?: number;
  ageTo?: number;
  sex?: "female" | "male" | "any";
  /**
   * Ретаргетинг: ID аудитории на площадке (Директ — условие ретаргетинга RetargetingLists, VK — сегмент
   * remarketing/segments). Группа без ключевых фраз и автотаргетинга, показ — только этой аудитории.
   */
  retargetingId?: string | null;
  ads: AdSpec[];
};

/** Что нужно площадке, чтобы собрать аудиторию «были на сайте, но не оставили заявку» */
export type AudienceSpec = {
  name: string;
  /** Директ: счётчик Метрики, цель «посетил сайт» и цель «обращение» */
  counterId?: number | null;
  visitGoalId?: number | null;
  leadGoalId?: number | null;
  /** VK: пиксель (счётчик Top@Mail.ru) и событие «заявка» */
  pixelId?: number | null;
  leadGoal?: string | null;
  /** Дней в аудитории */
  days: number;
};

/** Расписание показов по часам работы (Директ TimeTargeting): 7 строк «день,24 коэффициента» */
export type TimeTargetingSpec = { schedule: string[]; timeZone: string; considerWorkingWeekends: boolean; note: string };

export type DemographicsAdjustment = { Gender?: "GENDER_MALE" | "GENDER_FEMALE"; Age?: string; BidModifier: number };

/** Настройки показа для уже идущих кампаний (меняет владелец в «Настройках показа») */
export type TargetingUpdate = {
  /** Директ: расписание кампании (null — круглосуточно) */
  timeTargeting?: TimeTargetingSpec | null;
  demographics?: DemographicsAdjustment[];
  /** Группы: ID на площадке → регионы, возраст и пол, аудитория ретаргетинга */
  groups: { groupExt: string; regionIds: number[]; ageFrom?: number; ageTo?: number; sex?: "female" | "male" | "any"; retargetingId?: string | null }[];
};

/** Лимиты площадки на объявления в группе (Директ, комбинаторные: 3 неархивных и 10 вместе с архивными) */
export type AdLimits = { nonArchived: number; total: number };

export type CampaignSpec = {
  name: string;
  channel: Channel;
  weeklyBudget: number; // ₽
  strategy: Strategy;
  startDate: string; // YYYY-MM-DD
  counterId?: number | null;
  goalId?: number | null;
  negativeKeywords: string[];
  siteUrl: string;
  /** Директ: ID организации в Яндекс Бизнесе (permalink). Привязываем, если профиль опубликован и доступен логину */
  orgId?: string | null;
  /** Директ: расписание показов по часам работы */
  timeTargeting?: TimeTargetingSpec | null;
  /** Директ: корректировки «пол и возраст» −100% для тех, кому владелец не хочет показывать */
  demographics?: DemographicsAdjustment[];
  groups: GroupSpec[];
  /**
   * Метка запуска (короткая, латиница/цифры). Попадает в имя кампании на площадке, где по имени ищем
   * кампанию, созданную прерванной попыткой этого же запуска (VK), — и не «усыновляем» чужие.
   */
  tag?: string;
  /** Что уже создано прошлыми попытками этого запуска: продолжаем с места обрыва, а не создаём заново */
  resume?: ResumeState | null;
  /** Время (мс, epoch), после которого новые группы/объявления не начинаем: вернём complete=false и продолжим следующим вызовом */
  deadline?: number;
};

export type ResumeState = {
  campaignExt: string | null;
  /** localId группы → её ID на площадке и уже созданные объявления (localId объявления → ID на площадке) */
  groups: Record<string, { groupExt: string; ads: Record<string, string> }>;
};

export type LaunchResult = {
  campaignExt: string;
  groups: { localId: string; groupExt: string; ads: { localId: string; adExt: string | null; error?: string; imageRef?: string }[] }[];
  warnings: string[];
  /** false — не успели до spec.deadline; созданное уже передано в хуки, следующий вызов продолжит */
  complete?: boolean;
};

export type AdState = { status: "moderation" | "active" | "paused" | "rejected" | "archived"; note?: string };

export type StatRow = {
  campaignExt: string;
  adExt: string; // "" — если площадка не дала разбивку по объявлениям
  day: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  /** Только поиск Директа: средний объём трафика (100 — первое место над результатами) и средняя позиция показа */
  trafficVolume?: number | null;
  position?: number | null;
};

/** Аукцион по группе: сколько стоит клик за каждый объём трафика (место в выдаче), ₽ */
export type AuctionTier = { trafficVolume: number; bid: number; price: number };
export type AuctionRow = { groupExt: string; keywords: number; tiers: AuctionTier[] };

export type QueryRow = { campaignExt: string; query: string; impressions: number; clicks: number; cost: number };

/**
 * Колбэки запуска: ID кампании, групп и объявлений сохраняем в БД сразу, как площадка их вернула, —
 * чтобы таймаут не оставил «сирот», а повтор продолжил с места обрыва.
 */
export type LaunchHooks = {
  onCampaignCreated?: (campaignExt: string) => Promise<void>;
  onGroupCreated?: (groupLocalId: string, groupExt: string) => Promise<void>;
  onAdsCreated?: (groupLocalId: string, groupExt: string, ads: { localId: string; adExt: string | null; error?: string; imageRef?: string }[]) => Promise<void>;
  /** Картинка загружена на площадку — запоминаем ссылку, чтобы повтор не грузил её снова */
  onImageUploaded?: (imageId: string, ref: string) => Promise<void>;
};

export interface PlatformClient {
  platform: Platform;
  /**
   * Создаёт кампанию в состоянии, в котором она НЕ тратит деньги (Директ: объявления-черновики без модерации;
   * VK: план «blocked»). Показы включает activateCampaign в конце успешного запуска.
   */
  launchCampaign(spec: CampaignSpec, hooks?: LaunchHooks): Promise<LaunchResult>;
  /** Включить созданную launchCampaign кампанию: отправить объявления на модерацию / разблокировать план */
  activateCampaign(campaignExt: string, adExts: string[]): Promise<void>;
  /** Создать (или найти созданную раньше) аудиторию ретаргетинга. Возвращает её ID на площадке */
  ensureAudience?(a: AudienceSpec): Promise<string>;
  /** Найти кампанию по имени на площадке (для уборки, когда ID не успели сохранить) */
  findCampaignByName?(name: string): Promise<string | null>;
  /** Удалить (или, если площадка не даёт, остановить) недосозданную кампанию — для возобновления прерванного запуска */
  removeCampaign?(campaignExt: string): Promise<void>;
  addAd(campaignExt: string, groupExt: string, ad: AdSpec, ctx: { channel: Channel; orgId?: string | null }): Promise<{ adExt: string; imageRef?: string }>;
  /** Лимиты на число объявлений в группе для канала (null — площадка их не ограничивает так жёстко) */
  adLimits?(channel: Channel): AdLimits | null;
  /** В архив: архивные объявления не показываются и не занимают место среди 3 неархивных в группе Директа */
  archiveAds?(adExts: string[]): Promise<void>;
  /** Удалить (Директ разрешает только объявления без показов). Возвращает удалённые */
  deleteAds?(adExts: string[]): Promise<string[]>;
  /** Новая группа в работающей кампании (когда в старой исчерпан лимит объявлений) */
  addGroup?(campaignExt: string, g: Omit<GroupSpec, "ads" | "localId">, ctx: { channel: Channel }): Promise<{ groupExt: string; warnings: string[] }>;
  setCampaignActive(campaignExt: string, active: boolean): Promise<void>;
  setAdsActive(adExts: string[], active: boolean): Promise<void>;
  setBudget(campaignExt: string, p: { channel: Channel; weeklyBudget: number; strategy: Strategy; goalId?: number | null; bidCeiling?: number | null }): Promise<void>;
  setNegativeKeywords(campaignExt: string, words: string[]): Promise<void>;
  /** Поменять регион, возраст/пол и расписание у идущей кампании (без пересоздания) */
  /** Сменить ссылку у идущих объявлений (куда ведёт реклама). Возвращает предупреждения */
  updateAdsHref?(adExts: string[], href: string): Promise<string[]>;
  updateTargeting?(campaignExt: string, t: TargetingUpdate): Promise<string[]>;
  updateAdText(adExt: string, t: { title: string; title2?: string | null; text: string; titles?: string[]; texts?: string[] }): Promise<void>;
  getAdStates(adExts: string[]): Promise<Record<string, AdState>>;
  getStats(campaignExts: string[], from: string, to: string, goalIds: number[]): Promise<StatRow[]>;
  getAuction?(campaignExt: string): Promise<AuctionRow[]>;
  getSearchQueries?(campaignExts: string[], from: string, to: string): Promise<QueryRow[]>;
}

export class PlatformError extends Error {
  /** HTTP-статус ответа площадки (не путать с `status`, по которому API-маршруты выбирают код ответа) */
  httpStatus?: number;
  constructor(public platform: Platform, message: string, public detail?: unknown) {
    super(message);
  }
}

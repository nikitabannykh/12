import type { AdExtras } from "../engine/extras";
export type Platform = "yandex" | "vk" | "demo";
export type Channel = "search" | "network" | "vk";
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
};

export type GroupSpec = {
  localId: string;
  name: string;
  keywords: string[];
  autotargeting: boolean;
  regionIds: number[];
  ageFrom?: number;
  ageTo?: number;
  sex?: "female" | "male" | "any";
  ads: AdSpec[];
};

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
  groups: GroupSpec[];
};

export type LaunchResult = {
  campaignExt: string;
  groups: { localId: string; groupExt: string; ads: { localId: string; adExt: string | null; error?: string; imageRef?: string }[] }[];
  warnings: string[];
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

/** Колбэки запуска: ID кампании сохраняем в БД сразу, как площадка его вернула, — чтобы таймаут не оставил «сироту» */
export type LaunchHooks = { onCampaignCreated?: (campaignExt: string) => Promise<void> };

export interface PlatformClient {
  platform: Platform;
  launchCampaign(spec: CampaignSpec, hooks?: LaunchHooks): Promise<LaunchResult>;
  /** Удалить (или, если площадка не даёт, остановить) недосозданную кампанию — для возобновления прерванного запуска */
  removeCampaign?(campaignExt: string): Promise<void>;
  addAd(campaignExt: string, groupExt: string, ad: AdSpec, ctx: { channel: Channel }): Promise<{ adExt: string; imageRef?: string }>;
  setCampaignActive(campaignExt: string, active: boolean): Promise<void>;
  setAdsActive(adExts: string[], active: boolean): Promise<void>;
  setBudget(campaignExt: string, p: { channel: Channel; weeklyBudget: number; strategy: Strategy; goalId?: number | null; bidCeiling?: number | null }): Promise<void>;
  setNegativeKeywords(campaignExt: string, words: string[]): Promise<void>;
  updateAdText(adExt: string, t: { title: string; title2?: string | null; text: string }): Promise<void>;
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

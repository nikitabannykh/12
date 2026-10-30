import {
  pgTable, text, integer, bigint, timestamp, jsonb, real, date, uniqueIndex, index, customType,
} from "drizzle-orm/pg-core";
import type { SourceLink } from "../links";

export type { SourceLink } from "../links";

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v)),
});

const id = () => text("id").primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull(),
  name: text("name"),
  image: text("image"),
  // Вход по почте: scrypt-хеш пароля (null — пароль не задан: вход через Google, по ссылке или демо)
  passwordHash: text("password_hash"),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  // Входит в cookie сессии; увеличивается при смене/сбросе пароля — старые сессии перестают действовать
  sessionVersion: integer("session_version").notNull().default(0),
  // Выбранный проект (бизнес) — у одного владельца их может быть несколько; "new" — заполняет анкету нового
  currentBusinessId: text("current_business_id"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("users_email").on(t.email)]);

/** Услуга анкеты; category — раздел прайса («Маникюр», «Педикюр»), необязательно */
export type Service = { name: string; price?: string; note?: string; category?: string };

export const businesses = pgTable("businesses", {
  id: id(),
  userId: text("user_id").notNull(),
  publicKey: text("public_key").notNull(), // ключ для трекера и страницы записи
  name: text("name").notNull(),
  niche: text("niche").notNull(), // nails | yoga | barber | massage | fitness | beauty | other
  city: text("city").notNull(),
  address: text("address"),
  phone: text("phone"),
  whatsapp: text("whatsapp"),
  telegram: text("telegram"),
  hours: text("hours"), // часы работы, например «Ежедневно 10:00–21:00»
  orgUrl: text("org_url"), // ссылка на организацию в Яндекс Картах / Бизнесе
  orgId: text("org_id"), // ID организации (permalink) — для BusinessId в Директе
  legalInfo: text("legal_info"), // «ИП Иванова А. А., ИНН …» — для блока «о компании» в VK и маркировки
  geo: jsonb("geo").$type<{ lat: number; lng: number; source?: string } | null>(), // координаты адреса для показов в радиусе
  siteUrl: text("site_url"), // если пусто — объявления ведут на нашу страницу записи
  // Все ссылки владельца из анкеты: сайт, Яндекс Карты, 2ГИС, DIKIDI, YCLIENTS, Taplink, VK… (siteUrl и orgUrl — их «главные» копии)
  sourceLinks: jsonb("source_links").$type<SourceLink[]>().notNull().default([]),
  description: text("description").notNull().default(""),
  services: jsonb("services").$type<Service[]>().notNull().default([]),
  advantages: jsonb("advantages").$type<string[]>().notNull().default([]),
  audience: text("audience"),
  offer: text("offer"), // акция / оффер для новых клиентов
  review: text("review"), // реальный отзыв клиента для креативов
  monthlyBudget: integer("monthly_budget").notNull().default(15000),
  leadToClientRate: real("lead_to_client_rate").notNull().default(0.5),
  status: text("status").notNull().default("draft"), // draft | launching | active | paused
  counterId: bigint("counter_id", { mode: "number" }),
  goalIds: jsonb("goal_ids").$type<Record<string, number>>().notNull().default({}),
  /** Настройки показа владельца: регион, возраст и пол, расписание (engine/show.ts) */
  /** Куда ведёт реклама: страница записи, сайт или своя ссылка, можно отдельно по каналам (engine/landing.ts) */
  landing: jsonb("landing").$type<Record<string, unknown>>().notNull().default({}),
  showSettings: jsonb("show_settings").$type<Record<string, unknown>>().notNull().default({}),
  regionIds: jsonb("region_ids").$type<{ yandex?: number[]; vk?: number[] }>().notNull().default({}),
  launchPlan: jsonb("launch_plan").$type<unknown>(),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("businesses_user").on(t.userId), uniqueIndex("businesses_public").on(t.publicKey)]);

export const adAccounts = pgTable("ad_accounts", {
  id: id(),
  userId: text("user_id").notNull(),
  platform: text("platform").notNull(), // yandex | vk | demo
  login: text("login").notNull(),
  externalId: text("external_id"),
  accessToken: text("access_token").notNull(), // зашифрован
  refreshToken: text("refresh_token"), // зашифрован
  // VK по ключам API самого рекламодателя (Настройки → Доступ к API): client_id и client_secret (зашифрован)
  clientId: text("client_id"),
  clientSecret: text("client_secret"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  status: text("status").notNull().default("ok"), // ok | error
  statusNote: text("status_note"),
  createdAt: createdAt(),
}, (t) => [index("ad_accounts_user").on(t.userId)]);

export const campaigns = pgTable("campaigns", {
  id: id(),
  businessId: text("business_id").notNull(),
  accountId: text("account_id").notNull(),
  platform: text("platform").notNull(),
  channel: text("channel").notNull(), // search | network | vk
  externalId: text("external_id"),
  name: text("name").notNull(),
  weeklyBudget: integer("weekly_budget").notNull(), // ₽ в неделю
  strategy: text("strategy").notNull().default("clicks"), // clicks | conversions
  status: text("status").notNull().default("active"), // active | paused | archived | error
  statusNote: text("status_note"),
  negativeKeywords: jsonb("negative_keywords").$type<string[]>().notNull().default([]),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [index("campaigns_business").on(t.businessId)]);

export const adGroups = pgTable("ad_groups", {
  id: id(),
  campaignId: text("campaign_id").notNull(),
  externalId: text("external_id"),
  name: text("name").notNull(),
  audience: text("audience").notNull(), // человекочитаемое описание аудитории
  keywords: jsonb("keywords").$type<string[]>().notNull().default([]),
  targeting: jsonb("targeting").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").notNull().default("active"),
  createdAt: createdAt(),
}, (t) => [index("ad_groups_campaign").on(t.campaignId)]);

export const ads = pgTable("ads", {
  id: id(),
  businessId: text("business_id").notNull(),
  campaignId: text("campaign_id").notNull(),
  adGroupId: text("ad_group_id").notNull(),
  externalId: text("external_id"),
  angle: text("angle").notNull(), // гипотеза/подход: price | offer | proof | emotion | speed | expert
  title: text("title").notNull(),
  title2: text("title2"),
  text: text("text").notNull(),
  imageId: text("image_id"),
  status: text("status").notNull().default("moderation"), // moderation | active | paused | rejected | archived | error
  statusNote: text("status_note"),
  experimentId: text("experiment_id"),
  parentAdId: text("parent_ad_id"),
  createdAt: createdAt(),
}, (t) => [index("ads_campaign").on(t.campaignId), index("ads_business").on(t.businessId)]);

export const images = pgTable("images", {
  id: id(),
  businessId: text("business_id").notNull(),
  kind: text("kind").notNull(), // photo | generated | creative
  mime: text("mime").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  data: bytea("data").notNull(),
  prompt: text("prompt"),
  layout: text("layout"),
  platformRefs: jsonb("platform_refs").$type<Record<string, string>>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [index("images_business").on(t.businessId)]);

export const statsDaily = pgTable("stats_daily", {
  id: id(),
  businessId: text("business_id").notNull(),
  campaignId: text("campaign_id").notNull(),
  adId: text("ad_id").notNull(), // "" — итог по кампании без разбивки
  day: date("day").notNull(),
  impressions: integer("impressions").notNull().default(0),
  clicks: integer("clicks").notNull().default(0),
  cost: real("cost").notNull().default(0),
  conversions: integer("conversions").notNull().default(0),
  // Поиск: сумма «объём трафика × показы» и «позиция × показы» — так средние считаются по любому периоду
  tvWeighted: real("tv_weighted").notNull().default(0),
  posWeighted: real("pos_weighted").notNull().default(0),
}, (t) => [uniqueIndex("stats_unique").on(t.campaignId, t.adId, t.day), index("stats_business_day").on(t.businessId, t.day)]);

/**
 * Яндекс Метрика по дням (Reporting API): визиты из рекламы по кампании, объявлению и ключевой фразе.
 * «Качественный визит» = визит без отказа (bounces — отказы Метрики: один просмотр короче 15 секунд).
 * source: direct — по данным Директа в Метрике; utm — по меткам ссылки (так же и VK); demo — смоделировано.
 */
export const metricaDaily = pgTable("metrica_daily", {
  id: id(),
  businessId: text("business_id").notNull(),
  campaignId: text("campaign_id").notNull(),
  adId: text("ad_id").notNull().default(""), // "" — без разбивки по объявлениям
  phrase: text("phrase").notNull().default(""), // ключевая фраза (поиск), "" — нет
  day: date("day").notNull(),
  source: text("source").notNull(),
  visits: integer("visits").notNull().default(0),
  bounces: integer("bounces").notNull().default(0),
  durationSum: real("duration_sum").notNull().default(0), // секунд во всех визитах
  pageviews: real("pageviews").notNull().default(0),
  leads: integer("leads").notNull().default(0), // достижения цели «обращение»
  goals: jsonb("goals").$type<Record<string, number>>().notNull().default({}),
}, (t) => [uniqueIndex("metrica_daily_unique").on(t.campaignId, t.adId, t.phrase, t.day), index("metrica_daily_business_day").on(t.businessId, t.day)]);

/** Метрика за период по площадкам РСЯ (kind = site) и поисковым запросам (kind = query) — для решений робота */
export const metricaSlices = pgTable("metrica_slices", {
  id: id(),
  businessId: text("business_id").notNull(),
  campaignId: text("campaign_id").notNull(),
  kind: text("kind").notNull(), // site | query
  key: text("key").notNull(),
  visits: integer("visits").notNull().default(0),
  bounces: integer("bounces").notNull().default(0),
  durationSum: real("duration_sum").notNull().default(0),
  leads: integer("leads").notNull().default(0),
  periodFrom: date("period_from").notNull(),
  periodTo: date("period_to").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("metrica_slices_unique").on(t.campaignId, t.kind, t.key), index("metrica_slices_business").on(t.businessId)]);

export const experiments = pgTable("experiments", {
  id: id(),
  businessId: text("business_id").notNull(),
  campaignId: text("campaign_id").notNull(),
  kind: text("kind").notNull(), // ad | audience
  hypothesis: text("hypothesis").notNull(),
  controlId: text("control_id").notNull(),
  variantId: text("variant_id").notNull(),
  status: text("status").notNull().default("running"), // running | won | lost | draw
  result: text("result"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [index("experiments_business").on(t.businessId)]);

export type UndoOp =
  | { op: "campaignStatus"; campaignId: string; status: "active" | "paused" }
  | { op: "adStatus"; adId: string; status: "active" | "paused" }
  | { op: "groupStatus"; groupId: string; status: "active" | "paused"; adIds: string[] }
  | { op: "campaignBudget"; campaignId: string; weeklyBudget: number }
  | { op: "removeNegatives"; campaignId: string; words: string[] }
  | { op: "addNegatives"; campaignId: string; words: string[] }
  | { op: "adText"; adId: string; title: string; title2: string | null; text: string }
  | { op: "campaignStrategy"; campaignId: string; strategy: "clicks" | "conversions" }
  | { op: "monthlyBudget"; businessId: string; monthlyBudget: number }
  | { op: "bidCeiling"; campaignId: string; value: number | null }
  /** РСЯ: площадки (сайты, приложения), где кампания не показывается (Директ ExcludedSites, до 1000) */
  | { op: "excludeSites"; campaignId: string; sites: string[] }
  | { op: "includeSites"; campaignId: string; sites: string[] };

export const changes = pgTable("changes", {
  id: id(),
  businessId: text("business_id").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  actor: text("actor").notNull(), // robot | owner
  kind: text("kind").notNull(), // launch | pause | resume | budget | ad_new | ad_text | negatives | test_start | test_end | strategy | sync | revert
  title: text("title").notNull(),
  reason: text("reason").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  undo: jsonb("undo").$type<UndoOp[]>(),
  revertedAt: timestamp("reverted_at", { withTimezone: true }),
  revertOf: text("revert_of"),
}, (t) => [index("changes_business_at").on(t.businessId, t.at)]);

export const leads = pgTable("leads", {
  id: id(),
  businessId: text("business_id").notNull(),
  kind: text("kind").notNull(), // form | phone | messenger
  visitorId: text("visitor_id"),
  name: text("name"),
  contact: text("contact"),
  message: text("message"),
  source: text("source"), // yandex | vk | other
  campaignExt: text("campaign_ext"),
  adExt: text("ad_ext"),
  status: text("status"), // null — новая | booked (записался) | no_answer (не дозвонились) | spam
  statusAt: timestamp("status_at", { withTimezone: true }),
  metrikaClientId: text("metrika_client_id"), // ClientID Метрики — для офлайн-конверсий
  yclid: text("yclid"),
  createdAt: createdAt(),
}, (t) => [index("leads_business").on(t.businessId, t.createdAt)]);

export const clientMarks = pgTable("client_marks", {
  id: id(),
  businessId: text("business_id").notNull(),
  weekStart: date("week_start").notNull(),
  clients: integer("clients").notNull(),
}, (t) => [uniqueIndex("client_marks_unique").on(t.businessId, t.weekStart)]);

export const jobs = pgTable("jobs", {
  id: id(),
  businessId: text("business_id").notNull(),
  kind: text("kind").notNull(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastResult: text("last_result"),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
}, (t) => [uniqueIndex("jobs_unique").on(t.businessId, t.kind)]);

export const kv = pgTable("kv", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Business = typeof businesses.$inferSelect;
export type AdAccount = typeof adAccounts.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type AdGroup = typeof adGroups.$inferSelect;
export type Ad = typeof ads.$inferSelect;
export type Change = typeof changes.$inferSelect;
export type Experiment = typeof experiments.$inferSelect;
export type Image = typeof images.$inferSelect;

// --- Защита от спама: счётчики лимитов (работает и на serverless — общее состояние в базе) ---
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(), // например "lead:ip:<отпечаток>" — сам IP не храним
  count: integer("count").notNull().default(0),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
});

// --- Уведомления владельцу о заявках (Telegram) и ежедневная сводка ---
export const notifySettings = pgTable("notify_settings", {
  businessId: text("business_id").primaryKey(),
  telegramChatId: text("telegram_chat_id"),
  telegramName: text("telegram_name"), // как подписан чат: @username или имя
  linkedAt: timestamp("linked_at", { withTimezone: true }),
  digest: integer("digest").notNull().default(1), // 1 — присылать утреннюю сводку
  lastDigestAt: timestamp("last_digest_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type NotifySettings = typeof notifySettings.$inferSelect;

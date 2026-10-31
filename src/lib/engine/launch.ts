import "server-only";
import { catOf } from "./catalog";
import { directDemographics, recommendedReach, showOf } from "./show";
import { landingFor } from "./landing";
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { AdAccount, Business, Campaign, UndoOp } from "../db/schema";
import { allocate, MAX_MONTHLY } from "./budget";
import { expandSemantics, generateCopyPlan, type CopyPlan } from "../ai/copy";
import { buildSemanticCore, conflicts, geoTerms, reachKeywords, refineWithDirect, type SemanticChecks, type SemanticCore } from "./semantics";
import { applyWordstat } from "./wordstat";
import { demandForCore, demandNegatives } from "./demand";
import { aiConfigured } from "../ai/yandex";
import { generateServicePhotos, listPhotos, makeCreative, getImage, ensureLogo, imageSet, serviceArt, type ServiceArt } from "./images";
import { adExtras, responsiveAssets, timeTargeting, withPlanCallouts } from "./extras";
import { availableLayouts, type Layout } from "../creative/render";
import type { Channel, CampaignSpec, PlatformClient } from "../platforms/types";
import { clientFor, CHANNEL_NAME } from "../platforms";
import { YandexDirect } from "../platforms/yandex";
import { VkAds } from "../platforms/vk";
import { ensureCounter, ensureGoals, ensureVisitGoal } from "../platforms/metrica";
import { decrypt } from "../crypto";
import { prepareVk, regionIdsFor, vkPixelCounterId } from "./regions";
import { act, logChange } from "./ops";
import { isMedical, nicheById, type Layer } from "../niches";
export { MEDICAL_LICENSE_URL } from "../niches";
import { appUrl, errorText, isLaunched, isoDay, pl, rub, uid } from "../util";
import { baseOf, formatOf, isRetarget, RETARGET_MIN_AUDIENCE, RETARGET_WINDOW_DAYS, retargetOf, waitingAudience, type AudienceMeta } from "../channels";
import { VK_LEAD_GOAL } from "../platforms/vk-formats";
import { businessNow } from "./budget-guard";

export type PlanAd = { id: string; angle: string; title: string; title2?: string | null; text: string; imageId?: string | null; layout?: Layout | null; enabled: boolean };
export type PlanGroup = {
  id: string; name: string; audience: string; keywords: string[]; autotargeting: boolean; ageFrom?: number; ageTo?: number; sex?: "female" | "male" | "any"; ads: PlanAd[];
  /** Поиск: основная услуга группы и все услуги прайса, которые она покрывает (семантическое ядро) */
  service?: string; services?: string[];
  /** Минус-слова группы (кросс-минусовка), уходят в AdGroup.NegativeKeywords */
  negatives?: string[];
  /** Поиск: слой семантики — услуга, проблема клиента, смежный запрос, аудитория (робот сравнивает слои по цене обращения) */
  layer?: Layer;
  /** Поиск: целевых запросов в месяц по Wordstat (engine/wordstat) — для показа владельцу */
  demand?: number;
  /** VK: кто искал услугу (фразы поиска) и интересы — разные аудитории для A/B-сравнения */
  searchPhrases?: string[];
  interests?: string[];
};
export type PlanChannel = {
  channel: Channel; accountId: string; platform: string; weekly: number; enabled: boolean; groups: PlanGroup[];
  /** Почему канал выключен не владельцем: "budget" — не хватило бюджета; при большем бюджете rebalancePlan включит его обратно */
  disabledReason?: "budget";
};
export type LaunchPlan = {
  createdAt: string;
  /** Ревизия: растёт при каждом сохранении. Правки сохраняются, только если план не поменялся с момента чтения (updatePlan) */
  rev?: number;
  stage: "copy" | "images" | "ready";
  /** Подготовка картинок идёт шагами (лимит времени функции): одинаковые креативы переиспользуем по ключу */
  creatives?: Record<string, string>;
  /** Картинки, для которых уже сделан набор пропорций Директа */
  imageSetsDone?: string[];
  channels: PlanChannel[];
  negatives: string[];
  callouts: string[];
  imageIdeas: string[];
  photoIds: string[];
  /** Арт-концепты по услугам: подпись и выгода для картинки, сгенерированное под услугу фото */
  art?: ServiceArt[];
  dropped: Channel[];
  warnings: string[];
  /** Семантическое ядро: проверки (частотность и дубли в Директе, расширение моделью) и гео из адреса. Сами фразы — в группах поиска */
  semantics?: { checks: SemanticChecks; geo: SemanticCore["geo"]; total: number; medical?: boolean };
  /** Ход запуска: запуск идёт по одному каналу за запрос и возобновляется после обрыва */
  launch?: LaunchProgress;
  /** «Переписать тексты» по пожеланию владельца: идёт порциями; undo — прежние тексты, чтобы вернуть одним нажатием */
  rewrite?: {
    channel: Channel; wish: string; done: string[]; failed: number; undo: Record<string, { angle: string; title: string; title2?: string | null; text: string }>;
    /** Сколько объявлений переписано в этом заходе (undo может остаться от прошлого переписывания) */
    changed?: number;
  };
};
export type LaunchProgress = {
  id: string; startedAt: string; warnings: string[]; done: Channel[]; failed: Channel[];
  /** Когда был последний шаг — по нему робот понимает, что запуск брошен, и доводит его сам */
  lastStepAt?: string;
  /** Неудачные попытки включить кампанию (id → число) */
  activation?: Record<string, number>;
};

/** Сегодняшняя дата по Москве (YYYY-MM-DD): кампании Директа и VK живут в московском времени, а сервер — в UTC */
export function moscowDay(d: Date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" }).format(d);
}

/** Объявление можно публиковать: включено и с непустыми заголовком и текстом */
export const publishable = (a: PlanAd) => a.enabled && Boolean(a.title?.trim()) && Boolean(a.text?.trim());

/**
 * Делит бюджет между включёнными каналами плана: доля выключенного владельцем канала
 * переходит оставшимся (по тем же весам, что и при подготовке плана).
 * Канал, на который при текущем бюджете не хватает минимума площадки, выключается (enabled=false) —
 * иначе он запустился бы со старым лимитом сверх бюджета. exclude — каналы, которые в раскладке не участвуют
 * (например, не создались при запуске: их доля переходит остальным).
 */
export function rebalancePlan(plan: LaunchPlan, monthly: number, exclude: Channel[] = []): LaunchPlan {
  const on = plan.channels.filter((c) => c.enabled && !exclude.includes(c.channel)).map((c) => c.channel);
  // Канал, выключенный из-за бюджета (не владельцем), включаем обратно, если бюджет теперь позволяет — не вытесняя остальные
  const back: Channel[] = [];
  for (const ch of plan.channels) {
    if (ch.enabled || ch.disabledReason !== "budget" || exclude.includes(ch.channel)) continue;
    if (allocate(monthly, [...on, ch.channel]).dropped.length) continue;
    ch.enabled = true;
    delete ch.disabledReason;
    on.push(ch.channel);
    back.push(ch.channel);
  }
  if (back.length) {
    const stale = (w: string) => back.some((c) => w.startsWith(`Канал «${CHANNEL_NAME[c]}» выключен:`));
    plan.dropped = (plan.dropped ?? []).filter((d) => !back.includes(d));
    plan.warnings = (plan.warnings ?? []).filter((w) => !stale(w));
    if (plan.launch) plan.launch.warnings = plan.launch.warnings.filter((w) => !stale(w));
  }
  if (!on.length) return plan;
  const { allocation, dropped } = allocate(monthly, on);
  for (const ch of plan.channels) {
    if (dropped.includes(ch.channel)) {
      ch.enabled = false;
      ch.disabledReason = "budget";
      continue;
    }
    const a = allocation.find((x) => x.channel === ch.channel);
    if (ch.enabled && a) ch.weekly = a.weekly;
  }
  if (dropped.length) {
    plan.dropped = [...new Set([...(plan.dropped ?? []), ...dropped])];
    const notes = dropped.map((d) => `Канал «${CHANNEL_NAME[d]}» выключен: при бюджете ${rub(monthly)} в месяц на него не хватает минимума площадки. Увеличьте бюджет, чтобы добавить его.`);
    plan.warnings = [...new Set([...(plan.warnings ?? []), ...notes])];
    if (plan.launch) plan.launch.warnings = [...new Set([...plan.launch.warnings, ...notes])];
  }
  return plan;
}

/** Выбор «нового проекта»: анкета пустая, остальные проекты остаются в переключателе */
export const NEW_PROJECT = "new";

/**
 * Текущий проект (бизнес) владельца. У одного владельца может быть несколько проектов: выбранный хранится
 * в users.current_business_id. Чужой или удалённый id не вернётся — берём только из своих (проверка владельца).
 * NEW_PROJECT → null: страницы ведут на анкету, а POST /api/business создаст новый проект.
 */
export async function getBusinessForUser(userId: string, businessId?: string) {
  const db = await getDb();
  const rows = await db.select().from(schema.businesses).where(eq(schema.businesses.userId, userId)).orderBy(asc(schema.businesses.createdAt));
  if (businessId) return rows.find((r) => r.id === businessId) ?? null;
  if (!rows.length) return null;
  const [u] = await db.select({ cur: schema.users.currentBusinessId }).from(schema.users).where(eq(schema.users.id, userId));
  if (u?.cur === NEW_PROJECT) return null;
  return rows.find((r) => r.id === u?.cur) ?? rows[0];
}

export type ProjectItem = { id: string; name: string; status: string; city: string };

/** Проекты владельца для переключателя: старые первыми */
export async function listProjects(userId: string): Promise<ProjectItem[]> {
  const db = await getDb();
  return db
    .select({ id: schema.businesses.id, name: schema.businesses.name, status: schema.businesses.status, city: schema.businesses.city })
    .from(schema.businesses)
    .where(eq(schema.businesses.userId, userId))
    .orderBy(asc(schema.businesses.createdAt));
}

/** Сколько проектов можно завести: демо — 3, обычный аккаунт — 10 */
export const projectLimit = (email: string) => (email.endsWith("@demo.polny-zal.local") ? 3 : 10);

/** Переключить проект: id своего бизнеса или NEW_PROJECT. Возвращает false, если проект чужой. */
export async function setCurrentProject(userId: string, id: string): Promise<boolean> {
  const db = await getDb();
  if (id !== NEW_PROJECT) {
    const [b] = await db.select({ id: schema.businesses.id }).from(schema.businesses).where(and(eq(schema.businesses.id, id), eq(schema.businesses.userId, userId)));
    if (!b) return false;
  }
  await db.update(schema.users).set({ currentBusinessId: id }).where(eq(schema.users.id, userId));
  return true;
}

export async function accountsFor(userId: string) {
  const db = await getDb();
  return db.select().from(schema.adAccounts).where(eq(schema.adAccounts.userId, userId));
}

/** Какие каналы доступны с подключёнными кабинетами */
export function channelsFor(accounts: AdAccount[]): { channel: Channel; account: AdAccount }[] {
  const out: { channel: Channel; account: AdAccount }[] = [];
  const ya = accounts.find((a) => a.platform === "yandex" && a.status === "ok");
  const vk = accounts.find((a) => a.platform === "vk" && a.status === "ok");
  // Демо-кабинет используется, только если не подключено ни одного настоящего
  const demo = ya || vk ? undefined : accounts.find((a) => a.platform === "demo");
  const yaAcc = ya ?? demo;
  const vkAcc = vk ?? demo;
  if (yaAcc) {
    out.push({ channel: "search", account: yaAcc });
    out.push({ channel: "network", account: yaAcc });
  }
  if (vkAcc) out.push({ channel: "vk", account: vkAcc });
  // Ретаргетинг — отдельные кампании тех же кабинетов: Директ по Метрике, VK по пикселю
  if (yaAcc) out.push({ channel: retargetOf("yandex"), account: yaAcc });
  if (vkAcc) out.push({ channel: retargetOf("vk"), account: vkAcc });
  return out;
}

/** Куда ведёт реклама (в канале — с учётом настройки для канала). Без настроек: сайт или страница записи */
export function landingUrl(b: Business, channel?: string | null) {
  return landingFor(b, channel, appUrl()).url;
}

/** Каналы Директа: комбинаторные объявления, лимит 3 неархивных объявления в группе */
export const isDirectChannel = (channel: string) => channel === "search" || channel === "network" || channel === "retarget_yandex";
export const DIRECT_ADS_PER_GROUP = 3;

/**
 * Ссылка объявления с UTM-метками площадки. Одна функция для запуска и робота: VK требует один и тот же URL
 * в плане и всех баннерах группы, а разные написания (`site.ru?utm…` и `site.ru/?utm…`) — это разные url-объекты.
 */
export function withUtm(href: string, platform: string) {
  const u = new URL(href);
  const tags: Record<string, string> =
    platform === "yandex"
      ? { utm_source: "yandex", utm_medium: "cpc", utm_campaign: "{campaign_id}", utm_content: "{ad_id}", utm_term: "{keyword}" }
      : platform === "vk"
        ? { utm_source: "vk", utm_medium: "cpc", utm_campaign: "{{campaign_id}}", utm_content: "{{banner_id}}" }
        : { utm_source: "demo", utm_medium: "cpc" };
  for (const [k, v] of Object.entries(tags)) u.searchParams.set(k, v);
  // Макросы площадок нельзя кодировать
  return u.toString().replace(/%7B/g, "{").replace(/%7D/g, "}");
}

/** Какие тексты заказать у генератора: ретаргетинг пишется из объявлений основного канала той же площадки */
export function copyWants(channels: Channel[]) {
  const want = { search: false, network: false, vk: false };
  for (const c of channels) want[baseOf(c) as keyof typeof want] = true;
  return want;
}

/**
 * Группа ретаргетинга: одна аудитория «были на сайте или странице записи за 30 дней, но не оставили заявку».
 * Объявления — из основного канала той же площадки (лучшие идеи первыми: цена, предложение, доверие), без ключевых
 * фраз и автотаргетинга. Возраст — по нише, как у основных кампаний.
 */
function retargetGroup(b: Business, copy: CopyPlan, channel: Channel): CopyPlan["network"] {
  const src = copy[baseOf(channel) as "network" | "vk"] ?? [];
  const ads = src.flatMap((g) => g.ads);
  const order = ["offer", "price", "proof", "convenience", "result", "emotion"];
  const picked = [...ads].sort((x, y) => order.indexOf(x.angle) - order.indexOf(y.angle)).filter((a, i, arr) => arr.findIndex((z) => z.title === a.title) === i).slice(0, channel === "retarget_vk" ? 2 : 3);
  return [{
    name: "Были на сайте, но не записались",
    audience: `Заходили на ${b.siteUrl ? "сайт" : "страницу записи"} за ${RETARGET_WINDOW_DAYS} дней и не оставили заявку`,
    keywords: [],
    ads: picked,
    autotargeting: false,
  }];
}

/** Канал плана из сгенерированных текстов */
function channelFromCopy(b: Business, copy: CopyPlan, channel: Channel, acc: AdAccount, weekly: number): PlanChannel {
  const n = nicheById(b.niche);
  const fmt = formatOf(channel);
  const drafts = isRetarget(channel) ? retargetGroup(b, copy, channel) : copy[channel as "search" | "network" | "vk"];
  const groups = drafts.map((g) => ({
    id: uid("g_"),
    name: g.name,
    audience: g.audience,
    keywords: g.keywords,
    ...(g.service ? { service: g.service } : {}),
    ...(g.services?.length ? { services: g.services } : {}),
    ...(g.negatives?.length && channel === "search" ? { negatives: g.negatives } : {}),
    ...(g.layer && channel === "search" ? { layer: g.layer } : {}),
    ...(typeof g.demand === "number" && channel === "search" ? { demand: g.demand } : {}),
    ...(channel === "vk" && g.searchPhrases?.length ? { searchPhrases: g.searchPhrases } : {}),
    ...(channel === "vk" && g.interests?.length ? { interests: g.interests } : {}),
    autotargeting: fmt !== "vk" && !isRetarget(channel) && g.autotargeting !== false,
    ageFrom: g.ageFrom ?? n.audience.ageFrom,
    ageTo: g.ageTo ?? n.audience.ageTo,
    sex: n.audience.sex,
    // Директ: в группе не больше 3 неархивных объявлений — больше в план не берём
    ads: g.ads.slice(0, isDirectChannel(channel) ? DIRECT_ADS_PER_GROUP : undefined).map((ad) => ({ id: uid("a_"), angle: ad.angle, title: ad.title, title2: ad.title2 ?? null, text: ad.text, enabled: true })),
  }));
  return { channel, accountId: acc.id, platform: acc.platform, weekly, enabled: true, groups };
}

/** Не дольше: шаг подготовки текстов ограничен по времени запроса */
const SEMANTICS_BUDGET_MS = 20_000;

const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T) => Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

/**
 * Семантическое ядро для запуска: из анкеты (engine/semantics), затем — если подключены — расширение моделью
 * (только проверенные синонимы) и проверка Директом: фразы без показов в регионе и дубли убираем.
 * Демо-кабинет и ошибки API — ядро как есть.
 */
export async function semanticCoreFor(b: Business, accounts: AdAccount[]): Promise<SemanticCore> {
  let core = buildSemanticCore(b);
  const started = Date.now();
  if (aiConfigured()) core = await withTimeout(expandSemantics(b, core), 12_000, core);
  const ya = accounts.find((a) => a.platform === "yandex" && a.status === "ok");
  if (ya && core.groups.length) {
    try {
      const client = (await clientFor(ya)) as YandexDirect;
      const regionIds = await regionIdsFor(b, "yandex", client).catch(() => [0]);
      const left = Math.max(3_000, SEMANTICS_BUDGET_MS - (Date.now() - started));
      core = await withTimeout(
        refineWithDirect(core, { hasSearchVolume: (k, r) => client.hasSearchVolume(k, r), deduplicate: (items) => client.deduplicateKeywords(items) }, regionIds, b.niche),
        left,
        core,
      );
    } catch {
      /* без проверки Директом */
    }
  }
  // Минус-слова от проверки хвостов Wordstat (конкуренты, другие значения слов) — в минус-слова кампании
  const aiNeg = await demandNegatives(b.id).catch(() => [] as string[]);
  if (aiNeg.length) core = { ...core, negatives: [...new Set([...core.negatives, ...aiNeg.filter((n) => !core.groups.some((g) => g.keywords.some((k) => conflicts(n, k))))])] };
  // Спрос по Wordstat (собран заранее, пока владелец выбирал бюджет — engine/demand): частотность, хвосты, спрос групп
  if (core.groups.length) {
    try {
      const ws = await withTimeout(demandForCore(b, core), 5_000, null);
      if (ws && Object.keys(ws.results).length) {
        const none = core.checks.volume?.none;
        core = applyWordstat(core, ws.results, b.niche, { noVolume: none, source: ws.source });
      } else core = { ...core, checks: { ...core.checks, wordstat: { phrases: 0, note: ws?.note ?? "Нет данных Wordstat — запросы подобраны без частотности." } } };
    } catch (e) {
      core = { ...core, checks: { ...core.checks, wordstat: { phrases: 0, note: `Wordstat: ${errorText(e)}` } } };
    }
  }
  return core;
}

/** Шаг 1: тексты, семантика, аудитории */
export async function prepareCopy(b: Business, accounts: AdAccount[], opts: { deadline?: number } = {}): Promise<LaunchPlan> {
  const available = channelsFor(accounts);
  if (!available.length) throw new Error("Подключите хотя бы один рекламный кабинет");
  const { allocation, dropped } = allocate(b.monthlyBudget, available.map((a) => a.channel));
  const want = copyWants(allocation.map((a) => a.channel));
  const core = want.search || want.network ? await semanticCoreFor(b, accounts) : buildSemanticCore(b);
  const copy: CopyPlan = await generateCopyPlan(b, want, core, { deadline: opts.deadline });

  const channels: PlanChannel[] = allocation.map((a) => channelFromCopy(b, copy, a.channel, available.find((x) => x.channel === a.channel)!.account, a.weekly));

  const warnings: string[] = [];
  for (const d of dropped) warnings.push(`На канал «${CHANNEL_NAME[d]}» не хватает бюджета — начнём без него. Увеличьте бюджет, чтобы добавить.`);
  if (isMedical(b)) warnings.push(MEDICAL_NOTE);

  return {
    createdAt: new Date().toISOString(),
    stage: "copy",
    channels,
    negatives: copy.negatives,
    callouts: copy.callouts,
    imageIdeas: copy.imageIdeas,
    photoIds: [],
    dropped,
    warnings,
    semantics: { checks: core.checks, geo: core.geo, total: core.total, ...(core.medical ? { medical: true } : {}) },
  };
}

/**
 * Медицинские услуги (остеопатия, мануальная терапия, лечебный массаж, косметология): Директ показывает рекламу только
 * после проверки лицензии — https://yandex.ru/support/direct/ru/moderation/categories/medicine-medical-activity.
 * Предупреждение «Есть противопоказания. Посоветуйтесь с врачом» к текстовым объявлениям Директ добавляет сам;
 * на картинки (РСЯ, VK) его ставим мы — creative/render (не меньше 5% площади, закон «О рекламе», ст. 24 ч. 7).
 */
export const MEDICAL_NOTE =
  "Медицинские услуги: загрузите копию лицензии (со всеми приложениями, с адресом приёма) в кабинете Директа — без неё объявления не пройдут модерацию. Предупреждение «Есть противопоказания. Посоветуйтесь с врачом» Директ добавит к тексту сам, на картинки мы его уже поставили. Для VK Рекламы лицензия тоже нужна.";

/**
 * Шаг 2: фото и рекламные картинки. Работает шагами: за один вызов — пока не кончилось время (deadline),
 * затем возвращает план с done=false; следующий вызов продолжает с того же места. Одинаковые картинки
 * (тот же макет, фото, размер, услуга и цена) рисуем один раз и переиспользуем.
 */
const normName = (x: string) => x.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]/g, "");
const rootsOf = (x: string) => new Set(x.toLowerCase().replace(/ё/g, "е").split(/[^а-яa-z0-9]+/).filter((w) => w.length >= 3).map((w) => w.slice(0, 5)));

export async function prepareImages(b: Business, plan: LaunchPlan, deadline = Date.now() + 40_000): Promise<{ plan: LaunchPlan; done: boolean; made: number; total: number; steps: number; stepsDone: number }> {
  const warnings = [...plan.warnings];
  let photoIds = plan.stage === "images" ? plan.photoIds : [];
  let arts: ServiceArt[] = plan.stage === "images" ? plan.art ?? [] : [];
  if (plan.stage !== "images") {
    const own = await listPhotos(b.id);
    photoIds = own.filter((p) => p.kind === "photo").map((p) => p.id);
    // Фото владельца — максимум два; остальное — кадры, сгенерированные под каждую услугу отдельно (своя подпись,
    // своя выгода, свой сюжет). Объявления в группе получают разные картинки, робот A/B-тестом оставляет лучшую
    const own2 = photoIds.slice(0, 2);
    const mix = (a: string[], g: string[]) => {
      const out: string[] = [];
      for (let i = 0; i < Math.max(a.length, g.length); i++) out.push(...(g[i] ? [g[i]] : []), ...(a[i] ? [a[i]] : []));
      return [...new Set(out)].slice(0, 6);
    };
    const want = Math.min(5, Math.max(3, (b.services ?? []).filter((x) => x.name).length));
    // Картинки — под то, что ищут: сначала группы поиска (общая «Доставка еды», затем услуги), потом остальные услуги
    const subjects = [...new Set([...plan.channels.filter((c) => c.enabled).flatMap((c) => c.groups.filter((g) => (g.layer ?? "service") === "service").map((g) => g.service ?? g.name)), ...(b.services ?? []).map((s) => s.name)].filter(Boolean))];
    // Сюжеты и генерация — своё время, не урезанное шагом картинок (иначе модель не успевала, и подписи были просто названиями)
    arts = await serviceArt(b, plan.imageIdeas, Math.max(want, Math.min(6, subjects.length)), { until: Date.now() + 25_000, subjects });
    // Кадры, уже сгенерированные под ту же услугу (повторная подготовка), берём снова — не платим дважды
    const before = own.filter((p) => p.kind === "generated");
    // Своё фото с подписью позиции («Сет Свежесть» на сайте) — лучше любой генерации: берём его, а не рисуем
    const captioned = own.filter((p) => p.kind === "photo" && p.prompt?.startsWith("caption:")).map((p) => ({ id: p.id, caption: p.prompt!.slice(8), words: rootsOf(p.prompt!.slice(8)), key: normName(p.prompt!.slice(8)) }));
    const ownFor = (name: string) => {
      const key = normName(name), words = rootsOf(name);
      const exact = captioned.find((c) => c.key === key);
      if (exact) return exact.id;
      const best = captioned.map((c) => ({ c, k: [...words].filter((w) => c.words.has(w)).length })).sort((a, z) => z.k - a.k)[0];
      if (best && best.k >= Math.max(2, Math.ceil(words.size * 0.6))) return best.c.id;
      // Раздел меню («Пицца») — фото любой позиции этого раздела («Чёрная пицца с креветками»)
      const cat = catOf({ name });
      const inCat = cat ? captioned.find((c) => catOf({ name: c.caption })?.id === cat.id) : null;
      return inCat?.id ?? null;
    };
    arts = arts.map((a) => ({ ...a, photoId: ownFor(a.service) ?? before.find((p) => p.prompt?.startsWith(`${a.service} :: `))?.id ?? null }));
    const g = await generateServicePhotos(b, arts);
    arts = g.items;
    const gen = arts.map((a) => a.photoId).filter((x): x is string => Boolean(x));
    // Свои фото, совпавшие с позициями, — в общий набор (иначе их бы не было среди фото объявлений)
    photoIds = mix(own2, gen.length ? gen : before.map((p) => p.id));
    if (!photoIds.length) photoIds = own.filter((p) => p.kind === "photo").map((p) => p.id).slice(0, 4);
    deadline = Math.max(deadline, Date.now() + 15_000);
    if (g.errors.length) warnings.push(/denied|доступ|permission|403/i.test(g.errors[0])
      ? "Новые картинки не сгенерировались: у сервисного аккаунта Yandex Cloud нет роли ai.imageGeneration.user — объявления пока только с вашими фото и макетами"
      : `Часть картинок не сгенерировалась: ${g.errors[0]}`);
  }
  const ownSet = new Set(photoIds.filter((id) => !arts.some((a) => a.photoId === id)));
  const ownList = [...ownSet];
  const artFor = (name?: string | null) => (name ? arts.find((a) => a.service === name) : undefined);
  const artAt = (i: number) => (arts.length ? arts[i % arts.length] : undefined);
  const creatives: Record<string, string> = { ...(plan.creatives ?? {}) };
  const setsDone = new Set(plan.imageSetsDone ?? []);
  const layouts = availableLayouts(b, photoIds.length > 0);
  const svc = b.services?.[0];
  let made = 0;
  let outOfTime = false;
  const timeUp = () => (outOfTime ||= Date.now() > deadline);
  const creative = async (p: { layout: Layout; photoId: string | null; width: number; height: number; headline?: string; price?: string; benefit?: string }) => {
    const key = [p.layout, p.photoId ?? "-", p.width, p.height, p.headline ?? "", p.price ?? "", p.benefit ?? ""].join("|");
    if (creatives[key]) return creatives[key];
    const img = await makeCreative(b, p);
    creatives[key] = img.id;
    made++;
    return img.id;
  };
  let k = 0;
  const channels: PlanChannel[] = [];
  for (const ch of plan.channels) {
    if (ch.channel === "search") {
      // Поиск в ЕПК тоже показывает картинку рядом с текстом — одна на услугу (16:9), группы одной услуги делят её
      const groups: PlanGroup[] = [];
      for (const g of ch.groups) {
        if (g.ads.every((a) => a.imageId) || timeUp()) {
          groups.push(g);
          continue;
        }
        const service = b.services?.find((x) => x.name === (g.service ?? g.name)) ?? svc;
        let imageId: string | null = null;
        try {
          // Группы поиска чередуют: фото с карточкой услуги — и рисунок с преимуществом без фото,
          // чтобы у разных услуг были разные картинки, а не одно и то же фото везде
          // Своя картинка у каждой услуги: кадр, сгенерированный под неё, человеческая подпись и её выгода.
          // Макеты чередуются: подпись на фото — выгода с фото
          const a = artFor(service?.name ?? g.service ?? g.name) ?? artAt(k++);
          const layout: Layout = groups.length % 2 === 0 || !layouts.includes("benefit") ? "tag" : "benefit";
          const photoId = a?.photoId ?? (photoIds.length ? photoIds[(service ? (b.services ?? []).indexOf(service) : k) % photoIds.length] ?? photoIds[0] : null);
          imageId = await creative({ layout: photoId || layout === "benefit" ? layout : "tag", photoId, width: 1080, height: 607, headline: a?.headline ?? service?.name ?? g.name, price: service?.price, benefit: a?.benefit || undefined });
        } catch (e) {
          warnings.push(`Картинка для поиска «${g.name}»: ${errorText(e)}`);
        }
        groups.push({ ...g, ads: g.ads.map((ad) => ({ ...ad, imageId: ad.imageId ?? imageId, layout: ad.layout ?? null })) });
      }
      channels.push({ ...ch, groups });
      continue;
    }
    const groups: PlanGroup[] = [];
    for (const g of ch.groups) {
      const ads: PlanAd[] = [];
      for (const [i, ad] of g.ads.entries()) {
        if (ad.imageId || timeUp()) {
          ads.push(ad);
          continue;
        }
        // Директ: чистое фото и фото с ценником; VK: все макеты по кругу — так тест покажет, что работает
        const net = formatOf(ch.channel) === "network";
        // Разные макеты по кругу: чистое фото, фото с карточкой, рисунок с преимуществом, предложение — со сдвигом
        // по каналу, чтобы РСЯ, VK и ретаргетинг не получили одинаковые картинки. Макеты без фото — с иллюстрацией
        const pool: Layout[] = net
          ? photoIds.length ? ([...(["photo", "tag"] as Layout[]), ...layouts.filter((l) => l === "benefit" || l === "offer")]) : layouts
          : layouts.filter((l) => l !== "photo");
        const shift = i + groups.length + channels.length;
        const layout = pool[shift % pool.length] ?? "tag";
        // Картинка под услугу группы (у групп аудиторий — по кругу): подпись и выгода этой услуги, её кадр.
        // Каждое третье объявление — со своим фото владельца, если оно есть
        const exact = artFor(g.service ?? g.name);
        const a = exact ?? artAt(shift);
        // Фото под эту группу (своё с подписью позиции или сгенерированное под неё) — всегда оно; иначе каждое третье — своё фото
        const ownPick = !exact?.photoId && ownList.length && shift % 3 === 0 ? ownList[shift % ownList.length] : null;
        const photoId = layout === "offer" ? null : ownPick ?? a?.photoId ?? (photoIds.length ? photoIds[shift % photoIds.length] : null);
        const wide = net && i % 2 === 1;
        try {
          const imageId = await creative({ layout, photoId, width: 1080, height: wide ? 607 : 1080, headline: a?.headline ?? svc?.name, price: svc?.price, benefit: a?.benefit || undefined });
          ads.push({ ...ad, imageId, layout });
        } catch (e) {
          warnings.push(`Картинка для «${ad.title}»: ${errorText(e)}`);
          ads.push({ ...ad, imageId: null, layout: null });
        }
      }
      groups.push({ ...g, ads });
    }
    channels.push({ ...ch, groups });
  }
  // Директ: та же картинка в других пропорциях для комбинаторных объявлений (1:1, 16:9, 4:3, 3:4) — готовим заранее,
  // чтобы запуск не тратил на это время
  for (const ch of channels.filter((c) => isDirectChannel(c.channel) && c.platform !== "vk")) {
    for (const g of ch.groups) {
      const service = ch.channel === "search" ? b.services?.find((x) => x.name === (g.service ?? g.name)) ?? svc : svc;
      for (const ad of g.ads) {
        if (!ad.imageId || setsDone.has(ad.imageId) || timeUp()) continue;
        await imageSet(b, ad.imageId, { headline: ch.channel === "search" ? service?.name ?? g.name : svc?.name, price: service?.price, until: deadline }).catch(() => []);
        if (timeUp()) break; // набор мог остаться неполным — доделаем в следующем шаге
        setsDone.add(ad.imageId);
      }
    }
  }
  const allAds = channels.flatMap((c) => c.groups.flatMap((g) => g.ads));
  const pending = allAds.filter((a) => !a.imageId).length;
  // Прогресс для владельца: картинки объявлений + форматы Директа для каждой уникальной картинки
  const directImages = new Set(channels.filter((c) => isDirectChannel(c.channel) && c.platform !== "vk").flatMap((c) => c.groups.flatMap((g) => g.ads.map((a) => a.imageId).filter(Boolean) as string[])));
  const steps = allAds.length + directImages.size;
  const stepsDone = allAds.length - pending + [...directImages].filter((id) => setsDone.has(id)).length;
  const done = !outOfTime;
  const next: LaunchPlan = { ...plan, channels, photoIds, art: arts, creatives, imageSetsDone: [...setsDone], stage: done ? "ready" : "images", warnings: [...new Set(warnings)] };
  return { plan: next, done, made, total: allAds.length - pending, steps, stepsDone: done ? steps : stepsDone };
}

/** Ошибка с HTTP-статусом: route() отдаёт её текст владельцу */
const httpError = (message: string, status = 400) => Object.assign(new Error(message), { status });

/** Ревизия плана в БД (у плана без ревизии — 0) */
const planRev = sql<number>`coalesce((${schema.businesses.launchPlan}->>'rev')::int, 0)`;
/** План с ревизией на 1 больше той, что сейчас в БД, — для безусловной записи */
const nextRevPlan = (plan: LaunchPlan) => sql`jsonb_set(${JSON.stringify(plan)}::jsonb, '{rev}', to_jsonb(${planRev} + 1))`;

/**
 * Безусловная запись плана (запуск, под блокировкой "launch"). Ревизия растёт — правки, прочитанные до этого,
 * уже не сохранятся поверх (см. updatePlan).
 */
export async function savePlan(businessId: string, plan: LaunchPlan) {
  const db = await getDb();
  const [row] = await db.update(schema.businesses).set({ launchPlan: nextRevPlan(plan), updatedAt: new Date() }).where(eq(schema.businesses.id, businessId)).returning({ rev: planRev });
  if (row) plan.rev = Number(row.rev);
}

/** Запись, только если ревизия плана в БД всё ещё rev (никто не сохранил план после нашего чтения) */
async function savePlanIf(businessId: string, plan: LaunchPlan, rev: number): Promise<boolean> {
  const db = await getDb();
  const next = { ...plan, rev: rev + 1 };
  const rows = await db.update(schema.businesses).set({ launchPlan: next, updatedAt: new Date() }).where(and(eq(schema.businesses.id, businessId), sql`${planRev} = ${rev}`)).returning({ id: schema.businesses.id });
  if (!rows.length) return false;
  plan.rev = rev + 1;
  return true;
}

/**
 * Правка плана до запуска (владелец, картинки, переписывание): читаем свежий план, применяем apply и сохраняем,
 * только если план за это время никто не поменял; иначе повторяем на свежей копии. Так параллельные правки
 * не затирают друг друга, а начатый запуск (plan.launch) никогда не теряется: после его начала правки отклоняются.
 * apply может бросить httpError — его текст уйдёт владельцу.
 */
export async function updatePlan(businessId: string, apply: (plan: LaunchPlan, b: Business) => void | Promise<void>): Promise<LaunchPlan> {
  const db = await getDb();
  for (let i = 0; i < 5; i++) {
    const [b] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
    if (!b) throw httpError("Бизнес не найден", 404);
    if (isLaunched(b.status)) throw httpError("Реклама уже запущена — объявления меняются на странице «Реклама»", 409);
    const plan = b.launchPlan as LaunchPlan | null;
    if (!plan) throw httpError("План не найден — начните подготовку заново");
    if (plan.launch || b.status === "launching") throw httpError("Запуск уже начат — дождитесь окончания", 409);
    const rev = plan.rev ?? 0;
    await apply(plan, b);
    if (await savePlanIf(businessId, plan, rev)) return plan;
  }
  throw httpError("План сейчас меняется — попробуйте ещё раз", 409);
}

/** Новый план вместо прежнего («Подготовить объявления»): только если запуск не начат */
export async function replacePlan(businessId: string, next: LaunchPlan): Promise<void> {
  const db = await getDb();
  for (let i = 0; i < 5; i++) {
    const [b] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
    if (!b) throw httpError("Бизнес не найден", 404);
    if (isLaunched(b.status)) throw httpError("Реклама уже запущена", 409);
    const old = b.launchPlan as LaunchPlan | null;
    if (old?.launch || b.status === "launching") throw httpError("Запуск уже начат — дождитесь окончания или продолжите его", 409);
    if (await savePlanIf(businessId, next, old?.rev ?? 0)) return;
  }
  throw httpError("План сейчас меняется — попробуйте ещё раз", 409);
}

/**
 * Результат шага картинок — в свежий план: пока рисовали (~20 с), владелец мог поправить тексты, выключить
 * объявление или канал, добавить объявление. Переносим только картинки и служебные поля шага.
 * Новые объявления без картинки (добавлены во время шага) — дорисуем следующим шагом (done=false).
 */
export async function saveImagesStep(businessId: string, before: LaunchPlan, after: LaunchPlan, finished: boolean): Promise<{ plan: LaunchPlan; done: boolean }> {
  let done = finished;
  const drawn = new Map(after.channels.flatMap((c) => c.groups.flatMap((g) => g.ads.map((a) => [a.id, a] as const))));
  const added = after.warnings.filter((w) => !before.warnings.includes(w));
  const plan = await updatePlan(businessId, (fresh) => {
    if (fresh.createdAt !== before.createdAt) throw httpError("Объявления подготовили заново — картинки рисуем уже для них", 409);
    let unknown = false;
    for (const ch of fresh.channels)
      for (const g of ch.groups)
        for (const ad of g.ads) {
          const d = drawn.get(ad.id);
          if (!d) {
            if (!ad.imageId) unknown = true;
            continue;
          }
          if (!ad.imageId && d.imageId) {
            ad.imageId = d.imageId;
            ad.layout = d.layout ?? null;
          }
        }
    fresh.photoIds = after.photoIds;
    fresh.art = after.art;
    fresh.creatives = after.creatives;
    fresh.imageSetsDone = after.imageSetsDone;
    fresh.warnings = [...new Set([...fresh.warnings, ...added])];
    done = finished && !unknown;
    fresh.stage = done ? "ready" : "images";
  });
  return { plan, done };
}

async function setupMetrica(b: Business, account: AdAccount, warnings: string[]) {
  const db = await getDb();
  if (b.counterId && b.goalIds?.lead) return { counterId: b.counterId, goalId: b.goalIds.lead };
  try {
    const token = decrypt(account.accessToken);
    const site = landingUrl(b);
    const counter = b.counterId ? { id: b.counterId } : await ensureCounter(token, { name: `${b.name} — Самоход`, site });
    const goals = await ensureGoals(token, counter.id);
    await db.update(schema.businesses).set({ counterId: counter.id, goalIds: goals }).where(eq(schema.businesses.id, b.id));
    b.counterId = counter.id;
    b.goalIds = goals;
    return { counterId: counter.id, goalId: goals.lead };
  } catch (e) {
    warnings.push(`Метрику настроить не получилось (${errorText(e)}). Обращения всё равно считаем нашим счётчиком, а Директ будет оптимизировать по кликам.`);
    return { counterId: b.counterId ?? null, goalId: null };
  }
}

/** Ход создания кампании в meta: что уже есть на площадке — повторный вызов продолжает отсюда */
type BuildProgress = {
  /** localId группы плана → ID на площадке, ID строки в БД, созданные объявления (localId → ID на площадке) */
  groups: Record<string, { groupExt: string; dbId: string; ads: Record<string, string> }>;
  /** Объявления, которые площадка не приняла (строка в БД уже есть со статусом error) — повторно не шлём */
  failedAds: string[];
  ads: number;
  errors: number;
};
type CampaignMeta = { launchId?: string; extName?: string; build?: BuildProgress; launchStats?: { ads: number; errors: number }; [k: string]: unknown };
const metaOf = (c: Pick<Campaign, "meta">) => (c.meta ?? {}) as CampaignMeta;

/** Короткая метка запуска для имени кампании на площадке */
const launchTag = (launchId: string) => launchId.replace(/[^A-Za-z0-9]/g, "").slice(-6);

/**
 * Недосозданная кампания прошлого (прерванного) запуска: убираем с площадки и из БД, чтобы создать заново без дублей.
 * Если ID на площадке сохранить не успели, ищем кампанию по имени с меткой того запуска.
 */
async function cleanupCreating(stale: Campaign[], client: PlatformClient | null, warnings: string[]) {
  const db = await getDb();
  for (const c of stale) {
    let ext = c.externalId;
    const extName = metaOf(c).extName;
    if (!ext && extName && client?.findCampaignByName) ext = await client.findCampaignByName(extName).catch(() => null);
    if (ext && client?.removeCampaign) {
      try {
        await client.removeCampaign(ext);
      } catch (e) {
        await db.update(schema.campaigns).set({ externalId: ext, status: "error", statusNote: `Запуск прервался. Удалите кампанию ${ext} в кабинете площадки: ${errorText(e)}` }).where(eq(schema.campaigns.id, c.id));
        warnings.push(`${CHANNEL_NAME[c.channel]}: прерванный запуск оставил кампанию ${ext} — удалите её в кабинете`);
        continue;
      }
    }
    await db.delete(schema.ads).where(eq(schema.ads.campaignId, c.id));
    await db.delete(schema.adGroups).where(eq(schema.adGroups.campaignId, c.id));
    await db.delete(schema.campaigns).where(eq(schema.campaigns.id, c.id));
  }
}

type ChannelResult = { state: "ready"; campaignId: string; ads: number; errors: number } | { state: "pending" } | { state: "skipped" };

/**
 * Создаёт кампанию одного канала — выключенной (см. PlatformClient.launchCampaign); включает её activateLaunch.
 * Возобновляемо: строка кампании («creating») появляется в БД до вызова площадки, а ID кампании, групп и объявлений
 * пишутся в БД сразу, как площадка их вернула. Повторный вызов того же запуска продолжает с места обрыва;
 * «creating» от другого (прошлого) запуска убирается. Не успели до deadline — state "pending", продолжим следующим вызовом.
 */
async function launchChannel(b: Business, plan: LaunchPlan, ch: PlanChannel, account: AdAccount, launchId: string, warnings: string[], deadline: number): Promise<ChannelResult> {
  try {
    return await buildChannel(b, plan, ch, account, launchId, warnings, deadline);
  } catch (e) {
    // Канал будет помечен неудачным — недосозданную кампанию этого запуска убираем, чтобы не осталась сиротой на площадке
    const db = await getDb();
    const rows = (await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, b.id), eq(schema.campaigns.channel, ch.channel), eq(schema.campaigns.status, "creating"))))
      .filter((c) => metaOf(c).launchId === launchId);
    if (rows.length) await cleanupCreating(rows, await clientFor(account).catch(() => null), warnings).catch(() => null);
    throw e;
  }
}

async function buildChannel(b: Business, plan: LaunchPlan, ch: PlanChannel, account: AdAccount, launchId: string, warnings: string[], deadline: number): Promise<ChannelResult> {
  const db = await getDb();
  const href = landingUrl(b, ch.channel);
  const n = nicheById(b.niche);
  const client = await clientFor(account);

  const creating = await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, b.id), eq(schema.campaigns.channel, ch.channel), eq(schema.campaigns.status, "creating")));
  const mine = creating.find((c) => metaOf(c).launchId === launchId) ?? null;
  await cleanupCreating(creating.filter((c) => c !== mine), client, warnings);

  let counterId: number | null = null;
  let goalId: number | null = null;
  const regionIds = await regionIdsFor(b, account.platform, client);
  if (account.platform === "yandex") {
    const m = await setupMetrica(b, account, warnings);
    counterId = m.counterId;
    goalId = m.goalId;
  }

  const build: BuildProgress = mine ? { groups: {}, failedAds: [], ads: 0, errors: 0, ...(metaOf(mine).build ?? {}) } : { groups: {}, failedAds: [], ads: 0, errors: 0 };
  const imageCache = new Map<string, Awaited<ReturnType<typeof getImage>>>();
  const vkFormat = formatOf(ch.channel) === "vk";
  const logo = vkFormat ? await ensureLogo(b).catch(() => null) : null;
  const spec: CampaignSpec = {
    name: `${b.name} — ${CHANNEL_NAME[ch.channel]}`,
    channel: ch.channel,
    weeklyBudget: ch.weekly,
    strategy: "clicks",
    startDate: moscowDay(),
    counterId,
    goalId,
    negativeKeywords: vkFormat || isRetarget(ch.channel) ? [] : plan.negatives,
    siteUrl: withUtm(href, account.platform),
    groups: [],
    tag: launchTag(launchId),
    deadline,
  };
  const direct = isDirectChannel(ch.channel) && account.platform !== "vk";
  if (direct) {
    // Профиль организации (BusinessId, Карты) и расписание показов по часам работы
    spec.orgId = b.orgId ?? null;
    spec.timeTargeting = timeTargeting(b);
    spec.demographics = directDemographics(showOf(b));
  }
  // Ретаргетинг: аудитория «были на сайте, но не оставили заявку» (Директ — условие по целям Метрики, VK — сегмент пикселя)
  let audienceId: string | null = null;
  if (isRetarget(ch.channel)) {
    try {
      audienceId = await ensureAudienceFor(b, account, client, ch.channel);
    } catch (e) {
      warnings.push(`${CHANNEL_NAME[ch.channel]}: ${errorText(e)} — канал пропущен`);
      if (mine) await cleanupCreating([mine], client, warnings);
      return { state: "skipped" };
    }
  }
  const svc0 = b.services?.[0];
  const toInput = (img: NonNullable<Awaited<ReturnType<typeof getImage>>>) => ({ imageId: img.id, data: img.data, mime: img.mime, width: img.width, height: img.height, cachedRef: img.platformRefs?.[account.platform] });
  for (const g of ch.groups) {
    // Владелец показывает рекламу только женщинам (или мужчинам) — группу поиска для другого пола не запускаем
    const sexNow = showOf(b).sex;
    if (ch.channel === "search" && g.layer === "audience" && ((sexNow === "female" && /мужчин|мужск/i.test(g.name)) || (sexNow === "male" && /женщин|женск/i.test(g.name)))) {
      warnings.push(`Поиск: группу «${g.name}» не запускаем — в «Где, кому и когда показывать» выбран другой пол`);
      continue;
    }
    const ads = [];
    // Директ: не больше 3 объявлений в группе (уже созданные в прошлых попытках тоже считаются)
    const already = Object.keys(build.groups[g.id]?.ads ?? {}).length;
    const pub = g.ads.filter(publishable);
    const allowed = direct ? pub.filter((a) => build.groups[g.id]?.ads[a.id]).length + Math.max(0, DIRECT_ADS_PER_GROUP - already) : Infinity;
    const list = direct ? [...pub.filter((a) => build.groups[g.id]?.ads[a.id]), ...pub.filter((a) => !build.groups[g.id]?.ads[a.id])].slice(0, allowed) : pub;
    if (direct && pub.length > list.length) warnings.push(`${CHANNEL_NAME[ch.channel]}: в группе «${g.name}» включено ${pl(pub.length, "объявление", "объявления", "объявлений")}, а Директ принимает не больше ${DIRECT_ADS_PER_GROUP} — отправили первые ${DIRECT_ADS_PER_GROUP}`);
    for (const ad of list) {
      if (build.failedAds.includes(ad.id)) continue;
      let image = null;
      let images: ReturnType<typeof toInput>[] = [];
      if (ad.imageId) {
        const img = imageCache.get(ad.imageId) ?? (await getImage(ad.imageId));
        imageCache.set(ad.imageId, img);
        if (img) image = toInput(img);
        if (img && direct) {
          const service = ch.channel === "search" ? b.services?.find((x) => x.name === (g.service ?? g.name)) ?? svc0 : svc0;
          const set = await imageSet(b, img.id, { headline: ch.channel === "search" ? service?.name ?? g.name : svc0?.name, price: service?.price }).catch(() => []);
          for (const x of set) imageCache.set(x.id, x);
          images = set.map(toInput);
        }
      }
      const assets = direct ? responsiveAssets(b, ad, { service: ch.channel === "search" ? g.service ?? g.name : null, services: ch.channel === "search" ? g.services : null }) : null;
      ads.push({
        localId: ad.id,
        title: ad.title.trim(),
        title2: ad.title2?.trim() || null,
        text: ad.text.trim(),
        titles: assets?.titles,
        texts: assets?.texts,
        images,
        href: withUtm(href, account.platform),
        image,
        extras: withPlanCallouts(adExtras(b, { channel: formatOf(ch.channel), href, service: ch.channel === "search" ? g.service ?? g.name : null, text: ad.text, keywords: g.keywords }), plan.callouts),
        logo: vkFormat && logo ? { imageId: logo.id, data: logo.data, mime: logo.mime, width: logo.width, height: logo.height, cachedRef: logo.platformRefs?.[account.platform] } : null,
        marking: `${n.label}: ${b.name}`,
      });
    }
    if (!ads.length && !build.groups[g.id]) continue;
    // Поиск: фразы под охват владельца (точно / оптимально / широко); в «Точно» автотаргетинг выключен
    const reach = ch.channel === "search" ? showOf(b).reach ?? recommendedReach(b.monthlyBudget) : undefined;
    const kws = vkFormat || audienceId ? [] : ch.channel === "search" ? reachKeywords(g.keywords, reach, geoTerms(b)) : g.keywords;
    spec.groups.push({ localId: g.id, name: g.name, keywords: kws, negatives: vkFormat || audienceId ? [] : g.negatives ?? [], autotargeting: audienceId || reach === "precise" ? false : g.autotargeting, regionIds, ...ageSexOf(b, g), retargetingId: audienceId, ...(vkFormat && !audienceId && g.searchPhrases?.length ? { searchPhrases: g.searchPhrases } : {}), ...(vkFormat && !audienceId && g.interests?.length ? { interests: g.interests } : {}), ads });
  }
  if (!spec.groups.length) {
    warnings.push(`${CHANNEL_NAME[ch.channel]}: нет ни одного объявления с заголовком и текстом — канал пропущен`);
    if (mine) await cleanupCreating([mine], client, warnings);
    return { state: "skipped" };
  }

  // Имя на площадке — с меткой запуска: по нему находим свою кампанию, если ID сохранить не успели
  const extName = account.platform === "vk" ? VkAds.planName(spec) : spec.tag ? `${spec.name} #${spec.tag}` : spec.name;
  const campaignId = mine?.id ?? uid("c_");
  const baseMeta: CampaignMeta = { ...(mine ? metaOf(mine) : {}), regionIds, launchId, extName, startedAt: (mine ? metaOf(mine).startedAt : null) ?? new Date().toISOString() };
  if (isRetarget(ch.channel)) {
    // Аудиторию считаем с запуска (по часам бизнеса: в демо они промотаны)
    const since = (mine ? (metaOf(mine).audience as AudienceMeta | undefined)?.since : null) ?? isoDay(await businessNow(b.id));
    baseMeta.audience = { state: "collecting", need: RETARGET_MIN_AUDIENCE, size: 0, since, at: new Date().toISOString() } satisfies AudienceMeta;
    baseMeta.audienceId = audienceId;
  }
  if (!mine) {
    await db.insert(schema.campaigns).values({
      id: campaignId,
      businessId: b.id,
      accountId: account.id,
      platform: account.platform,
      channel: ch.channel,
      externalId: null,
      name: spec.name,
      weeklyBudget: ch.weekly,
      strategy: "clicks",
      status: "creating",
      negativeKeywords: spec.negativeKeywords,
      meta: { ...baseMeta, build },
    });
  }
  // Лимит уже созданной кампании здесь не трогаем: если бюджет поменялся, activateLaunch выставит новый перед включением
  spec.resume = { campaignExt: mine?.externalId ?? null, groups: Object.fromEntries(Object.entries(build.groups).map(([k, v]) => [k, { groupExt: v.groupExt, ads: v.ads }])) };
  const saveBuild = () => db.update(schema.campaigns).set({ meta: { ...baseMeta, build } }).where(eq(schema.campaigns.id, campaignId));

  const groupRow = async (localId: string, groupExt: string) => {
    if (build.groups[localId]) return build.groups[localId];
    const g = ch.groups.find((x) => x.id === localId)!;
    const dbId = uid("g_");
    await db.insert(schema.adGroups).values({
      id: dbId,
      campaignId,
      externalId: groupExt,
      name: g.name,
      audience: g.audience,
      keywords: g.keywords,
      targeting: {
        regionIds, ...ageSexOf(b, g), autotargeting: audienceId ? false : g.autotargeting, ...(audienceId ? { retargetingId: audienceId } : {}),
        ...(g.negatives?.length && !audienceId ? { negatives: g.negatives } : {}),
        ...(g.service ? { service: g.service } : {}),
        ...(g.services?.length ? { services: g.services } : {}),
        ...(g.layer ? { layer: g.layer } : {}),
      },
    });
    build.groups[localId] = { groupExt, dbId, ads: {} };
    return build.groups[localId];
  };

  let res;
  try {
    res = await client.launchCampaign(spec, {
      onCampaignCreated: async (ext) => {
        await db.update(schema.campaigns).set({ externalId: ext }).where(eq(schema.campaigns.id, campaignId));
      },
      onGroupCreated: async (localId, groupExt) => {
        await groupRow(localId, groupExt);
        await saveBuild();
      },
      onAdsCreated: async (localId, groupExt, created) => {
        const g = ch.groups.find((x) => x.id === localId);
        if (!g) return;
        const row = await groupRow(localId, groupExt);
        for (const ra of created) {
          const ad = g.ads.find((x) => x.id === ra.localId);
          if (!ad || row.ads[ra.localId] || build.failedAds.includes(ra.localId)) continue;
          await db.insert(schema.ads).values({
            id: uid("ad_"),
            businessId: b.id,
            campaignId,
            adGroupId: row.dbId,
            externalId: ra.adExt,
            angle: ad.angle,
            title: ad.title.trim(),
            title2: ad.title2?.trim() || null,
            text: ad.text.trim(),
            imageId: ad.imageId ?? null,
            status: ra.adExt ? "moderation" : "error",
            statusNote: ra.error ?? null,
          });
          if (ra.adExt) {
            row.ads[ra.localId] = ra.adExt;
            build.ads++;
          } else {
            build.failedAds.push(ra.localId);
            build.errors++;
          }
          if (ra.imageRef && ad.imageId) await rememberImageRef(ad.imageId, account.platform, ra.imageRef, imageCache);
        }
        await saveBuild();
      },
      onImageUploaded: (imageId, ref) => rememberImageRef(imageId, account.platform, ref, imageCache),
    });
  } catch (e) {
    const [row] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId));
    if (row) await cleanupCreating([row], client, warnings);
    throw e;
  }
  warnings.push(...res.warnings.map((w) => `${CHANNEL_NAME[ch.channel]}: ${w}`));
  if (res.complete === false) return { state: "pending" };

  await db.update(schema.campaigns).set({
    externalId: res.campaignExt,
    status: "ready",
    meta: { ...baseMeta, build, launchStats: { ads: build.ads, errors: build.errors } },
  }).where(eq(schema.campaigns.id, campaignId));
  return { state: "ready", campaignId, ads: build.ads, errors: build.errors };
}

/**
 * Аудитория ретаргетинга на площадке: «были на сайте или странице записи за 30 дней, но не оставили заявку».
 *  - Директ: цель Метрики «посетил сайт» (создаём, если нет) минус цель «обращение» → RetargetingLists;
 *  - VK: пиксель бизнеса (его ставит prepareVk при запуске VK) минус событие «заявка» → remarketing/segments;
 *  - демо: условная аудитория.
 */
async function ensureAudienceFor(b: Business, account: AdAccount, client: PlatformClient, channel: Channel): Promise<string> {
  if (!client.ensureAudience) throw new Error("площадка не умеет собирать аудиторию через API");
  const name = `${b.name.slice(0, 60)}: были на сайте, без заявки · pz-${b.publicKey}`;
  if (account.platform === "yandex") {
    if (!b.counterId || !b.goalIds?.lead) throw new Error("для ретаргетинга нужен счётчик Метрики с целью «обращение», а его настроить не удалось");
    let visit = b.goalIds.visit;
    if (!visit) {
      visit = await ensureVisitGoal(decrypt(account.accessToken), b.counterId, landingUrl(b));
      const goalIds = { ...(b.goalIds ?? {}), visit };
      const db = await getDb();
      await db.update(schema.businesses).set({ goalIds }).where(eq(schema.businesses.id, b.id));
      b.goalIds = goalIds;
    }
    return client.ensureAudience({ name, counterId: b.counterId, visitGoalId: visit, leadGoalId: b.goalIds.lead, days: RETARGET_WINDOW_DAYS });
  }
  if (account.platform === "vk") {
    let pixelId = await vkPixelCounterId(b.id);
    let why = "";
    if (!pixelId) {
      // Пиксель ещё не заводили (например, основной канал VK не запускался) — пробуем сейчас
      const ctx = await prepareVk(b, client as VkAds).catch((e: unknown) => ({ notes: [errorText(e)] }));
      why = (ctx as { notes?: string[] }).notes?.join("; ") ?? "";
      pixelId = await vkPixelCounterId(b.id);
    }
    if (!pixelId) throw new Error(`для ретаргетинга нужен пиксель VK на сайте, а создать его не получилось${why ? ` (${why})` : ""}. Нажмите «Настроить VK за меня» в блоке VK Рекламы выше — пиксель создадим сами, — и затем «Продолжить запуск»`);
    return client.ensureAudience({ name, pixelId, leadGoal: VK_LEAD_GOAL, days: RETARGET_WINDOW_DAYS });
  }
  void channel;
  return client.ensureAudience({ name, days: RETARGET_WINDOW_DAYS });
}

/** Ссылку на загруженную картинку сохраняем сразу — повтор запуска не грузит её второй раз */
async function rememberImageRef(imageId: string, platform: string, ref: string, cache: Map<string, Awaited<ReturnType<typeof getImage>>>) {
  const db = await getDb();
  const img = cache.get(imageId) ?? (await getImage(imageId));
  if (!img || img.platformRefs?.[platform] === ref) return;
  const refs = { ...(img.platformRefs ?? {}), [platform]: ref };
  img.platformRefs = refs;
  cache.set(imageId, img);
  await db.update(schema.images).set({ platformRefs: refs }).where(eq(schema.images.id, imageId));
}

/**
 * Включает кампании запуска (статус «ready»), предварительно сверив их лимиты с текущим бюджетом:
 * если бюджет снизили, пока шёл запуск, канал без минимума площадки удаляется, а остальным ставится новый лимит.
 * rebudgetLive — после включения нового канала уменьшить лимиты уже работающих кампаний (добавление канала к работающей рекламе).
 * Возвращает включённые кампании и признак, что что-то не включилось и стоит повторить.
 */
async function activateLaunch(b: Business, launchId: string, warnings: string[], opts: { rebudgetLive?: boolean; failures?: Record<string, number> } = {}) {
  const db = await getDb();
  const all = await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, b.id), inArray(schema.campaigns.status, ["ready", "active", "paused"])));
  const ready = all.filter((c) => c.status === "ready" && metaOf(c).launchId === launchId);
  const live = all.filter((c) => c.status !== "ready");
  const channels = [...new Set([...ready, ...live].map((c) => c.channel as Channel))];
  // Ретаргетинг, который ещё копит аудиторию, не тратит: его доля остаётся работающим каналам, пока он не включится
  // (включает его робот — engine/retarget.ts — и тогда же делит бюджет заново). Здесь его доля нужна только как план.
  const waitingLive = live.filter((c) => waitingAudience(c));
  const full = allocate(b.monthlyBudget, channels);
  const runChannels = channels.filter((ch) => !isRetarget(ch) || live.some((c) => c.channel === ch && !waitingLive.includes(c)));
  const { allocation, dropped } = runChannels.length ? allocate(b.monthlyBudget, runChannels) : full;
  const clients = new Map<string, PlatformClient>();
  const clientOf = async (c: Campaign) => {
    if (!clients.has(c.accountId)) {
      const [acc] = await db.select().from(schema.adAccounts).where(eq(schema.adAccounts.id, c.accountId));
      if (!acc) throw new Error("Рекламный кабинет отключён");
      clients.set(c.accountId, await clientFor(acc));
    }
    return clients.get(c.accountId)!;
  };

  const activated: Campaign[] = [];
  let retry = false;
  for (const c of ready) {
    const client = await clientOf(c).catch(() => null);
    if (isRetarget(c.channel)) {
      // Ретаргетинг создан выключенным и ждёт аудиторию. Доля — по полной раскладке; не помещается — убираем
      const plan = full.allocation.find((x) => x.channel === c.channel);
      if (full.dropped.includes(c.channel as Channel) || !plan) {
        warnings.push(`Канал «${CHANNEL_NAME[c.channel]}» не включили: при бюджете ${rub(b.monthlyBudget)} в месяц на него не хватает минимума площадки`);
        await cleanupCreating([c], client, warnings);
        continue;
      }
      const meta: CampaignMeta = { ...metaOf(c), launchedAt: new Date().toISOString(), pausedBy: "robot", pausedByGuard: null };
      delete meta.build;
      await db.update(schema.campaigns).set({ status: "paused", statusNote: null, weeklyBudget: plan.weekly, meta }).where(eq(schema.campaigns.id, c.id));
      activated.push({ ...c, status: "paused", weeklyBudget: plan.weekly, meta });
      continue;
    }
    const a = allocation.find((x) => x.channel === c.channel);
    if (dropped.includes(c.channel as Channel) || !a) {
      warnings.push(`Канал «${CHANNEL_NAME[c.channel]}» не включили: при бюджете ${rub(b.monthlyBudget)} в месяц на него не хватает минимума площадки`);
      await cleanupCreating([c], client, warnings);
      continue;
    }
    if (!client) {
      warnings.push(`${CHANNEL_NAME[c.channel]}: кабинет отключён — кампанию не включили`);
      await db.update(schema.campaigns).set({ status: "error", statusNote: "Кабинет отключён до окончания запуска" }).where(eq(schema.campaigns.id, c.id));
      continue;
    }
    try {
      if (a.weekly !== c.weeklyBudget && c.externalId) {
        // Бюджет поменялся, пока шёл запуск: лимит — по текущему бюджету, а не по плану
        await client.setBudget(c.externalId, { channel: c.channel as Channel, weeklyBudget: a.weekly, strategy: c.strategy as "clicks" | "conversions", goalId: b.goalIds?.lead ?? null });
        await db.update(schema.campaigns).set({ weeklyBudget: a.weekly }).where(eq(schema.campaigns.id, c.id));
        c.weeklyBudget = a.weekly;
      }
      const ads = await db.select({ ext: schema.ads.externalId }).from(schema.ads).where(and(eq(schema.ads.campaignId, c.id), notInArray(schema.ads.status, ["error", "archived"])));
      if (c.externalId) await client.activateCampaign(c.externalId, ads.map((x) => x.ext).filter(Boolean) as string[]);
      const meta = { ...metaOf(c), launchedAt: new Date().toISOString() };
      delete (meta as Record<string, unknown>).build;
      await db.update(schema.campaigns).set({ status: "active", statusNote: null, meta }).where(eq(schema.campaigns.id, c.id));
      activated.push({ ...c, status: "active", meta });
    } catch (e) {
      const n = (opts.failures?.[c.id] ?? 0) + 1;
      if (opts.failures) opts.failures[c.id] = n;
      if (n < 3) {
        retry = true;
        warnings.push(`${CHANNEL_NAME[c.channel]}: не удалось включить кампанию, пробуем ещё раз — ${errorText(e)}`);
      } else {
        await db.update(schema.campaigns).set({ status: "error", statusNote: `Кампания создана, но не включилась: ${errorText(e)}. Включите её в кабинете площадки.` }).where(eq(schema.campaigns.id, c.id));
        warnings.push(`${CHANNEL_NAME[c.channel]}: кампания создана, но не включилась — ${errorText(e)}`);
      }
    }
  }

  // Лимиты работающих кампаний уменьшаем только после того, как новый канал включился: не включился —
  // работающие остаются с прежними лимитами. Повтор (в т. ч. после сбоя здесь) идемпотентен — уменьшаем только то, что выше раскладки.
  const newOn = activated.some((c) => c.status === "active") || live.some((c) => c.status === "active" && metaOf(c).launchId === launchId);
  if (opts.rebudgetLive && newOn) {
    const ops: UndoOp[] = [];
    for (const c of live.filter((x) => !waitingLive.includes(x) && metaOf(x).launchId !== launchId)) {
      const a = allocation.find((x) => x.channel === c.channel);
      if (a && a.weekly < c.weeklyBudget) ops.push({ op: "campaignBudget", campaignId: c.id, weeklyBudget: a.weekly });
    }
    if (ops.length) {
      await act({
        businessId: b.id, actor: "owner", kind: "budget",
        title: "Перераспределили бюджет под новый канал",
        reason: `Месячный бюджет ${rub(b.monthlyBudget)} теперь делится и на новый канал, поэтому недельные лимиты остальных кампаний уменьшены.`,
      }, ops);
    }
  }
  return { activated, retry, live };
}

export type PublishStep = {
  done: boolean;
  ok: boolean;
  warnings: string[];
  progress: { total: number; finished: number; channels: { channel: Channel; state: "done" | "failed" | "pending" }[] };
  created?: { channel: Channel; campaignId: string; ads: number; errors: number }[];
};

/** Запас до лимита функции (60 с): новый шаг не начинаем, если до дедлайна меньше этого */
const STEP_RESERVE_MS = 20_000;
export const PUBLISH_BUDGET_MS = 45_000;

/**
 * Шаг 3: создаём кампании на площадках — по каналу за раз, пока есть время (лимит функции Vercel — 60 с).
 * Вызывающий должен держать блокировку запуска (run.tryLock(..., "launch")) и повторять вызов, пока done=false.
 * Кампании создаются выключенными и включаются все разом в конце — поэтому брошенный на полпути запуск
 * не тратит деньги. Повтор после обрыва продолжает с места обрыва (см. launchChannel).
 * Лимиты каналов пересчитываются от текущего месячного бюджета перед каждым каналом и перед включением.
 */
export async function publishStep(b: Business, plan: LaunchPlan, accounts: AdAccount[], opts: { deadline?: number } = {}): Promise<PublishStep> {
  const db = await getDb();
  const deadline = opts.deadline ?? Date.now() + PUBLISH_BUDGET_MS;
  const fresh = !plan.launch;
  const rev = plan.rev ?? 0;
  const prog: LaunchProgress = plan.launch ?? { id: uid("l_"), startedAt: new Date().toISOString(), warnings: [], done: [], failed: [] };
  plan.launch = prog;
  prog.lastStepAt = new Date().toISOString();
  rebalancePlan(plan, b.monthlyBudget, prog.failed); // бюджет мог поменяться после подготовки плана или между шагами
  // Только если план не поменялся с момента чтения: иначе запустили бы не то, что владелец видит, или затёрли бы его правку
  const started = await db.update(schema.businesses).set({ status: "launching", launchPlan: nextRevPlan(plan), updatedAt: new Date() })
    .where(and(eq(schema.businesses.id, b.id), sql`${planRev} = ${rev}`)).returning({ rev: planRev });
  if (!started.length) {
    if (fresh) plan.launch = undefined;
    throw httpError("План только что изменился — повторите запуск", 409);
  }
  plan.rev = Number(started[0].rev);

  if (fresh) {
    // Новый запуск: недосозданные и невключённые кампании прошлых запусков (их план потерян) убираем — иначе канал задублируется.
    // Кампании идущего добавления канала не трогаем.
    const adding = (await readAddState(b.id))?.launchId;
    // Сюда же — кампании прошлых запусков, которые создались, но так и не включились (ошибка при включении):
    // это черновики на площадке, иначе после исправления причины и повторного запуска они бы задублировались
    const leftovers = (await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, b.id), inArray(schema.campaigns.status, ["creating", "ready", "error"]))))
      .filter((c) => metaOf(c).launchId !== prog.id && (!adding || metaOf(c).launchId !== adding))
      .filter((c) => c.status !== "error" || (metaOf(c).launchId && !metaOf(c).launchedAt));
    for (const c of leftovers) {
      const acc = accounts.find((a) => a.id === c.accountId);
      await cleanupCreating([c], acc ? await clientFor(acc).catch(() => null) : null, prog.warnings).catch(() => null);
    }
  }

  const live = await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, b.id), inArray(schema.campaigns.status, ["active", "paused"])));
  const wantedOf = () => plan.channels.filter((c) => c.enabled && c.groups.some((g) => g.ads.some(publishable)));
  // Канал, по которому кампания уже есть (в том числе от прошлого запуска), второй раз не создаём
  for (const ch of wantedOf()) if (!prog.done.includes(ch.channel) && live.some((c) => c.channel === ch.channel)) prog.done.push(ch.channel);

  let first = true;
  for (;;) {
    const next = wantedOf().find((c) => !prog.done.includes(c.channel) && !prog.failed.includes(c.channel));
    if (!next) break;
    if (!first && deadline - Date.now() < STEP_RESERVE_MS) break;
    first = false;
    const warnings: string[] = [];
    const account = accounts.find((a) => a.id === next.accountId);
    let pending = false;
    if (!account) {
      warnings.push(`${CHANNEL_NAME[next.channel]}: кабинет отключён`);
      prog.failed.push(next.channel);
    } else {
      try {
        const r = await launchChannel(b, plan, next, account, prog.id, warnings, deadline);
        if (r.state === "ready") prog.done.push(next.channel);
        else if (r.state === "skipped") prog.failed.push(next.channel);
        else pending = true;
      } catch (e) {
        warnings.push(`${CHANNEL_NAME[next.channel]}: не удалось создать кампанию — ${errorText(e)}`);
        prog.failed.push(next.channel);
      }
    }
    if (prog.failed.includes(next.channel)) rebalancePlan(plan, b.monthlyBudget, prog.failed); // доля не созданного канала — остальным
    prog.warnings = [...new Set([...prog.warnings, ...warnings])];
    prog.lastStepAt = new Date().toISOString();
    await savePlan(b.id, plan);
    if (pending) break;
  }

  const wanted = wantedOf();
  const progress = {
    total: wanted.length,
    finished: wanted.filter((c) => prog.done.includes(c.channel) || prog.failed.includes(c.channel)).length,
    channels: wanted.map((c) => ({ channel: c.channel, state: prog.done.includes(c.channel) ? ("done" as const) : prog.failed.includes(c.channel) ? ("failed" as const) : ("pending" as const) })),
  };
  if (progress.finished < progress.total || deadline - Date.now() < 5_000) return { done: false, ok: true, warnings: prog.warnings, progress };

  // Все каналы обработаны — включаем созданные кампании разом (с лимитами по текущему бюджету)
  const warnings: string[] = [];
  prog.activation ??= {};
  const { retry } = await activateLaunch(b, prog.id, warnings, { failures: prog.activation });
  prog.warnings = [...new Set([...prog.warnings, ...warnings])];
  if (retry) {
    await savePlan(b.id, plan);
    return { done: false, ok: true, warnings: prog.warnings, progress };
  }
  // Включённые за все попытки, а не только за последнюю
  const { camps: activated, created } = await launchedBy(b.id, prog.id);
  const anyLive = live.length > 0 || created.length > 0;
  if (!anyLive) {
    // Ничего не создано — возвращаемся к плану, чтобы можно было поправить и запустить снова
    const warnings = prog.warnings;
    plan.launch = undefined;
    await db.update(schema.businesses).set({ status: "draft", launchPlan: plan, updatedAt: new Date() }).where(eq(schema.businesses.id, b.id));
    return { done: true, ok: false, warnings, progress };
  }

  await db.update(schema.businesses).set({ status: "active", launchPlan: null, updatedAt: new Date() }).where(eq(schema.businesses.id, b.id));
  if (created.length) await logLaunch(b.id, created, activated, prog.warnings);
  return { done: true, ok: true, warnings: prog.warnings, progress, created };
}

export type PublishStatus = { launchId: string | null; startedAt: string | null; uploaded: number; total: number; errors: number };

/**
 * Сколько объявлений уже отправлено на площадки в идущем запуске — для полосы прогресса в мастере.
 * Читается без блокировки, пока шаг запуска выполняется в соседнем запросе (счётчики шаг сохраняет после каждой пачки).
 */
export async function publishStatus(b: Business, accounts: AdAccount[]): Promise<PublishStatus> {
  const plan = b.launchPlan as LaunchPlan | null;
  const prog = plan?.launch;
  if (!plan || !prog) return { launchId: null, startedAt: null, uploaded: 0, total: 0, errors: 0 };
  const db = await getDb();
  const camps = await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, b.id), inArray(schema.campaigns.status, ["creating", "ready", "active", "paused", "error"])));
  let uploaded = 0;
  let total = 0;
  let errors = 0;
  for (const ch of plan.channels.filter((c) => c.enabled && c.groups.some((g) => g.ads.some(publishable)))) {
    const platform = accounts.find((a) => a.id === ch.accountId)?.platform;
    const cap = isDirectChannel(ch.channel) && platform !== "vk" ? DIRECT_ADS_PER_GROUP : Infinity;
    const planned = ch.groups.reduce((s, g) => s + Math.min(g.ads.filter(publishable).length, cap), 0);
    total += planned;
    if (prog.done.includes(ch.channel) || prog.failed.includes(ch.channel)) {
      uploaded += planned;
      continue;
    }
    const c = camps.find((x) => x.channel === ch.channel && metaOf(x).launchId === prog.id);
    const build = c ? (metaOf(c).build as BuildProgress | undefined) : undefined;
    if (build) {
      uploaded += Math.min(planned, build.ads + build.errors);
      errors += build.errors;
    }
  }
  return { launchId: prog.id, startedAt: prog.startedAt, uploaded, total, errors };
}

/** Все включённые кампании запуска (за все попытки включения), для итогов и «отменить» в истории */
async function launchedBy(businessId: string, launchId: string) {
  const db = await getDb();
  const camps = (await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, businessId), inArray(schema.campaigns.status, ["active", "paused"]))))
    .filter((c) => metaOf(c).launchId === launchId);
  return { camps, created: camps.map((c) => ({ channel: c.channel as Channel, campaignId: c.id, ads: metaOf(c).launchStats?.ads ?? 0, errors: metaOf(c).launchStats?.errors ?? 0 })) };
}

async function logLaunch(businessId: string, created: { channel: Channel; campaignId: string; ads: number; errors: number }[], camps: Campaign[], warnings: string[]) {
  const total = created.reduce((s, c) => s + c.ads, 0);
  // Ретаргетинг стоит, пока копит аудиторию, — в недельный расход не входит
  const waiting = camps.filter((c) => waitingAudience(c));
  const weekly = camps.filter((c) => !waiting.includes(c)).reduce((s, c) => s + c.weeklyBudget, 0);
  const waitNote = waiting.length
    ? ` ${waiting.map((c) => `«${CHANNEL_NAME[c.channel]}»`).join(" и ")} ${waiting.length === 1 ? "включится" : "включатся"} сам${waiting.length === 1 ? "" : "и"}, когда наберётся ${RETARGET_MIN_AUDIENCE} человек, которые были на сайте, но не записались, — тогда робот выделит ${waiting.length === 1 ? "ему" : "им"} около ${rub(waiting.reduce((s, c) => s + c.weeklyBudget, 0))} в неделю из общего бюджета.`
    : "";
  await logChange({
    businessId,
    actor: "owner",
    kind: "launch",
    title: `Запустили рекламу: ${created.map((c) => CHANNEL_NAME[c.channel]).join(", ")}`,
    reason: `Создали ${pl(total, "объявление", "объявления", "объявлений")} в ${pl(created.length, "канале", "каналах", "каналах")} с бюджетом около ${rub(weekly)} в неделю. Объявления проходят модерацию — обычно это занимает от пары часов до суток. Первые выводы робот сделает через 3 дня, когда накопятся показы.${waitNote}`,
    details: { created, warnings },
    undo: created.map((c) => ({ op: "campaignStatus" as const, campaignId: c.campaignId, status: "paused" as const })),
  });
}

// ─── Добавление канала к работающей рекламе ─────────────────────────────

/** Ход добавления канала (kv `addch:<businessId>`): тексты → картинки → создание → включение, по шагу за запрос */
type AddChannelState = { channel: Channel; plan: LaunchPlan; launchId: string; startedAt: string; activation?: Record<string, number> };
const ADD_KEY = (businessId: string) => `addch:${businessId}`;

async function readAddState(businessId: string): Promise<AddChannelState | null> {
  const db = await getDb();
  const [row] = await db.select().from(schema.kv).where(eq(schema.kv.key, ADD_KEY(businessId)));
  return (row?.value as AddChannelState | undefined) ?? null;
}
async function writeAddState(businessId: string, st: AddChannelState | null) {
  const db = await getDb();
  if (!st) {
    await db.delete(schema.kv).where(eq(schema.kv.key, ADD_KEY(businessId)));
    return;
  }
  await db.insert(schema.kv).values({ key: ADD_KEY(businessId), value: st }).onConflictDoUpdate({ target: schema.kv.key, set: { value: st, updatedAt: new Date() } });
}

/** Минимальный месячный бюджет, при котором к работающим каналам помещается ещё и этот */
export function minMonthlyWith(channels: Channel[], add: Channel) {
  for (let m = 1000; m <= MAX_MONTHLY; m += 100) if (!allocate(m, [...channels, add]).dropped.includes(add)) return m;
  return null;
}

/** Каналы, которые можно добавить к работающей рекламе, и хватает ли на них бюджета */
export async function addableChannels(b: Business, accounts: AdAccount[]) {
  const db = await getDb();
  const camps = await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, b.id), inArray(schema.campaigns.status, ["active", "paused"])));
  const liveChannels = [...new Set(camps.map((c) => c.channel as Channel))];
  const pending = await readAddState(b.id);
  return channelsFor(accounts)
    .filter((x) => !liveChannels.includes(x.channel))
    .map((x) => ({
      channel: x.channel,
      name: CHANNEL_NAME[x.channel],
      fits: !allocate(b.monthlyBudget, [...liveChannels, x.channel]).dropped.includes(x.channel),
      minMonthly: minMonthlyWith(liveChannels, x.channel),
      inProgress: pending?.channel === x.channel,
    }));
}

export type AddChannelStep = { done: boolean; ok: boolean; stage: "copy" | "images" | "publish" | "done"; warnings: string[]; campaignId?: string };

/**
 * Добавить канал к работающей рекламе (например, VK, который не помещался в бюджет до его увеличения).
 * Многошаговый, как запуск: вызывать повторно, пока done=false. Вызывающий держит блокировку "launch".
 * Тексты и картинки готовятся только для нового канала; бюджет делится между работающими каналами и новым
 * (лимиты работающих уменьшаются до включения нового — так сумма не выходит за месячный бюджет).
 */
export async function addChannelStep(b: Business, accounts: AdAccount[], channel: Channel | null, opts: { deadline?: number } = {}): Promise<AddChannelStep> {
  const db = await getDb();
  const deadline = opts.deadline ?? Date.now() + PUBLISH_BUDGET_MS;
  if (b.status === "paused") throw Object.assign(new Error("Реклама остановлена — сначала возобновите её, потом добавляйте каналы"), { status: 409 });
  if (b.status !== "active") throw Object.assign(new Error("Добавить канал можно, когда реклама уже запущена"), { status: 409 });
  let st = await readAddState(b.id);
  if (st && channel && st.channel !== channel) throw Object.assign(new Error(`Уже добавляем канал «${CHANNEL_NAME[st.channel]}» — дождитесь окончания`), { status: 409 });

  if (!st) {
    if (!channel) throw Object.assign(new Error("Какой канал добавить?"), { status: 400 });
    const avail = channelsFor(accounts).find((x) => x.channel === channel);
    if (!avail) throw Object.assign(new Error(`Для канала «${CHANNEL_NAME[channel]}» подключите рекламный кабинет`), { status: 400 });
    const camps = await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, b.id), inArray(schema.campaigns.status, ["active", "paused", "ready"])));
    if (camps.some((c) => c.channel === channel)) throw Object.assign(new Error(`Канал «${CHANNEL_NAME[channel]}» уже работает`), { status: 409 });
    const liveChannels = [...new Set(camps.map((c) => c.channel as Channel))];
    const { allocation, dropped } = allocate(b.monthlyBudget, [...liveChannels, channel]);
    if (dropped.includes(channel)) {
      const min = minMonthlyWith(liveChannels, channel);
      throw Object.assign(new Error(`На канал «${CHANNEL_NAME[channel]}» не хватает бюджета${min ? `: нужно от ${rub(min)} в месяц` : ""}. Увеличьте бюджет и попробуйте снова.`), { status: 409 });
    }
    const want = copyWants([channel]);
    const core = want.search || want.network ? await semanticCoreFor(b, accounts) : buildSemanticCore(b);
    const copy = await generateCopyPlan(b, want, core, { deadline: deadline - 5_000 });
    const weekly = allocation.find((a) => a.channel === channel)!.weekly;
    const plan: LaunchPlan = {
      createdAt: new Date().toISOString(),
      stage: "copy",
      channels: [channelFromCopy(b, copy, channel, avail.account, weekly)],
      negatives: copy.negatives,
      callouts: copy.callouts,
      imageIdeas: copy.imageIdeas,
      photoIds: [],
      dropped: [],
      warnings: isMedical(b) ? [MEDICAL_NOTE] : [],
      semantics: { checks: core.checks, geo: core.geo, total: core.total, ...(core.medical ? { medical: true } : {}) },
    };
    st = { channel, plan, launchId: uid("l_"), startedAt: new Date().toISOString() };
    await writeAddState(b.id, st);
    return { done: false, ok: true, stage: "copy", warnings: [] };
  }

  if (st.plan.stage === "copy" || st.plan.stage === "images") {
    st.plan = (await prepareImages(b, st.plan, (opts.deadline ?? Date.now() + 40_000) - 5_000)).plan;
    await writeAddState(b.id, st);
    return { done: false, ok: true, stage: "images", warnings: st.plan.warnings };
  }

  // Лимит — по текущему бюджету: его могли поменять, пока готовились тексты и картинки
  const ch = st.plan.channels[0];
  const liveCamps = await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, b.id), inArray(schema.campaigns.status, ["active", "paused"])));
  const liveChannels = [...new Set(liveCamps.map((c) => c.channel as Channel))];
  const { allocation, dropped } = allocate(b.monthlyBudget, [...liveChannels, ch.channel]);
  const warnings: string[] = [...st.plan.warnings];
  if (dropped.includes(ch.channel)) {
    const stale = (await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, b.id), eq(schema.campaigns.channel, ch.channel), inArray(schema.campaigns.status, ["creating", "ready"]))))
      .filter((c) => metaOf(c).launchId === st!.launchId);
    const acc = accounts.find((a) => a.id === ch.accountId);
    await cleanupCreating(stale, acc ? await clientFor(acc) : null, warnings);
    await writeAddState(b.id, null);
    throw Object.assign(new Error(`На канал «${CHANNEL_NAME[ch.channel]}» больше не хватает бюджета — бюджет уменьшили. Увеличьте его и попробуйте снова.`), { status: 409 });
  }
  ch.weekly = allocation.find((a) => a.channel === ch.channel)!.weekly;

  // Кампания этого добавления уже создана (или даже включена прошлой попыткой) — второй раз не создаём
  const ready = (await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, b.id), inArray(schema.campaigns.status, ["ready", "active", "paused"])))).some((c) => metaOf(c).launchId === st!.launchId);
  if (!ready) {
    const account = accounts.find((a) => a.id === ch.accountId);
    if (!account) {
      await writeAddState(b.id, null);
      throw Object.assign(new Error(`${CHANNEL_NAME[ch.channel]}: кабинет отключён`), { status: 400 });
    }
    let r: ChannelResult;
    try {
      r = await launchChannel(b, st.plan, ch, account, st.launchId, warnings, deadline);
    } catch (e) {
      await writeAddState(b.id, null);
      throw Object.assign(new Error(`${CHANNEL_NAME[ch.channel]}: не удалось создать кампанию — ${errorText(e)}`), { status: 502 });
    }
    if (r.state === "skipped") {
      await writeAddState(b.id, null);
      return { done: true, ok: false, stage: "done", warnings };
    }
    st.plan.warnings = [...new Set(warnings)];
    await writeAddState(b.id, st);
    if (r.state === "pending" || deadline - Date.now() < 5_000) return { done: false, ok: true, stage: "publish", warnings: st.plan.warnings };
  }

  st.activation ??= {};
  const { retry } = await activateLaunch(b, st.launchId, warnings, { rebudgetLive: true, failures: st.activation });
  st.plan.warnings = [...new Set(warnings)];
  if (retry) {
    await writeAddState(b.id, st);
    return { done: false, ok: true, stage: "publish", warnings: st.plan.warnings };
  }
  await writeAddState(b.id, null);
  const { camps: activated, created } = await launchedBy(b.id, st.launchId);
  if (created.length) await logLaunch(b.id, created, activated, st.plan.warnings);
  return { done: true, ok: created.length > 0, stage: "done", warnings: st.plan.warnings, campaignId: created[0]?.campaignId };
}

/** Брошенный запуск: бизнес в «launching», а шагов давно не было (владелец закрыл вкладку) */
export function launchStalled(b: Business, idleMs: number) {
  const plan = b.launchPlan as LaunchPlan | null;
  if (b.status !== "launching" || !plan?.launch) return false;
  const last = new Date(plan.launch.lastStepAt ?? plan.launch.startedAt).getTime();
  return Date.now() - last > idleMs;
}

export async function campaignsOf(businessId: string) {
  const db = await getDb();
  return db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, businessId), inArray(schema.campaigns.status, ["active", "paused", "error"])));
}


/** Возраст и пол группы: выбор владельца в «Настройках показа» важнее аудитории ниши */
export function ageSexOf(b: Business, g: Pick<PlanGroup, "ageFrom" | "ageTo" | "sex">) {
  const s = showOf(b);
  return {
    ageFrom: s.ageFrom ?? g.ageFrom,
    ageTo: s.ageTo ?? g.ageTo,
    sex: s.sex ?? g.sex,
  };
}

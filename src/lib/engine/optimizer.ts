import "server-only";
import { and, eq, gte, inArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { Ad, AdGroup, Business, Campaign, Change, Experiment, UndoOp } from "../db/schema";
import { clientFor, CHANNEL_NAME } from "../platforms";
import { demoNow } from "../platforms/demo";
import { ensureLogo, generatePhotos, getImage, imageSet, listPhotos, makeCreative, ownerPhotoCreative, ownerPhotoIds } from "./images";
import { adExtras, responsiveAssets } from "./extras";
import { liftBy, pickByThompson, placeName } from "./insights";
import { availableLayouts, LAYOUT_NAME, type Layout } from "../creative/render";
import { act, ceilingOf, logChange } from "./ops";
import { probBetter, pct, times } from "./stats";
import { rewriteAd, pickNegativeWords, type LIMITS } from "../ai/copy";
import { conflicts, displayKeyword } from "./semantics";
import { ANGLES, nicheById, type Layer } from "../niches";
import { decideLayers, LAYER_RULE, type LayerRow } from "./layers";
import { MIN_WEEKLY, weeklyFromMonthly } from "./budget";
import { firstDays, learningLeft as learningLeftFor, LEARN_LOOKBACK_DAYS } from "./budget-learning";
import { CATCH_UP, CATCH_UP_GAP, cutMeta, daysLeftInMonth, monthDays, monthKey, monthWeekly, planLimits, reserveFor, restoreTarget, spendableWeekly, type BudgetMeta, type Plan, type PlanItem } from "./budget-plan";
import { budgetState, businessNow, liveCampaigns, patchBudgetMeta, pausedForBudget, type BudgetState } from "./budget-guard";
import { addDays, errorText, isoDay, rub, uid, pl, num } from "../util";
import { getBalances, LOW_DAYS, CABINET_NAME } from "./balance";
import { isDirectChannel, landingUrl, withUtm } from "./launch";
import { VkAds } from "../platforms/vk";
import { vkAdContext } from "./regions";
import type { AdSpec, Channel, PlatformClient } from "../platforms/types";
import { formatOf, isRetarget, waitingAudience } from "../channels";
import { retargetStep } from "./retarget";
import { addQ, bounceRate, PROXY, proxyCompare, proxyVerdict, proxyVetoes, QUERY_RULE, qualityOf, SITE_RULE, zeroQ, type ProxyResult, type QStat } from "./quality";
import { phraseKeyOf, sliceKey } from "./metrica-sync";
import { geoTerms, phraseKey, stem } from "./semantics";
import { MAX_EXCLUDED_SITES } from "../platforms/yandex";
import type { QueryRow } from "../platforms/types";

/**
 * Робот-оптимизатор. Работает по расписанию (каждые несколько часов) и принимает решения
 * по накопленной статистике. Каждое решение — с объяснением и кнопкой «Отменить».
 *
 * Принципы:
 *  - не трогаем рекламу, пока не накопилось достаточно показов (иначе решения случайны);
 *  - сравниваем объявления только внутри одной группы — у них одинаковая аудитория;
 *  - меняем одну вещь за раз (текст при той же картинке), чтобы было понятно, что сработало;
 *  - в группе всегда остаётся минимум 2 рабочих объявления;
 *  - лимиты площадки соблюдаются: в группе Директа не больше 3 неархивных комбинаторных объявлений и 10 вместе
 *    с архивными. Перед новым вариантом робот убирает в архив проигравшее или самое слабое (не участвующее в тесте)
 *    объявление, а когда группа заполнена до 10 — переносит её в новую группу с теми же запросами;
 *  - бюджет месяца — жёсткая граница.
 */

// Ретаргетинг показывается маленькой аудитории — данных меньше, но люди «тёплые» и кликают чаще
const MIN_IMPR: Record<Channel, number> = { search: 150, network: 1500, vk: 1500, retarget_yandex: 600, retarget_vk: 600 };
const WINDOW_DAYS = 14;
const MAX_NEW_ADS_PER_RUN = 4;
const MAX_TEST_DAYS = 21;

type S = { impressions: number; clicks: number; cost: number; conversions: number };
const zero = (): S => ({ impressions: 0, clicks: 0, cost: 0, conversions: 0 });
const add = (a: S, b: S) => ({ impressions: a.impressions + b.impressions, clicks: a.clicks + b.clicks, cost: a.cost + b.cost, conversions: a.conversions + b.conversions });
const ctr = (s: S) => (s.impressions ? s.clicks / s.impressions : 0);

type Ctx = {
  b: Business;
  now: Date;
  campaigns: Campaign[];
  groups: AdGroup[];
  ads: Ad[];
  experiments: Experiment[];
  statByAd: Map<string, { day: string; s: S }[]>;
  /** Поиск: показы и «объём трафика × показы» по дням — чтобы знать место в выдаче */
  tvRows: { campaignId: string; day: string; impressions: number; tvWeighted: number }[];
  log: string[];
  newAds: number;
  /** Объекты, которые владелец менял сам в последние 14 дней: робот их не трогает */
  protected: Set<string>;
  /** Какой статус владелец сам поставил кампании в последние 14 дней */
  ownerStatus: Map<string, "active" | "paused">;
  /** История за 30 дней — для периода обучения кампаний */
  history: Change[];
  /** Первый день показов кампании (в окне статистики) */
  firstDay: Map<string, string>;
  /** Макет картинки по id изображения и id исходного фото */
  images: Map<string, { layout: string | null; photoId: string | null; width: number; height: number }>;
  /** Тесты, выигранные в этом проходе — их идеи переносим в другие группы */
  won: Experiment[];
  /** Свои фото владельца (не ИИ), старые первыми — робот предпочитает их иллюстрациям */
  ownPhotos: string[];
  /** Метрика: визиты и отказы по объявлениям и фразам (по дням), срезы по площадкам и запросам (за 30 дней) */
  metrica: {
    any: boolean;
    byAd: Map<string, { day: string; q: QStat }[]>;
    phrases: Map<string, { phrase: string; day: string; q: QStat; leadGoal: boolean }[]>;
    /** `${campaignId}|site|${площадка}` и `${campaignId}|query|${запрос}` */
    slices: Map<string, QStat>;
  };
  /**
   * Осторожный режим: статистику какого-то кабинета не удалось обновить (например, истёк токен VK), и расход за последние
   * дни может быть не виден. Защита бюджета тогда только снижает лимиты и ставит на паузу — ничего не поднимает и не включает.
   */
  safe: boolean;
};

function sumAd(cx: Ctx, adId: string, since?: string): S {
  return (cx.statByAd.get(adId) ?? []).filter((r) => !since || r.day >= since).reduce((acc, r) => add(acc, r.s), zero());
}

/** Визиты и отказы объявления по Метрике с даты since */
function qAd(cx: Ctx, adId: string, since?: string): QStat {
  return (cx.metrica.byAd.get(adId) ?? []).filter((r) => !since || r.day >= since).reduce((acc, r) => addQ(acc, r.q), zeroQ());
}

function adLabel(ad: Ad) {
  return `«${ad.title}»`;
}

// Время задач считаем по «часам» кампании: в демо они идут вместе с перемоткой
async function jobDue(cx: { b: Business; now: Date }, kind: string, everyHours: number) {
  const db = await getDb();
  const [j] = await db.select().from(schema.jobs).where(and(eq(schema.jobs.businessId, cx.b.id), eq(schema.jobs.kind, kind)));
  return !j?.lastRunAt || cx.now.getTime() - j.lastRunAt.getTime() > everyHours * 3600e3;
}

async function markJob(cx: { b: Business; now: Date }, kind: string, result: string) {
  const db = await getDb();
  const [j] = await db.select().from(schema.jobs).where(and(eq(schema.jobs.businessId, cx.b.id), eq(schema.jobs.kind, kind)));
  if (j) await db.update(schema.jobs).set({ lastRunAt: cx.now, lastResult: result }).where(eq(schema.jobs.id, j.id));
  else await db.insert(schema.jobs).values({ id: uid("j_"), businessId: cx.b.id, kind, lastRunAt: cx.now, lastResult: result });
}

async function load(b: Business): Promise<Ctx> {
  const db = await getDb();
  const campaigns = await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, b.id), inArray(schema.campaigns.status, ["active", "paused"])));
  const ids = campaigns.map((c) => c.id);
  const groups = ids.length ? await db.select().from(schema.adGroups).where(inArray(schema.adGroups.campaignId, ids)) : [];
  const ads = ids.length ? await db.select().from(schema.ads).where(inArray(schema.ads.campaignId, ids)) : [];
  const experiments = await db.select().from(schema.experiments).where(and(eq(schema.experiments.businessId, b.id), eq(schema.experiments.status, "running")));
  const isDemo = campaigns.some((c) => c.platform === "demo");
  const now = isDemo ? await demoNow({ businessId: b.id }) : new Date();
  const since = isoDay(addDays(now, -45));
  const stats = await db.select().from(schema.statsDaily).where(and(eq(schema.statsDaily.businessId, b.id), gte(schema.statsDaily.day, since)));
  const statByAd = new Map<string, { day: string; s: S }[]>();
  for (const r of stats) {
    if (!r.adId) continue;
    const list = statByAd.get(r.adId) ?? [];
    list.push({ day: String(r.day), s: { impressions: r.impressions, clicks: r.clicks, cost: r.cost, conversions: r.conversions } });
    statByAd.set(r.adId, list);
  }
  // Решения владельца важнее: если он что-то включил, выключил или отменил — не спорим с ним две недели.
  // Время — по часам бизнеса (в демо — демо-часы), как и запись истории.
  const history = await db.select().from(schema.changes).where(and(eq(schema.changes.businessId, b.id), gte(schema.changes.at, addDays(now, -LEARN_LOOKBACK_DAYS))));
  const ownerChanges = history.filter((ch) => ch.actor === "owner" && ch.at.getTime() >= addDays(now, -14).getTime()).sort((x, y) => x.at.getTime() - y.at.getTime());
  const prot = new Set<string>();
  const ownerStatus = new Map<string, "active" | "paused">();
  for (const ch of ownerChanges) {
    // Запуск и смена общего бюджета — не «решения про конкретный объект»
    if (ch.kind === "launch" || (ch.undo ?? []).some((o) => o.op === "monthlyBudget")) continue;
    for (const op of ch.undo ?? []) {
      const o = op as Record<string, unknown>;
      for (const k of ["adId", "groupId", "campaignId"]) if (typeof o[k] === "string") prot.add(o[k] as string);
      // В истории хранится обратная операция: владелец поставил противоположный статус
      if (op.op === "campaignStatus") ownerStatus.set(op.campaignId, op.status === "active" ? "paused" : "active");
    }
  }
  const firstDay = firstDays(stats.map((r) => ({ campaignId: r.campaignId, day: String(r.day), impressions: r.impressions })));
  const imageIds = [...new Set(ads.map((a) => a.imageId).filter(Boolean) as string[])];
  const imgRows = imageIds.length
    ? await db.select({ id: schema.images.id, layout: schema.images.layout, prompt: schema.images.prompt, width: schema.images.width, height: schema.images.height }).from(schema.images).where(inArray(schema.images.id, imageIds))
    : [];
  const images = new Map(imgRows.map((r) => [r.id, { layout: r.layout, photoId: r.prompt && r.prompt.startsWith("img_") ? r.prompt : null, width: r.width, height: r.height }]));
  const tvRows = stats.filter((r) => r.tvWeighted > 0).map((r) => ({ campaignId: r.campaignId, day: String(r.day), impressions: r.impressions, tvWeighted: r.tvWeighted }));
  const ownPhotos = await ownerPhotoIds(b.id);
  // Метрика (engine/metrica-sync): нет данных — робот работает как раньше, по кликам и обращениям
  const mrows = await db.select().from(schema.metricaDaily).where(and(eq(schema.metricaDaily.businessId, b.id), gte(schema.metricaDaily.day, since)));
  const byAd = new Map<string, { day: string; q: QStat }[]>();
  const phrases = new Map<string, { phrase: string; day: string; q: QStat; leadGoal: boolean }[]>();
  for (const r of mrows) {
    const q = { visits: r.visits, bounces: r.bounces, leads: r.leads };
    if (r.adId) byAd.set(r.adId, [...(byAd.get(r.adId) ?? []), { day: String(r.day), q }]);
    if (r.phrase) phrases.set(r.campaignId, [...(phrases.get(r.campaignId) ?? []), { phrase: r.phrase, day: String(r.day), q, leadGoal: "lead" in (r.goals ?? {}) }]);
  }
  const srows = await db.select().from(schema.metricaSlices).where(eq(schema.metricaSlices.businessId, b.id));
  const slices = new Map(srows.map((r) => [`${r.campaignId}|${r.kind}|${r.key}`, { visits: r.visits, bounces: r.bounces, leads: r.leads }]));
  const metrica = { any: mrows.length > 0 || srows.length > 0, byAd, phrases, slices };
  return { b, now, campaigns, groups, ads, experiments, statByAd, tvRows, log: [], newAds: 0, protected: prot, ownerStatus, history, firstDay, images, won: [], ownPhotos, safe: false, metrica };
}

/** Объявление сейчас участвует в идущем тесте (поле experimentId после теста не учитываем) */
function inTest(cx: Ctx, adId: string) {
  return cx.experiments.some((e) => e.status === "running" && (e.controlId === adId || e.variantId === adId));
}

/** Завершить тест: объявления возвращаются в обычную оптимизацию */
async function endExperiment(cx: Ctx, ex: Experiment, status: "won" | "lost" | "draw", result: string) {
  const db = await getDb();
  await db.update(schema.experiments).set({ status, result, finishedAt: cx.now }).where(eq(schema.experiments.id, ex.id));
  await db.update(schema.ads).set({ experimentId: null }).where(eq(schema.ads.experimentId, ex.id));
  ex.status = status;
  ex.result = result;
  for (const a of cx.ads) if (a.experimentId === ex.id) a.experimentId = null;
}

// ─── Период обучения ───────────────────────────────────────────────────
// После запуска и после смены стратегии или бюджета площадка заново учится. В это время данные шумные,
// и любое новое изменение сбрасывает обучение — поэтому ставки, бюджет и стратегию не трогаем.
// Исключение — защита бюджета месяца: она важнее. Правило общее с кабинетом — budget-learning.ts.
const learningLeft = (cx: Ctx, c: Campaign) => learningLeftFor(c, { now: cx.now, history: cx.history, firstDay: cx.firstDay });

/** Кампании, которые сейчас учатся, — пишем в лог, чтобы было видно, почему робот их не трогает */
function skipLearning(cx: Ctx, list: Campaign[], what: string) {
  return list.filter((c) => {
    const left = learningLeft(cx, c);
    if (left) cx.log.push(`${CHANNEL_NAME[c.channel]}: идёт обучение, ещё ${pl(left, "день", "дня", "дней")} — ${what} не меняем`);
    return !left;
  });
}

const LEARNED_NOTE = "Настройки канала давно не менялись — площадка закончила обучение, и этим данным можно доверять.";

/** Новое объявление-вариант в той же группе: тот же визуал, другой текст */
async function logoFor(b: Business, channel: string) {
  if (formatOf(channel) !== "vk") return null;
  const l = await ensureLogo(b).catch(() => null);
  return l ? { imageId: l.id, data: l.data, mime: l.mime, width: l.width, height: l.height } : null;
}

/** Какие идеи (подходы) лучше работают в этом канале у этого бизнеса */
function angleStats(cx: Ctx, channel: string) {
  const since = isoDay(addDays(cx.now, -30));
  return liftBy(
    cx.ads
      .filter((a) => cx.campaigns.find((c) => c.id === a.campaignId)?.channel === channel)
      .map((a) => ({ key: a.angle, groupId: a.adGroupId, s: sumAd(cx, a.id, since) })),
  );
}

function layoutStats(cx: Ctx, channel: string) {
  const since = isoDay(addDays(cx.now, -30));
  return liftBy(
    cx.ads
      .filter((a) => a.imageId && cx.campaigns.find((c) => c.id === a.campaignId)?.channel === channel)
      .map((a) => ({ key: (cx.images.get(a.imageId!)?.layout ?? null) as Layout | null, groupId: a.adGroupId, s: sumAd(cx, a.id, since) })),
  );
}

/** Следующая идея для группы: Thompson sampling — чаще удачные в этом канале, но с шансом для неиспробованных */
function chooseAngle(cx: Ctx, channel: string, groupId: string, exclude: string[]) {
  const active = cx.ads.filter((a) => a.adGroupId === groupId && (a.status === "active" || a.status === "moderation")).map((a) => a.angle);
  const candidates = Object.keys(ANGLES).filter((a) => !active.includes(a) && !exclude.includes(a));
  if (!candidates.length) return undefined;
  return pickByThompson(candidates, angleStats(cx, channel));
}

/**
 * Объявление для площадки: ссылка с теми же UTM, что при запуске (withUtm), дополнения, а для Директа —
 * все заголовки и тексты комбинаторного объявления и картинки других пропорций.
 */
async function adSpecFor(cx: Ctx, camp: Campaign, group: AdGroup, platform: string, a: { title: string; title2?: string | null; text: string; imageId?: string | null }, localId: string): Promise<AdSpec> {
  const href = landingUrl(cx.b, camp.channel);
  const img = a.imageId ? await getImage(a.imageId) : null;
  const direct = isDirectChannel(camp.channel) && platform !== "vk";
  const svc0 = cx.b.services?.[0];
  const service = camp.channel === "search" ? cx.b.services?.find((x) => x.name === ((group.targeting ?? {}) as { service?: string }).service || x.name === group.name) ?? svc0 : svc0;
  const set = img && direct ? await imageSet(cx.b, img.id, { headline: camp.channel === "search" ? service?.name ?? group.name : svc0?.name, price: service?.price }).catch(() => []) : [];
  // Фото владельца — в набор картинок комбинаторного объявления (чистое фото 1:1, без надписей).
  // Берём фото, которого ещё нет в этой группе, — так в группе со временем окажутся все фото владельца.
  let own: NonNullable<typeof img>[] = [];
  if (direct && img && cx.ownPhotos.length) {
    const inGroup = new Set(cx.ads.filter((x) => x.adGroupId === group.id && x.imageId).map((x) => cx.images.get(x.imageId!)?.photoId).filter(Boolean) as string[]);
    const basePhoto = img.prompt?.startsWith("img_") ? img.prompt : null;
    const pick = cx.ownPhotos.find((id) => id !== basePhoto && !inGroup.has(id)) ?? cx.ownPhotos.find((id) => id !== basePhoto);
    const x = pick ? await ownerPhotoCreative(cx.b, pick, { width: 1080, height: 1080 }).catch(() => null) : null;
    if (x) own = [x];
  }
  const gt = (group.targeting ?? {}) as { service?: string; services?: string[] };
  const assets = direct ? responsiveAssets(cx.b, a, { service: camp.channel === "search" ? gt.service ?? group.name : null, services: camp.channel === "search" ? gt.services : null }) : null;
  const toInput = (x: NonNullable<typeof img>) => ({ imageId: x.id, data: x.data, mime: x.mime, width: x.width, height: x.height, cachedRef: x.platformRefs?.[platform] });
  return {
    localId,
    title: a.title,
    title2: a.title2 ?? null,
    text: a.text,
    titles: assets?.titles,
    texts: assets?.texts,
    href: withUtm(href, platform),
    image: img ? toInput(img) : null,
    // Площадка берёт до 5 картинок: основная, фото владельца, затем другие пропорции
    images: [...own, ...set].map(toInput),
    extras: adExtras(cx.b, { channel: formatOf(camp.channel), href, service: camp.channel === "search" ? group.name : null, text: a.text }),
    logo: await logoFor(cx.b, camp.channel),
    marking: `${nicheById(cx.b.niche).label}: ${cx.b.name}`,
  };
}

async function clientOf(camp: Campaign) {
  const db = await getDb();
  const [acc] = await db.select().from(schema.adAccounts).where(eq(schema.adAccounts.id, camp.accountId));
  if (!acc) throw new Error("Рекламный кабинет отключён");
  const client: PlatformClient = await clientFor(acc);
  // VK: «о компании», возрастная метка и расписание берутся из анкеты бизнеса
  if (client instanceof VkAds) {
    const [b] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, camp.businessId));
    if (b) client.useBusiness(vkAdContext(b));
  }
  return { acc, client: client as PlatformClient };
}

/** Объявления, которые занимают место среди неархивных (у площадки они есть и не в архиве) */
const NOT_LIVE = ["archived", "error"];

/**
 * Место для нового объявления в группе с учётом лимитов площадки (Директ: 3 неархивных, 10 вместе с архивными).
 * Сначала в архив уходит заменяемое (отклонённое) и проигравшие (остановленные), потом самое слабое по кликабельности
 * из работающих — кроме keep, участников тестов и того, что владелец недавно менял сам. Когда группа заполнена до 10,
 * удаляем архивные без показов, а если нельзя — переносим группу в новую (те же запросы, лучшие объявления — копиями).
 * null — места нет (всё занято тестами): новый вариант добавим в следующий раз.
 */
async function ensureRoom(cx: Ctx, client: PlatformClient, camp: Campaign, group: AdGroup, keep: string[], why: string): Promise<{ group: AdGroup; copies: Map<string, Ad> } | null> {
  const ok = { group, copies: new Map<string, Ad>() };
  const lim = client.adLimits?.(camp.channel as Channel) ?? null;
  if (!lim) return ok;
  const db = await getDb();
  const peers = () => cx.ads.filter((a) => a.adGroupId === group.id && a.externalId);
  if (peers().length + 1 > lim.total && client.deleteAds) {
    const arch = peers().filter((a) => a.status === "archived");
    const deleted = new Set(arch.length ? await client.deleteAds(arch.map((a) => a.externalId!)).catch(() => [] as string[]) : []);
    for (const a of arch.filter((x) => deleted.has(x.externalId!))) {
      // Удалено у площадки: строку оставляем ради статистики, но без внешнего ID она не считается в лимите
      await db.update(schema.ads).set({ externalId: null }).where(eq(schema.ads.id, a.id));
      a.externalId = null;
    }
  }
  if (peers().length + 1 > lim.total) return rolloverGroup(cx, client, camp, group, keep, lim);

  const live = () => peers().filter((a) => !NOT_LIVE.includes(a.status));
  let need = live().length + 1 - lim.nonArchived;
  if (need <= 0) return ok;
  const since = isoDay(addDays(cx.now, -WINDOW_DAYS));
  const free = (a: Ad) => !keep.includes(a.id) && !inTest(cx, a.id);
  const candidates = [
    ...live().filter((a) => free(a) && a.status === "rejected"),
    ...live().filter((a) => free(a) && a.status === "paused").sort((x, y) => Number(cx.protected.has(x.id)) - Number(cx.protected.has(y.id))),
    ...live()
      .filter((a) => free(a) && !cx.protected.has(a.id) && (a.status === "active" || a.status === "moderation"))
      .map((a) => ({ a, s: sumAd(cx, a.id, since) }))
      .sort((x, y) => ctr(x.s) - ctr(y.s) || x.s.conversions - y.s.conversions)
      .map((x) => x.a),
  ];
  if (candidates.length < need) {
    cx.log.push(`${group.name}: в группе уже ${pl(live().length, "объявление", "объявления", "объявлений")} (лимит ${lim.nonArchived}), все заняты тестами — новый вариант позже`);
    return null;
  }
  for (const a of candidates.slice(0, need)) {
    try {
      if (a.status === "active" || a.status === "moderation") {
        const s = sumAd(cx, a.id, since);
        await act(
          {
            businessId: cx.b.id, actor: "robot", kind: "pause",
            title: `Убрали в архив объявление ${adLabel(a)}`,
            reason: `В одной группе Директа может быть не больше ${lim.nonArchived} неархивных объявлений. ${why} — поэтому освободили место: ${adLabel(a)} работает слабее остальных в группе «${group.name}» (${s.impressions ? `${pct(ctr(s))} кликов из ${pl(s.impressions, "показа", "показов", "показов")}` : "показов пока почти нет"}).`,
            details: { adId: a.id, stats: s, archived: true },
          },
          [{ op: "adStatus", adId: a.id, status: "paused" }],
        );
      }
      await client.archiveAds?.([a.externalId!]);
      await db.update(schema.ads).set({ status: "archived" }).where(eq(schema.ads.id, a.id));
      a.status = "archived";
      need--;
      cx.log.push(`В архив: ${a.id} (лимит ${lim.nonArchived} в группе)`);
    } catch (e) {
      cx.log.push(`Не удалось убрать в архив ${a.id}: ${errorText(e)}`);
      return null;
    }
  }
  return need <= 0 ? ok : null;
}

/** Группа заполнена до 10 объявлений: такая же новая группа, лучшие объявления — копиями, старые — в архив */
async function rolloverGroup(cx: Ctx, client: PlatformClient, camp: Campaign, group: AdGroup, keep: string[], lim: { nonArchived: number; total: number }) {
  if (!client.addGroup || !camp.externalId) {
    cx.log.push(`${group.name}: в группе ${pl(lim.total, "объявление", "объявления", "объявлений")} — больше площадка не принимает`);
    return null;
  }
  const db = await getDb();
  const { acc } = await clientOf(camp);
  const t = (group.targeting ?? {}) as { regionIds?: number[]; ageFrom?: number; ageTo?: number; sex?: "female" | "male" | "any"; autotargeting?: boolean; retargetingId?: string; negatives?: string[] };
  const regionIds = t.regionIds ?? ((camp.meta as { regionIds?: number[] })?.regionIds ?? []);
  // Ретаргетинг: новая группа — с тем же условием ретаргетинга, без фраз и автотаргетинга
  const rt = t.retargetingId ?? null;
  const { groupExt, warnings } = await client.addGroup(camp.externalId, { name: group.name, keywords: rt ? [] : group.keywords ?? [], negatives: rt ? [] : t.negatives ?? [], autotargeting: rt ? false : t.autotargeting ?? true, regionIds, ageFrom: t.ageFrom, ageTo: t.ageTo, sex: t.sex, retargetingId: rt }, { channel: camp.channel as Channel });
  const fresh: AdGroup = { ...group, id: uid("g_"), externalId: groupExt, status: "active", createdAt: new Date() };
  await db.insert(schema.adGroups).values(fresh);
  cx.groups.push(fresh);
  // Тесты старой группы завершаем: объявления переезжают, сравнение начнётся заново
  for (const ex of cx.experiments.filter((e) => e.status === "running" && cx.ads.some((a) => a.adGroupId === group.id && (a.id === e.controlId || a.id === e.variantId)))) {
    await endExperiment(cx, ex, "draw", "Группу перенесли в новую: в старой закончилось место для объявлений. Сравнение начнётся заново.");
  }
  const copies = new Map<string, Ad>();
  const toCopy = keep
    .map((id) => cx.ads.find((a) => a.id === id))
    .filter((a): a is Ad => !!a && a.adGroupId === group.id && (a.status === "active" || a.status === "moderation"))
    .slice(0, lim.nonArchived - 1);
  for (const src of toCopy) {
    const localId = uid("ad_");
    const res = await client.addAd(camp.externalId, groupExt, await adSpecFor(cx, camp, fresh, acc.platform, src, localId), { channel: camp.channel as Channel, orgId: cx.b.orgId });
    const copy: Ad = { ...src, id: localId, adGroupId: fresh.id, externalId: res.adExt, status: "moderation", statusNote: null, experimentId: null, parentAdId: src.id, createdAt: new Date() };
    await db.insert(schema.ads).values(copy);
    cx.ads.push(copy);
    copies.set(src.id, copy);
  }
  const old = cx.ads.filter((a) => a.adGroupId === group.id && a.externalId && !NOT_LIVE.includes(a.status));
  if (old.length) await client.archiveAds?.(old.map((a) => a.externalId!));
  for (const a of old) {
    await db.update(schema.ads).set({ status: "archived" }).where(eq(schema.ads.id, a.id));
    a.status = "archived";
  }
  await db.update(schema.adGroups).set({ status: "archived" }).where(eq(schema.adGroups.id, group.id));
  group.status = "archived";
  await logChange({
    businessId: cx.b.id, actor: "robot", kind: "ad_new",
    title: `Перенесли «${group.name}» в новую группу Директа`,
    reason: `В одной группе Директа может быть не больше ${lim.total} объявлений вместе с архивными, а робот уже проверил здесь все эти варианты. Создали такую же группу — те же запросы и настройки — и перенесли туда ${toCopy.length ? `лучшие объявления (${toCopy.map(adLabel).join(", ")})` : "новые объявления"}; старые убрали в архив. Их статистика сохранилась в отчётах.${warnings.length ? ` ${warnings.join(" ")}` : ""}`,
    details: { fromGroupId: group.id, toGroupId: fresh.id, copied: [...copies.values()].map((a) => a.id) },
  });
  cx.log.push(`Группа ${group.id} → ${fresh.id} (лимит ${lim.total})`);
  return { group: fresh, copies };
}

async function createVariant(cx: Ctx, base: Ad, reason: string, opts: { experiment?: boolean; angle?: string; owner?: boolean; replacing?: boolean } = {}) {
  const db = await getDb();
  const camp = cx.campaigns.find((c) => c.id === base.campaignId)!;
  let group = cx.groups.find((g) => g.id === base.adGroupId)!;
  if (!camp.externalId || !group.externalId) return null;
  // Робот не пишет объявления в остановленные кампании и аудитории (в т. ч. остановленные защитой бюджета в этом проходе)
  if (!opts.owner && (camp.status !== "active" || group.status !== "active")) return null;
  const peers = cx.ads.filter((a) => a.adGroupId === group.id);
  const tried = [...new Set(peers.map((a) => a.angle))];
  const winner = peers
    .filter((a) => a.status === "active" && a.id !== base.id)
    .map((a) => ({ a, s: sumAd(cx, a.id) }))
    .sort((x, y) => ctr(y.s) - ctr(x.s))[0]?.a;
  const ch = formatOf(camp.channel) as keyof typeof LIMITS;
  const angle = opts.angle ?? chooseAngle(cx, camp.channel, group.id, [base.angle]);
  const ask = (a: string | undefined) => rewriteAd(cx.b, { channel: ch, angle: a, service: camp.channel === "search" ? group.name : undefined, base: { angle: base.angle, title: base.title, title2: base.title2, text: base.text }, tried, reason, winner: winner ? { angle: winner.angle, title: winner.title, title2: winner.title2, text: winner.text } : null });
  // Не повторяем объявление, которое уже было в группе и проиграло или выключено
  const seen = (d: { title: string; text: string }) => peers.some((p) => p.title === d.title && p.text === d.text);
  let draft = await ask(angle);
  for (let i = 0; i < 3 && seen(draft); i++) {
    const other = chooseAngle(cx, camp.channel, group.id, [base.angle, draft.angle]);
    draft = await ask(other);
  }
  if (seen(draft)) return null;

  const { acc, client } = await clientOf(camp);
  // Лимит объявлений в группе: заменяемое отклонённое уходит в архив первым, базовое и лидер группы остаются
  const room = await ensureRoom(cx, client, camp, group, [...(opts.replacing ? [] : [base.id]), ...(winner ? [winner.id] : [])], opts.replacing ? "Отклонённое объявление заменяем новым" : "Робот добавляет новый вариант");
  if (!room) return null;
  group = room.group;
  base = room.copies.get(base.id) ?? base;
  const localId = uid("ad_");
  const res = await client.addAd(camp.externalId, group.externalId!, await adSpecFor(cx, camp, group, acc.platform, { ...draft, imageId: base.imageId }, localId), { channel: camp.channel as Channel, orgId: cx.b.orgId });

  let experimentId: string | null = null;
  if (opts.experiment) experimentId = uid("x_");
  const ad: Ad = {
    id: localId, businessId: cx.b.id, campaignId: camp.id, adGroupId: group.id, externalId: res.adExt, angle: draft.angle,
    title: draft.title, title2: draft.title2 ?? null, text: draft.text, imageId: base.imageId, status: "moderation", statusNote: null,
    experimentId, parentAdId: base.id, createdAt: new Date(),
  };
  await db.insert(schema.ads).values(ad);
  cx.ads.push(ad);
  cx.newAds++;
  if (experimentId) {
    const ex: Experiment = { id: experimentId, businessId: cx.b.id, campaignId: camp.id, kind: "ad", hypothesis: draft.hypothesis, controlId: base.id, variantId: ad.id, status: "running", result: null, startedAt: cx.now, finishedAt: null };
    await db.insert(schema.experiments).values(ex);
    await db.update(schema.ads).set({ experimentId }).where(eq(schema.ads.id, base.id));
    base.experimentId = experimentId;
    cx.experiments.push(ex);
  }
  return { ad, draft, experimentId };
}

// ─── 0. Бюджет месяца ────────────────────────────────────────────────────
// Жёсткая граница: лимиты подбираются так, чтобы остатка хватило до конца месяца, а если минимумы площадок
// не помещаются — отключаем наименее важный канал или останавливаем рекламу заранее, до следующей проверки.

const names = (list: Campaign[]) => list.map((c) => `«${CHANNEL_NAME[c.channel]}»`).join(", ");
const sumWeekly = (list: Campaign[], plan?: Plan) => list.reduce((s, c) => s + (plan?.weekly.get(c.id) ?? c.weeklyBudget), 0);

/** Первый проход защиты бюджета в новом месяце (самый первый проход после запуска — не «новый месяц») */
async function monthTurn(cx: Ctx, month: string) {
  const db = await getDb();
  const [j] = await db.select().from(schema.jobs).where(and(eq(schema.jobs.businessId, cx.b.id), eq(schema.jobs.kind, "budget_month")));
  return { newMonth: !!j && j.lastResult !== month, mark: !j || j.lastResult !== month };
}

/** Обновить кампанию в памяти прохода, чтобы следующие шаги видели новое состояние */
async function syncCampaign(c: Campaign, patch: Partial<Campaign>, meta?: BudgetMeta) {
  Object.assign(c, patch);
  if (meta) c.meta = (await patchBudgetMeta(c.id, meta)) ?? c.meta;
}

async function guardPause(cx: Ctx, list: Campaign[], st: BudgetState, reason: string, title: string) {
  const owned = list.filter((c) => cx.protected.has(c.id) && cx.ownerStatus.get(c.id) === "active");
  const ownerNote = owned.length ? ` Вы включали ${names(owned)} вручную, но бюджет месяца — жёсткая граница, его робот не превышает.` : "";
  await act(
    { businessId: cx.b.id, actor: "robot", kind: "pause", title, reason: reason + ownerNote, details: { guard: true, spent: Math.round(st.spent), budget: cx.b.monthlyBudget, remaining: Math.round(st.remaining) } },
    list.map((c) => ({ op: "campaignStatus" as const, campaignId: c.id, status: "paused" as const })),
  );
  for (const c of list) await syncCampaign(c, { status: "paused" }, { pausedByGuard: st.month, pausedBy: "robot" });
}

async function budgetGuard(cx: Ctx) {
  // Бюджет перечитываем: владелец мог изменить его, пока шёл проход (cx.b загружен в начале)
  {
    const db = await getDb();
    const [fresh] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, cx.b.id));
    if (fresh) cx.b = fresh;
  }
  const budget = cx.b.monthlyBudget;
  const st = await budgetState(cx.b.id, budget, cx.now, cx.campaigns);
  const { newMonth, mark } = await monthTurn(cx, st.month);
  // Жёсткая граница: больше этой суммы в неделю реклама могла бы выйти за остаток бюджета до следующей проверки
  const cap = spendableWeekly(st.remaining, st.daysLeft, st.model);
  // Обычный темп этого месяца (бюджет ровно на все его дни)
  const normalTotal = monthWeekly(budget, cx.now);
  // Площадки обычно тратят меньше лимита. Чтобы бюджет месяца не пропадал, лимиты держим «под остаток»,
  // но не выше CATCH_UP × обычного темпа и никогда не выше жёсткой границы
  // В месяц запуска «догоняем» только долю бюджета с дня запуска: запуск 26-го не повод потратить весь месячный бюджет за 5 дней
  const launched = Math.min(...cx.campaigns.map((c) => new Date(c.createdAt).getTime()));
  const launchMonth = Number.isFinite(launched) && monthKey(new Date(launched)) === st.month;
  const planned = launchMonth ? (budget * daysLeftInMonth(new Date(launched))) / monthDays(cx.now) : budget;
  const plannedCap = launchMonth ? spendableWeekly(planned - st.spent, st.daysLeft, st.model) : cap;
  const target = Math.min(cap, plannedCap, Math.floor(normalTotal * CATCH_UP));
  const active = cx.campaigns.filter((c) => c.status === "active");
  // Включаем обратно только то, что остановил сам робот из-за бюджета. Паузу владельца не трогаем никогда.
  // В осторожном режиме (статистика не обновилась) ничего не включаем
  let resumable = cx.safe ? [] : cx.campaigns.filter((c) => pausedForBudget(c) && c.externalId && cx.ownerStatus.get(c.id) !== "paused");
  // «Обычные» лимиты. В новом месяце считаем их заново от месячного бюджета с долями каналов (с учётом переносов
  // между каналами), а не от прошлых лимитов — иначе любые поправки накапливались бы из месяца в месяц.
  // Лимит, который владелец недавно менял сам, не поднимаем и не перераспределяем.
  const fixedOf = (c: Campaign) => cx.protected.has(c.id);
  const normals = new Map<string, number>();
  {
    const all = [...active, ...resumable];
    const free = all.filter((c) => !fixedOf(c));
    const freeBase = Math.max(0, weeklyFromMonthly(budget) - all.filter(fixedOf).reduce((s, c) => s + c.weeklyBudget, 0));
    const shareSum = free.reduce((s, c) => s + Math.max(restoreTarget(c), 1), 0);
    for (const c of all) {
      // Доля канала не ниже минимума площадки: переносы между каналами не должны «выключать» канал в новом месяце
      const share = newMonth && shareSum ? Math.floor((Math.max(restoreTarget(c), 1) / shareSum) * freeBase) : restoreTarget(c);
      normals.set(c.id, fixedOf(c) ? c.weeklyBudget : Math.max(share, MIN_WEEKLY[c.channel as Channel], 1));
    }
  }
  const item = (c: Campaign, restore: boolean): PlanItem => ({
    id: c.id, channel: c.channel as Channel,
    want: restore && !fixedOf(c) ? normals.get(c.id)! : c.weeklyBudget,
    fixed: fixedOf(c),
  });
  // Включаем с запасом 10 %, чтобы канал не включался и не выключался через день
  if (resumable.length) {
    const trial = planLimits([...active, ...resumable].map((c) => item(c, true)), Math.floor(Math.min(cap, normalTotal) * 0.9), true);
    resumable = resumable.filter((c) => !trial.dropped.includes(c.id));
  }
  const pool = [...active, ...resumable];
  if (pool.length) {
    const items = pool.map((c) => item(c, newMonth || c.status !== "active"));
    const wantSum = items.reduce((s, i) => s + i.want, 0);
    const low = await lowCabinets(cx, active);
    let plan: Plan;
    if (newMonth) {
      // Новый месяц: обычная раскладка бюджета, как при запуске
      plan = planLimits(items, Math.min(target, normalTotal), true);
    } else if (wantSum > cap) {
      // Не помещаемся в остаток — снижаем с запасом 3 %, чтобы не дёргать лимиты каждый день; превышение бюджета не допускаем вовсе
      plan = planLimits(items, Math.floor(cap * 0.97));
      if (plan.dropped.length || plan.short) plan = planLimits(items, cap);
    } else if (wantSum < target * CATCH_UP_GAP && low.length) {
      // Недорасход из-за того, что в кабинете кончаются деньги, а не из-за площадки: лимиты не поднимаем,
      // иначе после пополнения реклама разом потратила бы «накопленное»
      plan = planLimits(items, wantSum);
      await holdForBalance(cx, low, st);
    } else if (wantSum < target * CATCH_UP_GAP) {
      // Площадки тратят меньше лимита, и к концу месяца остался бы неизрасходованный бюджет — поднимаем лимиты под остаток
      // С тем же запасом 3 % до жёсткой границы, что и при снижении, — иначе на следующий день лимиты пришлось бы снова снижать
      plan = planLimits(items, Math.min(Math.floor(cap * 0.97), target), true);
    } else {
      plan = planLimits(items, wantSum);
    }
    if (cx.safe) {
      // Расход мог быть больше, чем видно в статистике: лимиты только снижаем, поднимать будем после успешной синхронизации
      for (const c of pool) {
        const w = plan.weekly.get(c.id);
        if (w !== undefined && w > c.weeklyBudget) plan.weekly.set(c.id, c.weeklyBudget);
      }
      cx.log.push("Бюджет: статистика обновилась не по всем кабинетам — лимиты не поднимаем и ничего не включаем");
    }
    const keep = pool.filter((c) => !plan.dropped.includes(c.id));
    const reserve = reserveFor(sumWeekly(keep, plan), st.daysLeft, st.model);

    if (st.remaining <= 0 || st.remaining < reserve) {
      if (active.length) {
        const left = Math.max(0, st.remaining);
        await guardPause(
          cx, active, st,
          `За этот месяц потрачено ${rub(st.spent)} из ${rub(budget)}${left ? `, осталось ${rub(left)}` : ""}. ` +
            (left ? `Площадки не принимают лимит меньше минимума, а с минимальным лимитом реклама до следующей проверки могла бы потратить около ${rub(reserve)} — больше остатка. Поэтому остановили её заранее. ` : "Бюджет месяца израсходован. ") +
            "1-го числа робот включит рекламу сам. Хотите продолжить раньше — увеличьте бюджет в настройках, и реклама включится сразу.",
          "Остановили рекламу до конца месяца",
        );
        cx.log.push("Бюджет месяца исчерпан — пауза");
      }
    } else {
      try {
        await dropForBudget(cx, active.filter((c) => plan.dropped.includes(c.id)), keep, st, cap);
      } catch (e) {
        // Не смогли отключить канал — всё равно снижаем лимиты остальных; ошибку покажем в итоге шага
        cx.log.push(`Бюджет: не удалось отключить ${names(active.filter((c) => plan.dropped.includes(c.id)))}: ${errorText(e)}`);
        await fitLimits(cx, keep.filter((c) => c.status === "active"), plan, st, newMonth, normals, cap);
        throw e;
      }
      await fitLimits(cx, keep.filter((c) => c.status === "active" || resumable.includes(c)), plan, st, newMonth, normals, cap);
      await resumeForBudget(cx, resumable.filter((c) => keep.includes(c)), st);
      // В новом месяце запоминаем «обычные» лимиты и у кампаний, чей лимит не изменился
      if (newMonth) {
        for (const c of keep) {
          const n = normals.get(c.id);
          if (n !== undefined && restoreTarget(c) !== n && !fixedOf(c)) await syncCampaign(c, {}, cutMeta(c, c.weeklyBudget, n));
        }
      }
    }
  }
  // В осторожном режиме новый месяц не отмечаем: обычную раскладку на месяц сделает первый проход со свежей статистикой
  if (mark && !cx.safe) await markJob(cx, "budget_month", st.month);
}

/** Кабинеты активных кампаний, где деньги кончились или кончатся в ближайшие дни (по последней проверке баланса) */
async function lowCabinets(cx: Ctx, active: Campaign[]) {
  const ids = new Set(active.map((c) => c.accountId));
  const list = await getBalances(cx.b).catch(() => []);
  return list.filter((x) => ids.has(x.accountId) && x.daysLeft !== null && x.daysLeft <= LOW_DAYS);
}

/** Объяснить в истории, почему лимиты не подняли при недорасходе (не чаще раза в 3 дня) */
async function holdForBalance(cx: Ctx, low: Awaited<ReturnType<typeof lowCabinets>>, st: BudgetState) {
  cx.log.push("Бюджет: недорасход из-за баланса кабинета — лимиты не поднимаем");
  const db = await getDb();
  const key = `balance:hold:${cx.b.id}`;
  const [row] = await db.select().from(schema.kv).where(eq(schema.kv.key, key));
  const last = Number((row?.value as { at?: number } | undefined)?.at ?? 0);
  if (last && cx.now.getTime() - last < 3 * 86400e3) return;
  const where = low.map((x) => (x.platform === "demo" ? "в демо-кабинете" : `в кабинете ${CABINET_NAME[x.platform] ?? x.platform}`)).join(" и ");
  const empty = low.some((x) => x.daysLeft === 0);
  await logChange({
    businessId: cx.b.id, actor: "robot", kind: "budget",
    title: "Не поднимаем лимиты: в кабинете кончаются деньги",
    reason:
      `С начала месяца потрачено ${rub(st.spent)} из ${rub(cx.b.monthlyBudget)} — меньше плана. Обычно робот в таком случае поднимает недельные лимиты, чтобы бюджет не пропал. ` +
      `Но сейчас деньги ${where} ${empty ? "кончились" : "почти кончились"}, поэтому реклама тратит меньше не из-за площадки, а из-за остатка. ` +
      "Лимиты оставили прежними: после пополнения реклама продолжит в обычном темпе, без рывка. Пополните кабинет — и робот снова будет следить за темпом сам.",
    details: { guard: true, balance: low.map((x) => ({ accountId: x.accountId, amount: x.amount, daysLeft: x.daysLeft })) },
  });
  const value = { at: cx.now.getTime() };
  await db.insert(schema.kv).values({ key, value }).onConflictDoUpdate({ target: schema.kv.key, set: { value, updatedAt: new Date() } });
}

/** Минимумы площадок не помещаются в остаток — отключаем наименее важные каналы */
async function dropForBudget(cx: Ctx, drop: Campaign[], keep: Campaign[], st: BudgetState, total: number) {
  if (!drop.length) return;
  const mins = drop.map((c) => `${rub(MIN_WEEKLY[c.channel as Channel])} в неделю для «${CHANNEL_NAME[c.channel]}»`).join(", ");
  await guardPause(
    cx, drop, st,
    `До конца месяца осталось ${rub(Math.max(0, st.remaining))} на ${pl(st.daysLeft, "день", "дня", "дней")} — это около ${rub(total)} в неделю на все каналы. ` +
      `Площадки не принимают лимит ниже минимума (${mins}), поэтому все каналы в бюджет не помещаются. ` +
      `Оставили самые важные: ${names(keep)}. ${names(drop)} включится сам, когда бюджета станет хватать — 1-го числа или если вы увеличите бюджет.`,
    `Поставили на паузу ${names(drop)}: на все каналы не хватает бюджета`,
  );
  cx.log.push(`Бюджет: отключены ${drop.map((c) => c.channel).join(", ")}`);
}

/** Поставить лимиты по плану: снизить, чтобы уложиться, поднять под остаток или вернуть обычные в начале месяца */
async function fitLimits(cx: Ctx, list: Campaign[], plan: Plan, st: BudgetState, newMonth: boolean, normals: Map<string, number>, cap: number) {
  const moves = list.map((c) => ({ c, next: plan.weekly.get(c.id)! })).filter(({ c, next }) => next !== undefined && next !== c.weeklyBudget);
  if (!moves.length) return;
  const down = moves.filter((m) => m.next < m.c.weeklyBudget), up = moves.filter((m) => m.next > m.c.weeklyBudget);
  const before = sumWeekly(list);
  const after = sumWeekly(list, plan);
  const projected = st.spent + (before / 7) * st.daysLeft;
  const normalSum = list.reduce((s, c) => s + (normals.get(c.id) ?? restoreTarget(c)), 0);
  const lines = moves.map((m) => `${CHANNEL_NAME[m.c.channel]}: ${rub(m.c.weeklyBudget)} → ${rub(m.next)}`).join("; ");
  const learning = moves.some((m) => learningLeft(cx, m.c)) ? " Кампании ещё учатся, но бюджет месяца важнее." : "";
  // Поднимаем, потому что площадки недотратили (а не возвращаем то, что робот снижал раньше)
  const restoring = up.every((m) => (normals.get(m.c.id) ?? restoreTarget(m.c)) >= m.next) && before < normalSum;
  const catchUp = !newMonth && !down.length && !restoring;
  // Лимит ниже минимума площадки поднимаем до минимума — это не «возврат», робот его не снижал
  const toMin = !newMonth && !down.length && up.every((m) => m.c.weeklyBudget < MIN_WEEKLY[m.c.channel as Channel] && m.next === MIN_WEEKLY[m.c.channel as Channel]);
  const title = toMin
    ? "Подняли лимит до минимума площадки"
    : newMonth
    ? "Пересчитали недельные лимиты на новый месяц"
    : !up.length
      ? "Снизили недельные лимиты, чтобы уложиться в бюджет"
      : catchUp
        ? "Подняли недельные лимиты под остаток бюджета"
        : !down.length
          ? "Вернули недельные лимиты"
          : "Пересчитали недельные лимиты под бюджет месяца";
  const days = pl(st.daysLeft, "день", "дня", "дней");
  const why = toMin
    ? `С недельным лимитом меньше минимума площадка не показывает рекламу. Подняли до минимума — бюджет месяца при этом соблюдается: робот следит за остатком.`
    : newMonth
    ? `Начался новый месяц — бюджет ${rub(cx.b.monthlyBudget)} снова доступен целиком. Лимиты рассчитали заново от бюджета месяца с прежними долями каналов и подогнали под число дней в месяце.`
    : !up.length
      ? `С начала месяца потрачено ${rub(st.spent)} из ${rub(cx.b.monthlyBudget)}. При прежних лимитах (${rub(before)} в неделю) к концу месяца вышло бы около ${rub(projected)} — больше бюджета. Новые лимиты рассчитаны так, чтобы остатка ${rub(st.remaining)} точно хватило на ${days}.`
      : catchUp
        ? `Площадки тратят меньше недельного лимита: с начала месяца потрачено ${rub(st.spent)} из ${rub(cx.b.monthlyBudget)}, осталось ${rub(st.remaining)} на ${days}. Чтобы остаток не пропал, подняли лимиты под него — больше бюджета месяца реклама всё равно не потратит.${after > normalSum ? " 1-го числа лимиты вернутся к обычным." : ""}`
        : `Бюджета снова хватает — вернули лимиты, которые робот снижал раньше.`;
  try {
    await act(
      { businessId: cx.b.id, actor: "robot", kind: "budget", title, reason: `${why} ${lines}.${learning}`, details: { guard: true, spent: Math.round(st.spent), projected: Math.round(projected) } },
      moves.map((m) => ({ op: "campaignBudget" as const, campaignId: m.c.id, weeklyBudget: m.next })),
    );
  } catch (e) {
    // Изменения применяются целиком: если не прошло повышение, откатилось и снижение. Сначала пробуем только снизить
    if (down.length && up.length) {
      try {
        await act(
          { businessId: cx.b.id, actor: "robot", kind: "budget", title: "Снизили недельные лимиты, чтобы уложиться в бюджет", reason: `${why} ${lines}.${learning}`, details: { guard: true, spent: Math.round(st.spent), projected: Math.round(projected) } },
          down.map((m) => ({ op: "campaignBudget" as const, campaignId: m.c.id, weeklyBudget: m.next })),
        );
        for (const m of down) await syncCampaign(m.c, { weeklyBudget: m.next }, cutMeta(m.c, m.next, normals.get(m.c.id) ?? restoreTarget(m.c)));
        cx.log.push("Снизили недельные лимиты, чтобы уложиться в бюджет");
        cx.log.push(`Бюджет: поднять лимиты не получилось: ${errorText(e)}`);
        return;
      } catch {
        /* снизить тоже не удалось — ниже остановим то, что не смогли урезать */
      }
    }
    // Площадка не приняла снижение, а лимиты выше безопасной суммы — останавливаем кампании, которые не смогли урезать
    const active = list.filter((c) => c.status === "active");
    if (down.length && sumWeekly(active) > cap + 1) {
      for (const m of down.filter((x) => x.c.status === "active")) {
        try {
          await guardPause(
            cx, [m.c], st,
            `Чтобы уложиться в бюджет месяца, робот снижал недельный лимит «${CHANNEL_NAME[m.c.channel]}» с ${rub(m.c.weeklyBudget)} до ${rub(m.next)}, но площадка не приняла изменение (${errorText(e)}). ` +
              `С прежним лимитом реклама могла бы выйти за бюджет, поэтому канал поставили на паузу. Робот включит его сам, когда сможет поставить нужный лимит.`,
            `Поставили на паузу ${names([m.c])}: не удалось снизить лимит`,
          );
        } catch (e2) {
          cx.log.push(`Бюджет: не удалось ни снизить лимит, ни остановить ${m.c.id}: ${errorText(e2)}`);
        }
      }
    }
    throw e;
  }
  for (const m of moves) await syncCampaign(m.c, { weeklyBudget: m.next }, cutMeta(m.c, m.next, normals.get(m.c.id) ?? restoreTarget(m.c)));
  cx.log.push(title);
}

async function resumeForBudget(cx: Ctx, list: Campaign[], st: BudgetState) {
  if (!list.length) return;
  const fromPrev = list.every((c) => String((c.meta as BudgetMeta).pausedByGuard ?? "") < st.month);
  await act(
    {
      businessId: cx.b.id, actor: "robot", kind: "resume",
      title: fromPrev ? "Возобновили рекламу в новом месяце" : "Снова включили рекламу",
      reason: fromPrev
        ? `Начался новый месяц. Робот включил ${names(list)}: ${list.length > 1 ? "они стояли" : "канал стоял"}, чтобы не выйти за бюджет прошлого месяца.`
        : `Бюджета снова хватает (до конца месяца осталось ${rub(st.remaining)}) — включили ${names(list)}: робот останавливал ${list.length > 1 ? "их" : "канал"} из-за бюджета.`,
      details: { guard: true },
    },
    list.map((c) => ({ op: "campaignStatus" as const, campaignId: c.id, status: "active" as const })),
  );
  for (const c of list) await syncCampaign(c, { status: "active" }, { pausedByGuard: null });
  cx.log.push("Возобновили кампании после паузы по бюджету");
}

// ─── 1. Отклонённые модерацией ──────────────────────────────────────────

async function handleRejected(cx: Ctx) {
  const db = await getDb();
  const rejected = cx.ads.filter((a) => a.status === "rejected");
  if (!rejected.length) return;
  // Какие объявления уже заменяли: запись «ad_new» с details.oldAdId (её же использует отмена замены).
  // По parentAdId проверять нельзя — его ставят и вариантам A/B-тестов, и копиям при переносе группы.
  const replaced = new Set(
    (await db.select({ details: schema.changes.details }).from(schema.changes).where(and(eq(schema.changes.businessId, cx.b.id), eq(schema.changes.kind, "ad_new"))))
      .map((r) => (r.details as { oldAdId?: unknown } | null)?.oldAdId)
      .filter((x): x is string => typeof x === "string"),
  );
  for (const ad of rejected) {
    if (cx.newAds >= MAX_NEW_ADS_PER_RUN) return;
    if (cx.protected.has(ad.id)) continue; // владелец сам правил или возвращал это объявление
    const camp = cx.campaigns.find((c) => c.id === ad.campaignId);
    if (!camp || camp.status !== "active") continue;
    if (cx.groups.find((g) => g.id === ad.adGroupId)?.status !== "active") continue; // аудиторию отключили — не пишем замену
    if (replaced.has(ad.id)) continue; // замену уже делали
    try {
      const r = await createVariant(cx, ad, `Модерация отклонила объявление: ${ad.statusNote || "без пояснения"}. Нужно переписать, сохранив смысл.`, { replacing: true });
      if (!r) continue;
      if (ad.status !== "archived") {
        // Отклонённое занимает место среди неархивных объявлений группы — убираем в архив и у площадки
        const { client } = await clientOf(camp);
        if (ad.externalId) await client.archiveAds?.([ad.externalId]).catch((e) => cx.log.push(`Архив ${ad.id}: ${errorText(e)}`));
        await db.update(schema.ads).set({ status: "archived" }).where(eq(schema.ads.id, ad.id));
        ad.status = "archived";
      }
      await logChange({
        businessId: cx.b.id, actor: "robot", kind: "ad_new",
        title: `Переписали объявление, которое не прошло модерацию`,
        reason: `${CHANNEL_NAME[camp.channel]} не пропустил ${adLabel(ad)}${ad.statusNote ? `: «${ad.statusNote}»` : ""}. Написали новый вариант — «${r.ad.title}». Он уже отправлен на проверку.`,
        // При отмене новое объявление выключается, а старое возвращается в список как «не прошло модерацию»
        details: { oldAdId: ad.id, newAdId: r.ad.id },
        undo: [{ op: "adStatus", adId: r.ad.id, status: "paused" }],
      });
      cx.log.push(`Заменено отклонённое объявление ${ad.id}`);
    } catch (e) {
      cx.log.push(`Не удалось заменить ${ad.id}: ${errorText(e)}`);
    }
  }
}

// ─── 2. Итоги A/B-тестов ────────────────────────────────────────────────

async function resolveExperiments(cx: Ctx) {
  for (const ex of cx.experiments.filter((e) => e.status === "running")) {
    const control = cx.ads.find((a) => a.id === ex.controlId);
    const variant = cx.ads.find((a) => a.id === ex.variantId);
    const camp = cx.campaigns.find((c) => c.id === ex.campaignId);
    if (!control || !variant || !camp) continue;
    // Владелец сам менял одно из объявлений теста — не выбираем победителя и ничего не отключаем
    if (cx.protected.has(control.id) || cx.protected.has(variant.id)) {
      await endExperiment(cx, ex, "draw", "Вы сами меняли одно из объявлений теста — робот не стал выбирать победителя, оба объявления работают как вы решили.");
      cx.log.push(`Тест ${ex.id}: завершён без решения (решение владельца)`);
      continue;
    }
    if (control.status !== "active" && control.status !== "moderation") {
      // Прежнее объявление отклонили, убрали в архив или остановили — сравнивать не с чем, тест не должен висеть вечно
      const why = control.status === "rejected" ? "не прошло модерацию" : control.status === "archived" ? "убрано в архив" : "остановлено";
      await endExperiment(cx, ex, "draw", `Прежнее объявление ${adLabel(control)} ${why} — сравнивать не с чем. Новый вариант работает дальше как обычное объявление.`);
      cx.log.push(`Тест ${ex.id}: завершён — контрольное объявление не работает`);
      continue;
    }
    if (variant.status === "rejected" || variant.status === "archived") {
      await endExperiment(cx, ex, "draw", "Новый вариант не прошёл модерацию");
      continue;
    }
    // Сравниваем только с момента, когда вариант начал показываться
    const varRows = (cx.statByAd.get(variant.id) ?? []).filter((r) => r.s.impressions > 0).map((r) => r.day).sort();
    if (!varRows.length) {
      // Вариант так и не показался — тест не должен висеть вечно и блокировать новые тесты в группе
      if ((cx.now.getTime() - ex.startedAt.getTime()) / 864e5 >= MAX_TEST_DAYS) await endExperiment(cx, ex, "draw", `За ${pl(MAX_TEST_DAYS, "день", "дня", "дней")} новый вариант так и не начал показываться.`);
      continue;
    }
    const since = varRows[0];
    const sc = sumAd(cx, control.id, since), sv = sumAd(cx, variant.id, since);
    const min = MIN_IMPR[camp.channel as Channel];
    const ageDays = (cx.now.getTime() - new Date(since).getTime()) / 864e5;
    if (sc.impressions < min || sv.impressions < min) {
      if (ageDays < MAX_TEST_DAYS) continue;
      // Срок вышел, а показов для вывода мало — ничья, ничего не отключаем: решение на таких данных было бы случайным
      await endExperiment(cx, ex, "draw", `За ${pl(MAX_TEST_DAYS, "день", "дня", "дней")} показов набралось слишком мало, чтобы выбрать лучший вариант. Оба объявления работают дальше.`);
      cx.log.push(`Тест ${ex.id}: ничья — мало показов`);
      continue;
    }
    // Если заявок достаточно — сравниваем по заявкам на клик. Если мало — по качеству визитов из Метрики
    // (визиты без отказа на переход), когда переходов достаточно и сигнал уверенный; иначе — по кликабельности (CTR).
    // Качество визитов никогда не перебивает обращения: при обратной картине по обращениям оно не используется.
    const byConv = sc.conversions + sv.conversions >= 10;
    const qv = qAd(cx, variant.id, since), qc = qAd(cx, control.id, since);
    const px: ProxyResult | null = byConv ? null : proxyCompare({ clicks: sv.clicks, conversions: sv.conversions, q: qv }, { clicks: sc.clicks, conversions: sc.conversions, q: qc });
    const pxVerdict = px ? proxyVerdict(px) : null;
    const mode: "conv" | "proxy" | "ctr" = byConv ? "conv" : pxVerdict ? "proxy" : "ctr";
    const p = mode === "conv" ? probBetter(sv.conversions, sv.clicks, sc.conversions, sc.clicks) : mode === "proxy" ? px!.p : probBetter(sv.clicks, sv.impressions, sc.clicks, sc.impressions);
    const metric = mode === "conv" ? "заявок на 100 переходов" : mode === "proxy" ? "качественных визитов на 100 переходов" : "кликов на 100 показов";
    const rV = mode === "conv" ? (sv.clicks ? (sv.conversions / sv.clicks) * 100 : 0) : mode === "proxy" ? px!.rateV * 100 : ctr(sv) * 100;
    const rC = mode === "conv" ? (sc.clicks ? (sc.conversions / sc.clicks) * 100 : 0) : mode === "proxy" ? px!.rateC * 100 : ctr(sc) * 100;
    const fmt = (x: number) => x.toFixed(1).replace(".", ",");
    const hyp = ex.hypothesis.replace(/\.$/, "");
    let status: "won" | "lost" | "draw" | null = null;
    if (mode === "proxy") status = pxVerdict;
    else if (p >= 0.9) status = "won";
    else if (p <= 0.1) status = "lost";
    else if (ageDays >= MAX_TEST_DAYS) status = "draw";
    // Кликабельность выбрала победителя, а по Метрике уверенно наоборот: люди с «победителя» чаще сразу уходят — ждём
    if (mode === "ctr" && (status === "won" || status === "lost") && proxyVetoes(px, status)) {
      if (ageDays < MAX_TEST_DAYS) {
        cx.log.push(`Тест ${ex.id}: по кликабельности ${status === "won" ? "новый" : "прежний"} вариант лучше, а по качеству визитов — наоборот; ждём данных`);
        continue;
      }
      status = "draw";
    }
    if (!status) continue;

    // При равенстве оставляем прежний вариант
    const loser = status === "won" ? control : status === "lost" ? variant : rV > rC ? control : variant;
    const winner = loser.id === control.id ? variant : control;
    const days = Math.max(1, Math.round(ageDays));
    const proxyWhy = mode === "proxy"
      ? `Обращений пока мало (${sv.conversions + sc.conversions} на оба варианта), поэтому сравнили, сколько людей после клика действительно смотрели сайт (по Метрике — визиты без отказа). За ${pl(days, "день", "дня", "дней")}: качественных визитов ${pct(px!.rateV, 0)} против ${pct(px!.rateC, 0)} у прежнего варианта (${pl(sv.clicks, "переход", "перехода", "переходов")} и ${num(sc.clicks)}), вероятность, что новый лучше, — ${Math.round(p * 100)}%.`
      : "";
    const result =
      mode === "proxy"
        ? status === "won"
          ? `Гипотеза подтвердилась по качеству визитов. ${proxyWhy}`
          : `Гипотеза не подтвердилась: ${proxyWhy.charAt(0).toLowerCase()}${proxyWhy.slice(1)} Оставили прежний.`
        : status === "won"
          ? `Гипотеза подтвердилась: новый вариант даёт ${fmt(rV)} ${metric} против ${fmt(rC)} (вероятность, что он лучше, — ${Math.round(p * 100)}%).`
          : status === "lost"
            ? `Гипотеза не подтвердилась: новый вариант даёт ${fmt(rV)} ${metric} против ${fmt(rC)}. Оставили прежний.`
            : `За ${pl(MAX_TEST_DAYS, "день", "дня", "дней")} явного победителя нет (${fmt(rV)} против ${fmt(rC)} ${metric}). Оставили тот, что немного лучше.`;
    await act(
      { businessId: cx.b.id, actor: "robot", kind: "test_end", title: `Тест завершён: ${status === "won" ? "новый вариант лучше" : status === "lost" ? "старый вариант лучше" : "ничья"}`, reason: `Проверяли: ${hyp}. ${result} ${loser.title === winner.title && ex.kind === "creative" ? `Отключили вариант с ${loser.id === ex.variantId ? "новой" : "прежней"} картинкой, работает вариант с ${winner.id === ex.variantId ? "новой" : "прежней"}.` : `Отключили ${adLabel(loser)}, работает ${adLabel(winner)}.`}`, details: { experimentId: ex.id, p, mode, control: sc, variant: sv, ...(mode === "proxy" ? { quality: { control: qc, variant: qv } } : {}) } },
      [{ op: "adStatus", adId: loser.id, status: "paused" }],
    );
    await endExperiment(cx, ex, status, result);
    if (status === "won" && ex.kind === "ad") cx.won.push(ex);
    loser.status = "paused";
    cx.log.push(`Тест ${ex.id}: ${status}`);
  }
}

// ─── 3. Объявления в группах ────────────────────────────────────────────

async function optimizeAds(cx: Ctx) {
  const since = isoDay(addDays(cx.now, -WINDOW_DAYS));
  for (const g of cx.groups.filter((x) => x.status === "active")) {
    const camp = cx.campaigns.find((c) => c.id === g.campaignId);
    if (!camp || camp.status !== "active") continue;
    const ch = camp.channel as Channel;
    const min = MIN_IMPR[ch];
    const live = cx.ads.filter((a) => a.adGroupId === g.id && a.status === "active");
    const running = cx.experiments.some((e) => e.status === "running" && live.some((a) => a.id === e.controlId || a.id === e.variantId));
    const rows = live.map((a) => ({ a, s: sumAd(cx, a.id, since) })).filter((r) => r.s.impressions >= min);
    if (rows.length < 2) continue;

    const groupS = rows.reduce((acc, r) => add(acc, r.s), zero());
    const best = [...rows].sort((x, y) => ctr(y.s) - ctr(x.s))[0];
    const cpa = groupS.conversions ? groupS.cost / groupS.conversions : null;

    for (const r of rows) {
      if (g.status !== "active") break; // группу перенесли в новую (лимит объявлений) — дальше решаем уже там
      if (r.a.status !== "active") continue; // ушло в архив, освобождая место новому варианту
      if (r.a.id === best.a.id || inTest(cx, r.a.id) || cx.protected.has(r.a.id)) continue;
      const pWorse = probBetter(best.s.clicks, best.s.impressions, r.s.clicks, r.s.impressions);
      const ratio = ctr(best.s) / Math.max(ctr(r.s), 1e-6);
      const activeLeft = cx.ads.filter((a) => a.adGroupId === g.id && a.status === "active").length;

      // Явно хуже: отключаем и пишем замену, чтобы в группе продолжали соревноваться минимум два варианта
      const drain = cpa && r.s.conversions === 0 && r.s.cost >= Math.max(2 * cpa, 600);
      if ((pWorse >= 0.95 && ratio >= 1.4) || drain) {
        const reason = drain
          ? `${adLabel(r.a)} потратило ${rub(r.s.cost)} за ${pl(WINDOW_DAYS, "день", "дня", "дней")} и не принесло ни одного обращения. В среднем по группе обращение стоит ${rub(cpa!)}.`
          : `${adLabel(r.a)} показали ${pl(r.s.impressions, "раз", "раза", "раз")}, кликнули ${pl(r.s.clicks, "раз", "раза", "раз")} (${pct(ctr(r.s))}). Лучшее объявление в этой группе получает ${pct(ctr(best.s))} — в ${times(ratio)} раза больше. Разница не случайна (уверенность ${Math.round(pWorse * 100)}%).`;
        await act(
          { businessId: cx.b.id, actor: "robot", kind: "pause", title: `Отключили слабое объявление ${adLabel(r.a)}`, reason: `${reason} Деньги уйдут на объявления, которые работают лучше.`, details: { adId: r.a.id, stats: r.s, best: best.s } },
          [{ op: "adStatus", adId: r.a.id, status: "paused" }],
        );
        r.a.status = "paused";
        cx.log.push(`Отключено ${r.a.id}`);
        if (activeLeft - 1 < 2 && cx.newAds < MAX_NEW_ADS_PER_RUN) {
          try {
            const v = await createVariant(cx, best.a, `Отключили слабое объявление ${adLabel(r.a)}. Нужен новый соперник для лучшего объявления группы.`);
            if (v) {
              await logChange({
                businessId: cx.b.id, actor: "robot", kind: "ad_new",
                title: `Добавили новое объявление «${v.ad.title}»`,
                reason: `Чтобы в группе «${g.name}» продолжали соревноваться минимум два варианта. Заодно проверяем, ${v.draft.hypothesis.replace(/\.$/, "")}.`,
                details: { adId: v.ad.id }, undo: [{ op: "adStatus", adId: v.ad.id, status: "paused" }],
              });
            }
          } catch (e) {
            cx.log.push(`Вариант не создан: ${errorText(e)}`);
          }
        }
        continue;
      }

      // Пограничное: не хуже явно, но и не лидер — запускаем A/B-тест с новой гипотезой
      if (!running && pWorse >= 0.6 && pWorse < 0.95 && cx.newAds < MAX_NEW_ADS_PER_RUN && r.s.impressions >= min * 2) {
        try {
          const v = await createVariant(cx, r.a, `Объявление работает средне: ${pct(ctr(r.s))} кликов против ${pct(ctr(best.s))} у лучшего. Попробуем другой подход.`, { experiment: true });
          if (v) {
            await logChange({
              businessId: cx.b.id, actor: "robot", kind: "test_start",
              title: `Запустили A/B-тест для ${adLabel(r.a)}`,
              reason: `Объявление работает средне: ${pct(ctr(r.s))} кликов, у лучшего в группе — ${pct(ctr(best.s))}. Проверяем: ${v.draft.hypothesis.replace(/\.$/, "")}. Новый вариант — «${v.ad.title}» — будет показываться наравне со старым, пока не станет ясно, какой лучше (обычно 1–2 недели).`,
              details: { experimentId: v.experimentId, controlId: r.a.id, variantId: v.ad.id, angle: v.draft.angle, angleName: ANGLES[v.draft.angle]?.name },
              undo: [{ op: "adStatus", adId: v.ad.id, status: "paused" }],
            });
            cx.log.push(`Тест для ${r.a.id}`);
          }
        } catch (e) {
          cx.log.push(`Тест не запущен: ${errorText(e)}`);
        }
        break; // одна новая гипотеза на группу за раз
      }
    }
  }
}

// ─── 3б. Перенос удачной идеи в другие группы ──────────────────────────

async function propagateWinners(cx: Ctx) {
  for (const ex of cx.won) {
    const winner = cx.ads.find((a) => a.id === ex.variantId);
    const camp = cx.campaigns.find((c) => c.id === ex.campaignId);
    if (!winner || !camp || camp.status !== "active") continue;
    const targets = cx.groups.filter(
      (g) =>
        g.campaignId === camp.id && g.id !== winner.adGroupId && g.status === "active" && !cx.protected.has(g.id) &&
        !cx.ads.some((a) => a.adGroupId === g.id && a.angle === winner.angle && (a.status === "active" || a.status === "moderation")) &&
        !cx.experiments.some((e) => e.status === "running" && cx.ads.some((a) => a.adGroupId === g.id && (a.id === e.controlId || a.id === e.variantId))),
    );
    const moved: string[] = [];
    const created: { adId: string; experimentId: string | null }[] = [];
    for (const g of targets) {
      if (cx.newAds >= MAX_NEW_ADS_PER_RUN) break;
      const since = isoDay(addDays(cx.now, -WINDOW_DAYS));
      const base = cx.ads
        .filter((a) => a.adGroupId === g.id && a.status === "active")
        .sort((a, b) => ctr(sumAd(cx, b.id, since)) - ctr(sumAd(cx, a.id, since)))[0];
      if (!base) continue;
      try {
        const v = await createVariant(cx, base, `В соседней группе победил подход «${ANGLES[winner.angle]?.name}». Перенеси его сюда, сохранив услугу этой группы.`, { experiment: true, angle: winner.angle });
        if (v) {
          moved.push(g.name);
          created.push({ adId: v.ad.id, experimentId: v.experimentId });
        }
      } catch (e) {
        cx.log.push(`Перенос идеи: ${errorText(e)}`);
      }
    }
    if (moved.length) {
      await logChange({
        businessId: cx.b.id, actor: "robot", kind: "test_start",
        title: `Пробуем удачную идею «${ANGLES[winner.angle]?.name}» в ${pl(moved.length, "другой группе", "других группах", "других группах")}`,
        reason: `В группе «${cx.groups.find((g) => g.id === winner.adGroupId)?.name}» подход «${ANGLES[winner.angle]?.name}» выиграл тест. Проверяем, сработает ли он и здесь: ${moved.map((m) => `«${m}»`).join(", ")}. Каждое новое объявление соревнуется с лучшим объявлением своей группы.`,
        details: { from: winner.id, angle: winner.angle, groups: moved, experimentIds: created.map((c) => c.experimentId).filter(Boolean), adIds: created.map((c) => c.adId) },
        // Отмена — выключить созданные объявления и завершить их тесты
        undo: created.map((c) => ({ op: "adStatus" as const, adId: c.adId, status: "paused" as const })),
      });
      cx.log.push(`Перенос идеи ${winner.angle} → ${moved.length}`);
    }
  }
}

// ─── 3в. Тест картинок: тот же текст, другой макет ─────────────────────

/**
 * Тест картинки при том же тексте. Сначала — фото владельца: если в группе его ещё не пробовали,
 * ставим его вместо иллюстрации или сгенерированной картинки (тот же макет, только другой снимок).
 * Когда все фото владельца в группе уже были, пробуем другие макеты с тем же фото.
 */
async function creativeTests(cx: Ctx, onlyOwnerPhotos = false) {
  const since = isoDay(addDays(cx.now, -WINDOW_DAYS));
  const db = await getDb();
  for (const camp of cx.campaigns.filter((c) => c.status === "active" && c.channel !== "search" && c.externalId)) {
    if (cx.newAds >= MAX_NEW_ADS_PER_RUN) return;
    const groups = cx.groups.filter((g) => g.campaignId === camp.id && g.status === "active" && g.externalId && !cx.protected.has(g.id));
    for (const g of groups) {
      // Фото владельца, которых в этой группе ещё не было (ни в работающих, ни в отключённых объявлениях)
      const triedPhotos = new Set(cx.ads.filter((a) => a.adGroupId === g.id && a.imageId).map((a) => cx.images.get(a.imageId!)?.photoId).filter(Boolean) as string[]);
      const freshPhoto = cx.ownPhotos.find((id) => !triedPhotos.has(id)) ?? null;
      if (onlyOwnerPhotos && !freshPhoto) continue;
      const running = cx.experiments.find((e) => e.status === "running" && cx.ads.some((a) => a.adGroupId === g.id && (a.id === e.controlId || a.id === e.variantId)));
      if (running) {
        // Тест нарисованных картинок уступает место фото владельца: настоящие фото важнее, чем выбор между иллюстрациями.
        // Тесты текстов и тесты с фото владельца не прерываем — фото подождёт их итога.
        const ownIn = (id: string) => { const ad = cx.ads.find((a) => a.id === id); const ph = ad?.imageId ? cx.images.get(ad.imageId)?.photoId : null; return !!ph && cx.ownPhotos.includes(ph); };
        if (!freshPhoto || running.kind !== "creative" || ownIn(running.controlId) || ownIn(running.variantId)) continue;
        const variant = cx.ads.find((a) => a.id === running.variantId);
        await endExperiment(cx, running, "draw", "Тест остановлен: владелец загрузил свои фото — теперь сравниваем с ними.");
        if (variant && (variant.status === "active" || variant.status === "moderation") && !cx.protected.has(variant.id)) {
          await act(
            {
              businessId: cx.b.id, actor: "robot", kind: "pause",
              title: `Остановили проверку нарисованной картинки для ${adLabel(variant)}`,
              reason: `Вы загрузили свои фото. Настоящие фото обычно работают лучше нарисованных картинок, поэтому проверку другой иллюстрации в аудитории «${g.name}» остановили — вместо неё сравним объявление с вашим фото.`,
              details: { experimentId: running.id },
            },
            [{ op: "adStatus", adId: variant.id, status: "paused" }],
          );
          variant.status = "paused";
        }
      }
      const live = cx.ads.filter((a) => a.adGroupId === g.id && a.status === "active" && a.imageId);
      if (!live.length) continue;
      const ranked = live.map((a) => ({ a, s: sumAd(cx, a.id, since) })).sort((x, y) => ctr(y.s) - ctr(x.s));
      // Тест макетов — только когда у лидера достаточно показов. Фото владельца пробуем сразу: владелец ждёт его в рекламе
      const best = freshPhoto ? ranked[0] : live.length >= 2 ? ranked.filter((r) => r.s.impressions >= MIN_IMPR[camp.channel as Channel])[0] : undefined;
      if (!best) continue;
      const img = cx.images.get(best.a.imageId!);
      if (!img?.layout) continue;
      let layout: Layout;
      let photoId = img.photoId;
      let hypothesis: string;
      if (freshPhoto) {
        // Тот же макет, если он показывает фото целиком; иначе — ценник поверх фото
        layout = img.layout === "photo" || img.layout === "tag" ? (img.layout as Layout) : "tag";
        photoId = freshPhoto;
        const was = !img.photoId ? "иллюстрация" : cx.ownPhotos.includes(img.photoId) ? "другое ваше фото" : "сгенерированная картинка";
        hypothesis = `привлечёт ли ваше фото больше людей, чем ${was}, при том же тексте`;
      } else if ((img.layout === "photo" || img.layout === "tag") && (await nextPhoto(cx, live, img.photoId))) {
        // Картинка с фото лидирует — пробуем другой кадр (сгенерированный под услугу или ваш), макет тот же
        layout = img.layout as Layout;
        photoId = (await nextPhoto(cx, live, img.photoId))!;
        hypothesis = `привлечёт ли другой кадр больше людей при том же тексте и макете`;
      } else {
        const usedHere = live.map((a) => cx.images.get(a.imageId!)?.layout).filter(Boolean) as string[];
        const options = availableLayouts(cx.b, cx.ownPhotos.length > 0 || !!img.photoId).filter((l) => l !== img.layout && !usedHere.includes(l));
        if (!options.length) continue;
        layout = pickByThompson(options, layoutStats(cx, camp.channel));
        // Без фото у лидера, но с фото владельца — берём фото, а не иллюстрацию
        photoId = img.photoId ?? cx.ownPhotos[0] ?? null;
        hypothesis = `привлечёт ли картинка «${LAYOUT_NAME[layout]}» больше людей, чем «${LAYOUT_NAME[img.layout as Layout] ?? img.layout}», при том же тексте`;
      }
      try {
        const { acc, client } = await clientOf(camp);
        // Лимит объявлений в группе: лидер остаётся, место освобождает проигравшее или самое слабое
        const room = await ensureRoom(cx, client, camp, g, [best.a.id], freshPhoto ? "Робот ставит ваше фото" : "Робот проверяет новую картинку");
        if (!room) continue;
        const group = room.group;
        const control = room.copies.get(best.a.id) ?? best.a;
        const creative = await makeCreative(cx.b, { layout, photoId, width: img.width, height: img.height });
        const localId = uid("ad_");
        const res = await client.addAd(camp.externalId!, group.externalId!, await adSpecFor(cx, camp, group, acc.platform, { title: control.title, title2: control.title2, text: control.text, imageId: creative.id }, localId), { channel: camp.channel as Channel, orgId: cx.b.orgId });
        const experimentId = uid("x_");
        const ad: Ad = {
          id: localId, businessId: cx.b.id, campaignId: camp.id, adGroupId: group.id, externalId: res.adExt, angle: control.angle,
          title: control.title, title2: control.title2, text: control.text, imageId: creative.id, status: "moderation", statusNote: null,
          experimentId, parentAdId: control.id, createdAt: new Date(),
        };
        await db.insert(schema.ads).values(ad);
        cx.ads.push(ad);
        cx.images.set(creative.id, { layout, photoId, width: img.width, height: img.height });
        cx.newAds++;
        const ex: Experiment = { id: experimentId, businessId: cx.b.id, campaignId: camp.id, kind: "creative", hypothesis, controlId: control.id, variantId: ad.id, status: "running", result: null, startedAt: cx.now, finishedAt: null };
        await db.insert(schema.experiments).values(ex);
        await db.update(schema.ads).set({ experimentId }).where(eq(schema.ads.id, control.id));
        control.experimentId = experimentId;
        cx.experiments.push(ex);
        await logChange({
          businessId: cx.b.id, actor: "robot", kind: "test_start",
          title: freshPhoto ? `Добавили объявление с вашим фото в аудиторию «${g.name}»` : `Тестируем другую картинку для ${adLabel(control)}`,
          reason: freshPhoto
            ? `Вы загрузили свои фото. В аудитории «${g.name}» добавили объявление с тем же текстом, но с вашим фото, и проверяем, ${hypothesis}. Оба объявления идут наравне, робот оставит то, что приводит больше людей.`
            : `Текст этого объявления работает лучше всех в аудитории «${g.name}». Теперь проверяем, ${hypothesis}. Меняем только картинку — так будет понятно, что именно сработало.`,
          details: { experimentId, controlId: control.id, variantId: ad.id, layout, photoId: freshPhoto },
          undo: [{ op: "adStatus", adId: ad.id, status: "paused" }],
        });
        cx.log.push(freshPhoto ? `Фото владельца в ${group.id}` : `Тест картинки ${layout} в ${group.id}`);
      } catch (e) {
        cx.log.push(`Тест картинки: ${errorText(e)}`);
      }
      break; // одна новая картинка на канал за проход
    }
  }
}

// ─── 4. Аудитории: сравнение групп ─────────────────────────────────────

async function optimizeAudiences(cx: Ctx) {
  const since = isoDay(addDays(cx.now, -WINDOW_DAYS));
  // Сравниваем аудитории только там, где группы — это разные аудитории (картинки в РСЯ и VK).
  // В поиске группы — это разные услуги: их не отключаем из-за цены обращения, владелец продаёт всё.
  for (const camp of cx.campaigns.filter((c) => c.status === "active" && c.channel !== "search")) {
    const groups = cx.groups.filter((g) => g.campaignId === camp.id && g.status === "active");
    if (groups.length < 2) continue;
    const rows = groups.map((g) => {
      const s = cx.ads.filter((a) => a.adGroupId === g.id).reduce((acc, a) => add(acc, sumAd(cx, a.id, since)), zero());
      return { g, s, cpa: s.conversions ? s.cost / s.conversions : Infinity };
    });
    const withConv = rows.filter((r) => r.s.conversions >= 3);
    if (!withConv.length) continue;
    const best = withConv.sort((a, b) => a.cpa - b.cpa)[0];
    for (const r of rows) {
      if (r.g.id === best.g.id || cx.protected.has(r.g.id)) continue;
      // В аудитории есть объявление, которое владелец недавно включал или правил, — не выключаем его вместе с группой
      if (cx.ads.some((a) => a.adGroupId === r.g.id && cx.protected.has(a.id))) continue;
      const enoughSpend = r.s.cost >= best.cpa * 3;
      const worse = r.cpa >= best.cpa * 2;
      if (!enoughSpend || !worse) continue;
      // Проверяем, что разница в конверсии кликов не случайна
      const p = probBetter(best.s.conversions, best.s.clicks, r.s.conversions, r.s.clicks);
      if (p < 0.85 && r.s.conversions > 0) continue;
      const adIds = cx.ads.filter((a) => a.adGroupId === r.g.id && a.status === "active").map((a) => a.id);
      const cpaText = r.s.conversions ? `обращение обходится в ${rub(r.cpa)}` : `за ${rub(r.s.cost)} не было ни одного обращения`;
      await act(
        { businessId: cx.b.id, actor: "robot", kind: "pause", title: `Отключили аудиторию «${r.g.name}»`, reason: `В канале «${CHANNEL_NAME[camp.channel]}» сравнивали аудитории. У «${r.g.name}» ${cpaText}, у «${best.g.name}» — ${rub(best.cpa)}. Весь бюджет канала теперь идёт на лучшую аудиторию.`, details: { groupId: r.g.id, stats: r.s, best: best.s } },
        [{ op: "groupStatus", groupId: r.g.id, status: "paused", adIds }],
      );
      r.g.status = "paused";
      cx.log.push(`Аудитория ${r.g.id} отключена`);
    }
  }
}

// ─── 4б. Поиск: слои семантики (проблемы, смежные запросы, аудитории) против услуг ─────────
// Правило и тексты — engine/layers.ts (decideLayers). Здесь — данные, обучение кампании и защита решений владельца.

async function evaluateLayers(cx: Ctx) {
  if (!(await jobDue(cx, "layers", 24 * 3.5))) return;
  const since = isoDay(addDays(cx.now, -LAYER_RULE.days));
  const layerOf = (g: AdGroup) => (((g.targeting ?? {}) as { layer?: Layer }).layer ?? "service") as Layer;
  let did = false;
  const list = cx.campaigns.filter((c) => c.status === "active" && c.channel === "search" && !cx.protected.has(c.id) && cx.groups.some((g) => g.campaignId === c.id && layerOf(g) !== "service"));
  for (const camp of skipLearning(cx, list, "слои запросов")) {
    const groups = cx.groups.filter((g) => g.campaignId === camp.id && g.status === "active");
    const rows: LayerRow[] = groups.map((g) => {
      const s = cx.ads.filter((a) => a.adGroupId === g.id).reduce((acc, a) => add(acc, sumAd(cx, a.id, since)), zero());
      // Владелец недавно менял группу или её объявление — не спорим с ним
      const prot = cx.protected.has(g.id) || cx.ads.some((a) => a.adGroupId === g.id && cx.protected.has(a.id));
      return { id: g.id, layer: layerOf(g), cost: s.cost, clicks: s.clicks, conversions: s.conversions, protected: prot, keyword: displayKeyword(g.keywords?.[0] ?? g.name) };
    });
    const verdicts = decideLayers(rows);
    if (!verdicts) {
      const conv = rows.filter((r) => r.layer === "service").reduce((n, r) => n + r.conversions, 0);
      cx.log.push(`Слои поиска: у групп услуг ${pl(conv, "обращение", "обращения", "обращений")} — ждём ${LAYER_RULE.baseConversions}, чтобы сравнивать`);
      continue;
    }
    for (const v of verdicts) {
      await act(
        { businessId: cx.b.id, actor: "robot", kind: "pause", title: v.title, reason: `${v.reason} ${LEARNED_NOTE}`, details: { layer: v.layer, groupIds: v.off, cost: v.cost, conversions: v.conversions, cpl: v.cpl, baseCpl: v.baseCpl } },
        v.off.map((id) => ({ op: "groupStatus" as const, groupId: id, status: "paused" as const, adIds: cx.ads.filter((a) => a.adGroupId === id && a.status === "active").map((a) => a.id) })),
      );
      for (const g of groups) if (v.off.includes(g.id)) g.status = "paused";
      cx.log.push(`Слой ${v.layer} отключён: ${v.off.length} групп`);
      did = true;
    }
  }
  await markJob(cx, "layers", did ? "отключено" : "без изменений");
}

// ─── 5. Минус-слова из поисковых запросов ──────────────────────────────

async function addNegatives(cx: Ctx) {
  if (!(await jobDue(cx, "negatives", 70))) return;
  const db = await getDb();
  for (const camp of cx.campaigns.filter((c) => c.status === "active" && c.channel === "search" && c.externalId && !cx.protected.has(c.id))) {
    try {
      const [acc] = await db.select().from(schema.adAccounts).where(eq(schema.adAccounts.id, camp.accountId));
      const client = await clientFor(acc);
      if (!client.getSearchQueries) continue;
      const goalIds = cx.b.goalIds?.lead ? [cx.b.goalIds.lead] : [];
      const rows = await client.getSearchQueries([camp.externalId!], isoDay(addDays(cx.now, -14)), isoDay(cx.now), goalIds);
      const wasteful = rows.filter((r) => r.clicks > 0).sort((a, b) => b.cost - a.cost);
      const found = await pickNegativeWords(cx.b, wasteful.map((r) => r.query), camp.negativeKeywords ?? []);
      // Минус-слово, которое заблокировало бы нашу же ключевую фразу, не добавляем
      const own = cx.groups.filter((g) => g.campaignId === camp.id).flatMap((g) => g.keywords ?? []);
      const words = found.map((f) => f.word).filter((w) => !own.some((k) => conflicts(w, k))).slice(0, 25);
      if (words.length) {
        const waste = wasteful.filter((r) => words.some((w) => r.query.toLowerCase().includes(w))).reduce((s, r) => s + r.cost, 0);
        await act(
          { businessId: cx.b.id, actor: "robot", kind: "negatives", title: `Убрали показы по ${pl(words.length, "нецелевому запросу", "нецелевым запросам", "нецелевым запросам")}`, reason: `Посмотрели, что люди искали перед кликом. Часть запросов — не про ваших клиентов: например, «${found[0].example}»${found[1] ? `, «${found[1].example}»` : ""}. ${waste > 0 ? `За 2 недели на такие клики ушло ${rub(waste)}. ` : ""}Добавили минус-слова: ${words.join(", ")}.`, details: { words, examples: found.slice(0, 10) } },
          [{ op: "addNegatives", campaignId: camp.id, words }],
        );
        camp.negativeKeywords = [...new Set([...(camp.negativeKeywords ?? []), ...words])];
        cx.log.push(`Минус-слова: ${words.length}`);
      }
      // По данным: запросы с кликами и расходом, без обращений, а по Метрике — почти одни отказы
      await dataNegatives(cx, camp, rows, own);
    } catch (e) {
      cx.log.push(`Минус-слова: ${errorText(e)}`);
    }
  }
  await markJob(cx, "negatives", "ok");
}

/** Слова запроса, которые не отличают целевой запрос от нецелевого: их не минусуем */
const NEUTRAL_WORDS = new Set([
  "рядом", "недорого", "дешево", "дешевле", "цена", "цены", "стоимость", "прайс", "запись", "записаться", "онлайн", "метро", "район", "улица",
  "отзывы", "лучший", "лучшие", "хороший", "салон", "студия", "мастер", "сколько", "стоит", "где", "круглосуточно", "срочно", "сегодня",
  "для", "без", "при", "про", "над", "под", "или", "как", "что", "это", "вечером", "утром", "выходные",
]);
const queryWords = (q: string) => q.toLowerCase().replace(/ё/g, "е").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !/^\d+$/.test(w));

/**
 * Минус-слова по данным: запросы, по которым за 2 недели были клики и расход, но ни одного обращения, а по Метрике
 * почти все визиты — отказы. Минусуем одно слово, которое отличает такой запрос: не слово наших ключевых фраз, не город
 * и район, не «цена/рядом/запись» и не слово из запросов, по которым люди обращаются или смотрят сайт.
 */
async function dataNegatives(cx: Ctx, camp: Campaign, rows: QueryRow[], own: string[]) {
  if (!cx.metrica.any || !rows.length) return;
  const sq = (r: QueryRow) => cx.metrica.slices.get(`${camp.id}|query|${sliceKey("query", r.query)}`);
  const ownStems = new Set(own.flatMap((k) => queryWords(phraseKeyOf(k))).map(stem));
  const geo = geoTerms(cx.b);
  const geoStems = new Set([...geo.city, ...geo.local].flatMap(queryWords).map(stem));
  const negStems = new Set((camp.negativeKeywords ?? []).flatMap(queryWords).map(stem));
  // Слова «хороших» запросов: были обращения или люди смотрели сайт — их не трогаем ни в каком виде
  const goodStems = new Set(
    rows
      .filter((r) => (r.conversions ?? 0) > 0 || (sq(r)?.leads ?? 0) > 0 || ((sq(r)?.visits ?? 0) >= QUERY_RULE.minVisits && 1 - bounceRate(sq(r)!) >= 0.5))
      .flatMap((r) => queryWords(r.query))
      .map(stem),
  );
  const byWord = new Map<string, { clicks: number; cost: number; q: QStat; examples: string[] }>();
  for (const r of rows) {
    if (r.clicks < QUERY_RULE.minClicks || r.cost < QUERY_RULE.minCost || (r.conversions ?? 0) > 0) continue;
    // Запрос уже отсечён минус-словом (в том числе добавленным только что по правилам)
    if (queryWords(r.query).some((w) => negStems.has(stem(w)))) continue;
    const q = sq(r);
    if (!q || q.visits < QUERY_RULE.minVisits || q.leads > 0 || qualityOf(q) / q.visits > QUERY_RULE.maxQuality) continue;
    const cand = queryWords(r.query)
      .filter((w) => !NEUTRAL_WORDS.has(w))
      .filter((w) => { const st = stem(w); return !ownStems.has(st) && !geoStems.has(st) && !negStems.has(st) && !goodStems.has(st); })
      .filter((w) => !own.some((k) => conflicts(w, k)))
      .sort((a, b) => b.length - a.length);
    const w = cand[0];
    if (!w) continue;
    const cur = byWord.get(w) ?? { clicks: 0, cost: 0, q: zeroQ(), examples: [] };
    cur.clicks += r.clicks;
    cur.cost += r.cost;
    cur.q = addQ(cur.q, q);
    if (cur.examples.length < 2) cur.examples.push(r.query);
    byWord.set(w, cur);
  }
  const top = [...byWord.entries()].sort((a, b) => b[1].cost - a[1].cost).slice(0, QUERY_RULE.perRun);
  if (!top.length) return;
  const words = top.map(([w]) => w);
  const lines = top.slice(0, 5).map(([, x]) => `«${x.examples[0]}» — ${pl(x.clicks, "клик", "клика", "кликов")}, ${rub(x.cost)}, отказов ${pct(bounceRate(x.q), 0)}`).join("; ");
  const waste = top.reduce((sum, [, x]) => sum + x.cost, 0);
  await act(
    {
      businessId: cx.b.id, actor: "robot", kind: "negatives",
      title: `Минус-слова по данным Метрики: ${pl(words.length, "запрос", "запроса", "запросов")} без обращений`,
      reason: `За 2 недели по этим запросам были клики, но ни одного обращения, а Метрика показывает, что почти все пришедшие сразу уходили со страницы: ${lines}. Всего на них ушло ${rub(waste)}. Добавили минус-слова: ${words.join(", ")}. Слова из запросов, по которым люди обращаются или смотрят сайт, не тронуты.`,
      details: { words, source: "metrica", examples: top.map(([w, x]) => ({ word: w, queries: x.examples, clicks: x.clicks, cost: Math.round(x.cost), visits: x.q.visits, bounces: x.q.bounces })) },
    },
    [{ op: "addNegatives", campaignId: camp.id, words }],
  );
  camp.negativeKeywords = [...new Set([...(camp.negativeKeywords ?? []), ...words])];
  cx.log.push(`Минус-слова по Метрике: ${words.length}`);
}

// ─── 5б. Поиск: слабые ключевые фразы по качеству визитов ──────────────
// Обращений по фразе мало, чтобы судить, — смотрим, приходят ли по ней люди, которым интересна страница.
// Робот фразы не удаляет: отмечает слабую в истории с цифрами, решение — за владельцем.

async function flagWeakPhrases(cx: Ctx) {
  if (!cx.metrica.any || !(await jobDue(cx, "phrases", 70))) return;
  const since = isoDay(addDays(cx.now, -30));
  let flagged = 0;
  // Одну и ту же фразу отмечаем не чаще раза в 60 дней (история робота в cx.history короче)
  const db = await getDb();
  const prevFlags = await db.select({ at: schema.changes.at, details: schema.changes.details }).from(schema.changes).where(and(eq(schema.changes.businessId, cx.b.id), eq(schema.changes.kind, "keywords"), gte(schema.changes.at, addDays(cx.now, -60))));
  for (const camp of cx.campaigns.filter((c) => c.status === "active" && c.channel === "search" && !cx.protected.has(c.id))) {
    const rows = (cx.metrica.phrases.get(camp.id) ?? []).filter((r) => r.day >= since);
    // Без цели «обращение» в Метрике не знаем, были ли обращения по фразе, — не судим
    if (!rows.some((r) => r.leadGoal)) continue;
    const own = new Map<string, { g: AdGroup; kw: string }>();
    for (const g of cx.groups.filter((x) => x.campaignId === camp.id && x.status === "active")) for (const k of g.keywords ?? []) own.set(phraseKey(k), { g, kw: phraseKeyOf(k) });
    const by = new Map<string, QStat>();
    for (const r of rows) by.set(r.phrase, addQ(by.get(r.phrase) ?? zeroQ(), r.q));
    const total = [...by.values()].reduce(addQ, zeroQ());
    for (const [phrase, q] of by) {
      if (q.visits < PROXY.phraseMinVisits || q.leads > 0) continue;
      const m = own.get(phraseKey(phrase));
      if (!m || cx.protected.has(m.g.id)) continue;
      const rest = { visits: total.visits - q.visits, bounces: total.bounces - q.bounces, leads: total.leads - q.leads };
      if (rest.visits < PROXY.phraseMinVisits) continue;
      const rateP = qualityOf(q) / q.visits, rateR = qualityOf(rest) / rest.visits;
      if (rateR < rateP * PROXY.phraseRatio) continue;
      const p = probBetter(qualityOf(rest), rest.visits, qualityOf(q), q.visits);
      if (p < PROXY.phraseConfidence) continue;
      const seen = prevFlags.some((h) => (h.details as { campaignId?: string })?.campaignId === camp.id && (h.details as { phrase?: string })?.phrase === m.kw);
      if (seen) continue;
      await logChange({
        businessId: cx.b.id, actor: "robot", kind: "keywords",
        title: `Слабая ключевая фраза «${m.kw}»`,
        reason: `За 30 дней по фразе «${m.kw}» (группа «${m.g.name}») пришло ${pl(q.visits, "визит", "визита", "визитов")} и ни одного обращения, а качественных визитов — только ${pct(rateP, 0)}: остальные люди уходили со страницы почти сразу. По другим фразам кампании качественных визитов ${pct(rateR, 0)}${rest.leads ? `, и по ним были обращения (${num(rest.leads)})` : ""}. Разница не случайна (уверенность ${Math.min(99, Math.round(p * 100))}%). Похоже, по этой фразе приходят не те люди. Робот фразу не убирал — её можно уточнить или удалить в кабинете Директа. Если обращения по ней появятся, робот перестанет её отмечать.`,
        details: { campaignId: camp.id, groupId: m.g.id, phrase: m.kw, quality: q, rest, p },
      });
      flagged++;
      cx.log.push(`Слабая фраза: ${m.kw}`);
    }
  }
  await markJob(cx, "phrases", flagged ? `отмечено ${flagged}` : "без изменений");
}

// ─── 5в. РСЯ: запрещаем площадки с кликами без качества ───────────────

/** Сервисы Яндекса не запрещаем: Директ их не принимает в ExcludedSites или это поиск и Карты */
const YANDEX_OWN = /(^|\.)(yandex\.[a-z]+|ya\.ru|dzen\.ru|kinopoisk\.ru|auto\.ru|avia\.yandex)$/i;

async function excludePlacements(cx: Ctx) {
  if (!(await jobDue(cx, "placements", 70))) return;
  const from = isoDay(addDays(cx.now, -(SITE_RULE.days - 1))), to = isoDay(cx.now);
  let did = 0;
  for (const camp of cx.campaigns.filter((c) => c.status === "active" && c.channel === "network" && c.externalId && !cx.protected.has(c.id))) {
    try {
      const { client } = await clientOf(camp);
      if (!client.getPlacements || !client.setExcludedSites) continue;
      const rows = await client.getPlacements([camp.externalId!], from, to, cx.b.goalIds?.lead ? [cx.b.goalIds.lead] : []);
      const bySite = new Map<string, { site: string; clicks: number; cost: number; conversions: number }>();
      for (const r of rows) {
        const site = sliceKey("site", r.placement);
        const cur = bySite.get(site) ?? { site, clicks: 0, cost: 0, conversions: 0 };
        cur.clicks += r.clicks;
        cur.cost += r.cost;
        cur.conversions += r.conversions;
        bySite.set(site, cur);
      }
      const all = [...bySite.values()];
      const tot = all.reduce((a, x) => ({ clicks: a.clicks + x.clicks, conversions: a.conversions + x.conversions }), { clicks: 0, conversions: 0 });
      const cr = tot.clicks ? tot.conversions / tot.clicks : 0;
      const current = client.getExcludedSites ? await client.getExcludedSites(camp.externalId!) : (((camp.meta as { excludedSites?: string[] }).excludedSites) ?? []);
      const already = new Set(current.map((x) => x.toLowerCase()));
      const cands = all
        .filter((x) => !already.has(x.site) && !YANDEX_OWN.test(x.site) && x.clicks >= SITE_RULE.minClicks && x.conversions === 0)
        .map((x) => ({ ...x, q: cx.metrica.slices.get(`${camp.id}|site|${x.site}`) ?? null }))
        .filter((x) => (x.q?.leads ?? 0) === 0)
        .filter((x) =>
          x.q && x.q.visits >= SITE_RULE.minVisits
            ? bounceRate(x.q) >= SITE_RULE.bounce
            // Без Метрики по площадке — только при большом объёме: столько кликов, что при обычной конверсии кампании было бы ≥ 3 обращений
            : x.clicks >= SITE_RULE.noMetricaClicks && cr * x.clicks >= 3,
        )
        .sort((a, b) => b.cost - a.cost);
      const room = MAX_EXCLUDED_SITES - current.length;
      if (cands.length && room <= 0) {
        cx.log.push(`Площадки РСЯ: в «${camp.name}» уже ${MAX_EXCLUDED_SITES} запрещённых — больше Директ не принимает`);
        continue;
      }
      const take = cands.slice(0, Math.min(room, SITE_RULE.perRun));
      if (!take.length) continue;
      const line = (x: (typeof take)[number]) => `${x.site} — ${pl(x.clicks, "клик", "клика", "кликов")}, ${rub(x.cost)}${x.q && x.q.visits ? `, отказов ${pct(bounceRate(x.q), 0)}` : ""}`;
      const waste = take.reduce((a, x) => a + x.cost, 0);
      const withQ = take.filter((x) => x.q && x.q.visits >= SITE_RULE.minVisits).length;
      await act(
        {
          businessId: cx.b.id, actor: "robot", kind: "placements",
          title: `Запретили показы на ${pl(take.length, "площадке", "площадках", "площадках")} РСЯ`,
          reason: `За ${pl(SITE_RULE.days, "день", "дня", "дней")} эти сайты и приложения дали много кликов, но ни одного обращения${withQ ? ", а по Метрике почти все визиты с них — отказы: человек закрывает страницу в первые секунды (так бывает со случайными кликами в играх и приложениях)" : ` — при обычной для кампании доле обращений их было бы хотя бы 3`}: ${take.slice(0, 6).map(line).join("; ")}${take.length > 6 ? ` и ещё ${take.length - 6}` : ""}. Всего на них ушло ${rub(waste)}. Запретили показы на этих площадках — деньги пойдут туда, откуда приходят живые люди.`,
          details: { campaignId: camp.id, sites: take.map((x) => ({ site: x.site, clicks: x.clicks, cost: Math.round(x.cost), visits: x.q?.visits ?? null, bounces: x.q?.bounces ?? null })) },
        },
        [{ op: "excludeSites", campaignId: camp.id, sites: take.map((x) => x.site) }],
      );
      did += take.length;
      cx.log.push(`Площадки РСЯ: запрещено ${take.length}`);
    } catch (e) {
      cx.log.push(`Площадки РСЯ: ${errorText(e)}`);
    }
  }
  await markJob(cx, "placements", did ? `запрещено ${did}` : "без изменений");
}

// ─── 6. Стратегия: клики → заявки ──────────────────────────────────────

async function switchStrategy(cx: Ctx) {
  if (!cx.b.goalIds?.lead) return;
  const since = isoDay(addDays(cx.now, -7));
  const list = cx.campaigns.filter((c) => c.status === "active" && c.platform === "yandex" && c.strategy === "clicks" && !cx.protected.has(c.id));
  for (const camp of skipLearning(cx, list, "стратегию")) {
    const s = cx.ads.filter((a) => a.campaignId === camp.id).reduce((acc, a) => add(acc, sumAd(cx, a.id, since)), zero());
    // Директу нужно ~10 конверсий в неделю, чтобы автостратегия по заявкам обучилась
    if (s.conversions < 10) continue;
    await act(
      { businessId: cx.b.id, actor: "robot", kind: "strategy", title: `Переключили «${CHANNEL_NAME[camp.channel]}» на оптимизацию заявок`, reason: `За неделю реклама принесла ${pl(s.conversions, "обращение", "обращения", "обращений")} — этого достаточно, чтобы Яндекс научился находить похожих людей. Раньше он искал тех, кто чаще кликает, теперь — тех, кто чаще записывается. Бюджет не меняется. Следующие 2 недели Яндекс будет переучиваться — в это время робот не трогает ставки и бюджет этого канала.` },
      [{ op: "campaignStrategy", campaignId: camp.id, strategy: "conversions" }],
    );
    cx.log.push(`Стратегия ${camp.id} → conversions`);
  }
}

// ─── 7. Перераспределение бюджета между каналами ──────────────────────

async function rebalance(cx: Ctx) {
  if (!(await jobDue(cx, "rebalance", 24 * 6.5))) return;
  const since = isoDay(addDays(cx.now, -WINDOW_DAYS));
  // Ретаргетинг в переносах не участвует: его аудитория маленькая, и больше денег он не потратит с пользой
  const active = skipLearning(cx, cx.campaigns.filter((c) => c.status === "active" && !cx.protected.has(c.id) && !isRetarget(c.channel)), "бюджет");
  if (active.length < 2) return;
  const rows = active.map((c) => {
    const s = cx.ads.filter((a) => a.campaignId === c.id).reduce((acc, a) => add(acc, sumAd(cx, a.id, since)), zero());
    return { c, s };
  });
  if (rows.some((r) => r.s.cost < r.c.weeklyBudget * 0.5)) return; // мало данных — ждём
  const totalConv = rows.reduce((x, r) => x + r.s.conversions, 0);
  const byConv = totalConv >= 6;
  const eff = (r: (typeof rows)[number]) => (byConv ? r.s.conversions : r.s.clicks) / Math.max(r.s.cost, 1);
  const sorted = [...rows].sort((a, b) => eff(b) - eff(a));
  const best = sorted[0], worst = sorted[sorted.length - 1];
  if (eff(best) < eff(worst) * 1.3) {
    await markJob(cx, "rebalance", "равно");
    return;
  }
  const minW = MIN_WEEKLY[worst.c.channel as Channel];
  // Ни текущий, ни «обычный» лимит (к нему робот вернёт канал 1-го числа) не опускаем ниже минимума площадки
  const move = Math.min(Math.floor(worst.c.weeklyBudget * 0.25), worst.c.weeklyBudget - minW, restoreTarget(worst.c) - minW);
  if (move < 100) {
    await markJob(cx, "rebalance", "минимум");
    return;
  }
  const unit = byConv ? "обращение" : "переход";
  const cost = (r: (typeof rows)[number]) => r.s.cost / Math.max(byConv ? r.s.conversions : r.s.clicks, 1);
  await act(
    { businessId: cx.b.id, actor: "robot", kind: "budget", title: `Перенесли ${rub(move)} в неделю: ${CHANNEL_NAME[worst.c.channel]} → ${CHANNEL_NAME[best.c.channel]}`, reason: `За 2 недели ${unit} в канале «${CHANNEL_NAME[best.c.channel]}» стоит ${rub(cost(best))}, а в «${CHANNEL_NAME[worst.c.channel]}» — ${rub(cost(worst))}. Переносим четверть бюджета туда, где клиенты дешевле. Общий бюджет не меняется. ${LEARNED_NOTE}`, details: { from: worst.c.id, to: best.c.id, move } },
    [
      { op: "campaignBudget", campaignId: worst.c.id, weeklyBudget: worst.c.weeklyBudget - move },
      { op: "campaignBudget", campaignId: best.c.id, weeklyBudget: best.c.weeklyBudget + move },
    ],
  );
  // Перенос сдвигает и «обычный» лимит, к которому защита бюджета вернёт кампанию в новом месяце
  for (const [c, delta] of [[worst.c, -move], [best.c, move]] as const) {
    const m = c.meta as BudgetMeta;
    const cut = typeof m.guardCutFrom === "number" && m.guardCutTo === c.weeklyBudget;
    await syncCampaign(c, { weeklyBudget: c.weeklyBudget + delta }, cut ? { guardCutFrom: Math.max(1, m.guardCutFrom! + delta), guardCutTo: c.weeklyBudget + delta } : undefined);
  }
  await markJob(cx, "rebalance", "перенесено");
  cx.log.push(`Бюджет: ${move} ₽ → ${best.c.channel}`);
}

// ─── 8. Место в выдаче и цена клика ────────────────────────────────────

type Tier = { trafficVolume: number; bid: number; price: number };
/** Средняя по группам цена каждого места в выдаче */
function auctionTiers(camp: Campaign): Tier[] {
  const groups = ((camp.meta as any)?.auction?.groups ?? []) as { tiers: Tier[] }[];
  const acc = new Map<number, { bid: number; price: number; n: number }>();
  for (const g of groups) for (const t of g.tiers) {
    const cur = acc.get(t.trafficVolume) ?? { bid: 0, price: 0, n: 0 };
    cur.bid += t.bid; cur.price += t.price; cur.n++;
    acc.set(t.trafficVolume, cur);
  }
  return [...acc.entries()].map(([trafficVolume, v]) => ({ trafficVolume, bid: v.bid / v.n, price: v.price / v.n })).sort((a, b) => b.trafficVolume - a.trafficVolume);
}

async function positionGuard(cx: Ctx) {
  if (!(await jobDue(cx, "positions", 24 * 6.5))) return;
  const since7 = isoDay(addDays(cx.now, -7));
  const since14 = isoDay(addDays(cx.now, -WINDOW_DAYS));
  const sumCamp = (id: string, since: string) => cx.ads.filter((a) => a.campaignId === id).reduce((acc, a) => add(acc, sumAd(cx, a.id, since)), zero());
  const others = cx.campaigns.filter((c) => c.channel !== "search" && c.status === "active").reduce((acc, c) => add(acc, sumCamp(c.id, since14)), zero());
  const othersCpl = others.conversions >= 3 ? others.cost / others.conversions : null;
  let did = false;
  for (const camp of skipLearning(cx, cx.campaigns.filter((c) => c.channel === "search" && c.status === "active" && c.externalId && !cx.protected.has(c.id)), "цену клика")) {
    const rows = cx.tvRows.filter((r) => r.campaignId === camp.id && r.day >= since7);
    const impr = rows.reduce((x, r) => x + r.impressions, 0);
    if (impr < 300) continue;
    const tv = rows.reduce((x, r) => x + r.tvWeighted, 0) / impr;
    const tiers = auctionTiers(camp);
    if (!tiers.length) continue;
    const w7 = sumCamp(camp.id, since7);
    const w14 = sumCamp(camp.id, since14);
    const cpc = w7.clicks ? w7.cost / w7.clicks : 0;
    const cpl = w14.conversions >= 3 ? w14.cost / w14.conversions : null;
    const ceiling = ceilingOf(camp);
    const third = tiers.find((t) => t.trafficVolume <= 80 && t.trafficVolume >= 65) ?? tiers[Math.min(2, tiers.length - 1)];
    const top = tiers[0];

    // А. Стоим наверху, а обращения дороже, чем в других каналах → платим за место, а не за клиентов
    if (tv >= 80 && cpl && othersCpl && cpl > othersCpl * 1.25 && third.price < cpc * 0.8 && (!ceiling || ceiling > third.bid * 1.1)) {
      const value = Math.ceil(third.bid * 1.08);
      await act(
        {
          businessId: cx.b.id, actor: "robot", kind: "budget",
          title: `Ограничили цену клика на поиске: ${rub(value)}`,
          reason: `Объявления держались в среднем на месте «${placeName(tv)}», клик там стоил около ${rub(cpc)}, а обращение — ${rub(cpl)}. В других каналах обращение дешевле — ${rub(othersCpl)}. Третье место над результатами стоит около ${rub(third.price)} за клик: людей увидят чуть меньше, зато за тот же бюджет кликов будет больше. Ставку выше ${rub(value)} Директ теперь не поднимет. ${LEARNED_NOTE}`,
          details: { campaignId: camp.id, tv, cpc, cpl, othersCpl, tiers },
        },
        [{ op: "bidCeiling", campaignId: camp.id, value }],
      );
      cx.log.push(`Потолок ставки ${value} ₽ (было место ${Math.round(tv)})`);
      did = true;
      continue;
    }
    // Б. Потолок мешает: бюджет не тратится или уехали вниз → поднимаем на ступень или снимаем
    const spentShare = w7.cost / Math.max(camp.weeklyBudget, 1);
    if (ceiling && (spentShare < 0.8 || tv < 45)) {
      const higher = [...tiers].reverse().find((t) => t.bid > ceiling * 1.05 && t.trafficVolume > tv + 5);
      const value = higher && higher.trafficVolume < 95 ? Math.ceil(higher.bid * 1.05) : null;
      await act(
        {
          businessId: cx.b.id, actor: "robot", kind: "budget",
          title: value ? `Подняли предел цены клика на поиске до ${rub(value)}` : "Сняли ограничение цены клика на поиске",
          reason: `С пределом ${rub(ceiling)} объявления опустились до места «${placeName(tv)}»${spentShare < 0.8 ? `, и за неделю потрачено только ${Math.round(spentShare * 100)}% бюджета — людям просто не хватало показов` : ""}. ${value ? `Поднимаем предел до ${rub(value)} — это примерно место «${placeName(higher!.trafficVolume)}».` : "Убираем предел — Директ снова сам выберет ставку в рамках недельного бюджета."}`,
          details: { campaignId: camp.id, tv, spentShare, from: ceiling, to: value },
        },
        [{ op: "bidCeiling", campaignId: camp.id, value }],
      );
      cx.log.push(`Предел ставки ${ceiling} → ${value ?? "нет"}`);
      did = true;
      continue;
    }
    void top;
  }
  await markJob(cx, "positions", did ? "изменено" : "без изменений");
}

/**
 * safe — статистику какого-то кабинета не удалось обновить: защита бюджета только снижает лимиты и останавливает,
 * а шаги, которые включают кампании или перекладывают бюджет (ретаргетинг, бюджет каналов), пропускаем.
 */
export async function optimizeBusiness(b: Business, opts: { safe?: boolean } = {}) {
  const cx = await load(b);
  cx.safe = !!opts.safe;
  if (!cx.campaigns.length) return { log: ["Нет кампаний"], failed: [] as string[] };
  const steps: [string, (c: Ctx) => Promise<void>][] = [
    ["бюджет", budgetGuard],
    // После защиты бюджета: включаем ретаргетинг, только если он помещается в остаток месяца
    ["ретаргетинг", (c) => retargetStep({ b: c.b, now: c.now, campaigns: c.campaigns, log: c.log })],
    ["модерация", handleRejected],
    ["тесты", resolveExperiments],
    ["перенос идей", propagateWinners],
    ["место в выдаче", positionGuard],
    // Свои фото владельца — раньше новых текстов: иначе свободные группы займут тесты текстов, и фото будет ждать неделями
    ["фото владельца", (c) => creativeTests(c, true)],
    ["объявления", optimizeAds],
    ["картинки", creativeTests],
    ["аудитории", optimizeAudiences],
    ["слои поиска", evaluateLayers],
    ["минус-слова", addNegatives],
    ["ключевые фразы", flagWeakPhrases],
    ["площадки РСЯ", excludePlacements],
    ["стратегия", switchStrategy],
    ["бюджет каналов", rebalance],
  ];
  const UNSAFE = new Set(["ретаргетинг", "бюджет каналов"]);
  const failed: string[] = [];
  for (const [name, fn] of steps) {
    if (cx.safe && UNSAFE.has(name)) {
      cx.log.push(`Шаг «${name}» пропущен: статистика обновилась не по всем кабинетам`);
      continue;
    }
    try {
      await fn(cx);
    } catch (e) {
      failed.push(name);
      cx.log.push(`Шаг «${name}»: ${errorText(e)}`);
    }
  }
  return { log: cx.log, failed };
}

/**
 * Владелец поменял месячный бюджет (или отменил такую смену): пересчитываем лимиты всех каналов,
 * включаем каналы, которые робот останавливал из-за бюджета, если теперь хватает, и отключаем лишние, если нет.
 * Каналы, которые владелец остановил сам, не включаем.
 */
export async function applyMonthlyBudget(b: Business, monthly: number, opts: { actor?: "owner" | "robot"; revert?: { of: string; title: string } } = {}) {
  const camps = await liveCampaigns(b.id);
  const now = await businessNow(b.id, camps);
  const st = await budgetState(b.id, monthly, now, camps);
  const active = camps.filter((c) => c.status === "active");
  const resumable = camps.filter((c) => pausedForBudget(c) && c.externalId);
  // Ретаргетинг, который копит аудиторию, стоит не по решению владельца — в тексте про паузы его не упоминаем
  const ownerPaused = camps.filter((c) => c.status === "paused" && !pausedForBudget(c) && !waitingAudience(c));
  const pool = [...active, ...resumable];
  // «Обычные» лимиты меняем пропорционально бюджету — у всех каналов, включая стоящие из-за бюджета,
  // чтобы доли каналов сохранились, когда бюджет снова вырастет
  const restoreSum = pool.reduce((s, c) => s + restoreTarget(c), 0);
  const k = restoreSum ? weeklyFromMonthly(monthly) / restoreSum : 1;
  const normal = new Map(pool.map((c) => [c.id, Math.floor(restoreTarget(c) * k)]));
  const items = pool.map((c) => ({ id: c.id, channel: c.channel as Channel, want: normal.get(c.id)! }));
  // Раскладка, которая помещается в остаток этого месяца
  const plan = planLimits(items, Math.min(monthWeekly(monthly, now), spendableWeekly(st.remaining, st.daysLeft, st.model)), true);
  const keep = pool.filter((c) => !plan.dropped.includes(c.id));
  const stopAll = pool.length > 0 && (st.remaining <= 0 || st.remaining < reserveFor(sumWeekly(keep, plan), st.daysLeft, st.model));
  const toPause = stopAll ? active : active.filter((c) => plan.dropped.includes(c.id));
  const toResume = stopAll ? [] : resumable.filter((c) => keep.includes(c));
  const moves = keep.map((c) => ({ c, next: plan.weekly.get(c.id)! })).filter((m) => m.next !== m.c.weeklyBudget);

  const ops: UndoOp[] = [
    { op: "monthlyBudget", businessId: b.id, monthlyBudget: monthly },
    ...moves.map((m) => ({ op: "campaignBudget" as const, campaignId: m.c.id, weeklyBudget: m.next })),
    ...toPause.map((c) => ({ op: "campaignStatus" as const, campaignId: c.id, status: "paused" as const })),
    ...toResume.map((c) => ({ op: "campaignStatus" as const, campaignId: c.id, status: "active" as const })),
  ];

  const parts: string[] = [];
  const old = b.monthlyBudget;
  parts.push(opts.revert ? `Вернули бюджет ${rub(monthly)} в месяц.` : `Вы ${monthly > old ? "увеличили" : "уменьшили"} бюджет с ${rub(old)} до ${rub(monthly)} в месяц.`);
  if (moves.length) {
    parts.push(`Недельные лимиты пересчитали: ${moves.map((m) => `${CHANNEL_NAME[m.c.channel]} — ${rub(m.c.weeklyBudget)} → ${rub(m.next)}`).join("; ")} (всего ${rub(sumWeekly(keep, plan))} в неделю).`);
  } else if (pool.length) parts.push("Недельные лимиты менять не понадобилось.");
  const fullSum = keep.reduce((s, c) => s + Math.max(normal.get(c.id)!, MIN_WEEKLY[c.channel as Channel]), 0);
  if (!stopAll && keep.length && sumWeekly(keep, plan) < fullSum - 1) {
    parts.push(`В этом месяце уже потрачено ${rub(st.spent)}, поэтому до конца месяца лимиты чуть ниже обычных — так остатка точно хватит. С 1-го числа робот вернёт их к ${rub(fullSum)} в неделю.`);
  }
  if (toResume.length) parts.push(`Снова включили ${names(toResume)}: бюджета теперь хватает.`);
  if (stopAll && active.length) parts.push(`В этом месяце уже потрачено ${rub(st.spent)} — новый бюджет почти исчерпан, поэтому реклама стоит до 1-го числа и включится сама.`);
  else if (stopAll) parts.push(`В этом месяце уже потрачено ${rub(st.spent)} — реклама включится 1-го числа.`);
  else if (toPause.length) {
    parts.push(`${names(toPause)} поставили на паузу: площадка не принимает лимит меньше ${toPause.map((c) => rub(MIN_WEEKLY[c.channel as Channel])).join(" / ")} в неделю, и на все каналы бюджета не хватает. Включится сам, когда бюджета станет хватать.`);
  }
  const stillPaused = resumable.filter((c) => !toResume.includes(c));
  if (stillPaused.length && !stopAll) parts.push(`${names(stillPaused)} пока стоит: на этот канал бюджета не хватает.`);
  if (ownerPaused.length) parts.push(`${names(ownerPaused)} вы остановили сами — не включали.`);

  const id = await act(
    {
      businessId: b.id, actor: opts.actor ?? "owner",
      kind: opts.revert ? "revert" : "budget",
      title: opts.revert?.title ?? `Бюджет изменён: ${rub(old)} → ${rub(monthly)} в месяц`,
      reason: parts.join(" "),
      details: { spent: Math.round(st.spent), weekly: sumWeekly(keep, plan) },
      revertOf: opts.revert?.of ?? null,
    },
    ops,
  );
  // Паузы здесь — из-за бюджета, а не решение владельца: робот снимет их сам, когда деньги появятся
  for (const c of toPause) await patchBudgetMeta(c.id, { pausedByGuard: st.month, pausedBy: "robot" });
  for (const c of pool) {
    const next = plan.weekly.get(c.id) ?? c.weeklyBudget, n = normal.get(c.id)!;
    await patchBudgetMeta(c.id, next !== n ? { guardCutFrom: n, guardCutTo: next } : { guardCutFrom: null, guardCutTo: null });
  }
  return id;
}

/** Владелец попросил ещё вариант объявления — запускаем A/B-тест против текущего */
export async function ownerVariant(b: Business, adId: string) {
  const cx = await load(b);
  const ad = cx.ads.find((a) => a.id === adId);
  if (!ad) throw new Error("Объявление не найдено");
  if (cx.experiments.some((e) => e.status === "running" && (e.controlId === ad.id || e.variantId === ad.id))) {
    throw new Error("Для этого объявления уже идёт тест — дождитесь результата");
  }
  const v = await createVariant(cx, ad, "Владелец попросил попробовать другой подход", { experiment: true, owner: true });
  if (!v) throw new Error("Сейчас добавить вариант не получится: кампания ещё не создана на площадке или в группе нет места — все объявления участвуют в тестах. Попробуйте после окончания теста.");
  await logChange({
    businessId: b.id, actor: "owner", kind: "test_start",
    title: `Запустили A/B-тест для ${adLabel(ad)}`,
    reason: `Вы попросили новый вариант. Проверяем: ${v.draft.hypothesis.replace(/\.$/, "")}. Новое объявление «${v.ad.title}» будет показываться наравне со старым, робот сам выберет лучшее.`,
    details: { experimentId: v.experimentId, controlId: ad.id, variantId: v.ad.id },
    undo: [{ op: "adStatus", adId: v.ad.id, status: "paused" }],
  });
  return v.ad;
}


/**
 * Следующий кадр для A/B-теста картинки: фото, которого ещё нет в группе (своё или сгенерированное).
 * Свободных нет — генерируем новый кадр под услуги (не больше 8 сгенерированных на бизнес).
 */
const photoPick = new Map<string, string | null>();
async function nextPhoto(cx: Ctx, live: Ad[], current: string | null | undefined): Promise<string | null> {
  const k = `${cx.b.id}|${live.map((a) => a.id).join(",")}`;
  if (photoPick.has(k)) return photoPick.get(k)!;
  if (photoPick.size > 500) photoPick.clear();
  const inGroup = new Set(live.map((a) => cx.images.get(a.imageId!)?.photoId).filter(Boolean) as string[]);
  if (current) inGroup.add(current);
  const pool = await listPhotos(cx.b.id);
  let pick = pool.find((p) => !inGroup.has(p.id))?.id ?? null;
  if (!pick && pool.filter((p) => p.kind === "generated").length < 8) {
    try {
      const g = await generatePhotos(cx.b, [], 1);
      pick = g.ids[0] ?? null;
    } catch {
      pick = null;
    }
  }
  photoPick.set(k, pick);
  return pick;
}

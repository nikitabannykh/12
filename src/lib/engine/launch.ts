import "server-only";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { AdAccount, Business, Campaign, UndoOp } from "../db/schema";
import { allocate, MAX_MONTHLY } from "./budget";
import { generateCopyPlan, type CopyPlan } from "../ai/copy";
import { generatePhotos, listPhotos, makeCreative, getImage, ensureLogo, imageSet } from "./images";
import { adExtras, responsiveAssets, timeTargeting, withPlanCallouts } from "./extras";
import { availableLayouts, type Layout } from "../creative/render";
import type { Channel, CampaignSpec, PlatformClient } from "../platforms/types";
import { clientFor, CHANNEL_NAME } from "../platforms";
import { YandexDirect } from "../platforms/yandex";
import { VkAds } from "../platforms/vk";
import { ensureCounter, ensureGoals } from "../platforms/metrica";
import { decrypt } from "../crypto";
import { regionIdsFor } from "./regions";
import { act, logChange } from "./ops";
import { nicheById } from "../niches";
import { appUrl, errorText, pl, rub, uid } from "../util";

export type PlanAd = { id: string; angle: string; title: string; title2?: string | null; text: string; imageId?: string | null; layout?: Layout | null; enabled: boolean };
export type PlanGroup = { id: string; name: string; audience: string; keywords: string[]; autotargeting: boolean; ageFrom?: number; ageTo?: number; sex?: "female" | "male" | "any"; ads: PlanAd[] };
export type PlanChannel = { channel: Channel; accountId: string; platform: string; weekly: number; enabled: boolean; groups: PlanGroup[] };
export type LaunchPlan = {
  createdAt: string;
  stage: "copy" | "ready";
  channels: PlanChannel[];
  negatives: string[];
  callouts: string[];
  imageIdeas: string[];
  photoIds: string[];
  dropped: Channel[];
  warnings: string[];
  /** Ход запуска: запуск идёт по одному каналу за запрос и возобновляется после обрыва */
  launch?: LaunchProgress;
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
  if (!on.length) return plan;
  const { allocation, dropped } = allocate(monthly, on);
  for (const ch of plan.channels) {
    if (dropped.includes(ch.channel)) {
      ch.enabled = false;
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

export async function getBusinessForUser(userId: string, businessId?: string) {
  const db = await getDb();
  const rows = await db.select().from(schema.businesses).where(eq(schema.businesses.userId, userId));
  return (businessId ? rows.find((r) => r.id === businessId) : rows[0]) ?? null;
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
  return out;
}

export function landingUrl(b: Business) {
  return b.siteUrl || `${appUrl()}/p/${b.publicKey}`;
}

/** Каналы Директа: комбинаторные объявления, лимит 3 неархивных объявления в группе */
export const isDirectChannel = (channel: string) => channel === "search" || channel === "network";
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

/** Канал плана из сгенерированных текстов */
function channelFromCopy(b: Business, copy: CopyPlan, channel: Channel, acc: AdAccount, weekly: number): PlanChannel {
  const n = nicheById(b.niche);
  const groups = copy[channel].map((g) => ({
    id: uid("g_"),
    name: g.name,
    audience: g.audience,
    keywords: g.keywords,
    autotargeting: channel !== "vk",
    ageFrom: g.ageFrom ?? n.audience.ageFrom,
    ageTo: g.ageTo ?? n.audience.ageTo,
    sex: n.audience.sex,
    // Директ: в группе не больше 3 неархивных объявлений — больше в план не берём
    ads: g.ads.slice(0, isDirectChannel(channel) ? DIRECT_ADS_PER_GROUP : undefined).map((ad) => ({ id: uid("a_"), angle: ad.angle, title: ad.title, title2: ad.title2 ?? null, text: ad.text, enabled: true })),
  }));
  return { channel, accountId: acc.id, platform: acc.platform, weekly, enabled: true, groups };
}

/** Шаг 1: тексты, семантика, аудитории */
export async function prepareCopy(b: Business, accounts: AdAccount[]): Promise<LaunchPlan> {
  const available = channelsFor(accounts);
  if (!available.length) throw new Error("Подключите хотя бы один рекламный кабинет");
  const { allocation, dropped } = allocate(b.monthlyBudget, available.map((a) => a.channel));
  const want = { search: false, network: false, vk: false };
  for (const a of allocation) want[a.channel] = true;
  const copy: CopyPlan = await generateCopyPlan(b, want);

  const channels: PlanChannel[] = allocation.map((a) => channelFromCopy(b, copy, a.channel, available.find((x) => x.channel === a.channel)!.account, a.weekly));

  const warnings: string[] = [];
  for (const d of dropped) warnings.push(`На канал «${CHANNEL_NAME[d]}» не хватает бюджета — начнём без него. Увеличьте бюджет, чтобы добавить.`);

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
  };
}

/** Шаг 2: фото и рекламные картинки */
export async function prepareImages(b: Business, plan: LaunchPlan): Promise<LaunchPlan> {
  const own = await listPhotos(b.id);
  let photoIds = own.filter((p) => p.kind === "photo").map((p) => p.id);
  const generatedBefore = own.filter((p) => p.kind === "generated").map((p) => p.id);
  const warnings = [...plan.warnings];
  if (photoIds.length < 3) {
    if (generatedBefore.length) photoIds = [...photoIds, ...generatedBefore].slice(0, 4);
    else {
      const g = await generatePhotos(b, plan.imageIdeas, 3 - photoIds.length);
      photoIds = [...photoIds, ...g.ids];
      if (g.errors.length) warnings.push(`Часть картинок не сгенерировалась: ${g.errors[0]}`);
    }
  }
  const layouts = availableLayouts(b, photoIds.length > 0);
  const svc = b.services?.[0];
  let k = 0;
  const channels: PlanChannel[] = [];
  for (const ch of plan.channels) {
    if (ch.channel === "search") {
      // Поиск в ЕПК тоже показывает картинку рядом с текстом — делаем одну на услугу (16:9)
      const groups: PlanGroup[] = [];
      for (const g of ch.groups) {
        const service = b.services?.find((x) => x.name === g.name) ?? svc;
        let imageId: string | null = null;
        try {
          const layout: Layout = photoIds.length ? "tag" : layouts.includes("tag") ? "tag" : layouts[0] ?? "tag";
          const img = await makeCreative(b, { layout, photoId: photoIds.length ? photoIds[k++ % photoIds.length] : null, width: 1080, height: 607, headline: service?.name ?? g.name, price: service?.price });
          imageId = img.id;
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
        // Директ: чистое фото и фото с ценником; VK: все макеты по кругу — так тест покажет, что работает
        const pool: Layout[] = ch.channel === "network"
          ? photoIds.length ? (["photo", "tag"] as Layout[]) : layouts
          : layouts.filter((l) => l !== "photo");
        const layout = pool[(i + groups.length) % pool.length] ?? "tag";
        const photoId = photoIds.length ? photoIds[k++ % photoIds.length] : null;
        const wide = ch.channel === "network" && i % 2 === 1;
        try {
          const img = await makeCreative(b, { layout, photoId, width: 1080, height: wide ? 607 : 1080, headline: svc?.name, price: svc?.price });
          ads.push({ ...ad, imageId: img.id, layout });
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
    const done = new Set<string>();
    for (const g of ch.groups) {
      const service = ch.channel === "search" ? b.services?.find((x) => x.name === g.name) ?? svc : svc;
      for (const ad of g.ads) {
        if (!ad.imageId || done.has(ad.imageId)) continue;
        done.add(ad.imageId);
        await imageSet(b, ad.imageId, { headline: ch.channel === "search" ? service?.name ?? g.name : svc?.name, price: service?.price }).catch(() => []);
      }
    }
  }
  return { ...plan, channels, photoIds, stage: "ready", warnings };
}

export async function savePlan(businessId: string, plan: LaunchPlan) {
  const db = await getDb();
  await db.update(schema.businesses).set({ launchPlan: plan, updatedAt: new Date() }).where(eq(schema.businesses.id, businessId));
}

async function setupMetrica(b: Business, account: AdAccount, warnings: string[]) {
  const db = await getDb();
  if (b.counterId && b.goalIds?.lead) return { counterId: b.counterId, goalId: b.goalIds.lead };
  try {
    const token = decrypt(account.accessToken);
    const site = landingUrl(b);
    const counter = b.counterId ? { id: b.counterId } : await ensureCounter(token, { name: `${b.name} — Полный зал`, site });
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
  const db = await getDb();
  const href = landingUrl(b);
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
  const logo = ch.channel === "vk" ? await ensureLogo(b).catch(() => null) : null;
  const spec: CampaignSpec = {
    name: `${b.name} — ${CHANNEL_NAME[ch.channel]}`,
    channel: ch.channel,
    weeklyBudget: ch.weekly,
    strategy: "clicks",
    startDate: moscowDay(),
    counterId,
    goalId,
    negativeKeywords: ch.channel === "vk" ? [] : plan.negatives,
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
  }
  const svc0 = b.services?.[0];
  const toInput = (img: NonNullable<Awaited<ReturnType<typeof getImage>>>) => ({ imageId: img.id, data: img.data, mime: img.mime, width: img.width, height: img.height, cachedRef: img.platformRefs?.[account.platform] });
  for (const g of ch.groups) {
    const ads = [];
    // Директ: не больше 3 объявлений в группе (уже созданные в прошлых попытках тоже считаются)
    const already = Object.keys(build.groups[g.id]?.ads ?? {}).length;
    const pub = g.ads.filter(publishable);
    const allowed = direct ? pub.filter((a) => build.groups[g.id]?.ads[a.id]).length + Math.max(0, DIRECT_ADS_PER_GROUP - already) : Infinity;
    const list = direct ? [...pub.filter((a) => build.groups[g.id]?.ads[a.id]), ...pub.filter((a) => !build.groups[g.id]?.ads[a.id])].slice(0, allowed) : pub;
    if (direct && pub.length > list.length) warnings.push(`${CHANNEL_NAME[ch.channel]}: в группе «${g.name}» включено ${pub.length} объявлений, а Директ принимает не больше ${DIRECT_ADS_PER_GROUP} — отправили первые ${DIRECT_ADS_PER_GROUP}`);
    for (const ad of list) {
      if (build.failedAds.includes(ad.id)) continue;
      let image = null;
      let images: ReturnType<typeof toInput>[] = [];
      if (ad.imageId) {
        const img = imageCache.get(ad.imageId) ?? (await getImage(ad.imageId));
        imageCache.set(ad.imageId, img);
        if (img) image = toInput(img);
        if (img && direct) {
          const service = ch.channel === "search" ? b.services?.find((x) => x.name === g.name) ?? svc0 : svc0;
          const set = await imageSet(b, img.id, { headline: ch.channel === "search" ? service?.name ?? g.name : svc0?.name, price: service?.price }).catch(() => []);
          for (const x of set) imageCache.set(x.id, x);
          images = set.map(toInput);
        }
      }
      const assets = direct ? responsiveAssets(b, ad, { service: ch.channel === "search" ? g.name : null }) : null;
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
        extras: withPlanCallouts(adExtras(b, { channel: ch.channel, href, service: ch.channel === "search" ? g.name : null, text: ad.text }), plan.callouts),
        logo: ch.channel === "vk" && logo ? { imageId: logo.id, data: logo.data, mime: logo.mime, width: logo.width, height: logo.height, cachedRef: logo.platformRefs?.[account.platform] } : null,
        marking: `${n.label}: ${b.name}`,
      });
    }
    if (!ads.length && !build.groups[g.id]) continue;
    spec.groups.push({ localId: g.id, name: g.name, keywords: ch.channel === "vk" ? [] : g.keywords, autotargeting: g.autotargeting, regionIds, ageFrom: g.ageFrom, ageTo: g.ageTo, sex: g.sex, ads });
  }
  if (!spec.groups.length) {
    warnings.push(`${CHANNEL_NAME[ch.channel]}: нет ни одного объявления с заголовком и текстом — канал пропущен`);
    if (mine) await cleanupCreating([mine], client, warnings);
    return { state: "skipped" };
  }

  // Имя на площадке — с меткой запуска: по нему находим свою кампанию, если ID сохранить не успели
  const extName = account.platform === "vk" ? VkAds.planName(spec) : spec.tag ? `${spec.name} #${spec.tag}` : spec.name;
  const campaignId = mine?.id ?? uid("c_");
  const baseMeta = { ...(mine ? metaOf(mine) : {}), regionIds, launchId, extName, startedAt: (mine ? metaOf(mine).startedAt : null) ?? new Date().toISOString() };
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
      targeting: { regionIds, ageFrom: g.ageFrom, ageTo: g.ageTo, sex: g.sex, autotargeting: g.autotargeting },
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
 * rebudgetLive — заодно пересчитать лимиты уже работающих кампаний (добавление канала к работающей рекламе).
 * Возвращает включённые кампании и признак, что что-то не включилось и стоит повторить.
 */
async function activateLaunch(b: Business, launchId: string, warnings: string[], opts: { rebudgetLive?: boolean; failures?: Record<string, number> } = {}) {
  const db = await getDb();
  const all = await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, b.id), inArray(schema.campaigns.status, ["ready", "active", "paused"])));
  const ready = all.filter((c) => c.status === "ready" && metaOf(c).launchId === launchId);
  const live = all.filter((c) => c.status !== "ready");
  const channels = [...new Set([...ready, ...live].map((c) => c.channel as Channel))];
  const { allocation, dropped } = allocate(b.monthlyBudget, channels);
  const clients = new Map<string, PlatformClient>();
  const clientOf = async (c: Campaign) => {
    if (!clients.has(c.accountId)) {
      const [acc] = await db.select().from(schema.adAccounts).where(eq(schema.adAccounts.id, c.accountId));
      if (!acc) throw new Error("Рекламный кабинет отключён");
      clients.set(c.accountId, await clientFor(acc));
    }
    return clients.get(c.accountId)!;
  };

  if (opts.rebudgetLive) {
    // Сначала уменьшаем лимиты работающих кампаний, потом включаем новую — чтобы сумма не выходила за бюджет
    const ops: UndoOp[] = [];
    for (const c of live) {
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

  const activated: Campaign[] = [];
  let retry = false;
  for (const c of ready) {
    const client = await clientOf(c).catch(() => null);
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
  const prog: LaunchProgress = plan.launch ?? { id: uid("l_"), startedAt: new Date().toISOString(), warnings: [], done: [], failed: [] };
  plan.launch = prog;
  prog.lastStepAt = new Date().toISOString();
  rebalancePlan(plan, b.monthlyBudget, prog.failed); // бюджет мог поменяться после подготовки плана или между шагами
  await db.update(schema.businesses).set({ status: "launching", launchPlan: plan, updatedAt: new Date() }).where(eq(schema.businesses.id, b.id));

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
  const { activated, retry } = await activateLaunch(b, prog.id, warnings, { failures: prog.activation });
  prog.warnings = [...new Set([...prog.warnings, ...warnings])];
  if (retry) {
    await savePlan(b.id, plan);
    return { done: false, ok: true, warnings: prog.warnings, progress };
  }
  const created = activated.map((c) => ({ channel: c.channel as Channel, campaignId: c.id, ads: metaOf(c).launchStats?.ads ?? 0, errors: metaOf(c).launchStats?.errors ?? 0 }));
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

async function logLaunch(businessId: string, created: { channel: Channel; campaignId: string; ads: number; errors: number }[], camps: Campaign[], warnings: string[]) {
  const total = created.reduce((s, c) => s + c.ads, 0);
  const weekly = camps.reduce((s, c) => s + c.weeklyBudget, 0);
  await logChange({
    businessId,
    actor: "owner",
    kind: "launch",
    title: `Запустили рекламу: ${created.map((c) => CHANNEL_NAME[c.channel]).join(", ")}`,
    reason: `Создали ${pl(total, "объявление", "объявления", "объявлений")} в ${pl(created.length, "канале", "каналах", "каналах")} с бюджетом около ${rub(weekly)} в неделю. Объявления проходят модерацию — обычно это занимает от пары часов до суток. Первые выводы робот сделает через 3 дня, когда накопятся показы.`,
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
  if (b.status !== "active" && b.status !== "paused") throw Object.assign(new Error("Добавить канал можно, когда реклама уже запущена"), { status: 409 });
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
    const want = { search: false, network: false, vk: false };
    want[channel] = true;
    const copy = await generateCopyPlan(b, want);
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
      warnings: [],
    };
    st = { channel, plan, launchId: uid("l_"), startedAt: new Date().toISOString() };
    await writeAddState(b.id, st);
    return { done: false, ok: true, stage: "copy", warnings: [] };
  }

  if (st.plan.stage === "copy") {
    st.plan = await prepareImages(b, st.plan);
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

  const ready = (await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, b.id), eq(schema.campaigns.status, "ready")))).some((c) => metaOf(c).launchId === st!.launchId);
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
  const { activated, retry } = await activateLaunch(b, st.launchId, warnings, { rebudgetLive: true, failures: st.activation });
  st.plan.warnings = [...new Set(warnings)];
  if (retry) {
    await writeAddState(b.id, st);
    return { done: false, ok: true, stage: "publish", warnings: st.plan.warnings };
  }
  await writeAddState(b.id, null);
  const created = activated.map((c) => ({ channel: c.channel as Channel, campaignId: c.id, ads: metaOf(c).launchStats?.ads ?? 0, errors: metaOf(c).launchStats?.errors ?? 0 }));
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

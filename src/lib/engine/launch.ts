import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { AdAccount, Business, Campaign } from "../db/schema";
import { allocate } from "./budget";
import { generateCopyPlan, type CopyPlan } from "../ai/copy";
import { generatePhotos, listPhotos, makeCreative, getImage, ensureLogo } from "./images";
import { adExtras, withPlanCallouts } from "./extras";
import { availableLayouts, type Layout } from "../creative/render";
import type { Channel, CampaignSpec, PlatformClient } from "../platforms/types";
import { clientFor, CHANNEL_NAME } from "../platforms";
import { YandexDirect } from "../platforms/yandex";
import { VkAds } from "../platforms/vk";
import { ensureCounter, ensureGoals } from "../platforms/metrica";
import { decrypt } from "../crypto";
import { regionIdsFor } from "./regions";
import { logChange } from "./ops";
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
export type LaunchProgress = { id: string; startedAt: string; warnings: string[]; done: Channel[]; failed: Channel[] };

/** Сегодняшняя дата по Москве (YYYY-MM-DD): кампании Директа и VK живут в московском времени, а сервер — в UTC */
export function moscowDay(d: Date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" }).format(d);
}

/** Объявление можно публиковать: включено и с непустыми заголовком и текстом */
export const publishable = (a: PlanAd) => a.enabled && Boolean(a.title?.trim()) && Boolean(a.text?.trim());

/**
 * Делит бюджет между включёнными каналами плана: доля выключенного владельцем канала
 * переходит оставшимся (по тем же весам, что и при подготовке плана).
 */
export function rebalancePlan(plan: LaunchPlan, monthly: number): LaunchPlan {
  const on = plan.channels.filter((c) => c.enabled).map((c) => c.channel);
  if (!on.length) return plan;
  const { allocation } = allocate(monthly, on);
  for (const ch of plan.channels) {
    const a = allocation.find((x) => x.channel === ch.channel);
    if (ch.enabled && a) ch.weekly = a.weekly;
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

function withUtm(href: string, platform: string) {
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

/** Шаг 1: тексты, семантика, аудитории */
export async function prepareCopy(b: Business, accounts: AdAccount[]): Promise<LaunchPlan> {
  const available = channelsFor(accounts);
  if (!available.length) throw new Error("Подключите хотя бы один рекламный кабинет");
  const { allocation, dropped } = allocate(b.monthlyBudget, available.map((a) => a.channel));
  const want = { search: false, network: false, vk: false };
  for (const a of allocation) want[a.channel] = true;
  const copy: CopyPlan = await generateCopyPlan(b, want);
  const n = nicheById(b.niche);

  const channels: PlanChannel[] = allocation.map((a) => {
    const acc = available.find((x) => x.channel === a.channel)!.account;
    const groups = copy[a.channel].map((g) => ({
      id: uid("g_"),
      name: g.name,
      audience: g.audience,
      keywords: g.keywords,
      autotargeting: a.channel !== "vk",
      ageFrom: g.ageFrom ?? n.audience.ageFrom,
      ageTo: g.ageTo ?? n.audience.ageTo,
      sex: n.audience.sex,
      ads: g.ads.map((ad) => ({ id: uid("a_"), angle: ad.angle, title: ad.title, title2: ad.title2 ?? null, text: ad.text, enabled: true })),
    }));
    return { channel: a.channel, accountId: acc.id, platform: acc.platform, weekly: a.weekly, enabled: true, groups };
  });

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

/** Недосозданная кампания прошлого (прерванного) запуска: убираем с площадки и из БД, чтобы создать заново без дублей */
async function cleanupCreating(stale: Campaign[], client: PlatformClient | null, warnings: string[]) {
  const db = await getDb();
  for (const c of stale) {
    if (c.externalId && client?.removeCampaign) {
      try {
        await client.removeCampaign(c.externalId);
      } catch (e) {
        await db.update(schema.campaigns).set({ status: "error", statusNote: `Запуск прервался. Удалите кампанию ${c.externalId} в кабинете площадки: ${errorText(e)}` }).where(eq(schema.campaigns.id, c.id));
        warnings.push(`${CHANNEL_NAME[c.channel]}: прерванный запуск оставил кампанию ${c.externalId} — удалите её в кабинете`);
        continue;
      }
    }
    await db.delete(schema.ads).where(eq(schema.ads.campaignId, c.id));
    await db.delete(schema.adGroups).where(eq(schema.adGroups.campaignId, c.id));
    await db.delete(schema.campaigns).where(eq(schema.campaigns.id, c.id));
  }
}

/** Создаёт кампанию одного канала. Запись в БД появляется до вызова площадки, а внешний ID — сразу после создания кампании. */
async function launchChannel(b: Business, plan: LaunchPlan, ch: PlanChannel, account: AdAccount, launchId: string, warnings: string[]) {
  const db = await getDb();
  const href = landingUrl(b);
  const n = nicheById(b.niche);
  const client = await clientFor(account);

  const stale = await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, b.id), eq(schema.campaigns.channel, ch.channel), eq(schema.campaigns.status, "creating")));
  await cleanupCreating(stale, client, warnings);

  let counterId: number | null = null;
  let goalId: number | null = null;
  const regionIds = await regionIdsFor(b, account.platform, client);
  if (account.platform === "yandex") {
    const m = await setupMetrica(b, account, warnings);
    counterId = m.counterId;
    goalId = m.goalId;
  }

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
  };
  for (const g of ch.groups) {
    const ads = [];
    for (const ad of g.ads.filter(publishable)) {
      let image = null;
      if (ad.imageId) {
        const img = imageCache.get(ad.imageId) ?? (await getImage(ad.imageId));
        imageCache.set(ad.imageId, img);
        if (img) image = { imageId: img.id, data: img.data, mime: img.mime, width: img.width, height: img.height, cachedRef: img.platformRefs?.[account.platform] };
      }
      ads.push({
        localId: ad.id,
        title: ad.title.trim(),
        title2: ad.title2?.trim() || null,
        text: ad.text.trim(),
        href: withUtm(href, account.platform),
        image,
        extras: withPlanCallouts(adExtras(b, { channel: ch.channel, href, service: ch.channel === "search" ? g.name : null, text: ad.text }), plan.callouts),
        logo: ch.channel === "vk" && logo ? { imageId: logo.id, data: logo.data, mime: logo.mime, width: logo.width, height: logo.height, cachedRef: logo.platformRefs?.[account.platform] } : null,
        marking: `${n.label}: ${b.name}`,
      });
    }
    if (!ads.length) continue;
    spec.groups.push({ localId: g.id, name: g.name, keywords: ch.channel === "vk" ? [] : g.keywords, autotargeting: g.autotargeting, regionIds, ageFrom: g.ageFrom, ageTo: g.ageTo, sex: g.sex, ads });
  }
  if (!spec.groups.length) {
    warnings.push(`${CHANNEL_NAME[ch.channel]}: нет ни одного объявления с заголовком и текстом — канал пропущен`);
    return null;
  }

  const campaignId = uid("c_");
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
    meta: { regionIds, launchId, startedAt: new Date().toISOString() },
  });

  let res;
  try {
    res = await client.launchCampaign(spec, {
      onCampaignCreated: async (ext) => {
        await db.update(schema.campaigns).set({ externalId: ext }).where(eq(schema.campaigns.id, campaignId));
      },
    });
  } catch (e) {
    const [row] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId));
    if (row) await cleanupCreating([row], client, warnings);
    throw e;
  }
  warnings.push(...res.warnings.map((w) => `${CHANNEL_NAME[ch.channel]}: ${w}`));

  let adsCount = 0, errors = 0;
  for (const g of ch.groups) {
    const r = res.groups.find((x) => x.localId === g.id);
    if (!r) continue;
    const groupId = uid("g_");
    await db.insert(schema.adGroups).values({
      id: groupId,
      campaignId,
      externalId: r.groupExt,
      name: g.name,
      audience: g.audience,
      keywords: g.keywords,
      targeting: { regionIds, ageFrom: g.ageFrom, ageTo: g.ageTo, sex: g.sex, autotargeting: g.autotargeting },
    });
    for (const ad of g.ads.filter(publishable)) {
      const ra = r.ads.find((x) => x.localId === ad.id);
      if (!ra) continue;
      if (ra.adExt) adsCount++;
      else errors++;
      await db.insert(schema.ads).values({
        id: uid("ad_"),
        businessId: b.id,
        campaignId,
        adGroupId: groupId,
        externalId: ra.adExt,
        angle: ad.angle,
        title: ad.title.trim(),
        title2: ad.title2?.trim() || null,
        text: ad.text.trim(),
        imageId: ad.imageId ?? null,
        status: ra.adExt ? "moderation" : "error",
        statusNote: ra.error ?? null,
      });
      if (ra.imageRef && ad.imageId) {
        const img = imageCache.get(ad.imageId);
        if (img && !img.platformRefs?.[account.platform]) {
          const refs = { ...(img.platformRefs ?? {}), [account.platform]: ra.imageRef };
          img.platformRefs = refs;
          await db.update(schema.images).set({ platformRefs: refs }).where(eq(schema.images.id, img.id));
        }
      }
    }
  }
  await db.update(schema.campaigns).set({
    externalId: res.campaignExt,
    status: "active",
    meta: { regionIds, launchId, launchedAt: new Date().toISOString(), launchStats: { ads: adsCount, errors } },
  }).where(eq(schema.campaigns.id, campaignId));
  return { channel: ch.channel, campaignId, ads: adsCount, errors };
}

export type PublishStep = {
  done: boolean;
  ok: boolean;
  warnings: string[];
  progress: { total: number; finished: number; channels: { channel: Channel; state: "done" | "failed" | "pending" }[] };
  created?: { channel: Channel; campaignId: string; ads: number; errors: number }[];
};

/**
 * Шаг 3: создаём кампании на площадках — по одному каналу за вызов (чтобы уложиться в лимит функции Vercel).
 * Вызывающий должен держать блокировку запуска (run.tryLock(..., "launch")) и повторять вызов, пока done=false.
 * Повторный вызов после обрыва безопасен: каналы с уже созданными кампаниями пропускаются,
 * недосозданные («creating») удаляются на площадке и создаются заново.
 */
export async function publishStep(b: Business, plan: LaunchPlan, accounts: AdAccount[]): Promise<PublishStep> {
  const db = await getDb();
  const prog: LaunchProgress = plan.launch ?? { id: uid("l_"), startedAt: new Date().toISOString(), warnings: [], done: [], failed: [] };
  if (!plan.launch) rebalancePlan(plan, b.monthlyBudget); // бюджет мог поменяться после подготовки плана
  plan.launch = prog;
  await db.update(schema.businesses).set({ status: "launching", launchPlan: plan, updatedAt: new Date() }).where(eq(schema.businesses.id, b.id));

  const wanted = plan.channels.filter((c) => c.enabled && c.groups.some((g) => g.ads.some(publishable)));
  const existing = await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, b.id), inArray(schema.campaigns.status, ["active", "paused"])));
  // Канал, по которому кампания уже есть (в том числе от прошлого запуска), второй раз не создаём
  for (const ch of wanted) if (!prog.done.includes(ch.channel) && existing.some((c) => c.channel === ch.channel)) prog.done.push(ch.channel);

  const next = wanted.find((c) => !prog.done.includes(c.channel) && !prog.failed.includes(c.channel));
  if (next) {
    const warnings: string[] = [];
    const account = accounts.find((a) => a.id === next.accountId);
    if (!account) {
      warnings.push(`${CHANNEL_NAME[next.channel]}: кабинет отключён`);
      prog.failed.push(next.channel);
    } else {
      try {
        const r = await launchChannel(b, plan, next, account, prog.id, warnings);
        if (r) prog.done.push(next.channel);
        else prog.failed.push(next.channel);
      } catch (e) {
        warnings.push(`${CHANNEL_NAME[next.channel]}: не удалось создать кампанию — ${errorText(e)}`);
        prog.failed.push(next.channel);
      }
    }
    prog.warnings = [...new Set([...prog.warnings, ...warnings])];
    await savePlan(b.id, plan);
  }

  const progress = {
    total: wanted.length,
    finished: wanted.filter((c) => prog.done.includes(c.channel) || prog.failed.includes(c.channel)).length,
    channels: wanted.map((c) => ({ channel: c.channel, state: prog.done.includes(c.channel) ? ("done" as const) : prog.failed.includes(c.channel) ? ("failed" as const) : ("pending" as const) })),
  };
  if (progress.finished < progress.total) return { done: false, ok: true, warnings: prog.warnings, progress };

  // Все каналы обработаны — подводим итог
  const mine = (await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, b.id), inArray(schema.campaigns.status, ["active", "paused"]))))
    .filter((c) => (c.meta as { launchId?: string })?.launchId === prog.id);
  const created = mine.map((c) => {
    const st = (c.meta as { launchStats?: { ads: number; errors: number } }).launchStats ?? { ads: 0, errors: 0 };
    return { channel: c.channel as Channel, campaignId: c.id, ads: st.ads, errors: st.errors };
  });
  const anyLive = existing.length > 0 || created.length > 0;
  if (!anyLive) {
    // Ничего не создано — возвращаемся к плану, чтобы можно было поправить и запустить снова
    const warnings = prog.warnings;
    plan.launch = undefined;
    await db.update(schema.businesses).set({ status: "draft", launchPlan: plan, updatedAt: new Date() }).where(eq(schema.businesses.id, b.id));
    return { done: true, ok: false, warnings, progress };
  }

  await db.update(schema.businesses).set({ status: "active", launchPlan: null, updatedAt: new Date() }).where(eq(schema.businesses.id, b.id));
  if (created.length) {
    const total = created.reduce((s, c) => s + c.ads, 0);
    const weekly = mine.reduce((s, c) => s + c.weeklyBudget, 0);
    await logChange({
      businessId: b.id,
      actor: "owner",
      kind: "launch",
      title: `Запустили рекламу: ${created.map((c) => CHANNEL_NAME[c.channel]).join(", ")}`,
      reason: `Создали ${pl(total, "объявление", "объявления", "объявлений")} в ${pl(created.length, "канале", "каналах", "каналах")} с бюджетом около ${rub(weekly)} в неделю. Объявления проходят модерацию — обычно это занимает от пары часов до суток. Первые выводы робот сделает через 3 дня, когда накопятся показы.`,
      details: { created, warnings: prog.warnings },
      undo: created.map((c) => ({ op: "campaignStatus" as const, campaignId: c.campaignId, status: "paused" as const })),
    });
  }
  return { done: true, ok: true, warnings: prog.warnings, progress, created };
}

export async function campaignsOf(businessId: string) {
  const db = await getDb();
  return db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, businessId), inArray(schema.campaigns.status, ["active", "paused", "error"])));
}

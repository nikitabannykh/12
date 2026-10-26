import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { AdAccount, Business } from "../db/schema";
import { allocate } from "./budget";
import { generateCopyPlan, type CopyPlan } from "../ai/copy";
import { generatePhotos, listPhotos, makeCreative, getImage, ensureLogo } from "./images";
import { adExtras, withPlanCallouts } from "./extras";
import { availableLayouts, type Layout } from "../creative/render";
import type { Channel, CampaignSpec } from "../platforms/types";
import { clientFor, CHANNEL_NAME } from "../platforms";
import { YandexDirect } from "../platforms/yandex";
import { VkAds } from "../platforms/vk";
import { ensureCounter, ensureGoals } from "../platforms/metrica";
import { decrypt } from "../crypto";
import { yandexRegionIds, vkRegionIds } from "./regions";
import { logChange } from "./ops";
import { nicheById } from "../niches";
import { appUrl, errorText, isoDay, pl, rub, uid } from "../util";

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
};

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

/** Шаг 3: создаём кампании на площадках */
export async function publish(b: Business, plan: LaunchPlan, accounts: AdAccount[]) {
  const db = await getDb();
  const warnings: string[] = [];
  const created: { channel: Channel; campaignId: string; ads: number; errors: number }[] = [];
  const href = landingUrl(b);
  const n = nicheById(b.niche);

  await db.update(schema.businesses).set({ status: "launching" }).where(eq(schema.businesses.id, b.id));

  for (const ch of plan.channels.filter((c) => c.enabled)) {
    const account = accounts.find((a) => a.id === ch.accountId);
    if (!account) {
      warnings.push(`${CHANNEL_NAME[ch.channel]}: кабинет отключён`);
      continue;
    }
    try {
      const client = await clientFor(account);
      let regionIds: number[] = [];
      let counterId: number | null = null;
      let goalId: number | null = null;
      if (account.platform === "yandex") {
        const r = await yandexRegionIds(b.city, client as YandexDirect);
        if (!r) throw new Error(`не нашли город «${b.city}» в справочнике Яндекса — уточните название в настройках бизнеса`);
        regionIds = r;
        const m = await setupMetrica(b, account, warnings);
        counterId = m.counterId;
        goalId = m.goalId;
      } else if (account.platform === "vk") {
        const r = await vkRegionIds(b.city, client as VkAds);
        if (!r) throw new Error(`не нашли город «${b.city}» в справочнике VK — уточните название в настройках бизнеса`);
        regionIds = r;
      } else {
        regionIds = [213];
      }

      const imageCache = new Map<string, Awaited<ReturnType<typeof getImage>>>();
      const logo = ch.channel === "vk" ? await ensureLogo(b).catch(() => null) : null;
      const spec: CampaignSpec = {
        name: `${b.name} — ${CHANNEL_NAME[ch.channel]}`,
        channel: ch.channel,
        weeklyBudget: ch.weekly,
        strategy: "clicks",
        startDate: isoDay(),
        counterId,
        goalId,
        negativeKeywords: ch.channel === "vk" ? [] : plan.negatives,
        siteUrl: withUtm(href, account.platform),
        groups: [],
      };
      for (const g of ch.groups) {
        const ads = [];
        for (const ad of g.ads.filter((a) => a.enabled)) {
          let image = null;
          if (ad.imageId) {
            const img = imageCache.get(ad.imageId) ?? (await getImage(ad.imageId));
            imageCache.set(ad.imageId, img);
            if (img) image = { imageId: img.id, data: img.data, mime: img.mime, width: img.width, height: img.height, cachedRef: img.platformRefs?.[account.platform] };
          }
          ads.push({
            localId: ad.id,
            title: ad.title,
            title2: ad.title2,
            text: ad.text,
            href: withUtm(href, account.platform),
            image,
            extras: withPlanCallouts(adExtras(b, { channel: ch.channel, href, service: ch.channel === "search" ? g.name : null, text: ad.text }), plan.callouts),
            logo: ch.channel === "vk" && logo ? { imageId: logo.id, data: logo.data, mime: logo.mime, width: logo.width, height: logo.height, cachedRef: logo.platformRefs?.[account.platform] } : null,
            marking: `${n.label}: ${b.name}`,
          });
        }
        if (!ads.length) continue;
        spec.groups.push({
          localId: g.id,
          name: g.name,
          keywords: ch.channel === "vk" ? [] : g.keywords,
          autotargeting: g.autotargeting,
          regionIds,
          ageFrom: g.ageFrom,
          ageTo: g.ageTo,
          sex: g.sex,
          ads,
        });
      }
      if (!spec.groups.length) continue;

      const res = await client.launchCampaign(spec);
      warnings.push(...res.warnings.map((w) => `${CHANNEL_NAME[ch.channel]}: ${w}`));

      const campaignId = uid("c_");
      await db.insert(schema.campaigns).values({
        id: campaignId,
        businessId: b.id,
        accountId: account.id,
        platform: account.platform,
        channel: ch.channel,
        externalId: res.campaignExt,
        name: spec.name,
        weeklyBudget: ch.weekly,
        strategy: "clicks",
        status: "active",
        negativeKeywords: spec.negativeKeywords,
        meta: { regionIds, launchedAt: new Date().toISOString() },
      });
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
        for (const ad of g.ads.filter((a) => a.enabled)) {
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
            title: ad.title,
            title2: ad.title2 ?? null,
            text: ad.text,
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
      created.push({ channel: ch.channel, campaignId, ads: adsCount, errors });
    } catch (e) {
      warnings.push(`${CHANNEL_NAME[ch.channel]}: не удалось создать кампанию — ${errorText(e)}`);
    }
  }

  if (!created.length) {
    await db.update(schema.businesses).set({ status: "draft" }).where(eq(schema.businesses.id, b.id));
    return { ok: false as const, warnings };
  }

  await db.update(schema.businesses).set({ status: "active", launchPlan: null, updatedAt: new Date() }).where(eq(schema.businesses.id, b.id));
  const total = created.reduce((s, c) => s + c.ads, 0);
  const weekly = plan.channels.filter((c) => created.some((x) => x.channel === c.channel)).reduce((s, c) => s + c.weekly, 0);
  await logChange({
    businessId: b.id,
    actor: "owner",
    kind: "launch",
    title: `Запустили рекламу: ${created.map((c) => CHANNEL_NAME[c.channel]).join(", ")}`,
    reason: `Создали ${pl(total, "объявление", "объявления", "объявлений")} в ${created.length} ${created.length === 1 ? "канале" : "каналах"} с бюджетом около ${rub(weekly)} в неделю. Объявления проходят модерацию — обычно это занимает от пары часов до суток. Первые выводы робот сделает через 3 дня, когда накопятся показы.`,
    details: { created, warnings },
    undo: created.map((c) => ({ op: "campaignStatus" as const, campaignId: c.campaignId, status: "paused" as const })),
  });
  return { ok: true as const, warnings, created };
}

export async function campaignsOf(businessId: string) {
  const db = await getDb();
  return db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, businessId), inArray(schema.campaigns.status, ["active", "paused", "error"])));
}

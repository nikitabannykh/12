import "server-only";
import { and, eq, gte, inArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { Ad, AdGroup, Business, Campaign, Experiment } from "../db/schema";
import { clientFor, CHANNEL_NAME } from "../platforms";
import { demoNow } from "../platforms/demo";
import { ensureLogo, getImage, makeCreative } from "./images";
import { adExtras } from "./extras";
import { liftBy, pickByThompson, placeName } from "./insights";
import { availableLayouts, LAYOUT_NAME, type Layout } from "../creative/render";
import { act, ceilingOf, logChange } from "./ops";
import { probBetter, pct, times } from "./stats";
import { rewriteAd, pickNegativeWords, type LIMITS } from "../ai/copy";
import { ANGLES, nicheById } from "../niches";
import { MIN_WEEKLY, weeklyFromMonthly } from "./budget";
import { addDays, daysInMonth, errorText, isoDay, rub, startOfMonth, uid, pl, num } from "../util";
import { landingUrl } from "./launch";
import type { Channel } from "../platforms/types";

/**
 * Робот-оптимизатор. Работает по расписанию (каждые несколько часов) и принимает решения
 * по накопленной статистике. Каждое решение — с объяснением и кнопкой «Отменить».
 *
 * Принципы:
 *  - не трогаем рекламу, пока не накопилось достаточно показов (иначе решения случайны);
 *  - сравниваем объявления только внутри одной группы — у них одинаковая аудитория;
 *  - меняем одну вещь за раз (текст при той же картинке), чтобы было понятно, что сработало;
 *  - в группе всегда остаётся минимум 2 рабочих объявления;
 *  - бюджет месяца — жёсткая граница.
 */

const MIN_IMPR: Record<Channel, number> = { search: 150, network: 1500, vk: 1500 };
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
  /** Макет картинки по id изображения и id исходного фото */
  images: Map<string, { layout: string | null; photoId: string | null; width: number; height: number }>;
  /** Тесты, выигранные в этом проходе — их идеи переносим в другие группы */
  won: Experiment[];
};

function sumAd(cx: Ctx, adId: string, since?: string): S {
  return (cx.statByAd.get(adId) ?? []).filter((r) => !since || r.day >= since).reduce((acc, r) => add(acc, r.s), zero());
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
  const now = isDemo ? await demoNow() : new Date();
  const since = isoDay(addDays(now, -45));
  const stats = await db.select().from(schema.statsDaily).where(and(eq(schema.statsDaily.businessId, b.id), gte(schema.statsDaily.day, since)));
  const statByAd = new Map<string, { day: string; s: S }[]>();
  for (const r of stats) {
    if (!r.adId) continue;
    const list = statByAd.get(r.adId) ?? [];
    list.push({ day: String(r.day), s: { impressions: r.impressions, clicks: r.clicks, cost: r.cost, conversions: r.conversions } });
    statByAd.set(r.adId, list);
  }
  // Решения владельца важнее: если он что-то включил, выключил или отменил — не спорим с ним две недели
  const ownerChanges = await db.select().from(schema.changes).where(and(eq(schema.changes.businessId, b.id), eq(schema.changes.actor, "owner"), gte(schema.changes.at, new Date(Date.now() - 14 * 864e5))));
  const prot = new Set<string>();
  for (const ch of ownerChanges) {
    // Запуск и смена общего бюджета — не «решения про конкретный объект»
    if (ch.kind === "launch" || (ch.undo ?? []).some((o) => o.op === "monthlyBudget")) continue;
    for (const op of ch.undo ?? []) {
      const o = op as Record<string, unknown>;
      for (const k of ["adId", "groupId", "campaignId"]) if (typeof o[k] === "string") prot.add(o[k] as string);
    }
  }
  const imageIds = [...new Set(ads.map((a) => a.imageId).filter(Boolean) as string[])];
  const imgRows = imageIds.length
    ? await db.select({ id: schema.images.id, layout: schema.images.layout, prompt: schema.images.prompt, width: schema.images.width, height: schema.images.height }).from(schema.images).where(inArray(schema.images.id, imageIds))
    : [];
  const images = new Map(imgRows.map((r) => [r.id, { layout: r.layout, photoId: r.prompt && r.prompt.startsWith("img_") ? r.prompt : null, width: r.width, height: r.height }]));
  const tvRows = stats.filter((r) => r.tvWeighted > 0).map((r) => ({ campaignId: r.campaignId, day: String(r.day), impressions: r.impressions, tvWeighted: r.tvWeighted }));
  return { b, now, campaigns, groups, ads, experiments, statByAd, tvRows, log: [], newAds: 0, protected: prot, images, won: [] };
}

/** Новое объявление-вариант в той же группе: тот же визуал, другой текст */
async function logoFor(b: Business, channel: string) {
  if (channel !== "vk") return null;
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

async function createVariant(cx: Ctx, base: Ad, reason: string, opts: { experiment?: boolean; angle?: string } = {}) {
  const db = await getDb();
  const camp = cx.campaigns.find((c) => c.id === base.campaignId)!;
  const group = cx.groups.find((g) => g.id === base.adGroupId)!;
  if (!camp.externalId || !group.externalId) return null;
  const peers = cx.ads.filter((a) => a.adGroupId === group.id);
  const tried = [...new Set(peers.map((a) => a.angle))];
  const winner = peers
    .filter((a) => a.status === "active" && a.id !== base.id)
    .map((a) => ({ a, s: sumAd(cx, a.id) }))
    .sort((x, y) => ctr(y.s) - ctr(x.s))[0]?.a;
  const ch = camp.channel as keyof typeof LIMITS;
  const angle = opts.angle ?? chooseAngle(cx, camp.channel, group.id, [base.angle]);
  const draft = await rewriteAd(cx.b, { channel: ch, angle, service: camp.channel === "search" ? group.name : undefined, base: { angle: base.angle, title: base.title, title2: base.title2, text: base.text }, tried, reason, winner: winner ? { angle: winner.angle, title: winner.title, title2: winner.title2, text: winner.text } : null });

  const [acc] = await db.select().from(schema.adAccounts).where(eq(schema.adAccounts.id, camp.accountId));
  const client = await clientFor(acc);
  const img = base.imageId ? await getImage(base.imageId) : null;
  const href = landingUrl(cx.b);
  const utm = acc.platform === "yandex"
    ? "utm_source=yandex&utm_medium=cpc&utm_campaign={campaign_id}&utm_content={ad_id}&utm_term={keyword}"
    : acc.platform === "vk" ? "utm_source=vk&utm_medium=cpc&utm_campaign={{campaign_id}}&utm_content={{banner_id}}" : "utm_source=demo";
  const localId = uid("ad_");
  const res = await client.addAd(camp.externalId, group.externalId, {
    localId,
    title: draft.title,
    title2: draft.title2,
    text: draft.text,
    href: `${href}${href.includes("?") ? "&" : "?"}${utm}`,
    image: img ? { imageId: img.id, data: img.data, mime: img.mime, width: img.width, height: img.height, cachedRef: img.platformRefs?.[acc.platform] } : null,
    extras: adExtras(cx.b, { channel: camp.channel, href, service: camp.channel === "search" ? group.name : null, text: draft.text }),
    logo: await logoFor(cx.b, camp.channel),
    marking: `${nicheById(cx.b.niche).label}: ${cx.b.name}`,
  }, { channel: camp.channel as Channel });

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
    const ex: Experiment = { id: experimentId, businessId: cx.b.id, campaignId: camp.id, kind: "ad", hypothesis: draft.hypothesis, controlId: base.id, variantId: ad.id, status: "running", result: null, startedAt: new Date(), finishedAt: null };
    await db.insert(schema.experiments).values(ex);
    await db.update(schema.ads).set({ experimentId }).where(eq(schema.ads.id, base.id));
    cx.experiments.push(ex);
  }
  return { ad, draft, experimentId };
}

// ─── 0. Бюджет месяца ────────────────────────────────────────────────────

async function budgetGuard(cx: Ctx) {
  const db = await getDb();
  const monthStart = isoDay(startOfMonth(cx.now));
  const spent = (await db.select().from(schema.statsDaily).where(and(eq(schema.statsDaily.businessId, cx.b.id), gte(schema.statsDaily.day, monthStart))))
    .reduce((s, r) => s + r.cost, 0);
  const budget = cx.b.monthlyBudget;
  const day = cx.now.getUTCDate();
  const dim = daysInMonth(cx.now);
  const active = cx.campaigns.filter((c) => c.status === "active");
  const guardPaused = cx.campaigns.filter((c) => c.status === "paused" && (c.meta as any)?.pausedByGuard === monthStart.slice(0, 7));
  const prevMonthPaused = cx.campaigns.filter((c) => c.status === "paused" && (c.meta as any)?.pausedByGuard && (c.meta as any).pausedByGuard !== monthStart.slice(0, 7));

  // Новый месяц: возвращаем кампании, которые робот останавливал из-за бюджета
  if (prevMonthPaused.length) {
    await act(
      { businessId: cx.b.id, actor: "robot", kind: "resume", title: "Возобновили рекламу в новом месяце", reason: `В прошлом месяце бюджет ${rub(budget)} закончился раньше срока, и реклама стояла. Начался новый месяц — включили обратно.` },
      prevMonthPaused.map((c) => ({ op: "campaignStatus" as const, campaignId: c.id, status: "active" as const })),
    );
    for (const c of prevMonthPaused) await db.update(schema.campaigns).set({ meta: { ...(c.meta ?? {}), pausedByGuard: null } }).where(eq(schema.campaigns.id, c.id));
    cx.log.push("Возобновили кампании в новом месяце");
    return;
  }
  if (guardPaused.length) return;

  if (spent >= budget * 0.98 && active.length) {
    await act(
      { businessId: cx.b.id, actor: "robot", kind: "pause", title: "Остановили рекламу до конца месяца", reason: `За этот месяц потрачено ${rub(spent)} из ${rub(budget)}. Чтобы не выйти за бюджет, реклама стоит до 1-го числа. Если хотите продолжить — увеличьте бюджет в настройках.`, details: { spent, budget } },
      active.map((c) => ({ op: "campaignStatus" as const, campaignId: c.id, status: "paused" as const })),
    );
    for (const c of active) await db.update(schema.campaigns).set({ meta: { ...(c.meta ?? {}), pausedByGuard: monthStart.slice(0, 7) } }).where(eq(schema.campaigns.id, c.id));
    cx.log.push("Бюджет месяца исчерпан — пауза");
    return;
  }

  // Прогноз: если при текущих лимитах выходим за бюджет — снижаем недельные лимиты пропорционально
  const daysLeft = dim - day + 1;
  const weeklyNow = active.reduce((s, c) => s + c.weeklyBudget, 0);
  const projected = spent + (weeklyNow / 7) * daysLeft;
  const allowedWeekly = Math.max(0, ((budget - spent) / daysLeft) * 7);
  if (projected > budget * 1.03 && weeklyNow > 0) {
    const k = allowedWeekly / weeklyNow;
    const ops = active
      .map((c) => ({ c, next: Math.max(MIN_WEEKLY[c.channel as Channel], Math.floor(c.weeklyBudget * k)) }))
      .filter(({ c, next }) => next < c.weeklyBudget)
      .map(({ c, next }) => ({ op: "campaignBudget" as const, campaignId: c.id, weeklyBudget: next }));
    if (ops.length) {
      await act(
        { businessId: cx.b.id, actor: "robot", kind: "budget", title: "Снизили недельные лимиты, чтобы уложиться в бюджет", reason: `С начала месяца потрачено ${rub(spent)}. При прежних лимитах к концу месяца вышло бы около ${rub(projected)} — больше вашего бюджета ${rub(budget)}. Уменьшили лимиты на оставшиеся ${pl(daysLeft, "день", "дня", "дней")}.`, details: { spent, projected } },
        ops,
      );
      cx.log.push("Снижены лимиты под бюджет");
    }
  }
}

// ─── 1. Отклонённые модерацией ──────────────────────────────────────────

async function handleRejected(cx: Ctx) {
  const db = await getDb();
  for (const ad of cx.ads.filter((a) => a.status === "rejected")) {
    if (cx.newAds >= MAX_NEW_ADS_PER_RUN) return;
    const camp = cx.campaigns.find((c) => c.id === ad.campaignId);
    if (!camp || camp.status !== "active") continue;
    if (cx.groups.find((g) => g.id === ad.adGroupId)?.status !== "active") continue; // аудиторию отключили — не пишем замену
    if (cx.ads.some((a) => a.parentAdId === ad.id)) continue; // замену уже делали
    try {
      const r = await createVariant(cx, ad, `Модерация отклонила объявление: ${ad.statusNote || "без пояснения"}. Нужно переписать, сохранив смысл.`);
      if (!r) continue;
      await db.update(schema.ads).set({ status: "archived" }).where(eq(schema.ads.id, ad.id));
      ad.status = "archived";
      await logChange({
        businessId: cx.b.id, actor: "robot", kind: "ad_new",
        title: `Переписали объявление, которое не прошло модерацию`,
        reason: `${CHANNEL_NAME[camp.channel]} не пропустил ${adLabel(ad)}${ad.statusNote ? `: «${ad.statusNote}»` : ""}. Написали новый вариант — «${r.ad.title}». Он уже отправлен на проверку.`,
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
  const db = await getDb();
  for (const ex of cx.experiments.filter((e) => e.status === "running")) {
    const control = cx.ads.find((a) => a.id === ex.controlId);
    const variant = cx.ads.find((a) => a.id === ex.variantId);
    const camp = cx.campaigns.find((c) => c.id === ex.campaignId);
    if (!control || !variant || !camp) continue;
    if (control.status !== "active" && control.status !== "moderation") continue;
    if (variant.status === "rejected" || variant.status === "archived") {
      await db.update(schema.experiments).set({ status: "draw", result: "Новый вариант не прошёл модерацию", finishedAt: new Date() }).where(eq(schema.experiments.id, ex.id));
      continue;
    }
    // Сравниваем только с момента, когда вариант начал показываться
    const varRows = (cx.statByAd.get(variant.id) ?? []).filter((r) => r.s.impressions > 0).map((r) => r.day).sort();
    if (!varRows.length) continue;
    const since = varRows[0];
    const sc = sumAd(cx, control.id, since), sv = sumAd(cx, variant.id, since);
    const min = MIN_IMPR[camp.channel as Channel];
    const ageDays = (cx.now.getTime() - new Date(since).getTime()) / 864e5;
    if (sc.impressions < min || sv.impressions < min) {
      if (ageDays < MAX_TEST_DAYS) continue;
    }
    // Если заявок достаточно — сравниваем по заявкам на клик, иначе по CTR
    const byConv = sc.conversions + sv.conversions >= 10;
    const p = byConv ? probBetter(sv.conversions, sv.clicks, sc.conversions, sc.clicks) : probBetter(sv.clicks, sv.impressions, sc.clicks, sc.impressions);
    const metric = byConv ? "заявок на 100 переходов" : "кликов на 100 показов";
    const rate = (s: S) => (byConv ? (s.clicks ? (s.conversions / s.clicks) * 100 : 0) : ctr(s) * 100);
    const fmt = (x: number) => x.toFixed(1).replace(".", ",");
    const hyp = ex.hypothesis.replace(/\.$/, "");
    let status: "won" | "lost" | "draw" | null = null;
    if (p >= 0.9) status = "won";
    else if (p <= 0.1) status = "lost";
    else if (ageDays >= MAX_TEST_DAYS) status = "draw";
    if (!status) continue;

    const loser = status === "won" ? control : status === "lost" ? variant : rate(sv) >= rate(sc) ? control : variant;
    const winner = loser.id === control.id ? variant : control;
    const result =
      status === "won"
        ? `Гипотеза подтвердилась: новый вариант даёт ${fmt(rate(sv))} ${metric} против ${fmt(rate(sc))} (вероятность, что он лучше, — ${Math.round(p * 100)}%).`
        : status === "lost"
          ? `Гипотеза не подтвердилась: новый вариант даёт ${fmt(rate(sv))} ${metric} против ${fmt(rate(sc))}. Оставили прежний.`
          : `За ${MAX_TEST_DAYS} дней явного победителя нет (${fmt(rate(sv))} против ${fmt(rate(sc))} ${metric}). Оставили тот, что немного лучше.`;
    await act(
      { businessId: cx.b.id, actor: "robot", kind: "test_end", title: `Тест завершён: ${status === "won" ? "новый вариант лучше" : status === "lost" ? "старый вариант лучше" : "ничья"}`, reason: `Проверяли: ${hyp}. ${result} Отключили ${adLabel(loser)}, работает ${adLabel(winner)}.`, details: { experimentId: ex.id, p, control: sc, variant: sv } },
      [{ op: "adStatus", adId: loser.id, status: "paused" }],
    );
    await db.update(schema.experiments).set({ status, result, finishedAt: new Date() }).where(eq(schema.experiments.id, ex.id));
    ex.status = status;
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
      if (r.a.id === best.a.id || r.a.experimentId || cx.protected.has(r.a.id)) continue;
      const pWorse = probBetter(best.s.clicks, best.s.impressions, r.s.clicks, r.s.impressions);
      const ratio = ctr(best.s) / Math.max(ctr(r.s), 1e-6);
      const activeLeft = cx.ads.filter((a) => a.adGroupId === g.id && a.status === "active").length;

      // Явно хуже: отключаем и пишем замену, чтобы в группе продолжали соревноваться минимум два варианта
      const drain = cpa && r.s.conversions === 0 && r.s.cost >= Math.max(2 * cpa, 600);
      if ((pWorse >= 0.95 && ratio >= 1.4) || drain) {
        const reason = drain
          ? `${adLabel(r.a)} потратило ${rub(r.s.cost)} за ${WINDOW_DAYS} дней и не принесло ни одного обращения. В среднем по группе обращение стоит ${rub(cpa!)}.`
          : `${adLabel(r.a)} показали ${num(r.s.impressions)} раз, кликнули ${num(r.s.clicks)} (${pct(ctr(r.s))}). Лучшее объявление в этой группе получает ${pct(ctr(best.s))} — в ${times(ratio)} раза больше. Разница не случайна (уверенность ${Math.round(pWorse * 100)}%).`;
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
    if (!winner || !camp) continue;
    const targets = cx.groups.filter(
      (g) =>
        g.campaignId === camp.id && g.id !== winner.adGroupId && g.status === "active" && !cx.protected.has(g.id) &&
        !cx.ads.some((a) => a.adGroupId === g.id && a.angle === winner.angle && (a.status === "active" || a.status === "moderation")) &&
        !cx.experiments.some((e) => e.status === "running" && cx.ads.some((a) => a.adGroupId === g.id && (a.id === e.controlId || a.id === e.variantId))),
    );
    const moved: string[] = [];
    for (const g of targets) {
      if (cx.newAds >= MAX_NEW_ADS_PER_RUN) break;
      const since = isoDay(addDays(cx.now, -WINDOW_DAYS));
      const base = cx.ads
        .filter((a) => a.adGroupId === g.id && a.status === "active")
        .sort((a, b) => ctr(sumAd(cx, b.id, since)) - ctr(sumAd(cx, a.id, since)))[0];
      if (!base) continue;
      try {
        const v = await createVariant(cx, base, `В соседней группе победил подход «${ANGLES[winner.angle]?.name}». Перенеси его сюда, сохранив услугу этой группы.`, { experiment: true, angle: winner.angle });
        if (v) moved.push(g.name);
      } catch (e) {
        cx.log.push(`Перенос идеи: ${errorText(e)}`);
      }
    }
    if (moved.length) {
      await logChange({
        businessId: cx.b.id, actor: "robot", kind: "test_start",
        title: `Пробуем удачную идею «${ANGLES[winner.angle]?.name}» в ${pl(moved.length, "другой группе", "других группах", "других группах")}`,
        reason: `В группе «${cx.groups.find((g) => g.id === winner.adGroupId)?.name}» подход «${ANGLES[winner.angle]?.name}» выиграл тест. Проверяем, сработает ли он и здесь: ${moved.map((m) => `«${m}»`).join(", ")}. Каждое новое объявление соревнуется с лучшим объявлением своей группы.`,
        details: { from: winner.id, angle: winner.angle, groups: moved },
      });
      cx.log.push(`Перенос идеи ${winner.angle} → ${moved.length}`);
    }
  }
}

// ─── 3в. Тест картинок: тот же текст, другой макет ─────────────────────

async function creativeTests(cx: Ctx) {
  const since = isoDay(addDays(cx.now, -WINDOW_DAYS));
  const db = await getDb();
  for (const camp of cx.campaigns.filter((c) => c.status === "active" && c.channel !== "search" && c.externalId)) {
    if (cx.newAds >= MAX_NEW_ADS_PER_RUN) return;
    const groups = cx.groups.filter((g) => g.campaignId === camp.id && g.status === "active" && g.externalId && !cx.protected.has(g.id));
    for (const g of groups) {
      const live = cx.ads.filter((a) => a.adGroupId === g.id && a.status === "active" && a.imageId);
      const busy = cx.experiments.some((e) => e.status === "running" && cx.ads.some((a) => a.adGroupId === g.id && (a.id === e.controlId || a.id === e.variantId)));
      if (busy || live.length < 2) continue;
      const best = live.map((a) => ({ a, s: sumAd(cx, a.id, since) })).filter((r) => r.s.impressions >= MIN_IMPR[camp.channel as Channel]).sort((x, y) => ctr(y.s) - ctr(x.s))[0];
      if (!best) continue;
      const img = cx.images.get(best.a.imageId!);
      if (!img?.layout) continue;
      const usedHere = live.map((a) => cx.images.get(a.imageId!)?.layout).filter(Boolean) as string[];
      const options = availableLayouts(cx.b).filter((l) => l !== img.layout && !usedHere.includes(l));
      if (!options.length) continue;
      const layout = pickByThompson(options, layoutStats(cx, camp.channel));
      try {
        const creative = await makeCreative(cx.b, { layout, photoId: img.photoId, width: img.width, height: img.height });
        const [acc] = await db.select().from(schema.adAccounts).where(eq(schema.adAccounts.id, camp.accountId));
        const client = await clientFor(acc);
        const full = await getImage(creative.id);
        const href = landingUrl(cx.b);
        const utm = acc.platform === "yandex"
          ? "utm_source=yandex&utm_medium=cpc&utm_campaign={campaign_id}&utm_content={ad_id}"
          : acc.platform === "vk" ? "utm_source=vk&utm_medium=cpc&utm_campaign={{campaign_id}}&utm_content={{banner_id}}" : "utm_source=demo";
        const localId = uid("ad_");
        const res = await client.addAd(camp.externalId!, g.externalId!, {
          localId, title: best.a.title, title2: best.a.title2, text: best.a.text,
          href: `${href}${href.includes("?") ? "&" : "?"}${utm}`,
          image: full ? { imageId: full.id, data: full.data, mime: full.mime, width: full.width, height: full.height } : null,
          extras: adExtras(cx.b, { channel: camp.channel, href, text: best.a.text }),
          logo: await logoFor(cx.b, camp.channel),
          marking: `${nicheById(cx.b.niche).label}: ${cx.b.name}`,
        }, { channel: camp.channel as Channel });
        const experimentId = uid("x_");
        const ad: Ad = {
          id: localId, businessId: cx.b.id, campaignId: camp.id, adGroupId: g.id, externalId: res.adExt, angle: best.a.angle,
          title: best.a.title, title2: best.a.title2, text: best.a.text, imageId: creative.id, status: "moderation", statusNote: null,
          experimentId, parentAdId: best.a.id, createdAt: new Date(),
        };
        await db.insert(schema.ads).values(ad);
        cx.ads.push(ad);
        cx.images.set(creative.id, { layout, photoId: img.photoId, width: img.width, height: img.height });
        cx.newAds++;
        const hypothesis = `привлечёт ли картинка «${LAYOUT_NAME[layout]}» больше людей, чем «${LAYOUT_NAME[img.layout as Layout] ?? img.layout}», при том же тексте`;
        const ex: Experiment = { id: experimentId, businessId: cx.b.id, campaignId: camp.id, kind: "creative", hypothesis, controlId: best.a.id, variantId: ad.id, status: "running", result: null, startedAt: new Date(), finishedAt: null };
        await db.insert(schema.experiments).values(ex);
        await db.update(schema.ads).set({ experimentId }).where(eq(schema.ads.id, best.a.id));
        best.a.experimentId = experimentId;
        cx.experiments.push(ex);
        await logChange({
          businessId: cx.b.id, actor: "robot", kind: "test_start",
          title: `Тестируем другую картинку для ${adLabel(best.a)}`,
          reason: `Текст этого объявления работает лучше всех в аудитории «${g.name}». Теперь проверяем, ${hypothesis}. Меняем только картинку — так будет понятно, что именно сработало.`,
          details: { experimentId, controlId: best.a.id, variantId: ad.id, layout },
          undo: [{ op: "adStatus", adId: ad.id, status: "paused" }],
        });
        cx.log.push(`Тест картинки ${layout} в ${g.id}`);
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

// ─── 5. Минус-слова из поисковых запросов ──────────────────────────────

async function addNegatives(cx: Ctx) {
  if (!(await jobDue(cx, "negatives", 70))) return;
  const db = await getDb();
  for (const camp of cx.campaigns.filter((c) => c.status === "active" && c.channel === "search" && c.externalId && !cx.protected.has(c.id))) {
    try {
      const [acc] = await db.select().from(schema.adAccounts).where(eq(schema.adAccounts.id, camp.accountId));
      const client = await clientFor(acc);
      if (!client.getSearchQueries) continue;
      const rows = await client.getSearchQueries([camp.externalId!], isoDay(addDays(cx.now, -14)), isoDay(cx.now));
      const wasteful = rows.filter((r) => r.clicks > 0).sort((a, b) => b.cost - a.cost);
      const found = await pickNegativeWords(cx.b, wasteful.map((r) => r.query), camp.negativeKeywords ?? []);
      if (!found.length) continue;
      const words = found.map((f) => f.word).slice(0, 25);
      const waste = wasteful.filter((r) => words.some((w) => r.query.toLowerCase().includes(w))).reduce((s, r) => s + r.cost, 0);
      await act(
        { businessId: cx.b.id, actor: "robot", kind: "negatives", title: `Убрали показы по ${pl(words.length, "нецелевому запросу", "нецелевым запросам", "нецелевым запросам")}`, reason: `Посмотрели, что люди искали перед кликом. Часть запросов — не про ваших клиентов: например, «${found[0].example}»${found[1] ? `, «${found[1].example}»` : ""}. ${waste > 0 ? `За 2 недели на такие клики ушло ${rub(waste)}. ` : ""}Добавили минус-слова: ${words.join(", ")}.`, details: { words, examples: found.slice(0, 10) } },
        [{ op: "addNegatives", campaignId: camp.id, words }],
      );
      camp.negativeKeywords = [...new Set([...(camp.negativeKeywords ?? []), ...words])];
      cx.log.push(`Минус-слова: ${words.length}`);
    } catch (e) {
      cx.log.push(`Минус-слова: ${errorText(e)}`);
    }
  }
  await markJob(cx, "negatives", "ok");
}

// ─── 6. Стратегия: клики → заявки ──────────────────────────────────────

async function switchStrategy(cx: Ctx) {
  if (!cx.b.goalIds?.lead) return;
  const since = isoDay(addDays(cx.now, -7));
  for (const camp of cx.campaigns.filter((c) => c.status === "active" && c.platform === "yandex" && c.strategy === "clicks" && !cx.protected.has(c.id))) {
    const s = cx.ads.filter((a) => a.campaignId === camp.id).reduce((acc, a) => add(acc, sumAd(cx, a.id, since)), zero());
    // Директу нужно ~10 конверсий в неделю, чтобы автостратегия по заявкам обучилась
    if (s.conversions < 10) continue;
    await act(
      { businessId: cx.b.id, actor: "robot", kind: "strategy", title: `Переключили «${CHANNEL_NAME[camp.channel]}» на оптимизацию заявок`, reason: `За неделю реклама принесла ${pl(s.conversions, "обращение", "обращения", "обращений")} — этого достаточно, чтобы Яндекс научился находить похожих людей. Раньше он искал тех, кто чаще кликает, теперь — тех, кто чаще записывается. Бюджет не меняется.` },
      [{ op: "campaignStrategy", campaignId: camp.id, strategy: "conversions" }],
    );
    cx.log.push(`Стратегия ${camp.id} → conversions`);
  }
}

// ─── 7. Перераспределение бюджета между каналами ──────────────────────

async function rebalance(cx: Ctx) {
  if (!(await jobDue(cx, "rebalance", 24 * 6.5))) return;
  const since = isoDay(addDays(cx.now, -WINDOW_DAYS));
  const active = cx.campaigns.filter((c) => c.status === "active" && !cx.protected.has(c.id));
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
  const move = Math.min(Math.floor(worst.c.weeklyBudget * 0.25), worst.c.weeklyBudget - minW);
  if (move < 100) {
    await markJob(cx, "rebalance", "минимум");
    return;
  }
  const unit = byConv ? "обращение" : "переход";
  const cost = (r: (typeof rows)[number]) => r.s.cost / Math.max(byConv ? r.s.conversions : r.s.clicks, 1);
  await act(
    { businessId: cx.b.id, actor: "robot", kind: "budget", title: `Перенесли ${rub(move)} в неделю: ${CHANNEL_NAME[worst.c.channel]} → ${CHANNEL_NAME[best.c.channel]}`, reason: `За 2 недели ${unit} в канале «${CHANNEL_NAME[best.c.channel]}» стоит ${rub(cost(best))}, а в «${CHANNEL_NAME[worst.c.channel]}» — ${rub(cost(worst))}. Переносим четверть бюджета туда, где клиенты дешевле. Общий бюджет не меняется.`, details: { from: worst.c.id, to: best.c.id, move } },
    [
      { op: "campaignBudget", campaignId: worst.c.id, weeklyBudget: worst.c.weeklyBudget - move },
      { op: "campaignBudget", campaignId: best.c.id, weeklyBudget: best.c.weeklyBudget + move },
    ],
  );
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
  for (const camp of cx.campaigns.filter((c) => c.channel === "search" && c.status === "active" && c.externalId && !cx.protected.has(c.id))) {
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
          reason: `Объявления держались в среднем на месте «${placeName(tv)}», клик там стоил около ${rub(cpc)}, а обращение — ${rub(cpl)}. В других каналах обращение дешевле — ${rub(othersCpl)}. Третье место над результатами стоит около ${rub(third.price)} за клик: людей увидят чуть меньше, зато за тот же бюджет кликов будет больше. Ставку выше ${rub(value)} Директ теперь не поднимет.`,
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

export async function optimizeBusiness(b: Business) {
  const cx = await load(b);
  if (!cx.campaigns.length) return { log: ["Нет кампаний"] };
  const steps: [string, (c: Ctx) => Promise<void>][] = [
    ["бюджет", budgetGuard],
    ["модерация", handleRejected],
    ["тесты", resolveExperiments],
    ["перенос идей", propagateWinners],
    ["место в выдаче", positionGuard],
    ["объявления", optimizeAds],
    ["картинки", creativeTests],
    ["аудитории", optimizeAudiences],
    ["минус-слова", addNegatives],
    ["стратегия", switchStrategy],
    ["бюджет каналов", rebalance],
  ];
  for (const [name, fn] of steps) {
    try {
      await fn(cx);
    } catch (e) {
      cx.log.push(`Шаг «${name}»: ${errorText(e)}`);
    }
  }
  return { log: cx.log };
}

/** Пересчитать недельные бюджеты при смене месячного бюджета владельцем */
export async function applyMonthlyBudget(b: Business, monthly: number) {
  const db = await getDb();
  const camps = await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, b.id), eq(schema.campaigns.status, "active")));
  const curWeekly = camps.reduce((s, c) => s + c.weeklyBudget, 0);
  const target = weeklyFromMonthly(monthly);
  const k = curWeekly ? target / curWeekly : 1;
  const ops = [
    { op: "monthlyBudget" as const, businessId: b.id, monthlyBudget: monthly },
    ...camps.map((c) => ({ op: "campaignBudget" as const, campaignId: c.id, weeklyBudget: Math.max(MIN_WEEKLY[c.channel as Channel], Math.floor(c.weeklyBudget * k)) })),
  ];
  const up = monthly > b.monthlyBudget;
  return act(
    { businessId: b.id, actor: "owner", kind: "budget", title: `Бюджет изменён: ${rub(b.monthlyBudget)} → ${rub(monthly)} в месяц`, reason: `Вы ${up ? "увеличили" : "уменьшили"} бюджет. Недельные лимиты всех кампаний ${up ? "подняли" : "снизили"} в той же пропорции${camps.length ? ` (всего ≈ ${rub(target)} в неделю)` : ""}.` },
    ops,
  );
}

/** Владелец попросил ещё вариант объявления — запускаем A/B-тест против текущего */
export async function ownerVariant(b: Business, adId: string) {
  const cx = await load(b);
  const ad = cx.ads.find((a) => a.id === adId);
  if (!ad) throw new Error("Объявление не найдено");
  if (cx.experiments.some((e) => e.status === "running" && (e.controlId === ad.id || e.variantId === ad.id))) {
    throw new Error("Для этого объявления уже идёт тест — дождитесь результата");
  }
  const v = await createVariant(cx, ad, "Владелец попросил попробовать другой подход", { experiment: true });
  if (!v) throw new Error("Кампания ещё не создана на площадке");
  await logChange({
    businessId: b.id, actor: "owner", kind: "test_start",
    title: `Запустили A/B-тест для ${adLabel(ad)}`,
    reason: `Вы попросили новый вариант. Проверяем: ${v.draft.hypothesis.replace(/\.$/, "")}. Новое объявление «${v.ad.title}» будет показываться наравне со старым, робот сам выберет лучшее.`,
    details: { experimentId: v.experimentId, controlId: ad.id, variantId: v.ad.id },
    undo: [{ op: "adStatus", adId: v.ad.id, status: "paused" }],
  });
  return v.ad;
}

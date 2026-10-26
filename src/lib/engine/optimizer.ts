import "server-only";
import { and, eq, gte, inArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { Ad, AdGroup, Business, Campaign, Change, Experiment, UndoOp } from "../db/schema";
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
import { firstDays, learningLeft as learningLeftFor, LEARN_LOOKBACK_DAYS } from "./budget-learning";
import { CATCH_UP, CATCH_UP_GAP, cutMeta, daysLeftInMonth, monthDays, monthKey, monthWeekly, planLimits, reserveFor, restoreTarget, spendableWeekly, type BudgetMeta, type Plan, type PlanItem } from "./budget-plan";
import { budgetState, businessNow, liveCampaigns, patchBudgetMeta, pausedForBudget, type BudgetState } from "./budget-guard";
import { addDays, errorText, isoDay, rub, uid, pl, num } from "../util";
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
  return { b, now, campaigns, groups, ads, experiments, statByAd, tvRows, log: [], newAds: 0, protected: prot, ownerStatus, history, firstDay, images, won: [] };
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

async function createVariant(cx: Ctx, base: Ad, reason: string, opts: { experiment?: boolean; angle?: string; owner?: boolean } = {}) {
  const db = await getDb();
  const camp = cx.campaigns.find((c) => c.id === base.campaignId)!;
  const group = cx.groups.find((g) => g.id === base.adGroupId)!;
  if (!camp.externalId || !group.externalId) return null;
  // Робот не пишет объявления в остановленные кампании и аудитории (в т. ч. остановленные защитой бюджета в этом проходе)
  if (!opts.owner && (camp.status !== "active" || group.status !== "active")) return null;
  const peers = cx.ads.filter((a) => a.adGroupId === group.id);
  const tried = [...new Set(peers.map((a) => a.angle))];
  const winner = peers
    .filter((a) => a.status === "active" && a.id !== base.id)
    .map((a) => ({ a, s: sumAd(cx, a.id) }))
    .sort((x, y) => ctr(y.s) - ctr(x.s))[0]?.a;
  const ch = camp.channel as keyof typeof LIMITS;
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
  let resumable = cx.campaigns.filter((c) => pausedForBudget(c) && c.externalId && cx.ownerStatus.get(c.id) !== "paused");
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
    let plan: Plan;
    if (newMonth) {
      // Новый месяц: обычная раскладка бюджета, как при запуске
      plan = planLimits(items, Math.min(target, normalTotal), true);
    } else if (wantSum > cap) {
      // Не помещаемся в остаток — снижаем с запасом 3 %, чтобы не дёргать лимиты каждый день; превышение бюджета не допускаем вовсе
      plan = planLimits(items, Math.floor(cap * 0.97));
      if (plan.dropped.length || plan.short) plan = planLimits(items, cap);
    } else if (wantSum < target * CATCH_UP_GAP) {
      // Площадки тратят меньше лимита, и к концу месяца остался бы неизрасходованный бюджет — поднимаем лимиты под остаток
      // С тем же запасом 3 % до жёсткой границы, что и при снижении, — иначе на следующий день лимиты пришлось бы снова снижать
      plan = planLimits(items, Math.min(Math.floor(cap * 0.97), target), true);
    } else {
      plan = planLimits(items, wantSum);
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
      await dropForBudget(cx, active.filter((c) => plan.dropped.includes(c.id)), keep, st, cap);
      await fitLimits(cx, keep.filter((c) => c.status === "active" || resumable.includes(c)), plan, st, newMonth, normals);
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
  if (mark) await markJob(cx, "budget_month", st.month);
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
async function fitLimits(cx: Ctx, list: Campaign[], plan: Plan, st: BudgetState, newMonth: boolean, normals: Map<string, number>) {
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
  const title = newMonth
    ? "Пересчитали недельные лимиты на новый месяц"
    : !up.length
      ? "Снизили недельные лимиты, чтобы уложиться в бюджет"
      : catchUp
        ? "Подняли недельные лимиты под остаток бюджета"
        : !down.length
          ? "Вернули недельные лимиты"
          : "Пересчитали недельные лимиты под бюджет месяца";
  const days = pl(st.daysLeft, "день", "дня", "дней");
  const why = newMonth
    ? `Начался новый месяц — бюджет ${rub(cx.b.monthlyBudget)} снова доступен целиком. Лимиты рассчитали заново от бюджета месяца с прежними долями каналов и подогнали под число дней в месяце.`
    : !up.length
      ? `С начала месяца потрачено ${rub(st.spent)} из ${rub(cx.b.monthlyBudget)}. При прежних лимитах (${rub(before)} в неделю) к концу месяца вышло бы около ${rub(projected)} — больше бюджета. Новые лимиты рассчитаны так, чтобы остатка ${rub(st.remaining)} точно хватило на ${days}.`
      : catchUp
        ? `Площадки тратят меньше недельного лимита: с начала месяца потрачено ${rub(st.spent)} из ${rub(cx.b.monthlyBudget)}, осталось ${rub(st.remaining)} на ${days}. Чтобы остаток не пропал, подняли лимиты под него — больше бюджета месяца реклама всё равно не потратит.${after > normalSum ? " 1-го числа лимиты вернутся к обычным." : ""}`
        : `Бюджета снова хватает — вернули лимиты, которые робот снижал раньше.`;
  await act(
    { businessId: cx.b.id, actor: "robot", kind: "budget", title, reason: `${why} ${lines}.${learning}`, details: { guard: true, spent: Math.round(st.spent), projected: Math.round(projected) } },
    moves.map((m) => ({ op: "campaignBudget" as const, campaignId: m.c.id, weeklyBudget: m.next })),
  );
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
  for (const ad of cx.ads.filter((a) => a.status === "rejected")) {
    if (cx.newAds >= MAX_NEW_ADS_PER_RUN) return;
    if (cx.protected.has(ad.id)) continue; // владелец сам правил или возвращал это объявление
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
    if (control.status !== "active" && control.status !== "moderation") continue;
    if (variant.status === "rejected" || variant.status === "archived") {
      await endExperiment(cx, ex, "draw", "Новый вариант не прошёл модерацию");
      continue;
    }
    // Сравниваем только с момента, когда вариант начал показываться
    const varRows = (cx.statByAd.get(variant.id) ?? []).filter((r) => r.s.impressions > 0).map((r) => r.day).sort();
    if (!varRows.length) {
      // Вариант так и не показался — тест не должен висеть вечно и блокировать новые тесты в группе
      if ((cx.now.getTime() - ex.startedAt.getTime()) / 864e5 >= MAX_TEST_DAYS) await endExperiment(cx, ex, "draw", `За ${MAX_TEST_DAYS} дней новый вариант так и не начал показываться.`);
      continue;
    }
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
      { businessId: cx.b.id, actor: "robot", kind: "test_end", title: `Тест завершён: ${status === "won" ? "новый вариант лучше" : status === "lost" ? "старый вариант лучше" : "ничья"}`, reason: `Проверяли: ${hyp}. ${result} ${loser.title === winner.title && ex.kind === "creative" ? `Отключили вариант с ${loser.id === ex.variantId ? "новой" : "прежней"} картинкой, работает вариант с ${winner.id === ex.variantId ? "новой" : "прежней"}.` : `Отключили ${adLabel(loser)}, работает ${adLabel(winner)}.`}`, details: { experimentId: ex.id, p, control: sc, variant: sv } },
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
      if (r.a.id === best.a.id || inTest(cx, r.a.id) || cx.protected.has(r.a.id)) continue;
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
        const ex: Experiment = { id: experimentId, businessId: cx.b.id, campaignId: camp.id, kind: "creative", hypothesis, controlId: best.a.id, variantId: ad.id, status: "running", result: null, startedAt: cx.now, finishedAt: null };
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
  const active = skipLearning(cx, cx.campaigns.filter((c) => c.status === "active" && !cx.protected.has(c.id)), "бюджет");
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
  const ownerPaused = camps.filter((c) => c.status === "paused" && !pausedForBudget(c));
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

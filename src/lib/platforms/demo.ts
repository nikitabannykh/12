import "server-only";
import { and, eq } from "drizzle-orm";
import { createHash } from "crypto";
import type { AuctionRow, AdSpec, AdState, CampaignSpec, Channel, LaunchHooks, LaunchResult, PlatformClient, QueryRow, StatRow, Strategy } from "./types";
import { getDb, schema } from "../db";
import { addDays, isoDay, uid } from "../util";

/**
 * Демо-площадка: ведёт себя как рекламный кабинет, но показы, клики и заявки моделируются.
 * Нужна, чтобы посмотреть сервис целиком без настоящего кабинета и денег.
 * «Время» демо можно промотать вперёд — так видно, как робот принимает решения по накопленным данным.
 */
type Interval = { from: string; to: string | null };
type DemoAd = { campaign: string; group: string; title: string; text: string; quality: number; intervals: Interval[]; status: AdState["status"]; note?: string; created: string };
type DemoCampaign = { channel: Channel; budgets: { from: string; weekly: number }[]; intervals: Interval[]; negatives: string[]; created: string; ceilings?: { from: string; value: number | null }[] };

/**
 * Модель аукциона на поиске: чем выше место, тем дороже клик и тем чаще кликают.
 * tv — объём трафика (как в Директе), m — множитель цены клика, ctr — доля кликабельности от первого места.
 */
const TIERS = [
  { tv: 100, m: 2.3, ctr: 1, pos: 1 },
  { tv: 85, m: 1.6, ctr: 0.78, pos: 2 },
  { tv: 75, m: 1.2, ctr: 0.62, pos: 3 },
  { tv: 65, m: 1, ctr: 0.5, pos: 4 },
  { tv: 15, m: 0.55, ctr: 0.18, pos: 5 },
  { tv: 5, m: 0.4, ctr: 0.1, pos: 6 },
];
const groupComp = (group: string) => 0.8 + rng("comp" + group)() * 0.5;
const tierPrice = (group: string, m: number) => Math.round(22 * m * groupComp(group));
type State = { campaigns: Record<string, DemoCampaign>; ads: Record<string, DemoAd>; seq: number };

const KEY = (accountId: string) => `demo:${accountId}`;
/** Старые общие часы демо — остаются только как запасной вариант, когда кабинет определить нельзя */
export const DEMO_CLOCK = "demo:clock";
const CLOCK_KEY = (accountId: string) => `demo:clock:${accountId}`;
/** Дальше этого демо-время не мотаем: статистика за 30 дней и месяц бюджета должны оставаться осмысленными */
export const DEMO_MAX_SHIFT_DAYS = 180;

export type DemoScope = { businessId?: string; accountId?: string };

/** Детерминированный генератор (mulberry32): одинаковые данные при каждой синхронизации */
function rng(seed: string) {
  let a = createHash("sha256").update(seed).digest().readUInt32BE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Демо-кабинет бизнеса: по его кампаниям, а если их ещё нет — по кабинетам владельца */
async function demoAccountOf(scope?: DemoScope): Promise<string | null> {
  if (scope?.accountId) return scope.accountId;
  if (!scope?.businessId) return null;
  const db = await getDb();
  const [c] = await db
    .select({ accountId: schema.campaigns.accountId })
    .from(schema.campaigns)
    .where(and(eq(schema.campaigns.businessId, scope.businessId), eq(schema.campaigns.platform, "demo")))
    .limit(1);
  if (c) return c.accountId;
  const [b] = await db.select({ userId: schema.businesses.userId }).from(schema.businesses).where(eq(schema.businesses.id, scope.businessId));
  if (!b) return null;
  const [a] = await db
    .select({ id: schema.adAccounts.id })
    .from(schema.adAccounts)
    .where(and(eq(schema.adAccounts.userId, b.userId), eq(schema.adAccounts.platform, "demo")))
    .limit(1);
  return a?.id ?? null;
}

async function readOffset(key: string): Promise<number | null> {
  const db = await getDb();
  const [row] = await db.select().from(schema.kv).where(eq(schema.kv.key, key));
  if (!row) return null;
  const n = Number((row.value as any)?.offsetDays ?? 0);
  return Number.isFinite(n) ? n : 0;
}

async function offsetFor(accountId: string | null): Promise<number> {
  if (!accountId) return (await readOffset(DEMO_CLOCK)) ?? 0;
  const own = await readOffset(CLOCK_KEY(accountId));
  if (own !== null) return own;
  // Переход со старых общих часов: кабинет, чьи кампании уже «живут» в будущем, продолжает с общего смещения,
  // иначе его статистика пропала бы. Новые кабинеты стартуют с реального «сегодня».
  const db = await getDb();
  const [st] = await db.select().from(schema.kv).where(eq(schema.kv.key, KEY(accountId)));
  const created = Object.values(((st?.value as State | undefined)?.campaigns ?? {})).map((c) => c.created);
  // Демо-кампании «стартуют» за 12 дней до запуска: дата позже реального «сегодня − 12» значит, что их создали по сдвинутым часам
  const realLaunchFloor = isoDay(addDays(new Date(), -12));
  if (created.some((d) => d > realLaunchFloor)) return Math.min(DEMO_MAX_SHIFT_DAYS, (await readOffset(DEMO_CLOCK)) ?? 0);
  return 0;
}

/**
 * «Сейчас» демо-кабинета. У каждого демо-кабинета свои часы (kv `demo:clock:<accountId>`),
 * чтобы перемотка у одного посетителя не сдвигала время другим. Без scope — старые общие часы.
 */
export async function demoNow(scope?: DemoScope): Promise<Date> {
  const accountId = await demoAccountOf(scope);
  return addDays(new Date(), await offsetFor(accountId));
}

/** Промотать демо-время кабинета вперёд. Возвращает итоговое смещение в днях (не больше DEMO_MAX_SHIFT_DAYS). */
export async function shiftDemoClock(days: number, scope?: DemoScope) {
  const db = await getDb();
  const accountId = await demoAccountOf(scope);
  const key = accountId ? CLOCK_KEY(accountId) : DEMO_CLOCK;
  const offset = Math.max(0, Math.min(DEMO_MAX_SHIFT_DAYS, (await offsetFor(accountId)) + days));
  await db
    .insert(schema.kv)
    .values({ key, value: { offsetDays: offset } })
    .onConflictDoUpdate({ target: schema.kv.key, set: { value: { offsetDays: offset }, updatedAt: new Date() } });
  return offset;
}

const BAD_WORDS = ["бесплатно", "вакансии", "обучение", "своими руками", "курсы", "работа", "дома самой", "как сделать", "отзывы сотрудников", "игра"];

export class DemoPlatform implements PlatformClient {
  platform = "demo" as const;
  constructor(private accountId: string) {}

  /** Часы этого демо-кабинета */
  private now() {
    return demoNow({ accountId: this.accountId });
  }

  private async load(): Promise<State> {
    const db = await getDb();
    const [row] = await db.select().from(schema.kv).where(eq(schema.kv.key, KEY(this.accountId)));
    return (row?.value as State) ?? { campaigns: {}, ads: {}, seq: 1000 };
  }
  private async save(s: State) {
    const db = await getDb();
    const [row] = await db.select({ key: schema.kv.key }).from(schema.kv).where(eq(schema.kv.key, KEY(this.accountId)));
    if (row) await db.update(schema.kv).set({ value: s, updatedAt: new Date() }).where(eq(schema.kv.key, KEY(this.accountId)));
    else await db.insert(schema.kv).values({ key: KEY(this.accountId), value: s });
  }
  private id(s: State) {
    s.seq += 1;
    return String(7_000_000 + s.seq);
  }

  private setActive(intervals: Interval[], active: boolean, day: string) {
    const open = intervals.find((i) => i.to === null);
    if (active && !open) intervals.push({ from: day, to: null });
    if (!active && open) open.to = day;
  }

  private newAd(s: State, campaign: string, group: string, ad: AdSpec, day: string, quality?: number) {
    const id = this.id(s);
    const r = rng(ad.title + ad.text + ad.localId);
    const q = quality ?? 0.55 + r() * 1.05;
    // ~7% объявлений модерация отклоняет — так видно, как робот их переписывает
    const rejected = r() < 0.07;
    s.ads[id] = {
      campaign, group, title: ad.title, text: ad.text, quality: q, created: day,
      intervals: rejected ? [] : [{ from: day, to: null }],
      status: rejected ? "rejected" : "active",
      note: rejected ? "в тексте есть утверждение, которое нельзя проверить" : undefined,
    };
    return id;
  }

  async launchCampaign(spec: CampaignSpec, hooks?: LaunchHooks): Promise<LaunchResult> {
    // Закрепляем часы кабинета (до первой перемотки ключа ещё нет)
    await shiftDemoClock(0, { accountId: this.accountId });
    const s = await this.load();
    const now = await this.now();
    // Демо-кампании «стартуют» 12 дней назад, чтобы сразу была статистика
    const day = isoDay(addDays(now, -12));
    const campaignExt = this.id(s);
    await hooks?.onCampaignCreated?.(campaignExt);
    s.campaigns[campaignExt] = { channel: spec.channel, budgets: [{ from: day, weekly: spec.weeklyBudget }], intervals: [{ from: day, to: null }], negatives: [...spec.negativeKeywords], created: day };
    const out: LaunchResult = { campaignExt, groups: [], warnings: [] };
    for (const g of spec.groups) {
      const groupExt = this.id(s);
      out.groups.push({
        localId: g.localId,
        groupExt,
        ads: g.ads.map((a) => ({ localId: a.localId, adExt: this.newAd(s, campaignExt, groupExt, a, day) })),
      });
    }
    await this.save(s);
    return out;
  }

  async removeCampaign(campaignExt: string) {
    const s = await this.load();
    delete s.campaigns[campaignExt];
    for (const [id, a] of Object.entries(s.ads)) if (a.campaign === campaignExt) delete s.ads[id];
    await this.save(s);
  }

  async addAd(campaignExt: string, groupExt: string, ad: AdSpec) {
    const s = await this.load();
    const day = isoDay(await this.now());
    // Новые варианты робот пишет с учётом статистики — в среднем они чуть сильнее
    const peers = Object.values(s.ads).filter((a) => a.group === groupExt);
    const avg = peers.length ? peers.reduce((x, a) => x + a.quality, 0) / peers.length : 1;
    const r = rng(ad.localId + ad.title);
    const adExt = this.newAd(s, campaignExt, groupExt, ad, day, avg * (0.85 + r() * 0.55));
    await this.save(s);
    return { adExt };
  }

  async setCampaignActive(campaignExt: string, active: boolean) {
    const s = await this.load();
    const c = s.campaigns[campaignExt];
    if (c) this.setActive(c.intervals, active, isoDay(await this.now()));
    await this.save(s);
  }

  async setAdsActive(adExts: string[], active: boolean) {
    const s = await this.load();
    const day = isoDay(await this.now());
    for (const id of adExts) {
      const a = s.ads[id];
      if (!a || a.status === "rejected" || a.status === "archived") continue;
      this.setActive(a.intervals, active, day);
      a.status = active ? "active" : "paused";
    }
    await this.save(s);
  }

  async setBudget(campaignExt: string, p: { weeklyBudget: number; strategy: Strategy; bidCeiling?: number | null }) {
    const s = await this.load();
    const c = s.campaigns[campaignExt];
    const day = isoDay(await this.now());
    if (c) {
      c.budgets.push({ from: day, weekly: p.weeklyBudget });
      if (p.bidCeiling !== undefined) (c.ceilings ??= []).push({ from: day, value: p.bidCeiling });
    }
    await this.save(s);
  }

  async setNegativeKeywords(campaignExt: string, words: string[]) {
    const s = await this.load();
    const c = s.campaigns[campaignExt];
    if (c) c.negatives = words;
    await this.save(s);
  }

  async updateAdText(adExt: string, t: { title: string; text: string }) {
    const s = await this.load();
    const a = s.ads[adExt];
    if (a) {
      a.title = t.title;
      a.text = t.text;
      if (a.status === "rejected") {
        a.status = "active";
        a.note = undefined;
        this.setActive(a.intervals, true, isoDay(await this.now()));
      }
    }
    await this.save(s);
  }

  async getAdStates(adExts: string[]) {
    const s = await this.load();
    const out: Record<string, AdState> = {};
    for (const id of adExts) {
      const a = s.ads[id];
      if (a) out[id] = { status: a.status, note: a.note };
    }
    return out;
  }

  async getStats(campaignExts: string[], from: string, to: string): Promise<StatRow[]> {
    const s = await this.load();
    const now = isoDay(await this.now());
    const end = to < now ? to : now;
    const out: StatRow[] = [];
    const activeOn = (iv: Interval[], d: string) => iv.some((i) => i.from <= d && (i.to === null || d < i.to));
    for (const cExt of campaignExts) {
      const c = s.campaigns[cExt];
      if (!c) continue;
      const ads = Object.entries(s.ads).filter(([, a]) => a.campaign === cExt);
      for (let d = new Date(from + "T00:00:00Z"); isoDay(d) <= end; d = addDays(d, 1)) {
        const day = isoDay(d);
        if (!activeOn(c.intervals, day)) continue;
        const live = ads.filter(([, a]) => activeOn(a.intervals, day));
        if (!live.length) continue;
        const weekly = [...c.budgets].reverse().find((b) => b.from <= day)?.weekly ?? 0;
        const r0 = rng(cExt + day);
        const dayBudget = (weekly / 7) * (0.78 + r0() * 0.2) * (new Date(day).getUTCDay() % 6 === 0 ? 0.85 : 1);
        const weights = live.map(([, a]) => Math.sqrt(a.quality));
        const wsum = weights.reduce((x, y) => x + y, 0);
        const negBoost = 1 + Math.min(0.25, c.negatives.length * 0.012);
        const ceiling = [...(c.ceilings ?? [])].reverse().find((x) => x.from <= day)?.value ?? null;
        live.forEach(([id, a], i) => {
          const r = rng(id + day);
          const spend = (dayBudget * weights[i]) / wsum;
          if (c.channel === "search") {
            // Автостратегия без потолка лезет наверх; с потолком — на самое высокое место, которое по карману
            const natural = a.quality > 1.15 ? 0 : a.quality > 0.85 ? 1 : 2;
            let ti = natural;
            if (ceiling) {
              ti = TIERS.findIndex((t, k) => k >= natural && tierPrice(a.group, t.m) / Math.sqrt(a.quality) <= ceiling);
              if (ti < 0) ti = TIERS.length - 1;
            }
            const t = TIERS[ti];
            const cpc = (tierPrice(a.group, t.m) / Math.sqrt(a.quality)) * (0.88 + r() * 0.24);
            const ctr = 0.075 * a.quality * t.ctr * (0.85 + r() * 0.3);
            const supply = 260 * groupComp(a.group) * (0.85 + r() * 0.3); // сколько раз за день ищут услугу
            const clicks = Math.max(0, Math.min(Math.round(spend / cpc), Math.round(supply * ctr)));
            const impressions = Math.round(clicks / Math.max(ctr, 0.0005)) + Math.round(r() * 15);
            const cr = 0.06 * a.quality * negBoost;
            let conversions = 0;
            for (let k = 0; k < clicks; k++) if (r() < cr) conversions++;
            const tv = Math.max(1, Math.min(100, t.tv + Math.round((r() - 0.5) * 8)));
            out.push({ campaignExt: cExt, adExt: id, day, impressions, clicks, cost: Math.round(clicks * cpc * 100) / 100, conversions, trafficVolume: tv, position: t.pos + Math.round((r() - 0.5) * 40) / 100 });
            return;
          }
          const baseCpc = c.channel === "network" ? 13 : 17;
          const cpc = baseCpc * (0.85 + r() * 0.3) / Math.sqrt(a.quality);
          const clicks = Math.max(0, Math.round(spend / cpc));
          const ctr = (c.channel === "network" ? 0.006 : 0.009) * a.quality * (0.85 + r() * 0.3);
          const impressions = Math.round(clicks / Math.max(ctr, 0.0005)) + Math.round(r() * 20);
          const cr = 0.022 * a.quality * negBoost;
          let conversions = 0;
          for (let k = 0; k < clicks; k++) if (r() < cr) conversions++;
          out.push({ campaignExt: cExt, adExt: id, day, impressions, clicks, cost: Math.round(clicks * cpc * 100) / 100, conversions });
        });
      }
    }
    return out;
  }

  async getAuction(campaignExt: string): Promise<AuctionRow[]> {
    const s = await this.load();
    const groups = [...new Set(Object.values(s.ads).filter((a) => a.campaign === campaignExt).map((a) => a.group))];
    return groups.map((g) => ({
      groupExt: g,
      keywords: 8,
      tiers: TIERS.map((t) => ({ trafficVolume: t.tv, price: tierPrice(g, t.m), bid: Math.round(tierPrice(g, t.m) * 1.18) })),
    }));
  }

  async getSearchQueries(campaignExts: string[]): Promise<QueryRow[]> {
    const s = await this.load();
    const out: QueryRow[] = [];
    for (const cExt of campaignExts) {
      const c = s.campaigns[cExt];
      if (!c || c.channel !== "search") continue;
      const ads = Object.values(s.ads).filter((a) => a.campaign === cExt);
      const topic = (ads[0]?.title ?? "услуга").toLowerCase().split(/\s+/).slice(0, 2).join(" ");
      for (const w of BAD_WORDS) {
        if (c.negatives.includes(w)) continue;
        const r = rng(cExt + w);
        out.push({ campaignExt: cExt, query: `${topic} ${w}`, impressions: 40 + Math.round(r() * 90), clicks: 2 + Math.round(r() * 5), cost: 60 + Math.round(r() * 150) });
      }
      out.push({ campaignExt: cExt, query: `${topic} рядом`, impressions: 300, clicks: 22, cost: 790 });
    }
    return out;
  }
}

export const demoLogin = () => `demo-${uid().slice(0, 5)}`;

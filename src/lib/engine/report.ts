import "server-only";
import { and, desc, eq, gte, isNull, lte, ne, or } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { Business, Campaign } from "../db/schema";
import { demoNow } from "../platforms/demo";
import { addDays, isoDay, startOfWeek } from "../util";
import { firstDays, learningLeft as learningLeftFor, LEARN_LOOKBACK_DAYS, LEARNING_DAYS } from "./budget-learning";
import { pausedForBudget } from "./budget-guard";

/**
 * Цифры для владельца. Правила, общие для «Главного», «Статистики» и «Рекламы»:
 *  - «Обращения из рекламы» — то, что засчитала площадка (включая заявки с нашего счётчика с меткой объявления),
 *    плюс заявки с меткой рекламы, которых нет в статистике площадки. Каждая заявка считается один раз.
 *  - «Другие обращения» — заявки без рекламной метки (зашли на страницу записи напрямую, из поиска, от знакомых).
 *    В стоимость клиента они не входят.
 *  - Клиенты: владелец отмечает число клиентов за календарную неделю (по всем обращениям недели).
 *    Для любого периода берём долю недели: обращения периода × (клиенты недели / обращения недели).
 *    Неделя без отметки — по статусам заявок: «Записался» — клиент, «Не дозвонились» — не клиент,
 *    неотмеченные (и обращения, которые засчитала площадка без нашей заявки) — по обычной доле «обращение → клиент».
 *    Если ни одной отметки нет — это оценка.
 *  - Заявки со статусом «Спам» не считаются нигде (ни обращениями, ни в решениях робота).
 */

export type Totals = {
  impressions: number;
  clicks: number;
  cost: number;
  /** обращения из рекламы */
  leads: number;
  /** клиенты из рекламы — на них считается стоимость клиента */
  clients: number;
  clientsEstimated: boolean;
  /** обращения без рекламной метки */
  otherLeads: number;
  otherClients: number;
  /** заявки из рекламы, которые владелец отметил: всего и «Записался» */
  adMarked: number;
  adBooked: number;
};

export type DayPoint = { day: string; cost: number; leads: number; clicks: number; other: number };

const AD_SOURCES = new Set(["yandex", "vk", "demo"]);
const CHANNEL_ORDER = ["search", "network", "vk", "unknown"];

const zero = (): Totals => ({ impressions: 0, clicks: 0, cost: 0, leads: 0, clients: 0, clientsEstimated: false, otherLeads: 0, otherClients: 0, adMarked: 0, adBooked: 0 });

export async function reportNow(b: Business) {
  const db = await getDb();
  const camps = await db.select({ platform: schema.campaigns.platform }).from(schema.campaigns).where(eq(schema.campaigns.businessId, b.id));
  return camps.some((c) => c.platform === "demo") ? demoNow({ businessId: b.id }) : new Date();
}

type ChAgg = { impressions: number; clicks: number; cost: number; leads: number; booked: number; done: number };
type DayAgg = {
  impressions: number; clicks: number; cost: number;
  adLeads: number; otherLeads: number;
  /** отмеченные владельцем заявки: done — «Записался» или «Не дозвонились», booked — «Записался» */
  adBooked: number; adDone: number; otherBooked: number; otherDone: number;
  byChannel: Map<string, ChAgg>;
};

/**
 * Сдвиг демо-часов бизнеса относительно реального времени, мс (0 — не демо). Заявки сохраняются по реальному времени,
 * а статистика демо — по демо-часам: чтобы заявка, оставленная сейчас, попала в «сегодня» демо, сдвигаем её на столько же.
 */
async function leadShiftMs(b: Business) {
  const now = await reportNow(b);
  const shift = now.getTime() - Date.now();
  return Math.abs(shift) < 3600e3 ? 0 : Math.round(shift / 864e5) * 864e5;
}

/** Все расходы и обращения по дням с разбивкой «реклама / другие» и по каналам. Каждая заявка — один раз. */
async function loadDays(b: Business, fromDay: string, toDay: string) {
  const db = await getDb();
  const shift = await leadShiftMs(b);
  const camps = await db.select().from(schema.campaigns).where(eq(schema.campaigns.businessId, b.id));
  const ads = await db.select({ id: schema.ads.id, campaignId: schema.ads.campaignId, externalId: schema.ads.externalId }).from(schema.ads).where(eq(schema.ads.businessId, b.id));
  const rows = await db.select().from(schema.statsDaily).where(and(eq(schema.statsDaily.businessId, b.id), gte(schema.statsDaily.day, fromDay), lte(schema.statsDaily.day, toDay)));
  const leads = await db
    .select({ createdAt: schema.leads.createdAt, source: schema.leads.source, adExt: schema.leads.adExt, campaignExt: schema.leads.campaignExt, status: schema.leads.status })
    .from(schema.leads)
    .where(and(eq(schema.leads.businessId, b.id), ne(schema.leads.kind, "suspect"), or(isNull(schema.leads.status), ne(schema.leads.status, "spam")), gte(schema.leads.createdAt, new Date(new Date(fromDay + "T00:00:00Z").getTime() - shift)), lte(schema.leads.createdAt, new Date(new Date(toDay + "T23:59:59.999Z").getTime() - shift))));

  const campById = new Map(camps.map((c) => [c.id, c]));
  const campByExt = new Map(camps.filter((c) => c.externalId).map((c) => [c.externalId!, c]));
  const adByExt = new Map(ads.filter((a) => a.externalId).map((a) => [a.externalId!, a]));
  const days = new Map<string, DayAgg>();
  const dayOf = (d: string) => {
    let x = days.get(d);
    if (!x) days.set(d, (x = { impressions: 0, clicks: 0, cost: 0, adLeads: 0, otherLeads: 0, adBooked: 0, adDone: 0, otherBooked: 0, otherDone: 0, byChannel: new Map() }));
    return x;
  };
  const chOf = (x: DayAgg, ch: string) => {
    let c = x.byChannel.get(ch);
    if (!c) x.byChannel.set(ch, (c = { impressions: 0, clicks: 0, cost: 0, leads: 0, booked: 0, done: 0 }));
    return c;
  };

  const statKeys = new Set<string>();
  for (const r of rows) {
    const day = String(r.day);
    const x = dayOf(day);
    x.impressions += r.impressions;
    x.clicks += r.clicks;
    x.cost += r.cost;
    x.adLeads += r.conversions;
    const c = chOf(x, campById.get(r.campaignId)?.channel ?? "unknown");
    c.impressions += r.impressions;
    c.clicks += r.clicks;
    c.cost += r.cost;
    c.leads += r.conversions;
    if (r.adId) statKeys.add(`${r.adId}|${day}`);
  }

  for (const l of leads) {
    const day = isoDay(new Date(l.createdAt.getTime() + shift));
    const x = dayOf(day);
    const ad = l.adExt ? adByExt.get(l.adExt) : undefined;
    const camp: Campaign | undefined = (ad ? campById.get(ad.campaignId) : undefined) ?? (l.campaignExt ? campByExt.get(l.campaignExt) : undefined);
    const fromAds = !!(ad || camp || l.adExt || l.campaignExt || (l.source && AD_SOURCES.has(l.source)));
    const booked = l.status === "booked" ? 1 : 0;
    const done = booked || l.status === "no_answer" ? 1 : 0;
    if (!fromAds) {
      x.otherLeads += 1;
      x.otherBooked += booked;
      x.otherDone += done;
      continue;
    }
    const ch = chOf(x, camp?.channel ?? (l.source === "vk" ? "vk" : "unknown"));
    x.adBooked += booked;
    x.adDone += done;
    ch.booked += booked;
    ch.done += done;
    // Уже вошла в статистику площадки (sync подмешивает такие заявки в conversions объявления за день) — второй раз не считаем
    if (ad && statKeys.has(`${ad.id}|${day}`)) continue;
    x.adLeads += 1;
    ch.leads += 1;
  }
  return { days, camps };
}

/** Доля «обращение → клиент» для каждой недели: по отметке владельца или оценка */
async function weekRates(b: Business, days: Map<string, DayAgg>) {
  const db = await getDb();
  const marks = await db.select().from(schema.clientMarks).where(eq(schema.clientMarks.businessId, b.id));
  const rate = b.leadToClientRate || 0.5;
  const weekLeads = new Map<string, number>();
  for (const [day, x] of days) {
    const wk = isoDay(startOfWeek(new Date(day + "T00:00:00Z")));
    weekLeads.set(wk, (weekLeads.get(wk) ?? 0) + x.adLeads + x.otherLeads);
  }
  const markOf = new Map(marks.map((m) => [String(m.weekStart), m.clients]));
  const k = (day: string): { k: number; marked: boolean; orphan: number } => {
    const wk = isoDay(startOfWeek(new Date(day + "T00:00:00Z")));
    const m = markOf.get(wk);
    if (m == null) return { k: rate, marked: false, orphan: 0 };
    const all = weekLeads.get(wk) ?? 0;
    // Отмечены клиенты, а обращений за неделю мы не видели — распределяем их по дням недели как «другие»
    return all ? { k: m / all, marked: true, orphan: 0 } : { k: 0, marked: true, orphan: m / 7 };
  };
  return { rate, k, markOf };
}

export async function report(b: Business, days: number) {
  const now = await reportNow(b);
  const to = isoDay(now);
  const from = isoDay(addDays(now, -(days - 1)));
  const prevFrom = isoDay(addDays(now, -(2 * days - 1)));
  // Грузим целые недели: доля клиентов недели считается по всем её обращениям
  const loadFrom = isoDay(startOfWeek(new Date(prevFrom + "T00:00:00Z")));
  const loadTo = isoDay(addDays(startOfWeek(now), 6));
  const { days: agg } = await loadDays(b, loadFrom, loadTo);
  const { rate, k } = await weekRates(b, agg);

  const series: DayPoint[] = [];
  for (let d = new Date(from + "T00:00:00Z"); isoDay(d) <= to; d = addDays(d, 1)) series.push({ day: isoDay(d), cost: 0, leads: 0, clicks: 0, other: 0 });
  const seriesOf = new Map(series.map((s) => [s.day, s]));

  const cur = zero(), prev = zero();
  const byChannel = new Map<string, Totals>();
  const curRaw = { clients: 0, other: 0 }, prevRaw = { clients: 0, other: 0 };
  const chRaw = new Map<string, number>();

  for (let d = new Date(prevFrom + "T00:00:00Z"); isoDay(d) <= to; d = addDays(d, 1)) {
    const day = isoDay(d);
    const isCur = day >= from;
    const t = isCur ? cur : prev;
    const raw = isCur ? curRaw : prevRaw;
    const w = k(day);
    raw.other += w.orphan;
    const x = agg.get(day);
    if (!x) continue;
    t.impressions += x.impressions;
    t.clicks += x.clicks;
    t.cost += x.cost;
    t.leads += x.adLeads;
    t.otherLeads += x.otherLeads;
    t.adMarked += x.adDone;
    t.adBooked += x.adBooked;
    if (w.marked) {
      // Неделя с отметкой «сколько клиентов» — доля недели, как раньше
      raw.clients += x.adLeads * w.k;
      raw.other += x.otherLeads * w.k;
    } else {
      // По статусам заявок: «Записался» — клиент, «Не дозвонились» — нет, остальное — по обычной доле
      const adOpen = Math.max(0, x.adLeads - x.adDone), otherOpen = Math.max(0, x.otherLeads - x.otherDone);
      raw.clients += Math.min(x.adLeads, x.adBooked) + adOpen * w.k;
      raw.other += Math.min(x.otherLeads, x.otherBooked) + otherOpen * w.k;
      if (adOpen || otherOpen) t.clientsEstimated = true;
    }
    if (!isCur) continue;
    const s = seriesOf.get(day);
    if (s) {
      s.cost += x.cost;
      s.leads += x.adLeads;
      s.clicks += x.clicks;
      s.other += x.otherLeads;
    }
    for (const [ch, v] of x.byChannel) {
      const bc = byChannel.get(ch) ?? zero();
      bc.impressions += v.impressions;
      bc.clicks += v.clicks;
      bc.cost += v.cost;
      bc.leads += v.leads;
      bc.adMarked += v.done;
      bc.adBooked += v.booked;
      const open = Math.max(0, v.leads - v.done);
      if (open && !w.marked) bc.clientsEstimated = true;
      byChannel.set(ch, bc);
      chRaw.set(ch, (chRaw.get(ch) ?? 0) + (w.marked ? v.leads * w.k : Math.min(v.leads, v.booked) + open * w.k));
    }
  }
  cur.clients = Math.round(curRaw.clients);
  cur.otherClients = Math.round(curRaw.other);
  prev.clients = Math.round(prevRaw.clients);
  prev.otherClients = Math.round(prevRaw.other);
  // Клиенты по каналам — целые и в сумме ровно итог (метод наибольшего остатка)
  const parts = [...byChannel.keys()].map((ch) => ({ ch, v: chRaw.get(ch) ?? 0 }));
  const base = parts.map((p) => ({ ...p, n: Math.floor(p.v), rest: p.v - Math.floor(p.v) }));
  let left = cur.clients - base.reduce((s, p) => s + p.n, 0);
  for (const p of [...base].sort((a, b) => b.rest - a.rest)) {
    if (left <= 0) break;
    p.n += 1;
    left -= 1;
  }
  for (const p of base) byChannel.get(p.ch)!.clients = p.n;
  const channels = [...byChannel.entries()].sort((a, b) => CHANNEL_ORDER.indexOf(a[0]) - CHANNEL_ORDER.indexOf(b[0]));

  return { from, to, now, cur, prev, byChannel: Object.fromEntries(channels), series, rate };
}

/** Статистика по объявлениям за период */
export async function adStats(businessId: string, from: string) {
  const db = await getDb();
  const rows = await db.select().from(schema.statsDaily).where(and(eq(schema.statsDaily.businessId, businessId), gte(schema.statsDaily.day, from)));
  const map = new Map<string, { impressions: number; clicks: number; cost: number; conversions: number; tvWeighted: number; tvImpressions: number }>();
  for (const r of rows) {
    if (!r.adId) continue;
    const s = map.get(r.adId) ?? { impressions: 0, clicks: 0, cost: 0, conversions: 0, tvWeighted: 0, tvImpressions: 0 };
    if (r.tvWeighted > 0) {
      s.tvWeighted += r.tvWeighted;
      s.tvImpressions += r.impressions;
    }
    s.impressions += r.impressions;
    s.clicks += r.clicks;
    s.cost += r.cost;
    s.conversions += r.conversions;
    map.set(r.adId, s);
  }
  return map;
}

export type WeekMark = { weekStart: string; leads: number; adLeads: number; otherLeads: number; clients: number | null };

/** Недели для отметки клиентов: только с начала рекламы, новые сверху */
export async function weeksForMarking(b: Business, n = 4): Promise<WeekMark[]> {
  const now = await reportNow(b);
  const first = startOfWeek(addDays(now, -7 * (n - 1)));
  const { days } = await loadDays(b, isoDay(first), isoDay(addDays(startOfWeek(now), 6)));
  const { markOf } = await weekRates(b, days);
  const active = [...days.entries()].filter(([, x]) => x.cost > 0 || x.impressions > 0 || x.adLeads || x.otherLeads).map(([d]) => d).sort();
  const firstDay = active[0];
  const weeks: WeekMark[] = [];
  for (let i = 0; i < n; i++) {
    const ws = startOfWeek(addDays(now, -7 * i));
    const wsIso = isoDay(ws), weIso = isoDay(addDays(ws, 7));
    // Недели до запуска не показываем
    if (i > 0 && (!firstDay || firstDay >= weIso)) continue;
    let adLeads = 0, otherLeads = 0;
    for (const [d, x] of days) if (d >= wsIso && d < weIso) { adLeads += x.adLeads; otherLeads += x.otherLeads; }
    weeks.push({ weekStart: wsIso, leads: adLeads + otherLeads, adLeads, otherLeads, clients: markOf.get(wsIso) ?? null });
  }
  return weeks;
}

/** Обучение площадки: после запуска или крупной перемены алгоритм заново подбирает аудиторию */
export { LEARNING_DAYS };
const PAUSE_KINDS = new Set(["pause", "resume", "revert"]);

export type CampaignState = {
  /** почему стоит (null — идёт) */
  stopped: null | "guard" | "owner" | "robot" | "error";
  stoppedAt?: Date;
  note?: string | null;
  /** пауза пришла вместе с другим изменением (например, со снижением бюджета) — его заголовок */
  via?: string | null;
  /** сколько дней ещё обучается (0 — не обучается) */
  learningLeft: number;
};

export async function campaignStates(b: Business, camps: Campaign[], now: Date): Promise<Map<string, CampaignState>> {
  const db = await getDb();
  const since = addDays(now, -LEARN_LOOKBACK_DAYS);
  const changes = await db.select().from(schema.changes).where(and(eq(schema.changes.businessId, b.id), gte(schema.changes.at, since))).orderBy(desc(schema.changes.at));
  // Обучение — по тому же правилу и тем же данным, что у робота (budget-learning.ts)
  const statRows = camps.length
    ? await db.select({ campaignId: schema.statsDaily.campaignId, day: schema.statsDaily.day, impressions: schema.statsDaily.impressions }).from(schema.statsDaily)
        .where(and(eq(schema.statsDaily.businessId, b.id), gte(schema.statsDaily.day, isoDay(since))))
    : [];
  const learnInput = { now, history: changes, firstDay: firstDays(statRows.map((r) => ({ ...r, day: String(r.day) }))) };
  const out = new Map<string, CampaignState>();
  for (const c of camps) {
    const learningLeft = c.status === "active" ? learningLeftFor(c, learnInput) : 0;
    if (c.status === "error") {
      out.set(c.id, { stopped: "error", note: c.statusNote, learningLeft: 0 });
      continue;
    }
    if (c.status !== "paused") {
      out.set(c.id, { stopped: null, learningLeft });
      continue;
    }
    const mine = changes.filter((ch) => !ch.revertedAt && (ch.undo ?? []).some((u) => "campaignId" in u && u.campaignId === c.id));
    const pauseCh = mine.find((ch) => (ch.undo ?? []).some((u) => u.op === "campaignStatus" && u.campaignId === c.id && u.status === "active"));
    // Та же логика, что у робота: стоит из-за бюджета, если робот пометил паузу «бюджетной» и владелец её не ставил сам
    // (в том числе когда канал остановлен вместе со снижением бюджета владельцем — это решение робота, не владельца)
    if (pausedForBudget(c)) out.set(c.id, { stopped: "guard", stoppedAt: pauseCh?.at, note: pauseCh?.reason ?? null, via: pauseCh && !PAUSE_KINDS.has(pauseCh.kind) ? pauseCh.title : null, learningLeft: 0 });
    else out.set(c.id, { stopped: pauseCh?.actor === "robot" ? "robot" : "owner", stoppedAt: pauseCh?.at, note: pauseCh?.reason, via: pauseCh && !PAUSE_KINDS.has(pauseCh.kind) ? pauseCh.title : null, learningLeft: 0 });
  }
  return out;
}

import "server-only";
import { and, eq, gte, lte } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { Business } from "../db/schema";
import { demoNow } from "../platforms/demo";
import { addDays, isoDay, startOfWeek } from "../util";

export type Totals = { impressions: number; clicks: number; cost: number; leads: number; clients: number; clientsEstimated: boolean };

export async function reportNow(b: Business) {
  const db = await getDb();
  const camps = await db.select({ platform: schema.campaigns.platform }).from(schema.campaigns).where(eq(schema.campaigns.businessId, b.id));
  return camps.some((c) => c.platform === "demo") ? demoNow() : new Date();
}

export async function report(b: Business, days: number) {
  const db = await getDb();
  const now = await reportNow(b);
  const to = isoDay(now);
  const from = isoDay(addDays(now, -(days - 1)));
  const prevFrom = isoDay(addDays(now, -(2 * days - 1)));
  const camps = await db.select().from(schema.campaigns).where(eq(schema.campaigns.businessId, b.id));
  const rows = await db.select().from(schema.statsDaily).where(and(eq(schema.statsDaily.businessId, b.id), gte(schema.statsDaily.day, prevFrom), lte(schema.statsDaily.day, to)));
  const marks = await db.select().from(schema.clientMarks).where(eq(schema.clientMarks.businessId, b.id));
  // Обращения не из рекламы (например, с формы записи) — тоже считаем
  const formLeads = await db.select().from(schema.leads).where(and(eq(schema.leads.businessId, b.id), gte(schema.leads.createdAt, new Date(prevFrom))));

  const series = new Map<string, { day: string; cost: number; leads: number; clicks: number }>();
  for (let d = new Date(from + "T00:00:00Z"); isoDay(d) <= to; d = addDays(d, 1)) series.set(isoDay(d), { day: isoDay(d), cost: 0, leads: 0, clicks: 0 });

  const cur: Totals = { impressions: 0, clicks: 0, cost: 0, leads: 0, clients: 0, clientsEstimated: true };
  const prev: Totals = { impressions: 0, clicks: 0, cost: 0, leads: 0, clients: 0, clientsEstimated: true };
  const byChannel = new Map<string, Totals>();
  const leadsByWeek = new Map<string, number>();
  for (const r of rows) {
    const day = String(r.day);
    const t = day >= from ? cur : prev;
    t.impressions += r.impressions;
    t.clicks += r.clicks;
    t.cost += r.cost;
    t.leads += r.conversions;
    if (day >= from) {
      const s = series.get(day);
      if (s) {
        s.cost += r.cost;
        s.leads += r.conversions;
        s.clicks += r.clicks;
      }
      const camp = camps.find((c) => c.id === r.campaignId);
      const ch = camp?.channel ?? "other";
      const bc = byChannel.get(ch) ?? { impressions: 0, clicks: 0, cost: 0, leads: 0, clients: 0, clientsEstimated: true };
      bc.impressions += r.impressions;
      bc.clicks += r.clicks;
      bc.cost += r.cost;
      bc.leads += r.conversions;
      byChannel.set(ch, bc);
      const wk = isoDay(startOfWeek(new Date(day + "T00:00:00Z")));
      leadsByWeek.set(wk, (leadsByWeek.get(wk) ?? 0) + r.conversions);
    }
  }
  // Заявки с формы записи без привязки к объявлению (их нет в статистике площадок)
  const untracked = formLeads.filter((l) => !l.adExt);
  for (const l of untracked) {
    const day = isoDay(l.createdAt);
    if (day >= from && day <= to) {
      cur.leads += 1;
      const s = series.get(day);
      if (s) s.leads += 1;
    } else if (day >= prevFrom && day < from) prev.leads += 1;
  }

  // Клиенты: где владелец отметил — берём его цифру, иначе оценка по доле «обращение → клиент»
  const rate = b.leadToClientRate || 0.5;
  let clients = 0;
  let estimated = false;
  for (const [wk, leads] of leadsByWeek) {
    const m = marks.find((x) => String(x.weekStart) === wk);
    if (m) clients += m.clients;
    else {
      clients += leads * rate;
      estimated = true;
    }
  }
  if (!leadsByWeek.size) estimated = true;
  cur.clients = Math.round(clients + untracked.filter((l) => isoDay(l.createdAt) >= from).length * rate);
  cur.clientsEstimated = estimated;
  prev.clients = Math.round(prev.leads * rate);
  for (const t of byChannel.values()) t.clients = Math.round(t.leads * rate);

  return { from, to, now, cur, prev, byChannel: Object.fromEntries(byChannel), series: [...series.values()], rate };
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

export async function weeksForMarking(b: Business, n = 4) {
  const db = await getDb();
  const now = await reportNow(b);
  const marks = await db.select().from(schema.clientMarks).where(eq(schema.clientMarks.businessId, b.id));
  const weeks: { weekStart: string; leads: number; clients: number | null }[] = [];
  const stats = await db.select().from(schema.statsDaily).where(and(eq(schema.statsDaily.businessId, b.id), gte(schema.statsDaily.day, isoDay(addDays(startOfWeek(now), -7 * (n - 1))))));
  for (let i = 0; i < n; i++) {
    const ws = startOfWeek(addDays(now, -7 * i));
    const we = addDays(ws, 7);
    const leads = stats.filter((r) => String(r.day) >= isoDay(ws) && String(r.day) < isoDay(we)).reduce((s, r) => s + r.conversions, 0);
    const m = marks.find((x) => String(x.weekStart) === isoDay(ws));
    weeks.push({ weekStart: isoDay(ws), leads, clients: m ? m.clients : null });
  }
  return weeks;
}

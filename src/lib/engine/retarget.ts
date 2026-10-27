import "server-only";
import { and, eq, gte, inArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { Business, Campaign, UndoOp } from "../db/schema";
import { clientFor, CHANNEL_NAME } from "../platforms";
import { decrypt } from "../crypto";
import { metricaVisitors } from "../platforms/metrica";
import { addDays, errorText, isoDay, pl, rub } from "../util";
import {
  audienceMeta, familyOf, isRetarget, RETARGET_MIN_AUDIENCE, RETARGET_WINDOW_DAYS, UNIQUE_SHARE, type AudienceMeta, type Channel,
} from "../channels";
import { allocate, MAX_MONTHLY } from "./budget";
import { planLimits, spendableWeekly } from "./budget-plan";
import { budgetState } from "./budget-guard";
import { act } from "./ops";

/**
 * Ретаргетинг: кампании создаются при запуске выключенными и включаются сами, когда аудитория
 * «были на сайте, но не оставили заявку» наберёт RETARGET_MIN_AUDIENCE человек.
 *
 * Размер аудитории площадки через API не отдают (у условий ретаргетинга Директа и сегментов VK нет поля охвата),
 * поэтому считаем сами — осторожно, снизу:
 *   переходы из рекламы этой площадки за 30 дней (с момента запуска ретаргетинга) × доля уникальных людей − обращения;
 *   для Директа — ещё и посетители сайта по Метрике (ym:s:users) минус обращения, берём большее.
 * Демо считает так же — по своей смоделированной статистике, поэтому аудитория «растёт» с каждым днём.
 */

type Row = { campaignId: string; day: string; clicks: number; conversions: number };

/** Оценка аудитории по статистике (без запросов к площадкам) — для страниц и робота */
export function estimateAudience(c: Pick<Campaign, "id" | "channel" | "meta">, camps: Pick<Campaign, "id" | "channel">[], rows: Row[], now: Date): number {
  const fam = familyOf(c.channel);
  const ids = new Set(camps.filter((x) => !isRetarget(x.channel) && familyOf(x.channel) === fam).map((x) => x.id));
  const windowFrom = isoDay(addDays(now, -(RETARGET_WINDOW_DAYS - 1)));
  const since = audienceMeta(c)?.since;
  const from = since && since > windowFrom ? since : windowFrom;
  let clicks = 0, conv = 0;
  for (const r of rows) {
    if (!ids.has(r.campaignId) || r.day < from) continue;
    clicks += r.clicks;
    conv += r.conversions;
  }
  return Math.max(0, Math.round(clicks * UNIQUE_SHARE - conv));
}

/** Статистика для оценки аудиторий — одним запросом */
export async function audienceRows(businessId: string, now: Date): Promise<Row[]> {
  const db = await getDb();
  const rows = await db
    .select({ campaignId: schema.statsDaily.campaignId, day: schema.statsDaily.day, clicks: schema.statsDaily.clicks, conversions: schema.statsDaily.conversions })
    .from(schema.statsDaily)
    .where(and(eq(schema.statsDaily.businessId, businessId), gte(schema.statsDaily.day, isoDay(addDays(now, -RETARGET_WINDOW_DAYS)))));
  return rows.map((r) => ({ ...r, day: String(r.day) }));
}

export type AudienceView = { size: number; need: number; ready: boolean; state: AudienceMeta["state"]; note: string | null };

/** Аудитории всех кампаний ретаргетинга бизнеса — для интерфейса (страница «Реклама», «Главное») */
export async function audiencesFor(b: Business, camps: Campaign[], now: Date): Promise<Map<string, AudienceView>> {
  const out = new Map<string, AudienceView>();
  const rt = camps.filter((c) => isRetarget(c.channel));
  if (!rt.length) return out;
  const rows = await audienceRows(b.id, now);
  for (const c of rt) {
    const m = audienceMeta(c);
    const need = m?.need ?? RETARGET_MIN_AUDIENCE;
    // Робот мог посчитать больше (Метрика видит и тех, кто пришёл не из рекламы) — берём большее
    const size = Math.max(estimateAudience(c, camps, rows, now), m?.size ?? 0);
    out.set(c.id, { size, need, ready: size >= need, state: m?.state ?? (c.status === "active" ? "on" : "collecting"), note: m?.note ?? null });
  }
  return out;
}

async function patchAudience(c: Campaign, patch: Partial<AudienceMeta>) {
  const db = await getDb();
  const [row] = await db.select({ meta: schema.campaigns.meta }).from(schema.campaigns).where(eq(schema.campaigns.id, c.id));
  const cur = ((row?.meta ?? {}) as { audience?: AudienceMeta }).audience ?? { state: "collecting" as const, need: RETARGET_MIN_AUDIENCE };
  const meta = { ...(row?.meta ?? {}), audience: { ...cur, ...patch, at: new Date().toISOString() } };
  await db.update(schema.campaigns).set({ meta }).where(eq(schema.campaigns.id, c.id));
  c.meta = meta;
}

/** Посетители сайта по Метрике минус обращения (только настоящий Директ). null — не знаем */
async function metricaAudience(b: Business, now: Date): Promise<number | null> {
  if (!b.counterId) return null;
  const db = await getDb();
  const [acc] = await db.select().from(schema.adAccounts).where(and(eq(schema.adAccounts.userId, b.userId), eq(schema.adAccounts.platform, "yandex"), eq(schema.adAccounts.status, "ok")));
  if (!acc) return null;
  const users = await metricaVisitors(decrypt(acc.accessToken), b.counterId, isoDay(addDays(now, -(RETARGET_WINDOW_DAYS - 1))), isoDay(now));
  if (users === null) return null;
  const leads = await db.select({ id: schema.leads.id }).from(schema.leads).where(and(eq(schema.leads.businessId, b.id), gte(schema.leads.createdAt, addDays(new Date(), -RETARGET_WINDOW_DAYS))));
  return Math.max(0, users - leads.length);
}

/** Минимальный месячный бюджет, при котором к работающим каналам помещается и этот */
function minMonthlyWith(channels: Channel[], add: Channel) {
  for (let m = 1000; m <= MAX_MONTHLY; m += 500) if (!allocate(m, [...channels, add]).dropped.includes(add)) return m;
  return null;
}

/**
 * Шаг робота: обновить размер аудитории ретаргетинга и включить кампанию, когда аудитории хватает.
 * Включение делит бюджет заново: лимиты работающих каналов уменьшаются пропорционально, ретаргетинг получает
 * свою долю (≈ 6 % бюджета), сумма лимитов не растёт и не выходит за то, что безопасно в остатке месяца.
 * Если бюджета на минимум площадки не хватает — не включаем и пишем, сколько нужно.
 */
export async function retargetStep(cx: { b: Business; now: Date; campaigns: Campaign[]; log: string[] }) {
  const rt = cx.campaigns.filter((c) => isRetarget(c.channel) && c.externalId);
  if (!rt.length) return;

  // Включённые, но не дошедшие до модерации (ошибка площадки в прошлый раз) — пробуем ещё раз
  for (const c of rt.filter((x) => x.status === "active" && audienceMeta(x)?.state === "on" && !audienceMeta(x)?.activatedAt)) {
    await platformActivate(cx, c);
  }

  const waiting = rt.filter((c) => c.status === "paused" && audienceMeta(c)?.state === "collecting");
  if (!waiting.length) return;
  const rows = await audienceRows(cx.b.id, cx.now);
  const fromMetrica = waiting.some((c) => c.platform === "yandex") ? await metricaAudience(cx.b, cx.now).catch(() => null) : null;

  for (const c of waiting) {
    const m = audienceMeta(c)!;
    const need = m.need ?? RETARGET_MIN_AUDIENCE;
    const est = estimateAudience(c, cx.campaigns, rows, cx.now);
    const size = Math.max(est, c.platform === "yandex" && fromMetrica !== null ? fromMetrica : 0);
    if (size < need) {
      if (size !== m.size || m.note) await patchAudience(c, { size, note: null });
      cx.log.push(`${CHANNEL_NAME[c.channel]}: копим аудиторию — ${size} из ${need}`);
      continue;
    }

    const active = cx.campaigns.filter((x) => x.status === "active" && x.id !== c.id);
    if (!active.length) {
      await patchAudience(c, { size, note: "Остальная реклама сейчас стоит — ретаргетинг включится вместе с ней" });
      continue;
    }
    const channels = [...new Set(active.map((x) => x.channel as Channel))];
    const share = allocate(cx.b.monthlyBudget, [...channels, c.channel as Channel]);
    const st = await budgetState(cx.b.id, cx.b.monthlyBudget, cx.now, cx.campaigns);
    const cap = spendableWeekly(st.remaining, st.daysLeft, st.model);
    const current = active.reduce((s, x) => s + x.weeklyBudget, 0);
    const want = share.allocation.find((a) => a.channel === c.channel)?.weekly ?? 0;
    const plan = planLimits(
      [...active.map((x) => ({ id: x.id, channel: x.channel as Channel, want: x.weeklyBudget })), { id: c.id, channel: c.channel as Channel, want: Math.max(want, 1) }],
      Math.min(cap, current),
      true,
    );
    if (share.dropped.includes(c.channel as Channel) || plan.dropped.includes(c.id) || plan.short) {
      const min = minMonthlyWith(channels, c.channel as Channel);
      const note = `Аудитория набралась, но на ретаргетинг не хватает бюджета${min ? `: нужно от ${rub(min)} в месяц` : ""}`;
      if (m.note !== note || m.size !== size) await patchAudience(c, { size, note });
      cx.log.push(`${CHANNEL_NAME[c.channel]}: аудитория ${size}, но бюджета не хватает`);
      continue;
    }
    const next = plan.weekly.get(c.id)!;
    const moves = active.map((x) => ({ x, w: plan.weekly.get(x.id) })).filter((m2): m2 is { x: Campaign; w: number } => m2.w !== undefined && m2.w !== m2.x.weeklyBudget);
    const ops: UndoOp[] = [
      // Сначала уменьшаем лимиты остальных, потом включаем — сумма не выходит за бюджет ни на минуту
      ...moves.filter((mv) => mv.w < mv.x.weeklyBudget).map((mv) => ({ op: "campaignBudget" as const, campaignId: mv.x.id, weeklyBudget: mv.w })),
      ...(next !== c.weeklyBudget ? [{ op: "campaignBudget" as const, campaignId: c.id, weeklyBudget: next }] : []),
      { op: "campaignStatus" as const, campaignId: c.id, status: "active" as const },
      ...moves.filter((mv) => mv.w > mv.x.weeklyBudget).map((mv) => ({ op: "campaignBudget" as const, campaignId: mv.x.id, weeklyBudget: mv.w })),
    ];
    const lines = moves.map((mv) => `${CHANNEL_NAME[mv.x.channel]}: ${rub(mv.x.weeklyBudget)} → ${rub(mv.w)}`).join("; ");
    await act(
      {
        businessId: cx.b.id, actor: "robot", kind: "resume",
        title: `Включили «${CHANNEL_NAME[c.channel]}»: набралось ${pl(size, "человек", "человека", "человек")}`,
        reason:
          `${pl(size, "человек", "человека", "человек")} ${size % 10 === 1 && size % 100 !== 11 ? "заходил" : "заходили"} на ${cx.b.siteUrl ? "сайт" : "страницу записи"} за последние ${RETARGET_WINDOW_DAYS} дней, но не ${size % 10 === 1 && size % 100 !== 11 ? "оставил" : "оставили"} заявку — этого хватает, чтобы площадка начала показы. ` +
          `Теперь им будет напоминать о вас реклама с лимитом ${rub(next)} в неделю. Обычно такие люди записываются охотнее, а обращение обходится дешевле.` +
          (lines ? ` Общий бюджет не меняется — лимиты остальных каналов немного уменьшили: ${lines}.` : ""),
        details: { audience: size, weekly: next },
      },
      ops,
    );
    for (const mv of moves) mv.x.weeklyBudget = mv.w;
    c.status = "active";
    c.weeklyBudget = next;
    await patchAudience(c, { size, state: "on", note: null });
    await platformActivate(cx, c);
    cx.log.push(`${CHANNEL_NAME[c.channel]}: включён, аудитория ${size}`);
  }
}

/**
 * На площадке: Директ — объявления-черновики на модерацию, VK — план уже разблокирован (setCampaignActive в act),
 * демо — кампания начинает «работать» с сегодняшнего дня. Повторяется при следующих проходах, пока не удастся.
 */
async function platformActivate(cx: { log: string[] }, c: Campaign) {
  const db = await getDb();
  try {
    const [acc] = await db.select().from(schema.adAccounts).where(eq(schema.adAccounts.id, c.accountId));
    if (!acc) throw new Error("кабинет отключён");
    const client = await clientFor(acc);
    const ads = await db.select({ ext: schema.ads.externalId }).from(schema.ads).where(and(eq(schema.ads.campaignId, c.id), inArray(schema.ads.status, ["moderation", "active", "paused"])));
    await client.activateCampaign(c.externalId!, ads.map((a) => a.ext).filter(Boolean) as string[]);
    await patchAudience(c, { activatedAt: new Date().toISOString(), note: null });
  } catch (e) {
    await patchAudience(c, { note: `Не удалось отправить объявления на модерацию: ${errorText(e)}. Робот повторит при следующей проверке` });
    cx.log.push(`${CHANNEL_NAME[c.channel]}: включение на площадке не удалось — ${errorText(e)}`);
  }
}

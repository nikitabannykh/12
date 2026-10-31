import "server-only";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { Business } from "../db/schema";
import { getBalances, LOW_DAYS } from "./balance";
import { CHANNEL_NAME } from "../platforms";
import { trafficDiagnosis } from "./quality";
import { siteDownInfo } from "./site-guard";
import { siteTrackingStatus } from "./site-tracking";
import { pl } from "../util";

/**
 * Уведомления «колокольчика»: что сейчас требует действий (считается на лету) + лента событий
 * (модерация, показы, доступ к кабинету — пишет синхронизация; действия робота и обращения — из своих таблиц).
 */
export type Tone = "good" | "bad" | "warn" | "info";
export type InboxEvent = { id: string; at: string; tone: Tone; title: string; text?: string; href?: string };
export type InboxItem = InboxEvent & { group: "now" | "event"; unread: boolean };

const KEEP = 60;
const key = (businessId: string) => `inbox:${businessId}`;
const seenKey = (businessId: string) => `inbox-seen:${businessId}`;

async function kvGet<T>(k: string): Promise<T | null> {
  const db = await getDb();
  const [r] = await db.select().from(schema.kv).where(eq(schema.kv.key, k));
  return (r?.value as T) ?? null;
}
async function kvSet(k: string, value: unknown) {
  const db = await getDb();
  await db.insert(schema.kv).values({ key: k, value }).onConflictDoUpdate({ target: schema.kv.key, set: { value, updatedAt: new Date() } });
}

/** Добавить события в ленту (последние KEEP) */
export async function pushInbox(businessId: string, events: Omit<InboxEvent, "id" | "at">[]) {
  if (!events.length) return;
  try {
    const now = new Date().toISOString();
    const list = (await kvGet<InboxEvent[]>(key(businessId))) ?? [];
    const fresh = events.map((e, i) => ({ ...e, at: now, id: `${Date.now().toString(36)}-${i}` }));
    await kvSet(key(businessId), [...fresh.reverse(), ...list].slice(0, KEEP));
  } catch {
    // Уведомления — не критичны: синхронизация не должна падать из-за них
  }
}

type Seen = { at: string; now: string[] };
async function getSeen(businessId: string): Promise<Seen> {
  const v = await kvGet<Seen | string>(seenKey(businessId));
  if (!v) return { at: "1970-01-01T00:00:00.000Z", now: [] };
  return typeof v === "string" ? { at: v, now: [] } : v;
}

/** Открыли колокольчик: события до этого момента и текущие «требует внимания» — прочитаны */
export async function markInboxSeen(b: Business) {
  const { items } = await inboxFor(b);
  // Демо живёт по своим часам (впереди настоящих) — «прочитано до» берём не раньше самого свежего события
  const latest = items.filter((x) => x.group === "event").reduce((m, x) => (x.at > m ? x.at : m), new Date().toISOString());
  await kvSet(seenKey(b.id), { at: latest, now: items.filter((x) => x.group === "now").map(nowKey) });
}
/** «Сейчас» помечаем прочитанным по виду проблемы: счётчик в заголовке меняется («ещё одно прошло») — это не новое */
const nowKey = (x: { id: string; tone: string }) => `${x.id}|${x.tone}`;

/** Лента для колокольчика */
export async function inboxFor(b: Business): Promise<{ items: InboxItem[]; unread: number }> {
  const db = await getDb();
  const seenAll = await getSeen(b.id);
  const seen = seenAll.at;
  const now = new Date().toISOString();
  const items: InboxItem[] = [];

  // ─── Сейчас: что мешает рекламе ───
  const camps = await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, b.id), inArray(schema.campaigns.status, ["active", "paused", "error"])));
  const accIds = [...new Set(camps.map((c) => c.accountId))];
  const accs = accIds.length ? await db.select().from(schema.adAccounts).where(inArray(schema.adAccounts.id, accIds)) : [];
  for (const a of accs.filter((x) => x.status !== "ok"))
    items.push({ id: `acc-${a.id}`, at: now, group: "now", unread: false, tone: "bad", title: `Нет доступа к кабинету ${a.login}`, text: a.statusNote ?? "Подключите кабинет заново — без доступа робот не управляет рекламой.", href: "/app/settings" });
  const ads = await db.select({ status: schema.ads.status, note: schema.ads.statusNote, campaignId: schema.ads.campaignId }).from(schema.ads)
    .where(and(eq(schema.ads.businessId, b.id), inArray(schema.ads.status, ["moderation", "rejected", "active"])));
  // «Хотим показывать» — включённые и те, что остановил робот (сайт, бюджет): их проблемы владелец должен видеть.
  // Паузу владельца не считаем: он остановил сам
  type M = { delivery?: { ok?: boolean; note?: string }; pausedBy?: string | null; pausedBySite?: string | null; pausedByGuard?: string | null };
  const metaOf = (c: (typeof camps)[number]) => (c.meta ?? {}) as M;
  const wanted = camps.filter((c) => c.status === "active" || c.status === "paused");
  const live = new Set(wanted.map((c) => c.id));
  // Сайт не работает — главная причина: без него деньги и лицензия ничего не дадут
  const siteOff = wanted.filter((c) => metaOf(c).pausedBySite);
  if (siteOff.length) {
    const host = String(metaOf(siteOff[0]).pausedBySite).replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    items.push({ id: "site", at: now, group: "now", unread: false, tone: "bad", title: `Сайт ${host} не работает — реклама на паузе`, text: `Остановили ${siteOff.map((c) => CHANNEL_NAME[c.channel] ?? c.channel).join(", ")}, чтобы не тратить деньги впустую. Проверьте адрес сайта и сам сайт — или переключите рекламу на страницу записи. Как только сайт откроется, включим сами.`, href: "/app/settings?tab=site#landing" });
  }
  const offCamps = camps.filter((c) => c.status === "active" && metaOf(c).delivery?.ok === false);
  const balances = await getBalances(b);
  const empty = new Set(balances.filter((x) => !x.demo && x.daysLeft === 0).map((x) => x.accountId));
  const money = wanted.filter((c) => /средств|пополн/i.test(metaOf(c).delivery?.note ?? "") || empty.has(c.accountId));
  if (money.length)
    items.push({ id: "money", at: now, group: "now", unread: false, tone: "bad", title: "Нет денег на счёте", text: `Без денег не покажутся: ${money.map((c) => CHANNEL_NAME[c.channel] ?? c.channel).join(", ")}. Пополните кабинет — показы начнутся сами${siteOff.length ? ", когда заработает сайт" : ""}.`, href: "/app" });
  for (const c of offCamps.filter((x) => !money.includes(x)))
    items.push({ id: `off-${c.id}`, at: now, group: "now", unread: false, tone: "bad", title: `${CHANNEL_NAME[c.channel] ?? c.channel}: не показывается`, text: metaOf(c).delivery?.note, href: `/app/ads#c-${c.id}` });
  const docs = ads.filter((a) => a.status === "active" && live.has(a.campaignId) && /документ|лиценз/i.test(a.note ?? "")).length;
  if (docs)
    items.push({ id: "docs", at: now, group: "now", unread: false, tone: "bad", title: "Директ ждёт лицензию", text: `${pl(docs, "объявление не покажется", "объявления не покажутся", "объявлений не покажутся")}, пока Директ не проверит лицензию. В кабинете Директа: объявление → «Отправить документы».`, href: "/app" });
  // Рекламу увели на страницу записи, потому что на сайте не было кода, — код появился: подсказываем вернуть сайт
  if (b.siteUrl && (b.landing as { noCode?: boolean } | null)?.noCode && (b.landing as { mode?: string } | null)?.mode === "page") {
    const st = await siteTrackingStatus(b.id).catch(() => null);
    if (st?.state === "ok")
      items.push({ id: "site-code-ok", at: now, group: "now", unread: false, tone: "info", title: "Код на сайте работает — можно вести рекламу на сайт", text: "Сейчас реклама ведёт на страницу записи, потому что раньше кода на сайте не было. Переключите на сайт в «Куда ведёт реклама».", href: "/app/settings?tab=site#landing" });
  }
  const rejected = ads.filter((a) => a.status === "rejected").length;
  if (rejected)
    items.push({ id: "rejected", at: now, group: "now", unread: false, tone: "warn", title: `${pl(rejected, "объявление отклонено", "объявления отклонены", "объявлений отклонены")}`, text: "Робот перепишет их при следующей проверке — или поправьте сами. Причины — у каждого объявления.", href: "/app/ads" });
  const moderation = ads.filter((a) => a.status === "moderation" && live.has(a.campaignId)).length;
  if (moderation)
    items.push({ id: "moderation", at: now, group: "now", unread: false, tone: "info", title: `${pl(moderation, "объявление", "объявления", "объявлений")} на модерации`, text: "Обычно проверка занимает до суток. Проверяем статусы сами — как только Директ ответит, здесь появится уведомление.", href: "/app/ads" });
  for (const x of balances.filter((x) => !x.demo && x.daysLeft !== null && x.daysLeft > 0 && x.daysLeft <= LOW_DAYS))
    items.push({ id: `bal-${x.accountId}`, at: now, group: "now", unread: false, tone: "warn", title: "Скоро кончатся деньги в кабинете", text: `Хватит примерно на ${pl(x.daysLeft!, "день", "дня", "дней")}.`, href: "/app" });

  // Канал тратит деньги впустую: за 3 дня клики есть, обращений нет, а почти все сразу уходят с сайта
  {
    const d3 = new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10);
    const live2 = camps.filter((c) => c.status === "active" && c.platform !== "demo");
    if (live2.length) {
      const st = await db.select({ campaignId: schema.statsDaily.campaignId, impressions: schema.statsDaily.impressions, clicks: schema.statsDaily.clicks, cost: schema.statsDaily.cost, conv: schema.statsDaily.conversions }).from(schema.statsDaily)
        .where(and(eq(schema.statsDaily.businessId, b.id), gte(schema.statsDaily.day, d3), inArray(schema.statsDaily.campaignId, live2.map((c) => c.id))));
      const siteDown = await siteDownInfo(b.id);
      const mt = await db.select({ campaignId: schema.metricaDaily.campaignId, visits: schema.metricaDaily.visits, bounces: schema.metricaDaily.bounces, durationSum: schema.metricaDaily.durationSum, adId: schema.metricaDaily.adId, phrase: schema.metricaDaily.phrase }).from(schema.metricaDaily)
        .where(and(eq(schema.metricaDaily.businessId, b.id), gte(schema.metricaDaily.day, d3)));
      for (const c of live2) {
        const s1 = st.filter((x) => x.campaignId === c.id);
        const clicks = s1.reduce((a, x) => a + x.clicks, 0), cost = s1.reduce((a, x) => a + x.cost, 0), conv = s1.reduce((a, x) => a + x.conv, 0);
        const m1 = mt.filter((x) => x.campaignId === c.id && x.adId === "" && x.phrase === "");
        const visits = m1.reduce((a, x) => a + x.visits, 0), bounces = m1.reduce((a, x) => a + x.bounces, 0);
        if (clicks < 15 || conv > 0) continue;
        const imps = s1.reduce((a, x) => a + x.impressions, 0);
        const d = trafficDiagnosis({ channel: c.channel, impressions: imps, clicks, visits, bounces, durationSum: m1.reduce((a, x) => a + x.durationSum, 0), siteDown });
        if (d.cause)
          items.push({ id: `waste-${c.id}`, at: now, group: "now", unread: false, tone: "bad", title: `${CHANNEL_NAME[c.channel] ?? c.channel}: ${Math.round(cost)} ₽ за 3 дня без обращений`, text: d.text, href: "/app/stats" });
      }
    }
  }

  // ─── События ───
  const since = new Date(Date.now() - 30 * 86400_000);
  // «Показы идут», а объявления кампании ждут лицензию — так не пишем (старые записи тоже поправляем на лету)
  const servingCamps = new Set(ads.filter((a) => a.status === "active" && !/^Не показывается/.test(a.note ?? "")).map((a) => a.campaignId));
  const docsCamps = new Set(ads.filter((a) => a.status === "active" && /документ|лиценз/i.test(a.note ?? "")).map((a) => a.campaignId));
  const events: InboxItem[] = ((await kvGet<InboxEvent[]>(key(b.id))) ?? []).map((e): InboxItem | null => {
    const camp = /#c-(.+)$/.exec(e.href ?? "")?.[1];
    // Старые записи «показы идут», а одобренных объявлений нет (все на модерации) — это была неправда, не показываем
    if (camp && /: показы (идут|начались)$/.test(e.title) && !servingCamps.has(camp) && !docsCamps.has(camp)) return null;
    if (camp && docsCamps.has(camp) && /: показы (идут|начались)$/.test(e.title))
      return { ...e, tone: "warn" as const, title: e.title.replace(/: показы (идут|начались)$/, ": Директ включил кампанию, но показов ещё нет"), text: "Объявления ждут проверки лицензии — показы начнутся после неё.", group: "event" as const, unread: e.at > seen };
    return { ...e, group: "event" as const, unread: e.at > seen };
  }).filter((x): x is InboxItem => x !== null);
  const changes = await db.select().from(schema.changes).where(and(eq(schema.changes.businessId, b.id), gte(schema.changes.at, since))).orderBy(desc(schema.changes.at)).limit(15);
  for (const c of changes) {
    const at = c.at.toISOString();
    events.push({ id: `ch-${c.id}`, at, group: "event", unread: at > seen, tone: c.kind === "revert" ? "warn" : "info", title: c.actor === "robot" ? `Робот: ${c.title}` : c.title, href: `/app/history#${c.id}` });
  }
  const leads = await db.select({ id: schema.leads.id, kind: schema.leads.kind, createdAt: schema.leads.createdAt, name: schema.leads.name }).from(schema.leads)
    .where(and(eq(schema.leads.businessId, b.id), gte(schema.leads.createdAt, since))).orderBy(desc(schema.leads.createdAt)).limit(10);
  const KIND: Record<string, string> = { form: "заявка с сайта", phone: "звонок", messenger: "сообщение в мессенджер", suspect: "заявка (похожа на спам)" };
  for (const l of leads) {
    const at = l.createdAt.toISOString();
    events.push({ id: `lead-${l.id}`, at, group: "event", unread: at > seen, tone: l.kind === "suspect" ? "info" : "good", title: `Новое обращение: ${KIND[l.kind] ?? l.kind}`, text: l.name ?? undefined, href: "/app/stats#leads" });
  }
  events.sort((x, y) => (x.at < y.at ? 1 : -1));
  const feed = events.slice(0, 40);
  const seenNow = new Set(seenAll.now);
  for (const x of items) x.unread = !seenNow.has(nowKey(x));
  return { items: [...items, ...feed], unread: feed.filter((x) => x.unread).length + items.filter((x) => x.unread).length };
}

import "server-only";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { Business } from "../db/schema";
import { getBalances, LOW_DAYS } from "./balance";
import { CHANNEL_NAME } from "../platforms";
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
  await kvSet(seenKey(b.id), { at: new Date().toISOString(), now: items.filter((x) => x.group === "now").map(nowKey) });
}
/** «Сейчас» помечаем прочитанным вместе с текстом: изменилось (стало больше отклонённых) — снова новое */
const nowKey = (x: { id: string; title: string }) => `${x.id}|${x.title}`;

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
  const live = new Set(camps.filter((c) => c.status === "active").map((c) => c.id));
  const offCamps = camps.filter((c) => c.status === "active" && (c.meta as { delivery?: { ok?: boolean; note?: string } } | null)?.delivery?.ok === false);
  const money = offCamps.filter((c) => /средств|пополн/i.test((c.meta as { delivery?: { note?: string } }).delivery?.note ?? ""));
  if (money.length)
    items.push({ id: "money", at: now, group: "now", unread: false, tone: "bad", title: "Нет денег на счёте — реклама не показывается", text: `Стоит: ${money.map((c) => CHANNEL_NAME[c.channel] ?? c.channel).join(", ")}. Пополните кабинет — показы начнутся сами.`, href: "/app" });
  for (const c of offCamps.filter((x) => !money.includes(x)))
    items.push({ id: `off-${c.id}`, at: now, group: "now", unread: false, tone: "bad", title: `${CHANNEL_NAME[c.channel] ?? c.channel}: не показывается`, text: (c.meta as { delivery?: { note?: string } }).delivery?.note, href: `/app/ads#c-${c.id}` });
  const docs = ads.filter((a) => a.status === "active" && live.has(a.campaignId) && /документ|лиценз/i.test(a.note ?? "")).length;
  if (docs)
    items.push({ id: "docs", at: now, group: "now", unread: false, tone: "bad", title: "Директ ждёт лицензию", text: `${pl(docs, "объявление не показывается", "объявления не показываются", "объявлений не показываются")}, пока Директ не проверит лицензию. В кабинете Директа: объявление → «Отправить документы».`, href: "/app" });
  const rejected = ads.filter((a) => a.status === "rejected").length;
  if (rejected)
    items.push({ id: "rejected", at: now, group: "now", unread: false, tone: "warn", title: `${pl(rejected, "объявление отклонено", "объявления отклонены", "объявлений отклонены")}`, text: "Робот перепишет их при следующей проверке — или поправьте сами. Причины — у каждого объявления.", href: "/app/ads" });
  const moderation = ads.filter((a) => a.status === "moderation" && live.has(a.campaignId)).length;
  if (moderation)
    items.push({ id: "moderation", at: now, group: "now", unread: false, tone: "info", title: `${pl(moderation, "объявление", "объявления", "объявлений")} на модерации`, text: "Обычно проверка занимает до суток. Статусы обновляются, когда вы открываете кабинет.", href: "/app/ads" });
  for (const x of (await getBalances(b)).filter((x) => !x.demo && x.daysLeft !== null && x.daysLeft > 0 && x.daysLeft <= LOW_DAYS))
    items.push({ id: `bal-${x.accountId}`, at: now, group: "now", unread: false, tone: "warn", title: "Скоро кончатся деньги в кабинете", text: `Хватит примерно на ${pl(x.daysLeft!, "день", "дня", "дней")}.`, href: "/app" });

  // ─── События ───
  const since = new Date(Date.now() - 30 * 86400_000);
  const events: InboxItem[] = ((await kvGet<InboxEvent[]>(key(b.id))) ?? []).map((e) => ({ ...e, group: "event", unread: e.at > seen }));
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

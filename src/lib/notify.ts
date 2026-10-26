import "server-only";
import { and, eq, gte, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { mac, macEqual } from "./crypto";
import { reportNow } from "./engine/report";
import { addDays, appUrl, errorText, isoDay, pl, rub } from "./util";

/**
 * Уведомления владельцу: новые заявки и утренняя сводка — в Telegram.
 * Нужен бот (@BotFather) и переменная TELEGRAM_BOT_TOKEN; имя бота можно задать в TELEGRAM_BOT_USERNAME,
 * иначе узнаём его через getMe. Владелец привязывает чат по ссылке t.me/<бот>?start=<подписанный код>.
 * E-mail пока не отправляем: нет почтового провайдера.
 */

// TELEGRAM_API_URL — если api.telegram.org недоступен с хостинга, можно указать свой прокси (Local Bot API / reverse proxy)
const TG = (process.env.TELEGRAM_API_URL || "https://api.telegram.org").replace(/\/$/, "");
const token = () => process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
export const tgConfigured = () => Boolean(token());

class TgError extends Error {
  constructor(message: string, public code: number) {
    super(message);
  }
}

async function tg<T = unknown>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${TG}/bot${token()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const d = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string; error_code?: number };
  if (!d.ok) throw new TgError(d.description || `Telegram ответил ошибкой ${res.status}`, d.error_code ?? res.status);
  return d.result as T;
}

export const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function kvGet<T>(key: string): Promise<T | null> {
  const db = await getDb();
  const [r] = await db.select().from(schema.kv).where(eq(schema.kv.key, key));
  return (r?.value as T) ?? null;
}

async function kvSet(key: string, value: unknown) {
  const db = await getDb();
  await db.insert(schema.kv).values({ key, value }).onConflictDoUpdate({ target: schema.kv.key, set: { value, updatedAt: new Date() } });
}

let botNameCache: string | null = null;
export async function botUsername(): Promise<string | null> {
  if (!tgConfigured()) return null;
  const env = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "").trim();
  if (env) return env;
  if (botNameCache) return botNameCache;
  const fromKv = await kvGet<{ username: string; token: string }>("tg:bot");
  if (fromKv && fromKv.token === mac("tg-token:" + token(), 12)) return (botNameCache = fromKv.username);
  const me = await tg<{ username: string }>("getMe");
  botNameCache = me.username;
  await kvSet("tg:bot", { username: me.username, token: mac("tg-token:" + token(), 12) });
  return me.username;
}

/** Секрет вебхука: Telegram присылает его в заголовке X-Telegram-Bot-Api-Secret-Token */
export const webhookSecret = () => mac("tg-webhook:" + token(), 32);

/** Вебхук можно поставить только на https. Локально (http://localhost) читаем обновления через getUpdates. */
const webhookMode = () => appUrl().startsWith("https://");

export async function ensureWebhook() {
  if (!tgConfigured() || !webhookMode()) return;
  const url = `${appUrl()}/api/notify/telegram`;
  const fp = mac(`wh:${url}:${token()}`, 16);
  if ((await kvGet<string>("tg:webhook")) === fp) return;
  await tg("setWebhook", { url, secret_token: webhookSecret(), allowed_updates: ["message"], drop_pending_updates: true });
  await kvSet("tg:webhook", fp);
}

// --- Код привязки: подпись (16) + срок действия (7, base36, секунды) + id бизнеса. Только [A-Za-z0-9_-], ≤ 64 символов
const LINK_TTL_SEC = 3600;
export function linkCode(businessId: string, now = Date.now()): string {
  const exp = Math.floor(now / 1000 + LINK_TTL_SEC).toString(36).padStart(7, "0");
  return mac(`tg-link:${exp}:${businessId}`, 16) + exp + businessId;
}

export function parseLinkCode(code: string): string | null {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(code)) return null;
  const sig = code.slice(0, 16), exp = code.slice(16, 23), bid = code.slice(23);
  if (!macEqual(sig, mac(`tg-link:${exp}:${bid}`, 16))) return null;
  if (parseInt(exp, 36) * 1000 < Date.now()) return null;
  return bid;
}

export async function linkUrl(businessId: string): Promise<string | null> {
  const bot = await botUsername();
  if (!bot) return null;
  await ensureWebhook();
  return `https://t.me/${bot}?start=${linkCode(businessId)}`;
}

export async function getNotify(businessId: string) {
  const db = await getDb();
  const [r] = await db.select().from(schema.notifySettings).where(eq(schema.notifySettings.businessId, businessId));
  return r ?? null;
}

export async function saveNotify(businessId: string, set: Partial<typeof schema.notifySettings.$inferInsert>) {
  const db = await getDb();
  await db
    .insert(schema.notifySettings)
    .values({ businessId, ...set, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.notifySettings.businessId, set: { ...set, updatedAt: new Date() } });
}

/** Отправить сообщение в привязанный чат. Если бот заблокирован — отвязываем, чтобы не долбить. */
export async function sendToBusiness(businessId: string, html: string): Promise<{ ok: boolean; error?: string }> {
  if (!tgConfigured()) return { ok: false, error: "Telegram не настроен на сервере" };
  const s = await getNotify(businessId);
  if (!s?.telegramChatId) return { ok: false, error: "Telegram не подключён" };
  try {
    await tg("sendMessage", { chat_id: s.telegramChatId, text: html, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    return { ok: true };
  } catch (e) {
    if (e instanceof TgError && (e.code === 403 || /chat not found/i.test(e.message))) {
      await saveNotify(businessId, { telegramChatId: null, telegramName: null });
      return { ok: false, error: "Бот заблокирован или чат удалён — подключите Telegram заново" };
    }
    if (e instanceof TgError && e.code === 401) return { ok: false, error: "Telegram не принял токен бота — проверьте TELEGRAM_BOT_TOKEN на сервере" };
    return { ok: false, error: `Telegram не ответил: ${errorText(e)}` };
  }
}

const reply = (chatId: number | string, text: string) => tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML" }).catch(() => {});

type TgUpdate = { update_id: number; message?: { text?: string; chat: { id: number; title?: string; username?: string; first_name?: string; last_name?: string } } };

/** Обработка сообщения боту: /start <код> — привязка, /stop — отвязка */
export async function processUpdate(u: TgUpdate) {
  const m = u.message;
  if (!m?.text) return;
  const chat = m.chat;
  const text = m.text.trim();
  const db = await getDb();
  if (text.startsWith("/start")) {
    const code = text.slice(6).trim();
    const bid = code ? parseLinkCode(code) : null;
    if (!bid) {
      await reply(chat.id, code
        ? "Ссылка устарела. Откройте «Настройки» в сервисе «Полный зал» и нажмите «Подключить Telegram» ещё раз."
        : "Это бот сервиса «Полный зал». Чтобы получать сюда заявки, откройте «Настройки» в сервисе и нажмите «Подключить Telegram».");
      return;
    }
    const [b] = await db.select({ id: schema.businesses.id, name: schema.businesses.name }).from(schema.businesses).where(eq(schema.businesses.id, bid));
    if (!b) return void (await reply(chat.id, "Бизнес не найден. Попробуйте подключить Telegram заново из настроек."));
    const name = chat.title || (chat.username ? `@${chat.username}` : [chat.first_name, chat.last_name].filter(Boolean).join(" ")) || "Telegram";
    await saveNotify(b.id, { telegramChatId: String(chat.id), telegramName: name.slice(0, 80), linkedAt: new Date() });
    await reply(chat.id, `Готово! Новые заявки «${esc(b.name)}» будут приходить сюда сразу, а по утрам — короткая сводка.\n\nОтключить — в настройках сервиса или командой /stop.`);
    return;
  }
  if (text.startsWith("/stop")) {
    await db.update(schema.notifySettings).set({ telegramChatId: null, telegramName: null, updatedAt: new Date() }).where(eq(schema.notifySettings.telegramChatId, String(chat.id)));
    await reply(chat.id, "Уведомления отключены. Включить снова можно в настройках сервиса «Полный зал».");
    return;
  }
  await reply(chat.id, "Я присылаю заявки и утреннюю сводку. Управлять уведомлениями можно в настройках сервиса «Полный зал». /stop — отключить.");
}

/** Локальный режим без https: забираем обновления сами (вызывается при проверке статуса подключения) */
export async function pollUpdates() {
  if (!tgConfigured() || webhookMode()) return;
  const offset = (await kvGet<number>("tg:offset")) ?? 0;
  const list = await tg<TgUpdate[]>("getUpdates", { offset, timeout: 0, allowed_updates: ["message"] }).catch(() => [] as TgUpdate[]);
  for (const u of list) await processUpdate(u).catch(() => {});
  if (list.length) await kvSet("tg:offset", list[list.length - 1].update_id + 1);
}

export function formatPhone(p: string) {
  const d = p.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("7")) return `+7 ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
  return p.startsWith("+") ? p : `+${d}`;
}

const SOURCE: Record<string, string> = { yandex: "Яндекс Директ", vk: "VK Реклама", demo: "демо-реклама" };

/** Сообщение о новой заявке — сразу после записи в базу */
export async function notifyLead(l: { businessId: string; businessName: string; name: string | null; contact: string; service: string | null; source: string | null; adTitle: string | null }) {
  if (!tgConfigured()) return { ok: false };
  const lines = [
    `<b>Новая заявка</b> · ${esc(l.businessName)}`,
    "",
    l.name ? `Имя: ${esc(l.name)}` : null,
    `Телефон: ${esc(formatPhone(l.contact))}`,
    l.service ? `Услуга: ${esc(l.service)}` : null,
    l.source ? `Откуда: ${esc(SOURCE[l.source] ?? l.source)}${l.adTitle ? `, объявление «${esc(l.adTitle)}»` : ""}` : "Откуда: страница записи",
    "",
    "Перезвоните в ближайшие 15 минут — так записывается больше людей.",
  ].filter((x) => x !== null);
  return sendToBusiness(l.businessId, lines.join("\n"));
}

/** Утренняя сводка за вчера: расход, обращения, что сделал робот. null — если сообщать нечего. */
export async function buildDigest(businessId: string): Promise<string | null> {
  const db = await getDb();
  const [b] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
  if (!b) return null;
  const now = await reportNow(b);
  const day = isoDay(addDays(now, -1));
  const [st] = await db
    .select({ cost: sql<number>`coalesce(sum(${schema.statsDaily.cost}), 0)`, conv: sql<number>`coalesce(sum(${schema.statsDaily.conversions}), 0)`, clicks: sql<number>`coalesce(sum(${schema.statsDaily.clicks}), 0)` })
    .from(schema.statsDaily)
    .where(and(eq(schema.statsDaily.businessId, b.id), eq(schema.statsDaily.day, day)));
  const dayStart = new Date(day + "T00:00:00Z"), dayEnd = addDays(dayStart, 1);
  // Как в отчёте: заявки без привязки к объявлению площадка не видит — добавляем их к её конверсиям
  const [own] = await db
    .select({ n: sql<number>`count(*)::int`, untracked: sql<number>`count(*) filter (where ${schema.leads.adExt} is null)::int`, forms: sql<number>`count(*) filter (where ${schema.leads.contact} is not null)::int` })
    .from(schema.leads)
    .where(and(eq(schema.leads.businessId, b.id), gte(schema.leads.createdAt, dayStart), lt(schema.leads.createdAt, dayEnd)));
  const robot = await db
    .select({ title: schema.changes.title })
    .from(schema.changes)
    .where(and(eq(schema.changes.businessId, b.id), eq(schema.changes.actor, "robot"), gte(schema.changes.at, addDays(now, -1)), isNull(schema.changes.revertedAt)))
    .orderBy(schema.changes.at)
    .limit(20);
  const cost = Number(st?.cost ?? 0);
  const leads = Number(st?.conv ?? 0) + Number(own?.untracked ?? 0);
  const changes = robot.filter((r) => r.title);
  if (cost < 1 && !leads && !changes.length) return null;

  const date = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" }).format(dayStart);
  const out = [`<b>Сводка за ${date}</b> · ${esc(b.name)}`, "", `Потрачено: ${rub(cost)}`];
  out.push(`Обращений: ${leads}${leads && cost >= 1 ? ` (одно — ${rub(cost / leads)})` : ""}${own?.forms ? `, из них заявок с телефоном: ${own.forms}` : ""}`);
  if (!leads && cost >= 1) out.push(`Кликов: ${Number(st?.clicks ?? 0)}, обращений пока нет`);
  if (changes.length) {
    out.push("", `Робот сделал ${pl(changes.length, "изменение", "изменения", "изменений")}:`);
    for (const c of changes.slice(0, 5)) out.push(`• ${esc(c.title)}`);
    if (changes.length > 5) out.push(`…и ещё ${changes.length - 5}`);
  } else out.push("", "Робот ничего не менял: всё идёт по плану.");
  out.push("", `Подробнее и отмена любого шага: ${appUrl()}/app/history`);
  return out.join("\n");
}

/** Разослать утренние сводки (раз в ~сутки на бизнес). Вызывается из cron после прохода робота. */
export async function sendDigests(deadlineMs = 8000) {
  if (!tgConfigured()) return { sent: 0, skipped: 0 };
  const started = Date.now();
  const db = await getDb();
  const list = await db
    .select()
    .from(schema.notifySettings)
    .where(and(isNotNull(schema.notifySettings.telegramChatId), eq(schema.notifySettings.digest, 1), or(isNull(schema.notifySettings.lastDigestAt), lt(schema.notifySettings.lastDigestAt, new Date(Date.now() - 20 * 3600e3)))));
  let sent = 0, skipped = 0;
  for (const s of list) {
    if (Date.now() - started > deadlineMs) break;
    try {
      const text = await buildDigest(s.businessId);
      if (text && (await sendToBusiness(s.businessId, text)).ok) sent++;
      else skipped++;
    } catch (e) {
      console.error("digest", s.businessId, e);
      skipped++;
    }
    await saveNotify(s.businessId, { lastDigestAt: new Date() });
  }
  return { sent, skipped };
}

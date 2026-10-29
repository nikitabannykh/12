import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, gte, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { mac } from "./crypto";
import { reportNow } from "./engine/report";
import { addDays, appUrl, isoDay, pl, rub } from "./util";

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
  if (!d.ok) throw new TgError(d.description || `HTTP ${res.status}`, d.error_code ?? res.status);
  return d.result as T;
}

/** Понятная причина сбоя запроса к Telegram — без «Telegram не ответил: Telegram ответил ошибкой…» */
export function tgErrorText(e: unknown): string {
  if (e instanceof TgError) {
    if (e.code === 401 || e.code === 404) return "Telegram не принял токен бота — проверьте TELEGRAM_BOT_TOKEN на сервере";
    if (e.code === 429) return "Telegram просит подождать: слишком много сообщений подряд. Попробуйте через минуту";
    return `Telegram вернул ошибку ${e.code}: ${e.message}`;
  }
  const name = (e as { name?: string })?.name;
  if (name === "TimeoutError" || name === "AbortError") return "Telegram не ответил за 5 секунд — попробуйте чуть позже";
  return "Сервер не смог связаться с Telegram (api.telegram.org недоступен) — попробуйте позже или задайте TELEGRAM_API_URL";
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
  const fp = mac(`wh2:${url}:${token()}`, 16); // wh2: добавились нажатия кнопок (callback_query)
  if ((await kvGet<string>("tg:webhook")) === fp) return;
  await tg("setWebhook", { url, secret_token: webhookSecret(), allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
  await kvSet("tg:webhook", fp);
}

// --- Код привязки: случайный, одноразовый, живёт 15 минут. Хранится в kv: tg:link:<код> → { businessId, exp }.
// Привязка — в два шага: /start <код> → бот спрашивает «Подключить уведомления для «…»?» → кнопка «Подключить».
// Так чужой человек, увидевший ссылку, не получит заявки незаметно: код гаснет после первого подтверждения,
// а владелец видит на странице настроек, какой чат подключён.
export const LINK_TTL_MIN = 15;
type LinkRec = { businessId: string; exp: number };

async function newLinkCode(businessId: string): Promise<string> {
  const db = await getDb();
  // Старые коды этого бизнеса больше не нужны; заодно подчищаем просроченные
  await db.delete(schema.kv).where(and(sql`${schema.kv.key} like 'tg:link:%'`, or(sql`(${schema.kv.value}->>'businessId') = ${businessId}`, sql`(${schema.kv.value}->>'exp')::bigint < ${Date.now()}`)));
  const code = randomBytes(18).toString("base64url"); // 24 символа [A-Za-z0-9_-]
  await kvSet(`tg:link:${code}`, { businessId, exp: Date.now() + LINK_TTL_MIN * 60e3 } satisfies LinkRec);
  return code;
}

async function peekLink(code: string): Promise<LinkRec | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(code)) return null;
  const r = await kvGet<LinkRec>(`tg:link:${code}`);
  return r && r.exp > Date.now() ? r : null;
}

/** Погасить код: удаляем атомарно, второй раз он не сработает */
async function takeLink(code: string): Promise<LinkRec | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(code)) return null;
  const db = await getDb();
  const [r] = await db.delete(schema.kv).where(eq(schema.kv.key, `tg:link:${code}`)).returning({ value: schema.kv.value });
  const v = r?.value as LinkRec | undefined;
  return v && v.exp > Date.now() ? v : null;
}

export async function linkUrl(businessId: string): Promise<string | null> {
  const bot = await botUsername();
  if (!bot) return null;
  await ensureWebhook();
  return `https://t.me/${bot}?start=${await newLinkCode(businessId)}`;
}

// --- Почему уведомления отключились: показываем владельцу в настройках
export type Unlinked = { reason: string; at: string; chat: string | null };
export async function setUnlinked(businessId: string, reason: string, chat: string | null) {
  await kvSet(`tg:unlinked:${businessId}`, { reason, at: new Date().toISOString(), chat } satisfies Unlinked);
}
export async function getUnlinked(businessId: string): Promise<Unlinked | null> {
  return kvGet<Unlinked>(`tg:unlinked:${businessId}`);
}
async function clearUnlinked(businessId: string) {
  const db = await getDb();
  await db.delete(schema.kv).where(eq(schema.kv.key, `tg:unlinked:${businessId}`));
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
export async function sendToBusiness(businessId: string, html: string, extra: Record<string, unknown> = {}): Promise<{ ok: boolean; error?: string }> {
  if (!tgConfigured()) return { ok: false, error: "Telegram не настроен на сервере" };
  const s = await getNotify(businessId);
  if (!s?.telegramChatId) return { ok: false, error: "Telegram не подключён" };
  try {
    await tg("sendMessage", { chat_id: s.telegramChatId, text: html, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...extra });
    return { ok: true };
  } catch (e) {
    if (e instanceof TgError && (e.code === 403 || /chat not found|bot was kicked|user is deactivated/i.test(e.message))) {
      const why = /kicked/i.test(e.message)
        ? "бота удалили из группы, куда приходили заявки"
        : /deactivated/i.test(e.message)
          ? "аккаунт Telegram, куда приходили заявки, удалён"
          : /chat not found/i.test(e.message)
            ? "чат, куда приходили заявки, удалён"
            : "бота остановили или заблокировали в Telegram";
      await saveNotify(businessId, { telegramChatId: null, telegramName: null });
      await setUnlinked(businessId, why, s.telegramName);
      return { ok: false, error: `Сообщение не дошло: ${why}. Уведомления отключены — подключите Telegram заново в настройках.` };
    }
    return { ok: false, error: tgErrorText(e) };
  }
}

const reply = (chatId: number | string, text: string, extra: Record<string, unknown> = {}) => tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra }).catch(() => {});

type TgButton = { text: string; callback_data?: string; url?: string };
type TgChat = { id: number; type?: string; title?: string; username?: string; first_name?: string; last_name?: string };
type TgUpdate = {
  update_id: number;
  message?: { text?: string; chat: TgChat };
  callback_query?: { id: string; data?: string; message?: { message_id: number; chat: TgChat; reply_markup?: { inline_keyboard?: TgButton[][] } } };
};

const chatName = (chat: TgChat) => (chat.title || (chat.username ? `@${chat.username}` : [chat.first_name, chat.last_name].filter(Boolean).join(" ")) || "Telegram").slice(0, 80);

async function businessName(id: string) {
  const db = await getDb();
  const [b] = await db.select({ id: schema.businesses.id, name: schema.businesses.name }).from(schema.businesses).where(eq(schema.businesses.id, id));
  return b ?? null;
}

const STALE = `Ссылка не сработала: она одноразовая и действует ${LINK_TTL_MIN} минут. Откройте «Настройки» в сервисе «Самоход» и нажмите «Подключить Telegram» ещё раз.`;


/** Чат, нажавший кнопку, должен быть тем самым, куда этот бизнес получает уведомления */
async function chatOwns(businessId: string, chat: TgChat) {
  const s = await getNotify(businessId);
  return Boolean(s?.telegramChatId) && s!.telegramChatId === String(chat.id);
}

// ─── Статус заявки в один тап: кнопки под сообщением о заявке (callback_data «ls:<id заявки>:b|n|s») ───
const LS_CODE = { b: "booked", n: "no_answer", s: "spam" } as const;
const LS_TEXT: Record<string, string> = { booked: "Записался", no_answer: "Не дозвонились", spam: "Спам" };

export function leadKeyboard(leadId: string, status: string | null): TgButton[][] {
  const btn = (code: keyof typeof LS_CODE) => {
    const st = LS_CODE[code];
    return { text: `${status === st ? "✓ " : ""}${LS_TEXT[st]}`, callback_data: `ls:${leadId}:${code}` };
  };
  return [[btn("b"), btn("n")], [btn("s")]];
}

async function onLeadStatus(leadId: string, code: string | undefined, chat: TgChat, answer: (t?: string) => Promise<unknown>, setKeyboard: (k: TgButton[][]) => Promise<unknown>) {
  const st = LS_CODE[code as keyof typeof LS_CODE];
  if (!st || !/^[\w-]{4,64}$/.test(leadId)) return void (await answer());
  const db = await getDb();
  const [lead] = await db.select({ id: schema.leads.id, businessId: schema.leads.businessId, status: schema.leads.status }).from(schema.leads).where(eq(schema.leads.id, leadId));
  if (!lead || !(await chatOwns(lead.businessId, chat))) return void (await answer("Эта заявка не из вашего кабинета или чат отключён от уведомлений"));
  // Повторное нажатие на выбранный статус снимает отметку
  const next = lead.status === st ? null : st;
  const { setLeadStatus } = await import("./engine/ops");
  await setLeadStatus(lead.businessId, lead.id, next);
  await setKeyboard(leadKeyboard(lead.id, next));
  await answer(next ? `Отмечено: ${LS_TEXT[next]}` : "Отметка снята");
}

// ─── «Отменить» в утренней сводке (callback_data «rv:<id изменения>») ───
async function onRevert(changeId: string, chat: TgChat, answer: (t?: string) => Promise<unknown>, keyboard: TgButton[][], setKeyboard: (k: TgButton[][]) => Promise<unknown>) {
  if (!/^[\w-]{4,64}$/.test(changeId)) return void (await answer());
  const db = await getDb();
  const [ch] = await db.select({ id: schema.changes.id, businessId: schema.changes.businessId, title: schema.changes.title }).from(schema.changes).where(eq(schema.changes.id, changeId));
  if (!ch || !(await chatOwns(ch.businessId, chat))) return void (await answer("Это изменение не из вашего кабинета или чат отключён от уведомлений"));
  const mark = async (label: string) => setKeyboard(keyboard.map((row) => row.map((b) => (b.callback_data === `rv:${changeId}` ? { text: label, callback_data: "noop:x" } : b))));
  try {
    const { revertChange } = await import("./engine/ops");
    await revertChange(ch.businessId, ch.id, "owner");
    await mark(`✓ Отменено: ${short(ch.title, 40)}`);
    await answer("Отменили — вернули как было");
  } catch (e) {
    const status = (e as { status?: number }).status;
    const msg = e instanceof Error && status ? e.message : "Не получилось отменить. Попробуйте в разделе «История» сервиса.";
    if (status === 409 && /уже отменено/i.test(msg)) await mark(`Уже отменено: ${short(ch.title, 40)}`);
    // У всплывающего ответа лимит 200 символов
    await answer(msg.slice(0, 190));
  }
}

const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

/** Обработка сообщений боту: /start <код> — спросить подтверждение, кнопка «Подключить» — привязать, /stop — отвязать */
export async function processUpdate(u: TgUpdate) {
  const db = await getDb();
  const cq = u.callback_query;
  if (cq) {
    const answer = (text?: string) => tg("answerCallbackQuery", { callback_query_id: cq.id, ...(text ? { text } : {}) }).catch(() => {});
    const chat = cq.message?.chat;
    const [act, code, arg] = String(cq.data || "").split(":");
    if (!chat || !code) return void (await answer());
    const edit = (text: string) => tg("editMessageText", { chat_id: chat.id, message_id: cq.message!.message_id, text, parse_mode: "HTML" }).catch(() => {});
    const setKeyboard = (inline_keyboard: unknown[][]) => tg("editMessageReplyMarkup", { chat_id: chat.id, message_id: cq.message!.message_id, reply_markup: { inline_keyboard } }).catch(() => {});
    if (act === "ls") return void (await onLeadStatus(code, arg, chat, answer, setKeyboard));
    if (act === "rv") return void (await onRevert(code, chat, answer, cq.message?.reply_markup?.inline_keyboard ?? [], setKeyboard));
    if (act === "no") {
      await answer();
      await edit("Не подключили. Если это была не ваша ссылка — всё в порядке, ничего не изменилось.");
      return;
    }
    if (act !== "link") return void (await answer());
    const rec = await takeLink(code);
    if (!rec) {
      await answer("Ссылка устарела");
      await edit(STALE);
      return;
    }
    const b = await businessName(rec.businessId);
    if (!b) return void (await edit("Бизнес не найден. Попробуйте подключить Telegram заново из настроек."));
    await saveNotify(b.id, { telegramChatId: String(chat.id), telegramName: chatName(chat), linkedAt: new Date() });
    await clearUnlinked(b.id);
    await answer("Подключено");
    await edit(`Готово! Новые заявки «${esc(b.name)}» будут приходить сюда сразу, а по утрам — короткая сводка.\n\nОтключить — в настройках сервиса или командой /stop.`);
    return;
  }

  const m = u.message;
  if (!m?.text) return;
  const chat = m.chat;
  const text = m.text.trim();
  if (text.startsWith("/start")) {
    const code = text.slice(6).trim();
    if (!code) {
      await reply(chat.id, "Это бот сервиса «Самоход». Чтобы получать сюда заявки, откройте «Настройки» в сервисе и нажмите «Подключить Telegram».");
      return;
    }
    const rec = await peekLink(code);
    if (!rec) return void (await reply(chat.id, STALE));
    const b = await businessName(rec.businessId);
    if (!b) return void (await reply(chat.id, "Бизнес не найден. Попробуйте подключить Telegram заново из настроек."));
    await reply(
      chat.id,
      `Подключить уведомления для «${esc(b.name)}»?\n\nСюда будут приходить новые заявки с именем и телефоном клиента. Подключайте, только если это ваш бизнес и вы сами нажали «Подключить Telegram» в сервисе «Самоход».`,
      { reply_markup: { inline_keyboard: [[{ text: "Подключить", callback_data: `link:${code}` }, { text: "Это не я", callback_data: `no:${code}` }]] } },
    );
    return;
  }
  if (text.startsWith("/stop")) {
    const rows = await db.update(schema.notifySettings).set({ telegramChatId: null, telegramName: null, updatedAt: new Date() }).where(eq(schema.notifySettings.telegramChatId, String(chat.id))).returning({ businessId: schema.notifySettings.businessId });
    for (const r of rows) await setUnlinked(r.businessId, "уведомления отключили командой /stop в Telegram", chatName(chat));
    await reply(chat.id, "Уведомления отключены. Включить снова можно в настройках сервиса «Самоход».");
    return;
  }
  await reply(chat.id, "Я присылаю заявки и утреннюю сводку. Управлять уведомлениями можно в настройках сервиса «Самоход». /stop — отключить.");
}

/** Локальный режим без https: забираем обновления сами (вызывается при проверке статуса подключения) */
export async function pollUpdates() {
  if (!tgConfigured() || webhookMode()) return;
  const offset = (await kvGet<number>("tg:offset")) ?? 0;
  const list = await tg<TgUpdate[]>("getUpdates", { offset, timeout: 0, allowed_updates: ["message", "callback_query"] }).catch(() => [] as TgUpdate[]);
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
export async function notifyLead(l: { leadId?: string; businessId: string; businessName: string; name: string | null; contact: string; service: string | null; source: string | null; adTitle: string | null }) {
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
    l.leadId ? "После звонка отметьте, чем закончилось, — так робот считает настоящую стоимость клиента." : null,
  ].filter((x) => x !== null);
  return sendToBusiness(l.businessId, lines.join("\n"), l.leadId ? { reply_markup: { inline_keyboard: leadKeyboard(l.leadId, null) } } : {});
}

/** Всплеск заявок: шлём одно предупреждение вместо десятков сообщений */
export async function notifySuspect(businessId: string, name: string, perHour: number) {
  if (!tgConfigured()) return { ok: false };
  return sendToBusiness(businessId, [
    `<b>Подозрительно много заявок</b> · ${esc(name)}`,
    "",
    `За последний час пришло больше ${perHour} заявок со страницы записи — похоже на спам или накрутку.`,
    "Мы их сохраняем, но больше не присылаем по одной и не учитываем в решениях робота. Проверьте их в разделе «Статистика → Последние обращения» — там они помечены «похоже на спам».",
    "",
    `${appUrl()}/app/stats`,
  ].join("\n"));
}

/**
 * Утренняя сводка за вчера: расход, обращения, что сделал робот. null — если сообщать нечего.
 * Под сводкой — кнопки «Отменить» для изменений робота за последние сутки (те же проверки, что в «Истории»).
 */
export type Digest = { text: string; keyboard: TgButton[][] };
export async function buildDigest(businessId: string): Promise<Digest | null> {
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
    .where(and(eq(schema.leads.businessId, b.id), ne(schema.leads.kind, "suspect"), or(isNull(schema.leads.status), ne(schema.leads.status, "spam")), gte(schema.leads.createdAt, dayStart), lt(schema.leads.createdAt, dayEnd)));
  const robot = await db
    .select({ id: schema.changes.id, title: schema.changes.title, undo: schema.changes.undo })
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
  const undoable = changes.slice(0, 5).filter((c) => c.undo?.length);
  if (undoable.length) out.push("", "Не согласны с шагом — нажмите «Отменить» под сообщением.");
  out.push("", `Подробнее: ${appUrl()}/app/history`);
  return { text: out.join("\n"), keyboard: undoable.map((c) => [{ text: `Отменить: ${short(c.title, 48)}`, callback_data: `rv:${c.id}` }]) };
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
      const d = await buildDigest(s.businessId);
      if (d && (await sendToBusiness(s.businessId, d.text, d.keyboard.length ? { reply_markup: { inline_keyboard: d.keyboard } } : {})).ok) sent++;
      else skipped++;
    } catch (e) {
      console.error("digest", s.businessId, e);
      skipped++;
    }
    await saveNotify(s.businessId, { lastDigestAt: new Date() });
  }
  return { sent, skipped };
}

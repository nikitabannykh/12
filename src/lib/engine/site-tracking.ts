import "server-only";
/**
 * Подключение сайта владельца: стоит ли наш код (t.js) на сайте и доходят ли с него события.
 *
 * Что храним (таблица kv, по ключу на бизнес — без гонок между записями):
 *  - site:seen:<id>  — последний сигнал «код стоит» от трекера (kind=ping), {at, host, ym}
 *  - site:event:<id> — последнее событие с сайта (обращение или заход по рекламе), {at, kind, via, host}
 *  - site:check:<id> — результат последней проверки кнопкой «Проверить установку» (загрузка сайта сервером)
 * События с нашей же страницы записи (/p/…) сюда не пишутся — это не сайт владельца.
 *
 * siteTrackingStatus(businessId) — только чтение; им пользуются настройки и проверка здоровья (health.ts).
 */
import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Business } from "@/lib/db/schema";
import { appUrl, errorText, hostOf } from "@/lib/util";
import { landingFor, landingOf } from "./landing";
import { accountsFor } from "./launch";
import { decrypt } from "@/lib/crypto";
import { ensureGoals, GOALS } from "@/lib/platforms/metrica";
import { fetchPage, FetchError } from "@/lib/importer/fetch";

const K = {
  seen: (id: string) => `site:seen:${id}`,
  event: (id: string) => `site:event:${id}`,
  check: (id: string) => `site:check:${id}`,
};

export type SiteEventKind = "form" | "phone" | "messenger" | "booking" | "visit" | "suspect";
export const EVENT_LABEL: Record<SiteEventKind, string> = {
  form: "отправка формы",
  phone: "клик по телефону",
  messenger: "переход в мессенджер",
  booking: "переход в онлайн-запись",
  visit: "заход по рекламной ссылке",
  suspect: "обращение (похоже на спам)",
};

export type SiteCheck = {
  at: string;
  url: string;
  /** key — код с ключом этого бизнеса; other_key — наш код, но с чужим ключом; none — кода нет; error — сайт не открылся */
  found: "key" | "other_key" | "none" | "error";
  /** На странице есть код счётчика Метрики, выбранного в сервисе */
  counterFound: boolean | null;
  message: string | null;
  goals: GoalsState;
};

export type GoalsState =
  | { state: "ok"; created: number }
  | { state: "no_counter" | "no_token" | "no_consent" }
  | { state: "error"; message: string };

export type SiteTrackingStatus = {
  /** Реклама хоть в одном канале ведёт на сайт владельца — код нужен */
  needed: boolean;
  siteUrl: string | null;
  /** ok — код стоит (сигнал или событие за 14 дней, либо найден проверкой); missing — проверка не нашла кода и сигналов нет; unknown — ещё не проверяли */
  state: "ok" | "missing" | "unknown";
  lastSeen: { at: string; host: string | null } | null;
  lastEvent: { at: string; kind: SiteEventKind; label: string; host: string | null } | null;
  check: SiteCheck | null;
  counterId: number | null;
  /** Все цели Самохода есть в счётчике (по сохранённым ID) */
  goalsOk: boolean;
};

type Seen = { at: string; host: string | null; ym?: boolean };
type LastEvent = { at: string; kind: SiteEventKind; host: string | null };

async function kvGet<T>(key: string): Promise<T | null> {
  const db = await getDb();
  const [r] = await db.select({ value: schema.kv.value }).from(schema.kv).where(eq(schema.kv.key, key));
  return (r?.value as T) ?? null;
}
async function kvSet(key: string, value: unknown) {
  const db = await getDb();
  await db.insert(schema.kv).values({ key, value }).onConflictDoUpdate({ target: schema.kv.key, set: { value, updatedAt: new Date() } });
}

/** Хост из Origin/Referer запроса трекера (браузер подставляет сам), иначе — присланный трекером */
export function eventHost(req: Request, claimed: unknown): string | null {
  const from = req.headers.get("origin") || req.headers.get("referer");
  let h: string | null = null;
  try {
    if (from && from !== "null") h = new URL(from).host;
  } catch {
    /* ниже */
  }
  if (!h && typeof claimed === "string" && /^[\w.-]{1,253}(:\d{1,5})?$/.test(claimed)) h = claimed;
  return h ? h.toLowerCase().replace(/^www\./, "") : null;
}

/** Событие пришло с нашей страницы записи (/p/…), а не с сайта владельца */
const ownHost = (host: string | null) => Boolean(host) && host === new URL(appUrl()).host.toLowerCase().replace(/^www\./, "");

/** Сигнал «код стоит». Пишем не чаще раза в 10 минут (кроме проверки по кнопке) */
export async function recordSiteSeen(businessId: string, host: string | null, opts: { force?: boolean; ym?: boolean } = {}) {
  if (ownHost(host)) return;
  if (!opts.force) {
    const prev = await kvGet<Seen>(K.seen(businessId));
    if (prev && Date.now() - Date.parse(prev.at) < 10 * 60e3 && prev.host === host) return;
  }
  await kvSet(K.seen(businessId), { at: new Date().toISOString(), host, ym: Boolean(opts.ym) } satisfies Seen);
}

export async function recordSiteEvent(businessId: string, kind: SiteEventKind, host: string | null) {
  if (ownHost(host)) return;
  const at = new Date().toISOString();
  await kvSet(K.event(businessId), { at, kind, host } satisfies LastEvent);
  // Событие — тоже доказательство, что код стоит
  await kvSet(K.seen(businessId), { at, host } satisfies Seen);
}

function siteNeeded(b: Pick<Business, "siteUrl" | "publicKey" | "landing">) {
  if (!b.siteUrl) return false;
  if (landingFor(b).kind === "site") return true;
  const s = landingOf(b);
  return Object.values(s.channels ?? {}).some((t) => t?.mode === "site");
}

const FRESH_MS = 14 * 864e5;

export async function siteTrackingStatus(businessId: string): Promise<SiteTrackingStatus | null> {
  const db = await getDb();
  const [b] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
  if (!b) return null;
  const rows = await db.select().from(schema.kv).where(inArray(schema.kv.key, [K.seen(b.id), K.event(b.id), K.check(b.id)]));
  const get = <T,>(k: string) => (rows.find((r) => r.key === k)?.value as T) ?? null;
  const seen = get<Seen>(K.seen(b.id));
  const ev = get<LastEvent>(K.event(b.id));
  const check = get<SiteCheck>(K.check(b.id));
  const fresh = (iso?: string | null) => Boolean(iso) && Date.now() - Date.parse(iso!) < FRESH_MS;
  const seenOk = fresh(seen?.at);
  const state: SiteTrackingStatus["state"] =
    seenOk || check?.found === "key" ? "ok" : check && check.found !== "error" ? "missing" : seen ? "missing" : "unknown";
  const goalIds = (b.goalIds ?? {}) as Record<string, number>;
  return {
    needed: siteNeeded(b),
    siteUrl: b.siteUrl ?? null,
    state,
    lastSeen: seen ? { at: seen.at, host: seen.host ?? null } : null,
    lastEvent: ev ? { at: ev.at, kind: ev.kind, label: EVENT_LABEL[ev.kind] ?? "событие", host: ev.host ?? null } : null,
    check,
    counterId: b.counterId ?? null,
    goalsOk: Boolean(b.counterId) && GOALS.every((g) => Number(goalIds[g.key]) > 0),
  };
}

/** Токен Яндекса владельца (тот же аккаунт, что и Директ: у него права metrika:read/write) */
async function yandexToken(userId: string) {
  const accs = (await accountsFor(userId)).filter((a) => a.platform === "yandex");
  const acc = accs.find((a) => a.status === "ok") ?? accs[0];
  return acc ? decrypt(acc.accessToken) : null;
}

/**
 * Цели Самохода в счётчике. Трогаем счётчик только с согласия:
 *  - счётчик создан/выбран сервисом при запуске (записи о «своём» счётчике нет) — цели и так ставит запуск;
 *  - свой счётчик владельца — только если согласие из выбора счётчика дано именно для него.
 */
export async function ensureSiteGoals(b: Business, userId: string): Promise<GoalsState> {
  if (!b.counterId) return { state: "no_counter" };
  const own = await kvGet<{ counterId?: number }>(`metrica:own:${b.id}`);
  if (own && Number(own.counterId) !== b.counterId) return { state: "no_consent" };
  const token = await yandexToken(userId);
  if (!token) return { state: "no_token" };
  const before = (b.goalIds ?? {}) as Record<string, number>;
  try {
    const goals = await ensureGoals(token, b.counterId);
    const created = Object.entries(goals).filter(([k, id]) => Number(before[k]) !== id).length;
    if (created) {
      const db = await getDb();
      await db.update(schema.businesses).set({ goalIds: { ...before, ...goals }, updatedAt: new Date() }).where(eq(schema.businesses.id, b.id));
    }
    return { state: "ok", created };
  } catch (e) {
    return { state: "error", message: `${errorText(e)}. Нужен доступ к Метрике с правом редактирования — подключите Яндекс заново.` };
  }
}

/** Проверка установки: загружаем сайт (без SSRF — fetchPage) и ищем наш код с ключом бизнеса и код счётчика */
export async function checkSiteInstall(b: Business, userId: string): Promise<SiteCheck> {
  const url = b.siteUrl!;
  let found: SiteCheck["found"] = "error";
  let counterFound: boolean | null = null;
  let message: string | null = null;
  try {
    const page = await fetchPage(url, { timeoutMs: 10_000, maxBytes: 2 * 1024 * 1024 });
    if (page.status >= 400) {
      message = `Сайт ответил ошибкой ${page.status}`;
    } else {
      const html = page.html;
      const hasKey = html.includes(`data-key="${b.publicKey}"`) || html.includes(`data-key='${b.publicKey}'`);
      const hasOurScript = /\/t\.js["'][^>]*data-key=|data-key=[^>]*\/t\.js/i.test(html) && html.includes(hostOf(appUrl()));
      found = hasKey ? "key" : hasOurScript ? "other_key" : "none";
      if (b.counterId) counterFound = new RegExp(`(ym\\(\\s*${b.counterId}\\b|mc\\.yandex\\.ru/watch/${b.counterId}\\b|data-ym=["']${b.counterId}["'])`).test(html);
    }
  } catch (e) {
    message = e instanceof FetchError ? e.message : errorText(e);
  }
  const goals = await ensureSiteGoals(b, userId);
  const check: SiteCheck = { at: new Date().toISOString(), url, found, counterFound, message, goals };
  await kvSet(K.check(b.id), check);
  return check;
}


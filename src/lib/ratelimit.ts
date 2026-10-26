import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { randomBytes } from "node:crypto";
import { fingerprint, sign, verify } from "./crypto";

/**
 * Лимит «не больше N событий за окно» — счётчики лежат в Postgres, поэтому работают
 * на serverless, где у каждого запроса может быть свой экземпляр.
 * Одна атомарная операция: INSERT … ON CONFLICT DO UPDATE … RETURNING.
 */
export async function hit(key: string, limit: number, windowSec: number): Promise<{ ok: boolean; count: number }> {
  const db = await getDb();
  const reset = new Date(Date.now() + windowSec * 1000);
  const t = schema.rateLimits;
  const [row] = await db
    .insert(t)
    .values({ key, count: 1, resetAt: reset })
    .onConflictDoUpdate({
      target: t.key,
      set: {
        count: sql`CASE WHEN ${t.resetAt} < now() THEN 1 ELSE ${t.count} + 1 END`,
        resetAt: sql`CASE WHEN ${t.resetAt} < now() THEN ${reset.toISOString()}::timestamptz ELSE ${t.resetAt} END`,
      },
    })
    .returning({ count: t.count });
  // Изредка подчищаем старые счётчики
  if (Math.random() < 0.02) await db.delete(t).where(lt(t.resetAt, new Date(Date.now() - 3600e3))).catch(() => {});
  const count = Number(row?.count ?? 1);
  return { ok: count <= limit, count };
}

/** Проверяет сразу несколько лимитов; true — если все в пределах */
export async function within(rules: { key: string | null; limit: number; windowSec: number }[]): Promise<boolean> {
  let ok = true;
  for (const r of rules) if (r.key && !(await hit(r.key, r.limit, r.windowSec)).ok) ok = false;
  return ok;
}

const first = (v: string | null) => (v ? v.split(",")[0].trim() : "");

/**
 * IP клиента — только из заголовков, которые не может подделать сам клиент:
 *  - на Vercel: x-vercel-forwarded-for / x-real-ip (их выставляет платформа, присланные клиентом она перезаписывает);
 *  - за своим прокси: заголовок из TRUSTED_IP_HEADER (например, x-real-ip у nginx или cf-connecting-ip у Cloudflare).
 * Иначе — null: x-forwarded-for без доверенного прокси присылает сам клиент (Next.js его не перезаписывает),
 * и лимит «по IP» превратился бы либо в обходимый, либо в общий на всех. Тогда лимиты по IP не применяются,
 * а защищают одноразовый токен формы и пометка «похоже на спам».
 */
export function clientIp(req: Request): string | null {
  const h = req.headers;
  if (process.env.VERCEL) return first(h.get("x-vercel-forwarded-for")) || first(h.get("x-real-ip")) || null;
  const trusted = process.env.TRUSTED_IP_HEADER?.trim().toLowerCase();
  if (trusted) return first(h.get(trusted)) || null;
  return null;
}

/** Ключ лимита по IP: сам адрес не храним, только необратимый отпечаток. null — IP неизвестен, лимит пропускаем. */
export const ipKey = (scope: string, req: Request): string | null => {
  const ip = clientIp(req);
  return ip ? `${scope}:ip:${fingerprint(ip)}` : null;
};

// --- Токен формы заявки ---

/**
 * Выдаётся при открытии страницы записи: время открытия (быстрее MIN_FILL_MS заполняют только боты)
 * и случайный nonce. Действует 2 часа и только для одной заявки — повторно отправить тот же токен нельзя.
 */
export type FormToken = { k: string; t: number; n: string; exp: number };
export const FORM_TTL_MS = 2 * 3600e3;
export function formToken(publicKey: string, now = Date.now()): string {
  return sign({ k: publicKey, t: now, n: randomBytes(12).toString("base64url"), exp: now + FORM_TTL_MS } satisfies FormToken);
}
export function readFormToken(token: unknown, publicKey: string): FormToken | null {
  const v = typeof token === "string" && token.length < 1000 ? verify<FormToken>(token) : null;
  return v && v.k === publicKey && typeof v.n === "string" && v.n.length >= 8 ? v : null;
}
/** Погасить токен: true — если им ещё не пользовались. Атомарно (тот же счётчик, что у лимитов). */
export async function consumeFormToken(v: FormToken): Promise<boolean> {
  const left = Math.max(60, Math.ceil((v.exp - Date.now()) / 1000) + 60);
  return (await hit(`form-nonce:${v.n}`, 1, left)).ok;
}

// --- Атрибуция заявок: откуда пришёл человек ---

/**
 * «Первое касание» — utm-метки визита, подписанные сервером. Трекер (t.js) получает подпись при первом
 * заходе по рекламной ссылке и хранит её в localStorage; при заявке присылает обратно. Подделать метки
 * в теле запроса больше нельзя, а объявление засчитывается, только если оно действительно принадлежит бизнесу.
 */
export type FirstTouch = { k: string; s: string | null; c: string | null; a: string | null; t: number; exp: number };
const FT_TTL = 30 * 864e5;
const clean = (v: unknown, max = 40) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s && s.length <= max && /^[\w.\-]+$/.test(s) && !s.includes("{") ? s : null;
};

export function signFirstTouch(publicKey: string, p: { source?: unknown; campaign?: unknown; ad?: unknown }): string | null {
  const s = clean(p.source, 30)?.toLowerCase() ?? null;
  if (!s) return null;
  return sign({ k: publicKey, s, c: clean(p.campaign), a: clean(p.ad), t: Date.now(), exp: Date.now() + FT_TTL } satisfies FirstTouch);
}

const SOURCES = ["yandex", "vk", "demo"];
export const normSource = (s: string | null | undefined) => {
  const v = (s || "").toLowerCase();
  return SOURCES.find((x) => v.includes(x)) ?? null;
};

export type Attribution = { source: string | null; campaignExt: string | null; adExt: string | null; adTitle: string | null };

/** Проверяет подписанное первое касание; объявление и кампанию принимает, только если они принадлежат бизнесу */
export async function attribute(b: { id: string; publicKey: string }, token: unknown): Promise<Attribution> {
  const none: Attribution = { source: null, campaignExt: null, adExt: null, adTitle: null };
  const ft = typeof token === "string" && token.length < 1000 ? verify<FirstTouch>(token) : null;
  if (!ft || ft.k !== b.publicKey) return none;
  const out: Attribution = { ...none, source: normSource(ft.s) };
  const db = await getDb();
  if (ft.a) {
    const [ad] = await db
      .select({ title: schema.ads.title, campaignId: schema.ads.campaignId })
      .from(schema.ads)
      .where(and(eq(schema.ads.businessId, b.id), eq(schema.ads.externalId, ft.a)));
    if (ad) {
      // Не больше 30 засчитанных обращений на объявление в сутки — иначе накрутка сломает выводы робота
      if ((await hit(`attr:${b.id}:${ft.a}`, 30, 86400)).ok) {
        out.adExt = ft.a;
        out.adTitle = ad.title;
      }
      const [c] = await db.select({ ext: schema.campaigns.externalId }).from(schema.campaigns).where(eq(schema.campaigns.id, ad.campaignId));
      out.campaignExt = c?.ext ?? null;
    }
  }
  if (!out.campaignExt && ft.c) {
    const [c] = await db.select({ id: schema.campaigns.id }).from(schema.campaigns).where(and(eq(schema.campaigns.businessId, b.id), eq(schema.campaigns.externalId, ft.c)));
    if (c) out.campaignExt = ft.c;
  }
  return out;
}

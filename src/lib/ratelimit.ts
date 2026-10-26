import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
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
export async function within(rules: { key: string; limit: number; windowSec: number }[]): Promise<boolean> {
  let ok = true;
  for (const r of rules) if (!(await hit(r.key, r.limit, r.windowSec)).ok) ok = false;
  return ok;
}

/** IP клиента (на Vercel — первый адрес в x-forwarded-for) */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  return (xff ? xff.split(",")[0] : req.headers.get("x-real-ip") || "").trim() || "unknown";
}

/** Ключ лимита по IP: сам адрес не храним, только необратимый отпечаток */
export const ipKey = (scope: string, req: Request) => `${scope}:ip:${fingerprint(clientIp(req))}`;

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

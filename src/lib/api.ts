import "server-only";
import { NextResponse } from "next/server";
import { getUser, type SessionUser } from "./auth";
import { getBusinessForUser } from "./engine/launch";
import type { Business } from "./db/schema";
import { appUrl, errorText } from "./util";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function originOf(v: string | null): string | null {
  if (!v) return null;
  try {
    return new URL(v).origin;
  } catch {
    return null;
  }
}

/** Свои адреса: APP_URL и адрес, по которому реально пришёл запрос (превью-домены Vercel) */
function ownOrigins(req: Request): Set<string> {
  const set = new Set<string>([new URL(appUrl()).origin]);
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (host) {
    const proto = req.headers.get("x-forwarded-proto") || new URL(req.url).protocol.replace(":", "");
    set.add(`${proto.split(",")[0].trim()}://${host.split(",")[0].trim()}`);
  }
  return set;
}

/**
 * Защита от CSRF для запросов, меняющих данные: браузер всегда присылает Origin при POST/PATCH/DELETE
 * с чужого сайта. Без Origin смотрим Sec-Fetch-Site и Referer; запросы не из браузера (curl, скрипты)
 * без этих заголовков пропускаем — у них нет чужих cookie, значит, и CSRF невозможен.
 */
export function sameOrigin(req: Request): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return true;
  const own = ownOrigins(req);
  const origin = req.headers.get("origin");
  if (origin && origin !== "null") return own.has(origin);
  if (origin === "null") return false;
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none";
  const ref = originOf(req.headers.get("referer"));
  if (ref) return own.has(ref);
  return true;
}

export const csrfError = () => fail("Запрос отклонён: он пришёл не со страницы сервиса. Обновите страницу и попробуйте ещё раз.", 403);

export function route<T>(fn: (ctx: { user: SessionUser; business: Business | null; req: Request; params: T }) => Promise<Response>) {
  return async (req: Request, ctx: { params: Promise<T> }) => {
    try {
      if (!sameOrigin(req)) return csrfError();
      const user = await getUser();
      if (!user) return fail("Нужно войти", 401);
      const business = await getBusinessForUser(user.id);
      return await fn({ user, business, req, params: ctx?.params ? await ctx.params : ({} as T) });
    } catch (e) {
      console.error(e);
      const status = Number((e as { status?: number })?.status) || 500;
      return fail(errorText(e), status >= 400 && status < 600 ? status : 500);
    }
  };
}

export function needBusiness(b: Business | null): asserts b is Business {
  if (!b) throw Object.assign(new Error("Сначала расскажите о бизнесе"), { status: 400 });
}

/** Куда вернуть человека после подключения: только относительный путь внутри сервиса */
export function safeBack(v: string | null | undefined, fallback = "/app/settings"): string {
  if (!v || typeof v !== "string" || v.length > 300) return fallback;
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\") || /[\\@\s]/.test(v) || /[\u0000-\u001f]/.test(v)) return fallback;
  try {
    const base = new URL(appUrl());
    const u = new URL(v, base);
    if (u.origin !== base.origin) return fallback;
    return u.pathname + u.search;
  } catch {
    return fallback;
  }
}

/** Добавить к пути параметр (?a=1 или &a=1) */
export const withQuery = (path: string, q: string) => `${path}${path.includes("?") ? "&" : "?"}${q}`;

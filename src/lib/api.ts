import "server-only";
import { NextResponse } from "next/server";
import { getUser, type SessionUser } from "./auth";
import { getBusinessForUser } from "./engine/launch";
import type { Business } from "./db/schema";
import { errorText } from "./util";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export function route<T>(fn: (ctx: { user: SessionUser; business: Business | null; req: Request; params: T }) => Promise<Response>) {
  return async (req: Request, ctx: { params: Promise<T> }) => {
    try {
      const user = await getUser();
      if (!user) return fail("Нужно войти", 401);
      const business = await getBusinessForUser(user.id);
      return await fn({ user, business, req, params: ctx?.params ? await ctx.params : ({} as T) });
    } catch (e) {
      console.error(e);
      return fail(errorText(e), 500);
    }
  };
}

export function needBusiness(b: Business | null): asserts b is Business {
  if (!b) throw Object.assign(new Error("Сначала расскажите о бизнесе"), { status: 400 });
}

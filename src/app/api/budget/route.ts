import { eq } from "drizzle-orm";
import { route, json, fail, needBusiness } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { applyMonthlyBudget } from "@/lib/engine/optimizer";

export const PATCH = route(async ({ business, req }) => {
  needBusiness(business);
  const { monthly } = await req.json();
  const m = Math.round(Number(monthly));
  if (!Number.isFinite(m) || m < 1000) return fail("Бюджет — от 1 000 ₽ в месяц");
  if (m === business.monthlyBudget) return json({ ok: true });
  if (business.status !== "active") {
    const db = await getDb();
    await db.update(schema.businesses).set({ monthlyBudget: m, updatedAt: new Date() }).where(eq(schema.businesses.id, business.id));
    return json({ ok: true });
  }
  await applyMonthlyBudget(business, m);
  return json({ ok: true });
});

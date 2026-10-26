import { and, eq, inArray } from "drizzle-orm";
import { route, json, fail, needBusiness } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { act } from "@/lib/engine/ops";

export const PATCH = route<{ id: string }>(async ({ business, params, req }) => {
  needBusiness(business);
  const db = await getDb();
  const [g] = await db.select().from(schema.adGroups).where(eq(schema.adGroups.id, params.id));
  if (!g) return fail("Аудитория не найдена", 404);
  const [c] = await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.id, g.campaignId), eq(schema.campaigns.businessId, business.id)));
  if (!c) return fail("Аудитория не найдена", 404);
  const { status } = await req.json();
  if (status !== "active" && status !== "paused") return fail("Неверный статус");
  const ads = await db.select().from(schema.ads).where(and(eq(schema.ads.adGroupId, g.id), inArray(schema.ads.status, status === "paused" ? ["active", "moderation"] : ["paused"])));
  await act(
    {
      businessId: business.id, actor: "owner", kind: status === "active" ? "resume" : "pause",
      title: status === "active" ? `Включили аудиторию «${g.name}»` : `Отключили аудиторию «${g.name}»`,
      reason: status === "active" ? "Вы вернули эту аудиторию — её объявления снова показываются." : "Вы отключили аудиторию. Её объявления больше не показываются, бюджет канала уходит на остальные.",
    },
    [{ op: "groupStatus", groupId: g.id, status, adIds: ads.map((a) => a.id) }],
  );
  return json({ ok: true });
});

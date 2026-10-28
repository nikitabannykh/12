import { eq } from "drizzle-orm";
import { route, json, fail, needBusiness } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { logChange } from "@/lib/engine/ops";
import { landingFor, sanitizeLanding } from "@/lib/engine/landing";
import { applyLanding } from "@/lib/engine/landingApply";
import { CHANNEL_NAME } from "@/lib/platforms";
import { appUrl, isLaunched } from "@/lib/util";

export const maxDuration = 60;

/** Куда ведёт реклама: страница записи, сайт или своя ссылка; отдельно по каналам. Для идущей рекламы меняем ссылки сразу */
export const PUT = route(async ({ business, req }) => {
  needBusiness(business);
  const { settings, error } = sanitizeLanding(await req.json().catch(() => ({})));
  if (error) return fail(error);
  if (settings.mode === "site" && !business.siteUrl) return fail("Сайт не указан — добавьте его в «Ссылках на бизнес» или выберите другую ссылку");
  for (const t of Object.values(settings.channels ?? {})) if (t?.mode === "site" && !business.siteUrl) return fail("Сайт не указан — добавьте его в «Ссылках на бизнес»");
  const db = await getDb();
  const before = landingFor(business, null, appUrl()).url;
  await db.update(schema.businesses).set({ landing: settings, updatedAt: new Date() }).where(eq(schema.businesses.id, business.id));
  const next = { ...business, landing: settings };
  const after = landingFor(next, null, appUrl());
  const per = Object.keys(settings.channels ?? {}).map((ch) => `${CHANNEL_NAME[ch] ?? ch} → ${landingFor(next, ch, appUrl()).url}`);
  const result = isLaunched(business.status) ? await applyLanding(next, business) : { updated: 0, warnings: [] };
  await logChange({
    businessId: business.id, actor: "owner", kind: "settings",
    title: "Изменили, куда ведёт реклама",
    reason: `${before !== after.url ? `Все каналы: ${after.url}. ` : ""}${per.length ? `Отдельно: ${per.join("; ")}. ` : ""}${result.updated ? `Обновили ссылки в ${result.updated} кампаниях — объявления пройдут модерацию заново.` : ""}`.trim() || "Без изменений ссылки.",
  });
  return json({ settings, updated: result.updated, warnings: result.warnings });
});

import { eq } from "drizzle-orm";
import { route, json, needBusiness } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { logChange } from "@/lib/engine/ops";
import { sanitizeShow, showSummary, type ShowSettings } from "@/lib/engine/show";
import { timeTargeting } from "@/lib/engine/extras";
import { applyReach, applyShowSettings } from "@/lib/engine/showApply";
import { REACH_INFO, recommendedReach } from "@/lib/engine/show";

export const maxDuration = 60;

export const GET = route(async ({ business }) => {
  needBusiness(business);
  return json({ settings: (business.showSettings ?? {}) as ShowSettings });
});

/**
 * Настройки показа: регион, возраст и пол, расписание. Если реклама уже идёт — сразу меняем их в кабинетах
 * (без пересоздания кампаний). Черновик запуска подхватит их при запуске.
 */
export const PUT = route(async ({ business, req }) => {
  needBusiness(business);
  const settings = sanitizeShow(await req.json().catch(() => ({})));
  const db = await getDb();
  const prev = showSummary((business.showSettings ?? {}) as ShowSettings, business, timeTargeting({ ...business, showSettings: {} })?.note ?? null);
  await db.update(schema.businesses).set({ showSettings: settings, updatedAt: new Date() }).where(eq(schema.businesses.id, business.id));
  const next = { ...business, showSettings: settings };
  const sum = showSummary(settings, business, timeTargeting({ ...business, showSettings: {} })?.note ?? null);
  let result: { updated: number; warnings: string[] } = { updated: 0, warnings: [] };
  const prevReach = ((business.showSettings ?? {}) as ShowSettings).reach ?? recommendedReach(business.monthlyBudget);
  const nextReach = settings.reach ?? recommendedReach(business.monthlyBudget);
  const live = business.status === "active" || business.status === "paused";
  if (live) result = await applyShowSettings(next);
  let reachChanged = 0;
  if (live && prevReach !== nextReach) {
    const r = await applyReach(next);
    reachChanged = r.updated;
    result.warnings.push(...r.warnings);
  }
  const diff = [
    prev.where !== sum.where ? `Где: ${sum.where}` : null,
    prev.who !== sum.who ? `Кому: ${sum.who}` : null,
    prev.when !== sum.when ? `Когда: ${sum.when}` : null,
    prevReach !== nextReach ? `Охват поиска: ${REACH_INFO[nextReach].label} (${REACH_INFO[nextReach].short})${reachChanged ? `, в Директе изменили ${reachChanged} фраз` : ""}` : null,
  ].filter(Boolean) as string[];
  if (diff.length) {
    await logChange({
      businessId: business.id, actor: "owner", kind: "settings",
      title: "Изменили настройки показа",
      reason: `${diff.join(". ")}.${result.updated ? ` Обновили ${result.updated} ${result.updated === 1 ? "кампанию" : "кампании"} в кабинетах без перезапуска.` : ""}`,
    });
  }
  return json({ settings, summary: sum, updated: result.updated, warnings: result.warnings });
});

import "server-only";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { Business } from "../db/schema";
import { clientFor, CHANNEL_NAME } from "../platforms";
import { VkAds } from "../platforms/vk";
import { isDirectChannel } from "./launch";
import { timeTargeting } from "./extras";
import { regionIdsFor, vkAdContext, vkLocalGeo } from "./regions";
import { directDemographics, recommendedReach, showOf } from "./show";
import { displayKeyword, geoTerms, reachKeywords } from "./semantics";
import type { TargetingUpdate } from "../platforms/types";

type GroupTargeting = { ageFrom?: number; ageTo?: number; sex?: "female" | "male" | "any"; regionIds?: number[]; retargetingId?: string | null; base?: { ageFrom?: number; ageTo?: number; sex?: "female" | "male" | "any" } };

/**
 * Возраст: владелец задал хоть одну границу — вторую берём из ниши, только если она не противоречит первой
 * («от 50» владельца + «до 45» ниши дали бы пустой диапазон), иначе оставляем открытой. И всегда ageTo ≥ ageFrom.
 */
function ownerAges(s: { ageFrom?: number | null; ageTo?: number | null }, base: { ageFrom?: number; ageTo?: number }): { ageFrom?: number; ageTo?: number } {
  if (s.ageFrom == null && s.ageTo == null) return { ageFrom: base.ageFrom, ageTo: base.ageTo };
  let ageFrom = s.ageFrom ?? (base.ageFrom != null && s.ageTo != null && base.ageFrom <= s.ageTo ? base.ageFrom : undefined);
  let ageTo = s.ageTo ?? (base.ageTo != null && s.ageFrom != null && base.ageTo >= s.ageFrom ? base.ageTo : undefined);
  if (ageFrom != null && ageTo != null && ageTo < ageFrom) [ageFrom, ageTo] = [ageTo, ageFrom];
  return { ageFrom, ageTo };
}

/**
 * Применить «Настройки показа» к уже запущенным кампаниям: регион групп, возраст и пол, расписание.
 * Кампании не пересоздаются — статистика и обучение сохраняются. Возраст и пол из аудитории ниши запоминаем
 * в targeting.base, чтобы при возврате к «Подбирает робот» вернуть их.
 */
export async function applyShowSettings(b: Business): Promise<{ updated: number; warnings: string[] }> {
  const db = await getDb();
  const s = showOf(b);
  const camps = await db
    .select()
    .from(schema.campaigns)
    .where(and(eq(schema.campaigns.businessId, b.id), inArray(schema.campaigns.status, ["active", "paused"]), isNotNull(schema.campaigns.externalId)));
  const warnings: string[] = [];
  let updated = 0;
  for (const camp of camps) {
    const name = CHANNEL_NAME[camp.channel];
    try {
      const [acc] = await db.select().from(schema.adAccounts).where(eq(schema.adAccounts.id, camp.accountId));
      if (!acc) continue;
      const client = await clientFor(acc);
      if (!client.updateTargeting) continue;
      if (client instanceof VkAds) client.useBusiness({ ...vkAdContext(b), localGeo: await vkLocalGeo(b).catch(() => null) });
      const regionIds = await regionIdsFor(b, acc.platform, client).catch((e) => {
        warnings.push(`${name}: регион не определили (${(e as Error).message}) — регион кампании оставили прежним`);
        return [] as number[];
      });
      const groups = await db.select().from(schema.adGroups).where(and(eq(schema.adGroups.campaignId, camp.id), isNotNull(schema.adGroups.externalId)));
      const upd: TargetingUpdate = { groups: [] };
      const save: { id: string; targeting: Record<string, unknown> }[] = [];
      for (const g of groups) {
        const t = (g.targeting ?? {}) as GroupTargeting;
        const base = t.base ?? { ageFrom: t.ageFrom, ageTo: t.ageTo, sex: t.sex };
        const eff = { ...ownerAges(s, base), sex: s.sex ?? base.sex };
        upd.groups.push({ groupExt: g.externalId!, regionIds, ...eff, retargetingId: t.retargetingId ?? null });
        save.push({ id: g.id, targeting: { ...t, base, ...eff, ...(regionIds.length ? { regionIds } : {}) } });
      }
      if (isDirectChannel(camp.channel) && acc.platform !== "vk") {
        upd.timeTargeting = timeTargeting(b);
        upd.demographics = directDemographics(s);
      }
      const w = await client.updateTargeting(camp.externalId!, upd);
      warnings.push(...w.map((x) => `${name}: ${x}`));
      // Группы, которые площадка пропустила («Группа <id>: …»), не отмечаем изменёнными — иначе база и площадка разойдутся
      const skipped = new Set(groups.filter((g) => w.some((x) => x.startsWith(`Группа ${g.externalId}:`))).map((g) => g.id));
      for (const x of save) if (!skipped.has(x.id)) await db.update(schema.adGroups).set({ targeting: x.targeting }).where(eq(schema.adGroups.id, x.id));
      updated++;
    } catch (e) {
      warnings.push(`${name}: ${(e as Error).message}`);
    }
  }
  return { updated, warnings };
}


/**
 * Охват поиска у идущей рекламы: в группах поиска оставляем фразы по reachKeywords (остальные — на паузу в Директе,
 * не удаляем), в «Точно» выключаем автотаргетинг. Фразы групп в базе не трогаем — так охват можно вернуть.
 */
export async function applyReach(b: Business): Promise<{ updated: number; warnings: string[] }> {
  const db = await getDb();
  const reach = showOf(b).reach ?? recommendedReach(b.monthlyBudget);
  const camps = await db.select().from(schema.campaigns)
    .where(and(eq(schema.campaigns.businessId, b.id), eq(schema.campaigns.channel, "search"), inArray(schema.campaigns.status, ["active", "paused"]), isNotNull(schema.campaigns.externalId)));
  const geo = geoTerms(b);
  let updated = 0;
  const warnings: string[] = [];
  for (const camp of camps) {
    try {
      const [acc] = await db.select().from(schema.adAccounts).where(eq(schema.adAccounts.id, camp.accountId));
      if (!acc) continue;
      const client = await clientFor(acc);
      if (!client.applyReach) continue;
      const groups = await db.select().from(schema.adGroups).where(and(eq(schema.adGroups.campaignId, camp.id), isNotNull(schema.adGroups.externalId)));
      const perGroup = new Map<string, { keep: Map<string, string>; known: Set<string> }>();
      for (const g of groups) {
        if ((g.targeting as { retargetingId?: string } | null)?.retargetingId) continue;
        const all = g.keywords ?? [];
        perGroup.set(g.externalId!, { keep: new Map(reachKeywords(all, reach, geo).map((k) => [displayKeyword(k), k])), known: new Set(all.map(displayKeyword)) });
      }
      updated += await client.applyReach(camp.externalId!, perGroup, reach !== "precise", displayKeyword);
    } catch (e) {
      warnings.push(`${CHANNEL_NAME[camp.channel]}: охват не применили — ${(e as Error).message}`);
    }
  }
  return { updated, warnings };
}

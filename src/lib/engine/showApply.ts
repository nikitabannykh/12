import "server-only";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { Business } from "../db/schema";
import { clientFor, CHANNEL_NAME } from "../platforms";
import { VkAds } from "../platforms/vk";
import { isDirectChannel } from "./launch";
import { timeTargeting } from "./extras";
import { regionIdsFor, vkAdContext, vkLocalGeo } from "./regions";
import { directDemographics, showOf } from "./show";
import type { TargetingUpdate } from "../platforms/types";

type GroupTargeting = { ageFrom?: number; ageTo?: number; sex?: "female" | "male" | "any"; regionIds?: number[]; retargetingId?: string | null; base?: { ageFrom?: number; ageTo?: number; sex?: "female" | "male" | "any" } };

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
        warnings.push(`${name}: ${(e as Error).message}`);
        return [] as number[];
      });
      const groups = await db.select().from(schema.adGroups).where(and(eq(schema.adGroups.campaignId, camp.id), isNotNull(schema.adGroups.externalId)));
      const upd: TargetingUpdate = { groups: [] };
      const save: { id: string; targeting: Record<string, unknown> }[] = [];
      for (const g of groups) {
        const t = (g.targeting ?? {}) as GroupTargeting;
        const base = t.base ?? { ageFrom: t.ageFrom, ageTo: t.ageTo, sex: t.sex };
        const eff = { ageFrom: s.ageFrom ?? base.ageFrom, ageTo: s.ageTo ?? base.ageTo, sex: s.sex ?? base.sex };
        upd.groups.push({ groupExt: g.externalId!, regionIds, ...eff, retargetingId: t.retargetingId ?? null });
        save.push({ id: g.id, targeting: { ...t, base, ...eff, ...(regionIds.length ? { regionIds } : {}) } });
      }
      if (isDirectChannel(camp.channel) && acc.platform !== "vk") {
        upd.timeTargeting = timeTargeting(b);
        upd.demographics = directDemographics(s);
      }
      const w = await client.updateTargeting(camp.externalId!, upd);
      warnings.push(...w.map((x) => `${name}: ${x}`));
      for (const x of save) await db.update(schema.adGroups).set({ targeting: x.targeting }).where(eq(schema.adGroups.id, x.id));
      updated++;
    } catch (e) {
      warnings.push(`${name}: ${(e as Error).message}`);
    }
  }
  return { updated, warnings };
}

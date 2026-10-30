import type { PlanAd } from "@/lib/engine/launch";

/**
 * Метки правок владельца в объявлении плана (хранятся в том же JSON плана):
 *  edited — текст поправил владелец: «Переписать тексты» его по умолчанию не трогает;
 *  original — вариант робота до первой правки: «Ещё вариант от робота» его не предлагает снова.
 */
export type AdText = { title: string; title2: string | null; text: string };
export type MarkedAd = PlanAd & { edited?: boolean; original?: AdText };

export const marks = (ad: PlanAd) => ad as MarkedAd;
/** Объявление владельца: написал сам или поправил текст робота */
export const ownText = (ad: PlanAd) => ad.angle === "custom" || Boolean(marks(ad).edited);

/** Данные анкеты бизнеса (этап 1 «Данные о бизнесе», см. BusinessOnboarding) и то, что уходит на сервер */
import type { Service } from "@/lib/db/schema";

export type BusinessInput = {
  name: string; niche: string; city: string; address: string; phone: string; whatsapp: string; telegram: string; hours: string; siteUrl: string;
  orgUrl: string; legalInfo: string;
  /** Ссылка на карточку в 2ГИС — хранится в общем списке ссылок (source_links) */
  dgisUrl?: string;
  description: string; services: Service[]; advantages: string[]; audience: string; offer: string; review: string; leadToClientRate: number;
};

/** Пустые строки → null и очистка списков — то, что уходит в POST /api/business */
export function businessPayload(f: BusinessInput, sourceLinks?: string[]) {
  const { dgisUrl: _dgis, ...rest } = f;
  return {
    ...rest,
    ...(sourceLinks ? { sourceLinks } : {}),
    services: f.services.filter((s) => s.name.trim()).slice(0, 40).map((s) => ({ name: s.name.trim(), price: s.price?.trim() || undefined, note: s.note?.trim() || undefined, category: s.category?.trim() || undefined })),
    advantages: f.advantages.map((a) => a.trim()).filter(Boolean),
    address: f.address || null, phone: f.phone || null, whatsapp: f.whatsapp || null, telegram: f.telegram || null, hours: f.hours || null,
    siteUrl: f.siteUrl || null, orgUrl: f.orgUrl.trim() || null, legalInfo: f.legalInfo.trim() || null, audience: f.audience || null, offer: f.offer || null, review: f.review || null,
  };
}

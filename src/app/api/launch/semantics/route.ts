import { route, json, needBusiness } from "@/lib/api";
import type { LaunchPlan } from "@/lib/engine/launch";
import { buildSemanticCore, semanticsView } from "@/lib/engine/semantics";
import { isMedical } from "@/lib/niches";

/**
 * Семантическое ядро для владельца: группы поиска, фразы (без операторов), примеры, минус-слова группы и кампании.
 * У каждой группы — слой (layer: service | problem | adjacent | audience) и его подпись (layerLabel), итоги по слоям — layers.
 * Есть план запуска — из его группы поиска (то, что уйдёт в Директ, с учётом проверки частотности);
 * плана нет — предварительный расчёт по анкете (source: "preview"), без проверки Директом.
 */
export const GET = route(async ({ business }) => {
  needBusiness(business);
  const plan = business.launchPlan as LaunchPlan | null;
  const search = plan?.channels.find((c) => c.channel === "search");
  if (plan && search?.groups.length) {
    const view = semanticsView({
      groups: search.groups.map((g) => ({ id: g.id, name: g.name, service: g.service, services: g.services, keywords: g.keywords, negatives: g.negatives, layer: g.layer })),
      negatives: plan.negatives ?? [],
      geo: plan.semantics?.geo ?? { city: [], local: [] },
      checks: plan.semantics?.checks ?? {},
      medical: plan.semantics?.medical ?? isMedical(business),
    });
    const network = plan.channels.find((c) => c.channel === "network")?.groups.filter((g) => g.keywords.length).map((g) => ({ name: g.name, keywords: g.keywords })) ?? [];
    return json({ source: "plan", enabled: search.enabled, ...view, network });
  }
  const core = buildSemanticCore(business);
  return json({ source: "preview", enabled: true, ...semanticsView(core), network: [] });
});

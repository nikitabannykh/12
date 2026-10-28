/**
 * Решение робота по слоям поиска (без серверных зависимостей — проверяется отдельно от БД).
 * Группы поиска разных слоёв — это разные намерения: «остеопат цена» (услуга) и «болит шея» (проблема). Тёплые слои дают
 * охват, но могут приводить обращения дороже. Когда у групп услуг накопилось достаточно обращений, сравниваем с ними
 * цену обращения каждого слоя и отключаем слой, который стабильно дороже в 2+ раза. Группы слоя, которые владелец недавно
 * менял сам, и группы с хорошей ценой обращения остаются.
 */
import { LAYER_LABEL, type Layer } from "../niches";
import { probBetter } from "./stats";
import { rub, pl } from "../util";

export const LAYER_RULE = {
  /** Окно статистики, дней */
  days: 21,
  /** Сколько обращений должно быть у групп услуг, чтобы их цена была ориентиром */
  baseConversions: 5,
  /** Слой дороже услуг во столько раз — отключаем */
  worse: 2,
  /** Слой потратил хотя бы столько «обращений услуг» — иначе рано судить */
  spendInLeads: 3,
  /** Группа слоя сама по себе хороша (не дороже услуг в 1,3 раза при 2+ обращениях) — оставляем */
  keep: 1.3,
} as const;

export type LayerRow = { id: string; layer: Layer; cost: number; clicks: number; conversions: number; protected: boolean; keyword: string };
export type LayerVerdict = { layer: Exclude<Layer, "service">; off: string[]; kept: number; cost: number; conversions: number; cpl: number | null; baseCpl: number; title: string; reason: string };

const LAYER_GEN: Record<Exclude<Layer, "service">, string> = { problem: "Запросы о проблемах клиентов", adjacent: "Смежные запросы", audience: "Запросы по аудиториям" };
const sum = (rows: LayerRow[]) => rows.reduce((a, r) => ({ cost: a.cost + r.cost, clicks: a.clicks + r.clicks, conversions: a.conversions + r.conversions }), { cost: 0, clicks: 0, conversions: 0 });

/** null — у групп услуг мало обращений, сравнивать не с чем */
export function decideLayers(rows: LayerRow[]): LayerVerdict[] | null {
  const base = sum(rows.filter((r) => r.layer === "service"));
  if (base.conversions < LAYER_RULE.baseConversions) return null;
  const baseCpl = base.cost / base.conversions;
  const out: LayerVerdict[] = [];
  for (const layer of ["problem", "adjacent", "audience"] as const) {
    const all = rows.filter((r) => r.layer === layer);
    if (!all.length) continue;
    const s = sum(all);
    const cpl = s.conversions ? s.cost / s.conversions : Infinity;
    if (s.cost < baseCpl * LAYER_RULE.spendInLeads || cpl < baseCpl * LAYER_RULE.worse) continue;
    // Разница в конверсии кликов не случайна
    if (s.conversions > 0 && probBetter(base.conversions, base.clicks, s.conversions, s.clicks) < 0.85) continue;
    const off = all.filter((r) => !r.protected && !(r.conversions >= 2 && r.cost / r.conversions <= baseCpl * LAYER_RULE.keep));
    if (!off.length) continue;
    const top = [...off].sort((x, y) => y.cost - x.cost)[0];
    const times = cpl === Infinity ? null : Math.round((cpl / baseCpl) * 10) / 10;
    const what = `${LAYER_GEN[layer]} «${top.keyword}»`;
    const head = times
      ? `${what} дают обращения по ${rub(cpl)} — дороже основных в ${String(times).replace(".", ",")} ${Number.isInteger(times) && times >= 5 ? "раз" : "раза"}, отключили.`
      : `${what}: за ${rub(s.cost)} не было ни одного обращения, а по услугам обращение стоит ${rub(baseCpl)} — отключили.`;
    const kept = all.length - off.length;
    out.push({
      layer, off: off.map((r) => r.id), kept, cost: s.cost, conversions: s.conversions, cpl: times ? cpl : null, baseCpl,
      title: `Отключили ${LAYER_LABEL[layer].toLowerCase()} на поиске`,
      reason: `${head}${times ? ` По услугам обращение стоит ${rub(baseCpl)}.` : ""} Сравнивали ${pl(LAYER_RULE.days, "день", "дня", "дней")}: ${LAYER_LABEL[layer].toLowerCase()} — ${pl(off.length, "группа", "группы", "групп")}, ${rub(s.cost)}, ${pl(s.conversions, "обращение", "обращения", "обращений")}. Бюджет поиска теперь идёт на запросы, которые приводят клиентов дешевле.${kept ? ` Ещё ${pl(kept, "группу", "группы", "групп")} этого слоя не трогали: их недавно меняли вы или они приводят клиентов недорого.` : ""}`,
    });
  }
  return out;
}

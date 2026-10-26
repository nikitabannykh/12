/**
 * Оценки «что работает лучше» — общие для экрана «Реклама» и для робота.
 * Чистые функции без доступа к базе.
 */
import { probBetter } from "./stats";

export type S = { impressions: number; clicks: number; cost: number; conversions: number };
export const zeroS = (): S => ({ impressions: 0, clicks: 0, cost: 0, conversions: 0 });
export const addS = (a: S, b: S): S => ({ impressions: a.impressions + b.impressions, clicks: a.clicks + b.clicks, cost: a.cost + b.cost, conversions: a.conversions + b.conversions });
export const ctrOf = (s: S) => (s.impressions ? s.clicks / s.impressions : 0);
export const cplOf = (s: S) => (s.conversions ? s.cost / s.conversions : null);

/** Порог показов, после которого объявление можно сравнивать */
export const MIN_IMPR: Record<string, number> = { search: 150, network: 1500, vk: 1500 };

export type Verdict = "leader" | "good" | "average" | "weak" | "learning" | "off";
export const VERDICT: Record<Verdict, { label: string; cls: string }> = {
  leader: { label: "Лучшее", cls: "bg-good text-white" },
  good: { label: "Хорошо", cls: "bg-good-soft text-good" },
  average: { label: "Средне", cls: "bg-paper text-ink-2" },
  weak: { label: "Слабое", cls: "bg-bad-soft text-bad" },
  learning: { label: "Копим данные", cls: "bg-info-soft text-ink-2" },
  off: { label: "Выключено", cls: "bg-paper text-faint" },
};

export type AdScore = {
  id: string;
  rank: number | null; // место в группе среди сравнимых
  verdict: Verdict;
  why: string; // одной фразой для владельца
  rel: number; // 0..1 — длина полоски «насколько хорошо» относительно лучшего
  s: S;
};

const pct = (x: number) => `${(x * 100).toFixed(x < 0.01 ? 2 : 1).replace(".", ",")}%`;
const rub = (n: number) => `${new Intl.NumberFormat("ru-RU").format(Math.round(n))} ₽`;

/**
 * Сравнение объявлений внутри группы (одна аудитория).
 * Если обращений хватает — главная метрика «цена обращения», иначе «кликабельность».
 */
export function scoreGroup(rows: { id: string; s: S; live: boolean }[], channel: string): AdScore[] {
  const min = MIN_IMPR[channel] ?? 500;
  const ready = rows.filter((r) => r.live && r.s.impressions >= min / 3);
  const totalConv = ready.reduce((x, r) => x + r.s.conversions, 0);
  const byConv = totalConv >= 6;
  // Обращений мало: считаем «сколько обращений на показ» = кликабельность × сглаженная конверсия.
  // Сглаживание к средней по группе, чтобы одно случайное обращение не перевернуло рейтинг.
  const gClicks = ready.reduce((x, r) => x + r.s.clicks, 0);
  const gCR = gClicks ? totalConv / gClicks : 0;
  const crSm = (s: S) => (s.conversions + 20 * gCR) / (s.clicks + 20);
  const value = (s: S) => (byConv ? (s.cost ? s.conversions / s.cost : 0) : totalConv ? ctrOf(s) * crSm(s) : ctrOf(s));
  const sorted = [...ready].sort((a, b) => value(b.s) - value(a.s));
  const best = sorted[0];
  const bestV = best ? value(best.s) : 0;
  return rows.map((r) => {
    if (!r.live) return { id: r.id, rank: null, verdict: "off", why: "Не показывается", rel: 0, s: r.s };
    const idx = sorted.findIndex((x) => x.id === r.id);
    if (idx < 0) {
      const left = Math.max(0, Math.ceil(min / 3 - r.s.impressions));
      return { id: r.id, rank: null, verdict: "learning", why: `Нужно ещё ≈ ${new Intl.NumberFormat("ru-RU").format(left)} показов, чтобы сравнить`, rel: 0, s: r.s };
    }
    const v = value(r.s);
    const rel = bestV ? v / bestV : 0;
    const metricText = byConv
      ? r.s.conversions ? `обращение по ${rub(r.s.cost / r.s.conversions)}` : `${rub(r.s.cost)} без обращений`
      : `кликают ${pct(ctrOf(r.s))} увидевших${totalConv ? `, ${r.s.conversions ? `${r.s.conversions} ${r.s.conversions === 1 ? "обращение" : r.s.conversions < 5 ? "обращения" : "обращений"}` : "обращений пока нет"}` : ""}`;
    if (sorted.length < 2) return { id: r.id, rank: 1, verdict: "average", why: `Пока не с кем сравнить: ${metricText}`, rel: 1, s: r.s };
    if (idx === 0) {
      const second = value(sorted[1].s);
      const lift = second ? Math.round((v / second - 1) * 100) : 0;
      return { id: r.id, rank: 1, verdict: "leader", why: `${metricText[0].toUpperCase()}${metricText.slice(1)}${lift > 3 ? ` — на ${lift}% лучше следующего` : ""}`, rel: 1, s: r.s };
    }
    const pWorse = byConv
      ? probBetter(best.s.conversions, best.s.clicks, r.s.conversions, r.s.clicks, 1500)
      : probBetter(best.s.clicks, best.s.impressions, r.s.clicks, r.s.impressions, 1500);
    const verdict: Verdict = pWorse >= 0.9 && rel < 0.75 ? "weak" : rel >= 0.85 ? "good" : "average";
    const gap = rel ? Math.round((1 / rel - 1) * 100) : 100;
    const why = verdict === "weak" ? `${metricText[0].toUpperCase()}${metricText.slice(1)} — хуже лучшего на ${gap}%` : `${metricText[0].toUpperCase()}${metricText.slice(1)}`;
    return { id: r.id, rank: idx + 1, verdict, why, rel, s: r.s };
  });
}

/**
 * Какие идеи (подходы) и какие картинки работают лучше в этом бизнесе.
 * Считаем «подъём» — во сколько раз кликабельность объявления выше средней по его группе — и усредняем по показам.
 */
export function liftBy<K extends string>(items: { key: K | null | undefined; groupId: string; s: S }[]) {
  const groups = new Map<string, S>();
  for (const it of items) groups.set(it.groupId, addS(groups.get(it.groupId) ?? zeroS(), it.s));
  const acc = new Map<K, { w: number; lift: number; ads: number; impressions: number }>();
  for (const it of items) {
    if (!it.key || it.s.impressions < 100) continue;
    const g = groups.get(it.groupId)!;
    const gc = ctrOf(g);
    if (!gc) continue;
    const lift = ctrOf(it.s) / gc;
    const cur = acc.get(it.key) ?? { w: 0, lift: 0, ads: 0, impressions: 0 };
    cur.lift += lift * it.s.impressions;
    cur.w += it.s.impressions;
    cur.ads += 1;
    cur.impressions += it.s.impressions;
    acc.set(it.key, cur);
  }
  return [...acc.entries()]
    .map(([key, v]) => ({ key, index: v.w ? v.lift / v.w : 1, ads: v.ads, impressions: v.impressions }))
    .sort((a, b) => b.index - a.index);
}

/** Thompson sampling: выбираем следующую идею — чаще удачные, но иногда пробуем новые */
export function pickByThompson<K extends string>(candidates: K[], stats: { key: K; index: number; impressions: number }[]) {
  let best: K = candidates[0];
  let bestV = -Infinity;
  for (const c of candidates) {
    const st = stats.find((s) => s.key === c);
    const mean = st ? st.index : 1; // неиспробованная идея — как средняя, но с большой неопределённостью
    const sd = st ? 0.35 / Math.sqrt(1 + st.impressions / 1000) : 0.45;
    const u1 = Math.random() || 1e-9, u2 = Math.random();
    const sample = mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    if (sample > bestV) {
      bestV = sample;
      best = c;
    }
  }
  return best;
}

/** Объём трафика Директа → место в выдаче простыми словами */
export function placeName(tv: number) {
  if (tv >= 95) return "1-е место над результатами";
  if (tv >= 80) return "2-е место над результатами";
  if (tv >= 70) return "3-е место над результатами";
  if (tv >= 55) return "4-е место над результатами";
  if (tv >= 12) return "внизу первой страницы";
  return "дальше первой страницы";
}


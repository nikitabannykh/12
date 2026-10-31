import { probBetter } from "./stats";

/**
 * «Качественный визит» — визит из рекламы без отказа по Метрике (отказ: один просмотр страницы короче 15 секунд).
 * Когда обращений слишком мало, чтобы судить (меньше порогов робота), доля качественных визитов на переход —
 * запасной сигнал: видно, приводит ли объявление, фраза или площадка людей, которым интересна страница.
 *
 * Правила осторожные:
 *  - сравниваем только при достаточном объёме (PROXY.minClicks переходов у каждого варианта)
 *    и если Метрика видит хотя бы половину переходов (иначе счётчик стоит не везде и данные неполные);
 *  - решение — только при уверенности ≥ PROXY.decide (строже, чем 90% для кликабельности);
 *  - настоящие обращения важнее: если по обращениям картина обратная (уверенность ≥ 80%), сигнал Метрики не используем.
 */
export const PROXY = {
  /** переходов у каждого варианта A/B-теста */
  minClicks: 60,
  /** визитов по Метрике на переход — ниже этого данные неполные */
  minCoverage: 0.5,
  /** уверенность, с которой решаем по качеству визитов */
  decide: 0.95,
  /** уверенность, с которой качество визитов останавливает решение по кликабельности */
  veto: 0.8,
  /** обращения против: вероятность, что «победитель» по Метрике хуже по обращениям, не меньше 1 − convConflict */
  convConflict: 0.2,
  /**
   * Ключевая фраза: визитов за 30 дней (у фразы и у остальных фраз кампании), во сколько раз качество хуже, уверенность.
   * Порог ниже, чем для тестов: фразу робот только отмечает, а не выключает.
   */
  phraseMinVisits: 40,
  phraseRatio: 1.5,
  phraseConfidence: 0.95,
};

/** РСЯ: площадка с кликами и без качества */
export const SITE_RULE = {
  days: 30,
  // На маленьком бюджете 30 кликов на площадку — это весь бюджет: решаем раньше, но только при почти сплошных отказах
  minClicks: 12,
  minVisits: 6,
  bounce: 0.8,
  /** без данных Метрики по площадке — только при большом объёме: столько кликов и ≥ 3 ожидаемых обращения */
  noMetricaClicks: 60,
  perRun: 20,
};

/** Поисковый запрос: клики и расход без обращений, а по Метрике — почти одни отказы */
export const QUERY_RULE = { minClicks: 5, minCost: 200, minVisits: 3, maxQuality: 0.2, perRun: 10 };

export type QStat = { visits: number; bounces: number; leads: number };
export const zeroQ = (): QStat => ({ visits: 0, bounces: 0, leads: 0 });
export const addQ = (a: QStat, b: QStat): QStat => ({ visits: a.visits + b.visits, bounces: a.bounces + b.bounces, leads: a.leads + b.leads });
export const qualityOf = (q: QStat) => Math.max(0, q.visits - q.bounces);
export const bounceRate = (q: QStat) => (q.visits ? q.bounces / q.visits : 0);

export type ProxySide = { clicks: number; conversions: number; q: QStat };
export type ProxyResult = {
  eligible: boolean;
  /** почему сравнивать нельзя */
  why?: string;
  /** вероятность, что у варианта доля качественных визитов на переход выше */
  p: number;
  rateV: number;
  rateC: number;
  /** обращения указывают в другую сторону — сигналу Метрики не доверяем */
  conflict: boolean;
};

/** Доля качественных визитов на переход (не больше 1: визитов может быть чуть больше переходов) */
export const proxyRate = (s: ProxySide) => (s.clicks ? Math.min(qualityOf(s.q), s.clicks) / s.clicks : 0);

export function proxyCompare(v: ProxySide, c: ProxySide): ProxyResult {
  const base = { p: 0.5, rateV: proxyRate(v), rateC: proxyRate(c), conflict: false };
  if (v.clicks < PROXY.minClicks || c.clicks < PROXY.minClicks) return { ...base, eligible: false, why: `меньше ${PROXY.minClicks} переходов` };
  const cov = (s: ProxySide) => s.q.visits / Math.max(1, s.clicks);
  if (cov(v) < PROXY.minCoverage || cov(c) < PROXY.minCoverage) return { ...base, eligible: false, why: "Метрика видит меньше половины переходов" };
  const qv = Math.min(qualityOf(v.q), v.clicks), qc = Math.min(qualityOf(c.q), c.clicks);
  const p = probBetter(qv, v.clicks, qc, c.clicks);
  const pConv = probBetter(v.conversions, v.clicks, c.conversions, c.clicks);
  const conflict = p >= 0.5 ? pConv < PROXY.convConflict : pConv > 1 - PROXY.convConflict;
  return { ...base, eligible: true, p, conflict };
}

/** Решение по качеству визитов: won / lost / null (нет уверенности или обращения против) */
export function proxyVerdict(r: ProxyResult): "won" | "lost" | null {
  if (!r.eligible || r.conflict) return null;
  if (r.p >= PROXY.decide) return "won";
  if (r.p <= 1 - PROXY.decide) return "lost";
  return null;
}

/** Качество визитов уверенно против решения по кликабельности */
export function proxyVetoes(r: ProxyResult | null, status: "won" | "lost") {
  if (!r?.eligible || r.conflict) return false;
  return status === "won" ? r.p <= 1 - PROXY.veto : r.p >= PROXY.veto;
}

/**
 * Почему люди уходят с сайта — как разобрал бы директолог, а не «отказов много»:
 *  - сайт не открывался (сторож сайта ловил ошибки) — люди физически не попадали на страницу;
 *  - визитов намного меньше кликов — страница не грузится или кликают не люди;
 *  - в сетях CTR выше нормы в 2+ раза и на сайте 0–5 секунд — случайные клики в приложениях и боты;
 *  - 5–30 секунд и уход — страница не совпадает с объявлением или неудобна с телефона.
 */
export type TrafficInput = { channel: string; impressions: number; clicks: number; visits: number; bounces: number; durationSum: number; siteDown?: string | null };
export function trafficDiagnosis(x: TrafficInput): { cause: "site" | "lost" | "bots" | "mismatch" | null; text: string } {
  if (x.siteDown) return { cause: "site", text: `Сайт не открывался (${x.siteDown}) — люди кликали, но страница не загружалась. Пока сайт лежит, робот держит рекламу на паузе.` };
  if (x.clicks >= 15 && x.visits < x.clicks * 0.5) return { cause: "lost", text: `До сайта дошли ${x.visits} из ${x.clicks} кликнувших — страница слишком долго грузится или не открывается у части людей. Проверьте сайт с телефона.` };
  if (x.visits < 8) return { cause: null, text: "" };
  const bounce = x.bounces / x.visits;
  const avg = x.durationSum / x.visits;
  const ctr = x.impressions ? x.clicks / x.impressions : 0;
  const net = x.channel !== "search";
  if (bounce >= 0.7 && avg <= 6 && net && ctr >= 0.015)
    return { cause: "bots", text: `Похоже на случайные клики и ботов: CTR ${(ctr * 100).toFixed(1)}% — в 2–3 раза выше обычного для сетей, а на сайте в среднем ${Math.round(avg)} с. Так кликают в мобильных играх и на мусорных площадках — робот их отключает.` };
  if (bounce >= 0.6 && avg > 6)
    return { cause: "mismatch", text: `Люди открывают страницу и через ${Math.round(avg)} с уходят — она не отвечает на то, что обещает объявление (цена, услуга, запись), или неудобна с телефона.` };
  if (bounce >= 0.7) return { cause: "bots", text: `${Math.round(bounce * 100)}% уходят почти сразу — похоже на случайные клики. Робот отключает площадки, откуда они идут.` };
  return { cause: null, text: "" };
}

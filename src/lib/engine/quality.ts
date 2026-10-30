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
  minClicks: 30,
  minVisits: 10,
  bounce: 0.85,
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

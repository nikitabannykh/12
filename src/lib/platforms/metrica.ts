import "server-only";
import { hostOf } from "../util";

/**
 * Яндекс Метрика: создаём счётчик и цели под обращения.
 * Цели типа «JavaScript-событие» срабатывают из нашего скрипта, который ставится вместе с кодом счётчика:
 *   pz_lead      — любое обращение (форма, звонок, мессенджер)
 *   pz_form      — отправка формы
 *   pz_phone     — клик по номеру телефона
 *   pz_messenger — переход в WhatsApp / Telegram / VK
 *   pz_booked    — клиент записался (офлайн-конверсия: владелец отметил заявку «Записался», мы загружаем её сами)
 * Директ оптимизирует показы по pz_lead.
 */
// METRIKA_API_URL — переопределение адреса Management API (тесты, прокси)
const API_URL = () => (process.env.METRIKA_API_URL || "https://api-metrika.yandex.net/management/v1").replace(/\/$/, "");

export const GOALS: { key: string; name: string; action: string }[] = [
  { key: "lead", name: "Обращение (любое)", action: "pz_lead" },
  { key: "form", name: "Заявка с сайта", action: "pz_form" },
  { key: "phone", name: "Клик по телефону", action: "pz_phone" },
  { key: "messenger", name: "Переход в мессенджер", action: "pz_messenger" },
  { key: "booked", name: "Клиент записался (офлайн)", action: "pz_booked" },
];

/** Цель офлайн-конверсий: её идентификатор (событие) пишется в колонку Target загружаемого CSV */
export const BOOKED_GOAL = GOALS.find((g) => g.key === "booked")!;

async function call(token: string, path: string, init?: RequestInit) {
  const res = await fetch(`${API_URL()}${path}`, {
    ...init,
    headers: { Authorization: `OAuth ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = j?.message || j?.errors?.[0]?.message || `HTTP ${res.status}`;
    throw new Error(`Метрика: ${msg}`);
  }
  return j;
}

export async function listCounters(token: string) {
  const j = await call(token, `/counters?per_page=100`);
  return ((j.counters ?? []) as any[]).map((c) => ({ id: Number(c.id), name: String(c.name || ""), site: String(c.site2?.site || c.site || "") }));
}

export async function ensureCounter(token: string, p: { name: string; site: string }) {
  const host = hostOf(p.site);
  const existing = (await listCounters(token)).find((c) => hostOf(c.site) === host);
  if (existing) return { id: existing.id, created: false };
  const j = await call(token, `/counters`, {
    method: "POST",
    body: JSON.stringify({ counter: { name: p.name.slice(0, 200), site2: { site: host } } }),
  });
  return { id: Number(j.counter.id), created: true };
}

/** Только одна цель (например, pz_booked для счётчиков, созданных до её появления). Возвращает ID цели. */
export async function ensureGoal(token: string, counterId: number, goal: { name: string; action: string }) {
  const j = await call(token, `/counter/${counterId}/goals`);
  const found = ((j.goals ?? []) as any[]).find((g) => g.type === "action" && g.conditions?.some((c: any) => String(c.url) === goal.action));
  if (found) return Number(found.id);
  const r = await call(token, `/counter/${counterId}/goals`, {
    method: "POST",
    body: JSON.stringify({ goal: { name: goal.name, type: "action", conditions: [{ type: "exact", url: goal.action }] } }),
  });
  return Number(r.goal.id);
}

/**
 * Цель «посетил сайт» (тип url, условие «содержит» домен страницы) — для ретаргетинга «были на сайте, но не оставили
 * заявку». Такая цель срабатывает на любом просмотре страницы этого домена. Возвращает ID цели.
 */
export async function ensureVisitGoal(token: string, counterId: number, site: string) {
  const host = hostOf(site);
  const j = await call(token, `/counter/${counterId}/goals`);
  const found = ((j.goals ?? []) as any[]).find((g) => g.type === "url" && g.conditions?.some((c: any) => String(c.url) === host));
  if (found) return Number(found.id);
  const r = await call(token, `/counter/${counterId}/goals`, {
    method: "POST",
    body: JSON.stringify({ goal: { name: "Посетил сайт (для ретаргетинга)", type: "url", conditions: [{ type: "contain", url: host }] } }),
  });
  return Number(r.goal.id);
}

/**
 * Сколько разных людей заходило на сайт за период — Reporting API Метрики (/stat/v1/data, метрика ym:s:users).
 * Это верхняя оценка аудитории ретаргетинга (из неё ещё вычитаются оставившие заявку). Ошибка — null.
 */
export async function metricaVisitors(token: string, counterId: number, from: string, to: string): Promise<number | null> {
  const base = (process.env.METRIKA_STAT_URL || "https://api-metrika.yandex.net/stat/v1").replace(/\/$/, "");
  try {
    const q = new URLSearchParams({ ids: String(counterId), metrics: "ym:s:users", date1: from, date2: to, accuracy: "full" });
    const res = await fetch(`${base}/data?${q}`, { headers: { Authorization: `OAuth ${token}` } });
    if (!res.ok) return null;
    const j = await res.json();
    const n = Number(j?.totals?.[0]);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// ─── Reporting API: визиты из рекламы ─────────────────────────────────────

/**
 * Ошибка Reporting API с причиной: scope — у токена нет прав на статистику (нужен metrika:read — подключить Яндекс заново),
 * counter — счётчик не найден или не принадлежит этому аккаунту, quota — исчерпан лимит запросов (повторим позже),
 * bad_request — Метрика не знает группировку/метрику (например, разбивку Директа), api — прочее.
 */
export type MetricaErrorCode = "scope" | "counter" | "quota" | "bad_request" | "api";
export class MetricaError extends Error {
  constructor(public code: MetricaErrorCode, message: string, public httpStatus?: number) {
    super(message);
  }
}

const STAT_URL = () => (process.env.METRIKA_STAT_URL || "https://api-metrika.yandex.net/stat/v1").replace(/\/$/, "");
/**
 * Модель атрибуции в названиях группировок (ym:s:<attribution>DirectClickOrder и т. п.). По умолчанию last — источник
 * самого визита: так визит из объявления считается за этим объявлением, а повторный заход из закладок — нет.
 */
const ATTR = () => (process.env.METRIKA_ATTRIBUTION || "last").replace(/[^a-z_]/gi, "") || "last";
const PAGE = 10_000;
const MAX_ROWS = 60_000;

function metricaError(status: number, j: any): MetricaError {
  const e = j?.errors?.[0] ?? {};
  const msg = String(e.message || j?.message || `HTTP ${status}`);
  const type = String(e.error_type || "");
  if (status === 429 || /quota/i.test(type) || /quota|лимит запросов/i.test(msg)) return new MetricaError("quota", `Метрика: исчерпан лимит запросов (${msg})`, status);
  if (status === 401 || status === 403 || /access|scope|token|доступ/i.test(type)) return new MetricaError("scope", `Метрика: нет доступа к статистике (${msg})`, status);
  if (status === 404) return new MetricaError("counter", `Метрика: счётчик не найден (${msg})`, status);
  if (status === 400) return new MetricaError("bad_request", `Метрика: ${msg}`, status);
  return new MetricaError("api", `Метрика: ${msg}`, status);
}

type Dim = { name: string | null; id: string | null };
type RawRow = { dims: Dim[]; metrics: number[] };

/** Запрос к /stat/v1/data постранично (offset в Метрике начинается с 1) */
async function statRows(token: string, params: Record<string, string>): Promise<RawRow[]> {
  const out: RawRow[] = [];
  for (let offset = 1; out.length < MAX_ROWS; offset += PAGE) {
    const q = new URLSearchParams({ ...params, limit: String(PAGE), offset: String(offset), accuracy: "full" });
    let res: Response;
    try {
      res = await fetch(`${STAT_URL()}/data?${q}`, { headers: { Authorization: `OAuth ${token}` } });
    } catch (e) {
      throw new MetricaError("api", `Метрика не ответила: ${(e as Error).message}`);
    }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw metricaError(res.status, j);
    const rows = (j?.data ?? []) as { dimensions?: any[]; metrics?: number[] }[];
    for (const r of rows) {
      out.push({
        dims: (r.dimensions ?? []).map((d) => ({ name: d?.name != null ? String(d.name) : null, id: d?.direct_id != null ? String(d.direct_id) : d?.id != null ? String(d.id) : null })),
        metrics: (r.metrics ?? []).map((m) => Number(m) || 0),
      });
    }
    const total = Number(j?.total_rows ?? 0);
    if (!rows.length || offset + PAGE > total) break;
  }
  return out;
}

/** Цели, достижения которых забираем: ключ → ID цели (обращение и «Записался») */
export type MetricaGoals = Partial<Record<"lead" | "booked", number>>;

const BASE_METRICS = ["ym:s:visits", "ym:s:bounceRate", "ym:s:avgVisitDurationSeconds", "ym:s:pageDepth"];

function metricsFor(goals: MetricaGoals) {
  const keys = (Object.entries(goals).filter(([, id]) => Number(id) > 0) as [string, number][]).slice(0, 5);
  return { names: [...BASE_METRICS, ...keys.map(([, id]) => `ym:s:goal${id}reaches`)].join(","), keys: keys.map(([k]) => k) };
}

/** Визиты, отказы, длительность и цели одной строки отчёта */
export type MetricaNumbers = { visits: number; bounces: number; durationSum: number; pageviews: number; goals: Record<string, number> };
function numbers(m: number[], keys: string[]): MetricaNumbers {
  const visits = Math.round(m[0] ?? 0);
  const goals: Record<string, number> = {};
  keys.forEach((k, i) => (goals[k] = Math.round(m[4 + i] ?? 0)));
  return {
    visits,
    // bounceRate — в процентах
    bounces: Math.min(visits, Math.round((visits * (m[1] ?? 0)) / 100)),
    durationSum: Math.round(visits * (m[2] ?? 0)),
    pageviews: Math.round(visits * (m[3] ?? 0) * 10) / 10,
    goals,
  };
}

/** Строка по дням: кампания / объявление / фраза — как их отдала Метрика (ID площадки или значения UTM-меток) */
export type MetricaDayRow = MetricaNumbers & { day: string; via: "direct" | "utm"; utmSource?: string; campaignKey: string; adKey: string; phrase: string };

/**
 * Визиты из Директа по дням с разбивкой «кампания → объявление → условие показа (фраза)» — данные Директа в Метрике
 * (ym:s:<attribution>DirectClickOrder / DirectClickBanner / DirectPhraseOrCond). Работает, если счётчик привязан к кампании.
 */
export async function metricaDirectDaily(token: string, counterId: number, from: string, to: string, goals: MetricaGoals): Promise<MetricaDayRow[]> {
  const a = ATTR();
  const m = metricsFor(goals);
  const rows = await statRows(token, {
    ids: String(counterId), date1: from, date2: to, metrics: m.names,
    dimensions: ["ym:s:date", `ym:s:${a}DirectClickOrder`, `ym:s:${a}DirectClickBanner`, `ym:s:${a}DirectPhraseOrCond`].join(","),
  });
  return rows
    .filter((r) => r.dims[1]?.id || r.dims[1]?.name)
    .map((r) => ({
      day: String(r.dims[0]?.name ?? ""), via: "direct" as const,
      campaignKey: r.dims[1]?.id ?? r.dims[1]?.name ?? "", adKey: r.dims[2]?.id ?? "", phrase: r.dims[3]?.name ?? "",
      ...numbers(r.metrics, m.keys),
    }));
}

/**
 * Запасной путь и VK: визиты по UTM-меткам наших ссылок (withUtm): utm_source = yandex | vk, utm_campaign — ID кампании,
 * utm_content — ID объявления, utm_term — ключевая фраза (только Директ).
 */
export async function metricaUtmDaily(token: string, counterId: number, from: string, to: string, goals: MetricaGoals): Promise<MetricaDayRow[]> {
  const a = ATTR();
  const m = metricsFor(goals);
  const rows = await statRows(token, {
    ids: String(counterId), date1: from, date2: to, metrics: m.names,
    dimensions: ["ym:s:date", `ym:s:${a}UTMSource`, `ym:s:${a}UTMCampaign`, `ym:s:${a}UTMContent`, `ym:s:${a}UTMTerm`].join(","),
    filters: `ym:s:${a}UTMSource=.('yandex','vk')`,
  });
  return rows.map((r) => ({
    day: String(r.dims[0]?.name ?? ""), via: "utm" as const, utmSource: String(r.dims[1]?.name ?? ""),
    campaignKey: String(r.dims[2]?.name ?? ""), adKey: String(r.dims[3]?.name ?? ""), phrase: String(r.dims[4]?.name ?? ""),
    ...numbers(r.metrics, m.keys),
  }));
}

/** Срез за период: кампания × площадка РСЯ (site) или кампания × поисковый запрос (query) */
export type MetricaSliceRow = MetricaNumbers & { campaignKey: string; key: string };

export async function metricaDirectSlices(token: string, counterId: number, from: string, to: string, goals: MetricaGoals, kind: "site" | "query"): Promise<MetricaSliceRow[]> {
  const a = ATTR();
  const m = metricsFor(goals);
  const rows = await statRows(token, {
    ids: String(counterId), date1: from, date2: to, metrics: m.names,
    dimensions: [`ym:s:${a}DirectClickOrder`, kind === "site" ? `ym:s:${a}DirectPlatform` : `ym:s:${a}DirectSearchPhrase`].join(","),
  });
  return rows
    .filter((r) => (r.dims[0]?.id || r.dims[0]?.name) && r.dims[1]?.name)
    .map((r) => ({ campaignKey: r.dims[0]?.id ?? r.dims[0]?.name ?? "", key: String(r.dims[1]?.name ?? ""), ...numbers(r.metrics, m.keys) }));
}

/** ClientID Метрики и yclid Директа — только цифры (до 25), иначе не храним. Нужны для офлайн-конверсий «Записался». */
export function metrikaIds(d: { cid?: unknown; yclid?: unknown }) {
  const ok = (v: unknown) => (typeof v === "string" || typeof v === "number") && /^\d{1,25}$/.test(String(v)) ? String(v) : null;
  return { metrikaClientId: ok(d?.cid), yclid: ok(d?.yclid) };
}

export type OfflineRow = { clientId?: string | null; yclid?: string | null; at: Date };

/**
 * Офлайн-конверсии: POST /counter/{id}/offline_conversions/upload, multipart-поле «file» с CSV.
 * Первая строка — названия колонок: Target, DateTime (unix-время, только прошлое) и идентификатор посетителя —
 * ClientId (ClientID Метрики) или Yclid (метка клика Директа). Данные появляются в отчётах в течение ~3 часов.
 * Строки с ClientId и строки только с Yclid грузим отдельными файлами — у каждого файла свой набор колонок.
 * https://yandex.ru/dev/metrika/ru/management/offline-conv
 */
export async function uploadOffline(token: string, counterId: number, target: string, rows: OfflineRow[]) {
  const now = Math.floor(Date.now() / 1000) - 60;
  const ts = (d: Date) => Math.min(now, Math.floor(d.getTime() / 1000));
  const byCid = rows.filter((r) => r.clientId);
  const byYclid = rows.filter((r) => !r.clientId && r.yclid);
  const ids: number[] = [];
  const send = async (csv: string) => {
    const fd = new FormData();
    fd.append("file", new Blob([csv], { type: "text/csv" }), "offline.csv");
    const res = await fetch(`${API_URL()}/counter/${counterId}/offline_conversions/upload`, { method: "POST", headers: { Authorization: `OAuth ${token}` }, body: fd });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Метрика: ${j?.message || j?.errors?.[0]?.message || `HTTP ${res.status}`}`);
    if (j?.uploading?.id) ids.push(Number(j.uploading.id));
  };
  if (byCid.length) await send(["ClientId,Target,DateTime", ...byCid.map((r) => `${r.clientId},${target},${ts(r.at)}`)].join("\n"));
  if (byYclid.length) await send(["Yclid,Target,DateTime", ...byYclid.map((r) => `${r.yclid},${target},${ts(r.at)}`)].join("\n"));
  return { uploaded: byCid.length + byYclid.length, ids };
}

export async function ensureGoals(token: string, counterId: number) {
  const j = await call(token, `/counter/${counterId}/goals`);
  const have = new Map<string, number>();
  for (const g of (j.goals ?? []) as any[]) {
    const cond = g.conditions?.[0];
    if (g.type === "action" && cond?.url) have.set(String(cond.url), Number(g.id));
  }
  const ids: Record<string, number> = {};
  for (const goal of GOALS) {
    if (have.has(goal.action)) {
      ids[goal.key] = have.get(goal.action)!;
      continue;
    }
    const r = await call(token, `/counter/${counterId}/goals`, {
      method: "POST",
      body: JSON.stringify({ goal: { name: goal.name, type: "action", conditions: [{ type: "exact", url: goal.action }] } }),
    });
    ids[goal.key] = Number(r.goal.id);
  }
  return ids;
}

/** Код счётчика + наш трекер обращений — один фрагмент, который владелец вставляет на сайт */
export function trackingSnippet(p: { counterId?: number | null; publicKey: string; appUrl: string }) {
  const ym = p.counterId
    ? `<!-- Яндекс Метрика -->
<script type="text/javascript">
(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}
k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");
ym(${p.counterId},"init",{clickmap:true,trackLinks:true,accurateTrackBounce:true,webvisor:true});
</script>
<noscript><div><img src="https://mc.yandex.ru/watch/${p.counterId}" style="position:absolute;left:-9999px;" alt="" /></div></noscript>
`
    : "";
  return `${ym}<!-- Самоход: считает обращения из рекламы -->
<script async src="${p.appUrl}/t.js" data-key="${p.publicKey}"${p.counterId ? ` data-ym="${p.counterId}"` : ""}></script>`;
}

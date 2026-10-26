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
  return `${ym}<!-- Полный зал: считает обращения из рекламы -->
<script async src="${p.appUrl}/t.js" data-key="${p.publicKey}"${p.counterId ? ` data-ym="${p.counterId}"` : ""}></script>`;
}

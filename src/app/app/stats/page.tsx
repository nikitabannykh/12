import { isLaunched } from "@/lib/util";
import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getBusinessForUser } from "@/lib/engine/launch";
import { metricaVisits, report, reportNow, weeksForMarking } from "@/lib/engine/report";
import { trafficDiagnosis } from "@/lib/engine/quality";
import { siteDownInfo } from "@/lib/engine/site-guard";
import { PeriodPicker } from "./PeriodPicker";
import { METRICA_REASON_TEXT, metricaStatus } from "@/lib/engine/metrica-sync";
import { getDb, schema } from "@/lib/db";
import { DaysChart, Delta } from "@/components/charts";
import { ClientsWeek } from "@/components/ClientsWeek";
import { CHANNEL_NAME } from "@/lib/platforms";
import { addDays, isoDay, num, pl, rub } from "@/lib/util";
import { LeadStatus } from "./LeadStatus";
import { landingFor } from "@/lib/engine/landing";

const KIND: Record<string, string> = { form: "Заявка", phone: "Звонок", messenger: "Мессенджер", suspect: "Заявка" };
const SRC: Record<string, string> = { yandex: "Реклама в Яндексе", vk: "Реклама ВКонтакте", demo: "Реклама (демо)" };
const CH: Record<string, string> = { ...CHANNEL_NAME, unknown: "Реклама, канал не определён" };
/** Среднее время визита: «1 мин 05 с» */
const pctFmt = (x: number) => `${(x * 100).toLocaleString("ru-RU", { maximumFractionDigits: x < 0.1 ? 1 : 0 })}%`;
/** Нормы по типу канала: CTR [терпимо, хорошо] */
const NORMS: Record<string, { ctr: [number, number] }> = { search: { ctr: [0.02, 0.05] }, network: { ctr: [0.004, 0.01] }, vk: { ctr: [0.003, 0.008] } };
const normKey = (ch: string) => (ch === "search" ? "search" : /vk|ok/.test(ch) ? "vk" : "network");
type T = { impressions: number; clicks: number; cost: number; leads: number; clients: number };
/** Оценка канала простыми словами: хорошо / терпимо / плохо / мало данных — и почему */
function channelVerdict(ch: string, t: T, m?: { visits: number; bounces: number; durationSum: number } | null, siteDown?: string | null): { label: string; tone: "good" | "warn" | "bad" | "muted"; text: string } {
  // Разбор причины, как у директолога: сайт лежал, клики теряются, боты, страница не та
  const d = trafficDiagnosis({ channel: ch, impressions: t.impressions, clicks: t.clicks, visits: m?.visits ?? 0, bounces: m?.bounces ?? 0, durationSum: m?.durationSum ?? 0, siteDown: t.clicks ? siteDown : null });
  if (d.cause) return { label: d.cause === "site" ? "Сайт не работал" : d.cause === "bots" ? "Мусорные клики" : d.cause === "lost" ? "Клики теряются" : "Страница не цепляет", tone: "bad", text: d.text };
  if (t.clicks >= 30 && t.leads === 0) return { label: "Плохо", tone: "bad", text: `${pl(t.clicks, "клик", "клика", "кликов")} и ни одного обращения. Проверьте, стоит ли код Самохода на сайте и есть ли на странице кнопки записи.` };
  if (t.clicks < 20) return { label: "Мало данных", tone: "muted", text: t.impressions ? "Оценим, когда наберётся хотя бы 20 кликов." : "" };
  const conv = t.leads / t.clicks;
  const ctr = t.impressions ? t.clicks / t.impressions : 0;
  const n = NORMS[normKey(ch)];
  if (conv >= 0.03 && ctr >= n.ctr[0]) return { label: "Хорошо", tone: "good", text: `${pctFmt(conv)} кликнувших обращаются — канал работает.` };
  return { label: "Терпимо", tone: "warn", text: conv < 0.01 ? "Обращаются меньше 1% кликнувших — робот проверяет другие тексты и площадки." : "Есть обращения, но можно лучше — робот продолжает тесты." };
}
function Metric({ label, value, tone = null, hint }: { label: string; value: string; tone?: "good" | "warn" | "bad" | null; hint?: string }) {
  const dot = tone === "good" ? "bg-good" : tone === "warn" ? "bg-warn" : tone === "bad" ? "bg-bad" : null;
  return (
    <div className="rounded-xl bg-paper px-3 py-2.5 min-w-0">
      <div className="text-xs text-muted flex items-center gap-1.5">{dot ? <span className={`w-2 h-2 rounded-full ${dot}`} /> : null}{label}</div>
      <div className={`font-bold tabular-nums mt-0.5 ${tone === "bad" ? "text-bad" : ""}`}>{value}</div>
      {hint ? <div className="text-[11px] text-faint mt-0.5 leading-tight">{hint}</div> : null}
    </div>
  );
}

const dur = (sec: number) => (sec >= 60 ? `${Math.floor(sec / 60)} мин ${String(Math.round(sec % 60)).padStart(2, "0")} с` : `${Math.round(sec)} с`);

/** Готовые периоды — как в Директе */
const PRESETS = [
  { id: "today", label: "Сегодня" },
  { id: "yesterday", label: "Вчера" },
  { id: "7", label: "7 дней" },
  { id: "30", label: "30 дней" },
  { id: "month", label: "Этот месяц" },
  { id: "prevmonth", label: "Прошлый месяц" },
  { id: "90", label: "3 месяца" },
  { id: "180", label: "Полгода" },
  { id: "365", label: "Год" },
] as const;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const fmtDay = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function periodOf(q: { days?: string; p?: string; from?: string; to?: string }, now: Date) {
  const today = isoDay(now);
  const span = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400_000) + 1;
  if (q.from && q.to && DAY_RE.test(q.from) && DAY_RE.test(q.to)) {
    let [from, to] = q.from <= q.to ? [q.from, q.to] : [q.to, q.from];
    if (to > today) to = today;
    if (from > to) from = to;
    const days = Math.min(span(from, to), 3 * 366);
    return { id: "custom", from: isoDay(addDays(new Date(to + "T00:00:00Z"), -(days - 1))), to, days };
  }
  const id = q.p ?? q.days ?? "7";
  if (id === "today") return { id, from: today, to: today, days: 1 };
  if (id === "yesterday") { const y = isoDay(addDays(now, -1)); return { id, from: y, to: y, days: 1 }; }
  if (id === "month") { const from = today.slice(0, 8) + "01"; return { id, from, to: today, days: span(from, today) }; }
  if (id === "prevmonth") {
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    return { id, from: isoDay(first), to: isoDay(last), days: span(isoDay(first), isoDay(last)) };
  }
  const n = [7, 30, 90, 180, 365].includes(Number(id)) ? Number(id) : 7;
  return { id: String(n), from: isoDay(addDays(now, -(n - 1))), to: today, days: n };
}

export default async function Stats({ searchParams }: { searchParams: Promise<{ days?: string; p?: string; from?: string; to?: string }> }) {
  const user = await requireUser();
  const b = await getBusinessForUser(user.id);
  if (!b) redirect("/app/start");
  if (!isLaunched(b.status)) redirect("/app/launch");
  const period = periodOf(await searchParams, await reportNow(b));
  const days = period.days;
  const r = await report(b, days, period.to);
  const unit = days > 200 ? "month" : days > 62 ? "week" : "day";
  const periodText = period.from === period.to ? fmtDay(period.from) : `${fmtDay(period.from)} — ${fmtDay(period.to)}`;
  const weeks = await weeksForMarking(b, 4);
  const db = await getDb();
  const leads = await db.select().from(schema.leads).where(eq(schema.leads.businessId, b.id)).orderBy(desc(schema.leads.createdAt)).limit(30);
  const c = r.cur;
  const rows = Object.entries(r.byChannel);
  const mstatus = await metricaStatus(b.id);
  const mv = await metricaVisits(b, r.from, r.to);
  const siteDown = await siteDownInfo(b.id);
  const funnel = rows
    .filter(([ch]) => ch !== "unknown")
    .map(([ch, t]) => ({ ch, impressions: t.impressions, clicks: t.clicks, visits: mv.byChannel.get(ch)?.visits ?? 0, quality: mv.byChannel.get(ch)?.quality ?? 0, leads: t.leads }));
  const hasVisits = mv.rows > 0;
  const mNote = !mstatus
    ? "Данные Метрики появятся после следующей проверки рекламы роботом."
    : !mstatus.ok
      ? mstatus.note || (mstatus.reason ? METRICA_REASON_TEXT[mstatus.reason] : "Метрика пока недоступна.")
      : !hasVisits
        ? "Метрика подключена, но визитов из рекламы за этот период в ней нет. Проверьте, что код счётчика стоит на всех страницах, куда ведёт реклама."
        : null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Статистика</h1>
          <p className="text-muted mt-1">{periodText} · сравнение — с таким же периодом перед ним</p>
        </div>
        <PeriodPicker presets={PRESETS.map((x) => ({ ...x }))} current={period.id} from={period.from} to={period.to} />
      </div>

      <section className="card p-5 sm:p-7">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-5">
          {[
            ["Потрачено", rub(c.cost)],
            ["Переходы на сайт", num(c.clicks)],
            ["Обращения из рекламы", num(c.leads)],
            [c.clientsEstimated ? "Клиенты (оценка)" : "Клиенты", num(c.clients)],
            ["Стоимость клиента", c.clients ? rub(c.cost / c.clients) : "—"],
          ].map(([l, v]) => (
            <div key={l} className="min-w-0">
              <div className="text-sm text-muted">{l}</div>
              <div className="text-2xl font-extrabold mt-0.5">{v}</div>
            </div>
          ))}
        </div>
        {/* Вторая строка — как в Директе: показы, CTR, цена клика, конверсия и сравнение с прошлым периодом */}
        <div className="mt-5 pt-4 border-t border-line grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-5 gap-y-3 text-sm">
          {[
            ["Показы", num(c.impressions), <Delta key="i" cur={c.impressions} prev={r.prev.impressions} />],
            ["CTR", c.impressions ? `${((c.clicks / c.impressions) * 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%` : "—", c.impressions && r.prev.impressions ? <Delta key="c" cur={c.clicks / c.impressions} prev={r.prev.clicks / r.prev.impressions} /> : null],
            ["Ср. цена клика", c.clicks ? rub(c.cost / c.clicks) : "—", c.clicks && r.prev.clicks ? <Delta key="p" cur={c.cost / c.clicks} prev={r.prev.cost / r.prev.clicks} inverse /> : null],
            ["Конверсия в обращение", c.clicks ? `${((c.leads / c.clicks) * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%` : "—", c.clicks && r.prev.clicks ? <Delta key="v" cur={c.leads / c.clicks} prev={r.prev.leads / r.prev.clicks} /> : null],
            ["Цена обращения", c.leads ? rub(c.cost / c.leads) : "—", c.leads && r.prev.leads ? <Delta key="l" cur={c.cost / c.leads} prev={r.prev.cost / r.prev.leads} inverse /> : null],
            ["Визиты (Метрика)", hasVisits ? num([...mv.byChannel.values()].reduce((a, x) => a + x.visits, 0)) : "—", null],
          ].map(([l, v, d]) => (
            <div key={l as string} className="min-w-0">
              <div className="text-xs text-muted">{l}</div>
              <div className="text-lg font-bold tabular-nums">{v}</div>
              <div className="h-4">{d}</div>
            </div>
          ))}
        </div>
        {c.otherLeads ? (
          <div className="mt-5 rounded-xl bg-paper p-4 text-sm leading-relaxed">
            <b>Другие обращения: {num(c.otherLeads)}</b>
            {c.otherClients ? `, из них ${c.clientsEstimated ? "примерно " : ""}${pl(c.otherClients, "клиент", "клиента", "клиентов")}` : ""}.{" "}
            <span className="text-muted">Пришли без рекламной метки — напрямую на страницу записи, из поиска или по совету. В стоимость клиента не входят.</span>
          </div>
        ) : null}
        <div className="mt-6"><DaysChart series={r.series} unit={unit} /></div>
        <p className="hint mt-4 max-w-3xl">
          Здесь всё — только из рекламы: обращение — заявка, звонок или сообщение от человека, который пришёл по объявлению; стоимость клиента = потрачено ÷ клиенты.{" "}
          {c.adBooked || c.adMarked
            ? `Клиенты — по вашим отметкам заявок: «Записался» — клиент (${num(c.adBooked)}), «Не дозвонились» — нет. `
            : ""}
          {c.clientsEstimated
            ? `${c.adMarked ? "Неотмеченные" : "Пока заявки не отмечены, клиентов"} считаем по обычной доле: записываются ${Math.round(r.rate * 10)} из 10 обратившихся. Отмечайте заявки ниже или кнопками в Telegram — оценка станет фактом.`
            : c.adMarked ? "" : "Клиенты — по вашим отметкам."}{" "}
          Если за неделю указано число клиентов, берём его. Заявки с отметкой «Спам» не считаются нигде.
        </p>
      </section>

      <section className="card p-5 sm:p-7">
        <h2 className="text-lg font-bold">По каналам</h2>
        <p className="text-sm text-muted mt-1">У каждого канала — оценка и норма рядом с цифрой: зелёное — хорошо, жёлтое — терпимо, красное — надо разбираться.</p>
        {rows.length ? (
          <>
            <div className="mt-4 grid gap-3">
              {rows.map(([ch, t]) => {
                const m = mv.byChannel.get(ch);
                const v = channelVerdict(ch, t, m, siteDown);
                const ctr = t.impressions ? t.clicks / t.impressions : null;
                const conv = t.clicks ? t.leads / t.clicks : null;
                const bounce = m && m.visits ? m.bounces / m.visits : null;
                const n = NORMS[normKey(ch)];
                return (
                  <div key={ch} className="rounded-2xl border border-line p-4 sm:p-5">
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="font-bold text-base">{CH[ch] ?? ch}</span>
                        <span className={`pill ${v.tone === "good" ? "bg-good-soft text-good" : v.tone === "bad" ? "bg-bad-soft text-bad" : v.tone === "warn" ? "bg-warn-soft text-warn" : "bg-paper text-muted"}`}>{v.label}</span>
                      </div>
                      <div className="text-sm text-muted">Потрачено <b className="text-ink text-base tabular-nums">{rub(t.cost)}</b></div>
                    </div>
                    {v.text ? <p className={`text-sm mt-1.5 ${v.tone === "bad" ? "text-bad" : "text-ink-2"}`}>{v.text}</p> : null}
                    <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                      <Metric label="Показы" value={num(t.impressions)} />
                      <Metric label="Клики · CTR" value={`${num(t.clicks)} · ${ctr === null ? "—" : pctFmt(ctr)}`} tone={ctr === null || t.impressions < 300 ? null : ctr >= n.ctr[1] ? "good" : ctr >= n.ctr[0] ? "warn" : "bad"} hint={`норма ${pctFmt(n.ctr[0])}–${pctFmt(n.ctr[1])}`} />
                      <Metric label="Цена клика" value={t.clicks ? rub(t.cost / t.clicks) : "—"} />
                      <Metric label="Ушли сразу" value={bounce === null ? "—" : pctFmt(bounce)} tone={bounce === null || (m?.visits ?? 0) < 10 ? null : bounce <= 0.35 ? "good" : bounce <= 0.6 ? "warn" : "bad"} hint={m && m.visits ? `из ${num(m.visits)} визитов · хорошо до 35%` : "нужна Метрика на сайте"} />
                      <Metric label="Обращения" value={`${num(t.leads)}${conv !== null && t.clicks >= 20 ? ` · ${pctFmt(conv)}` : ""}`} tone={t.clicks < 20 ? null : conv! >= 0.03 ? "good" : conv! >= 0.01 ? "warn" : "bad"} hint="из кликов · хорошо от 3%" />
                      <Metric label="Цена клиента" value={t.clients && t.cost ? `${t.clientsEstimated ? "≈ " : ""}${rub(t.cost / t.clients)}` : t.leads && t.cost ? `обращение ${rub(t.cost / t.leads)}` : "—"} />
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="hint mt-3">Суммы по каналам равны итогу выше. Расход — с НДС, поэтому он на 22% больше, чем в кабинете Директа.{r.byChannel.unknown ? " «Канал не определён» — заявки с рекламной меткой, но без номера объявления: расход по ним уже учтён в своих каналах." : ""}</p>
          </>
        ) : (
          <p className="text-muted mt-3">Данных пока нет — показы начнутся после модерации.</p>
        )}
      </section>

      <section id="funnel" className="card p-5 sm:p-7 scroll-mt-6">
        <h2 className="text-lg font-bold">Путь клиента: от показа до обращения</h2>
        <p className="hint mt-1 max-w-3xl">
          Сколько людей дошло до каждого шага за выбранный период. Визиты — по Яндекс Метрике: человек открыл страницу. Качественный визит — человек не ушёл сразу: посмотрел больше одной страницы или пробыл дольше 15 секунд. Робот смотрит на качественные визиты, когда обращений пока мало, чтобы судить.
        </p>
        {mstatus?.source === "demo" && hasVisits ? <p className="mt-3 text-sm text-warn">Демо-кабинет: визиты и отказы смоделированы, это не данные Метрики.</p> : null}
        {mNote ? (
          <div className="mt-4 rounded-xl bg-paper p-4 text-sm leading-relaxed max-w-3xl">
            <b>Визитов из Метрики пока нет.</b> {mNote}
            {mstatus?.reason === "scope" || mstatus?.reason === "no_account" ? <> <Link href="/app/settings" className="font-semibold underline underline-offset-2">Открыть настройки</Link></> : null}
          </div>
        ) : null}
        {funnel.length ? (
          <div className="mt-5 grid gap-6">
            {funnel.map((f) => {
              const steps = [
                { label: "Показы", hint: "увидели объявление", v: f.impressions },
                { label: "Клики", hint: "перешли по объявлению", v: f.clicks },
                { label: "Визиты", hint: "открыли страницу", v: f.visits, metrica: true },
                { label: "Без отказа", hint: "не ушли сразу", v: f.quality, metrica: true },
                { label: "Обращения", hint: "заявки и звонки", v: f.leads },
              ];
              return (
                <div key={f.ch}>
                  <div className="font-semibold">{CH[f.ch] ?? f.ch}</div>
                  <ol className="mt-2 grid gap-2 sm:grid-cols-5">
                    {steps.map((st, i) => {
                      const prev = i > 0 ? steps[i - 1].v : 0;
                      const share = i > 0 && prev > 0 ? st.v / prev : null;
                      const empty = st.metrica && !hasVisits;
                      return (
                        <li key={st.label} className="rounded-xl bg-paper px-3.5 py-2.5 sm:py-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 sm:flex sm:flex-col sm:items-stretch">
                          {/* Высота подписи одинаковая у всех карточек — цифры и полоски стоят на одной линии */}
                          <div className="min-w-0 sm:min-h-[2.6rem]">
                            <div className="text-sm font-semibold leading-tight sm:truncate" title={st.label}>{st.label}</div>
                            <div className="text-xs text-muted leading-tight sm:line-clamp-1" title={st.hint}>{st.hint}</div>
                          </div>
                          <div className="text-right sm:text-left sm:mt-1">
                            <div className="text-xl font-extrabold leading-tight">{empty ? "—" : num(st.v)}</div>
                            <div className="text-xs text-muted truncate">{empty || share === null ? (i === 0 ? "\u00a0" : "—") : `${share < 0.1 && share > 0 ? (share * 100).toFixed(1).replace(".", ",") : Math.round(share * 100)}% от пред. шага`}</div>
                          </div>
                          <div className="col-span-2 mt-2 sm:mt-auto sm:pt-2" aria-hidden><div className="h-1.5 rounded-full bg-line overflow-hidden">
                            <div className="h-full rounded-full bg-ink" style={{ width: `${empty ? 0 : i === 0 ? 100 : Math.max(share ? 2 : 0, Math.min(100, (share ?? 0) * 100))}%` }} />
                          </div></div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-muted mt-3">Данных пока нет — показы начнутся после модерации.</p>
        )}
        {mv.campaigns.length ? (
          <div className="mt-7">
            <h3 className="font-bold">Визиты по кампаниям</h3>
            <ul className="mt-3 grid gap-3 sm:hidden">
              {mv.campaigns.map((k) => (
                <li key={k.id} className="rounded-xl border border-line p-4">
                  <div className="font-semibold">{CH[k.channel] ?? k.channel}</div>
                  <div className="text-xs text-faint truncate">{k.name}</div>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                    <div><dt className="text-xs text-muted">Визиты</dt><dd className="font-semibold">{num(k.visits)}</dd></div>
                    <div><dt className="text-xs text-muted">Отказы</dt><dd className="font-semibold">{k.visits ? `${Math.round((k.bounces / k.visits) * 100)}%` : "—"}</dd></div>
                    <div><dt className="text-xs text-muted">Время</dt><dd className="font-semibold">{k.visits ? dur(k.durationSum / k.visits) : "—"}</dd></div>
                  </dl>
                </li>
              ))}
            </ul>
            <div className="hidden sm:block mt-3 overflow-x-auto">
              <table className="dtable">
                <thead>
                  <tr>
                    <th>Кампания</th>
                    <th>Клики</th>
                    <th>Визиты</th>
                    <th>Ушли сразу</th>
                    <th>Время на сайте</th>
                  </tr>
                </thead>
                <tbody>
                  {mv.campaigns.map((k) => (
                    <tr key={k.id}>
                      <td><span className="name">{CH[k.channel] ?? k.channel}</span><span className="desc">{k.name}</span></td>
                      <td><span className="num">{num(k.clicks)}</span></td>
                      <td><span className="num">{num(k.visits)}</span>{k.visits ? <span className="sub">{num(k.visits - k.bounces)} без отказа</span> : null}</td>
                      <td><span className={`num ${k.visits && k.bounces / k.visits > 0.6 ? "!text-bad" : ""}`}>{k.visits ? `${Math.round((k.bounces / k.visits) * 100)}%` : "—"}</span></td>
                      <td><span className="num">{k.visits ? dur(k.durationSum / k.visits) : "—"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint mt-3">Отказ — человек посмотрел одну страницу меньше 15 секунд. Визитов бывает меньше кликов: часть людей закрывает страницу до её загрузки.</p>
          </div>
        ) : null}
      </section>

      <section className="card p-5 sm:p-7">
        <h2 className="text-lg font-bold">Клиенты по неделям</h2>
        <p className="hint mt-1">Сколько из всех обратившихся за неделю действительно записались и пришли. Достаточно раз в неделю заглянуть в журнал записи.</p>
        <div className="mt-4 grid gap-4 divide-y divide-line">
          {weeks.map((w) => (
            <div key={w.weekStart} className="pt-4 first:pt-0">
              <ClientsWeek plain weekStart={w.weekStart} leads={w.leads} otherLeads={w.otherLeads} initial={w.clients} current={w === weeks[0]} />
            </div>
          ))}
        </div>
      </section>

      <section id="leads" className="card p-5 sm:p-7 scroll-mt-6">
        <h2 className="text-lg font-bold">Последние обращения</h2>
        {leads.some((l) => l.contact) ? (
          <p className="hint mt-1 max-w-2xl">
            После звонка отметьте, чем закончилось: «Записался» — это клиент в стоимости клиента{b.counterId ? " и сигнал для Директа (передаём в Метрику)" : ""}; «Спам» убираем из статистики. Те же кнопки есть в Telegram под каждой заявкой.
          </p>
        ) : null}
        {leads.length ? (
          <ul className="mt-3 divide-y divide-line">
            {leads.map((l) => (
              <li key={l.id} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <span className="font-semibold w-24 shrink-0">{KIND[l.kind] ?? l.kind}</span>
                <span className="text-muted w-36 shrink-0">{l.createdAt.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" })}</span>
                <span className="flex-1 min-w-[8rem] truncate">{[l.name, l.contact].filter(Boolean).join(", ") || "—"}</span>
                {l.kind === "suspect" ? <span className="pill bg-warn-soft text-warn" title="Пришла во время всплеска заявок — возможно, спам. В статистику рекламы не входит.">похоже на спам</span> : null}
                <span className="pill bg-paper text-muted">{l.adExt || l.campaignExt || (l.source && SRC[l.source]) ? SRC[l.source ?? ""] ?? "Реклама" : l.source ? `Не из рекламы (${l.source})` : "Не из рекламы"}</span>
                {l.contact ? (
                  <div className="basis-full sm:basis-auto sm:ml-auto">
                    <LeadStatus id={l.id} initial={(l.status as "booked" | "no_answer" | "spam" | null) ?? null} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted mt-3 leading-relaxed max-w-2xl">
            Здесь появятся заявки, звонки и сообщения с {b.siteUrl && ["search", "network", "vk"].some((ch) => landingFor(b, ch).kind === "site") ? "сайта — после установки кода счётчика" : "вашей страницы записи"}. Обращения, которые засчитала сама площадка (например, по целям Метрики), учитываются в цифрах выше.
          </p>
        )}
      </section>
    </div>
  );
}

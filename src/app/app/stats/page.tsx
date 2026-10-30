import { isLaunched } from "@/lib/util";
import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getBusinessForUser } from "@/lib/engine/launch";
import { metricaVisits, report, weeksForMarking } from "@/lib/engine/report";
import { METRICA_REASON_TEXT, metricaStatus } from "@/lib/engine/metrica-sync";
import { getDb, schema } from "@/lib/db";
import { DaysChart } from "@/components/charts";
import { ClientsWeek } from "@/components/ClientsWeek";
import { CHANNEL_NAME } from "@/lib/platforms";
import { num, pl, rub } from "@/lib/util";
import { LeadStatus } from "./LeadStatus";

const KIND: Record<string, string> = { form: "Заявка", phone: "Звонок", messenger: "Мессенджер", suspect: "Заявка" };
const SRC: Record<string, string> = { yandex: "Реклама в Яндексе", vk: "Реклама ВКонтакте", demo: "Реклама (демо)" };
const CH: Record<string, string> = { ...CHANNEL_NAME, unknown: "Реклама, канал не определён" };
/** Среднее время визита: «1 мин 05 с» */
const dur = (sec: number) => (sec >= 60 ? `${Math.floor(sec / 60)} мин ${String(Math.round(sec % 60)).padStart(2, "0")} с` : `${Math.round(sec)} с`);

export default async function Stats({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const user = await requireUser();
  const b = await getBusinessForUser(user.id);
  if (!b) redirect("/app/start");
  if (!isLaunched(b.status)) redirect("/app/launch");
  const days = (await searchParams).days === "30" ? 30 : 7;
  const r = await report(b, days);
  const weeks = await weeksForMarking(b, 4);
  const db = await getDb();
  const leads = await db.select().from(schema.leads).where(eq(schema.leads.businessId, b.id)).orderBy(desc(schema.leads.createdAt)).limit(30);
  const c = r.cur;
  const rows = Object.entries(r.byChannel);
  const mstatus = await metricaStatus(b.id);
  const mv = await metricaVisits(b, r.from, r.to);
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
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Статистика</h1>
          <p className="text-muted mt-1">Сколько потрачено и сколько людей обратилось</p>
        </div>
        <div className="inline-flex rounded-xl bg-card border border-line p-1" role="tablist">
          {[7, 30].map((d) => (
            <Link key={d} href={`/app/stats?days=${d}`} role="tab" aria-selected={days === d} className={`px-4 h-9 grid place-items-center rounded-lg text-sm font-semibold ${days === d ? "bg-ink text-white" : "text-ink-2"}`}>
              {pl(d, "день", "дня", "дней")}
            </Link>
          ))}
        </div>
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
        {c.otherLeads ? (
          <div className="mt-5 rounded-xl bg-paper p-4 text-sm leading-relaxed">
            <b>Другие обращения: {num(c.otherLeads)}</b>
            {c.otherClients ? `, из них ${c.clientsEstimated ? "примерно " : ""}${pl(c.otherClients, "клиент", "клиента", "клиентов")}` : ""}.{" "}
            <span className="text-muted">Пришли без рекламной метки — напрямую на страницу записи, из поиска или по совету. В стоимость клиента не входят.</span>
          </div>
        ) : null}
        <div className="mt-6"><DaysChart series={r.series} /></div>
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
        {rows.length ? (
          <>
            {/* Телефон: карточки вместо широкой таблицы */}
            <ul className="mt-4 grid gap-3 sm:hidden">
              {rows.map(([ch, t]) => (
                <li key={ch} className="rounded-xl border border-line p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold">{CH[ch] ?? ch}</span>
                    <span className="font-extrabold">{t.clients && t.cost ? rub(t.cost / t.clients) : "—"}</span>
                  </div>
                  <div className="text-xs text-faint text-right">стоимость клиента</div>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                    <div><dt className="text-xs text-muted">Расход</dt><dd className="font-semibold">{rub(t.cost)}</dd></div>
                    <div><dt className="text-xs text-muted">Обращения</dt><dd className="font-semibold">{num(t.leads)}{t.leads && t.cost ? <span className="text-muted font-normal"> · {rub(t.cost / t.leads)}</span> : null}</dd></div>
                    <div><dt className="text-xs text-muted">Клиенты{t.clientsEstimated ? " ≈" : ""}</dt><dd className="font-semibold">{num(t.clients)}</dd></div>
                  </dl>
                </li>
              ))}
            </ul>
            <div className="hidden sm:block mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted border-b border-line">
                    <th className="py-2 pr-2 font-semibold">Канал</th>
                    <th className="py-2 px-2 font-semibold text-right">Расход</th>
                    <th className="py-2 px-2 font-semibold text-right">Переходы</th>
                    <th className="py-2 px-2 font-semibold text-right">Обращения</th>
                    <th className="py-2 px-2 font-semibold text-right">Цена обращения</th>
                    <th className="py-2 px-2 font-semibold text-right">Клиенты</th>
                    <th className="py-2 pl-2 font-semibold text-right">Стоимость клиента</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(([ch, t]) => (
                    <tr key={ch} className="border-b border-line last:border-0">
                      <td className="py-3 pr-2 font-semibold">{CH[ch] ?? ch}</td>
                      <td className="py-3 px-2 text-right">{rub(t.cost)}</td>
                      <td className="py-3 px-2 text-right">{num(t.clicks)}</td>
                      <td className="py-3 px-2 text-right">{num(t.leads)}</td>
                      <td className="py-3 px-2 text-right">{t.leads && t.cost ? rub(t.cost / t.leads) : "—"}</td>
                      <td className="py-3 px-2 text-right">{t.clientsEstimated && t.clients ? "≈ " : ""}{num(t.clients)}</td>
                      <td className="py-3 pl-2 text-right font-semibold">{t.clients && t.cost ? rub(t.cost / t.clients) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint mt-3">Суммы по каналам равны итогу выше.{r.byChannel.unknown ? " «Канал не определён» — заявки с рекламной меткой, но без номера объявления: расход по ним уже учтён в своих каналах." : ""}</p>
          </>
        ) : (
          <p className="text-muted mt-3">Данных пока нет — показы начнутся после модерации.</p>
        )}
      </section>

      <section id="funnel" className="card p-5 sm:p-7 scroll-mt-6">
        <h2 className="text-lg font-bold">Путь клиента: от показа до обращения</h2>
        <p className="hint mt-1 max-w-3xl">
          Сколько людей дошло до каждого шага за {pl(days, "день", "дня", "дней")}. Визиты — по Яндекс Метрике: человек открыл страницу. Качественный визит — человек не ушёл сразу: посмотрел больше одной страницы или пробыл дольше 15 секунд. Робот смотрит на качественные визиты, когда обращений пока мало, чтобы судить.
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
                { label: "Качественные визиты", hint: "не ушли сразу", v: f.quality, metrica: true },
                { label: "Обращения", hint: "заявка, звонок, сообщение", v: f.leads },
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
                        <li key={st.label} className="rounded-xl bg-paper px-3.5 py-2.5 sm:py-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 sm:block">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold leading-tight">{st.label}</div>
                            <div className="text-xs text-muted leading-tight">{st.hint}</div>
                          </div>
                          <div className="text-right sm:text-left sm:mt-2">
                            <div className="text-xl font-extrabold leading-tight">{empty ? "—" : num(st.v)}</div>
                            <div className="text-xs text-muted">{empty || share === null ? (i === 0 ? "\u00a0" : "—") : `${share < 0.1 && share > 0 ? (share * 100).toFixed(1).replace(".", ",") : Math.round(share * 100)}% от «${steps[i - 1].label.toLowerCase()}»`}</div>
                          </div>
                          <div className="col-span-2 mt-2 h-1.5 rounded-full bg-line overflow-hidden" aria-hidden>
                            <div className="h-full rounded-full bg-ink" style={{ width: `${empty ? 0 : i === 0 ? 100 : Math.max(share ? 2 : 0, Math.min(100, (share ?? 0) * 100))}%` }} />
                          </div>
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
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted border-b border-line">
                    <th className="py-2 pr-2 font-semibold">Кампания</th>
                    <th className="py-2 px-2 font-semibold text-right">Клики</th>
                    <th className="py-2 px-2 font-semibold text-right">Визиты</th>
                    <th className="py-2 px-2 font-semibold text-right">Качественные</th>
                    <th className="py-2 px-2 font-semibold text-right">Отказы</th>
                    <th className="py-2 pl-2 font-semibold text-right">Среднее время на сайте</th>
                  </tr>
                </thead>
                <tbody>
                  {mv.campaigns.map((k) => (
                    <tr key={k.id} className="border-b border-line last:border-0">
                      <td className="py-3 pr-2"><div className="font-semibold">{CH[k.channel] ?? k.channel}</div><div className="text-xs text-faint">{k.name}</div></td>
                      <td className="py-3 px-2 text-right">{num(k.clicks)}</td>
                      <td className="py-3 px-2 text-right">{num(k.visits)}</td>
                      <td className="py-3 px-2 text-right">{num(k.visits - k.bounces)}</td>
                      <td className="py-3 px-2 text-right">{k.visits ? `${Math.round((k.bounces / k.visits) * 100)}%` : "—"}</td>
                      <td className="py-3 pl-2 text-right">{k.visits ? dur(k.durationSum / k.visits) : "—"}</td>
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
            Здесь появятся заявки, звонки и сообщения с {b.siteUrl ? "сайта — после установки кода счётчика" : "вашей страницы записи"}. Обращения, которые засчитала сама площадка (например, по целям Метрики), учитываются в цифрах выше.
          </p>
        )}
      </section>
    </div>
  );
}

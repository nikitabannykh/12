import { isLaunched } from "@/lib/util";
import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getBusinessForUser } from "@/lib/engine/launch";
import { report, weeksForMarking } from "@/lib/engine/report";
import { getDb, schema } from "@/lib/db";
import { DaysChart } from "@/components/charts";
import { ClientsWeek } from "@/components/ClientsWeek";
import { CHANNEL_NAME } from "@/lib/platforms";
import { num, pl, rub } from "@/lib/util";
import { LeadStatus } from "./LeadStatus";

const KIND: Record<string, string> = { form: "Заявка", phone: "Звонок", messenger: "Мессенджер", suspect: "Заявка" };
const SRC: Record<string, string> = { yandex: "Реклама в Яндексе", vk: "Реклама ВКонтакте", demo: "Реклама (демо)" };
const CH: Record<string, string> = { ...CHANNEL_NAME, unknown: "Реклама, канал не определён" };

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

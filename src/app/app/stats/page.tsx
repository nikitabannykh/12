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
import { num, rub } from "@/lib/util";

const KIND: Record<string, string> = { form: "Заявка", phone: "Звонок", messenger: "Мессенджер" };
const SRC: Record<string, string> = { yandex: "Яндекс", vk: "ВКонтакте", demo: "Демо" };

export default async function Stats({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const user = await requireUser();
  const b = await getBusinessForUser(user.id);
  if (!b) redirect("/app/start");
  if (b.status !== "active") redirect("/app/launch");
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
              {d} дней
            </Link>
          ))}
        </div>
      </div>

      <section className="card p-5 sm:p-7">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-5">
          {[
            ["Потрачено", rub(c.cost)],
            ["Переходы на сайт", num(c.clicks)],
            ["Обращения", num(c.leads)],
            [c.clientsEstimated ? "Клиенты (оценка)" : "Клиенты", num(c.clients)],
            ["Стоимость клиента", c.clients ? rub(c.cost / c.clients) : "—"],
          ].map(([l, v]) => (
            <div key={l}>
              <div className="text-sm text-muted">{l}</div>
              <div className="text-2xl font-extrabold mt-0.5">{v}</div>
            </div>
          ))}
        </div>
        <div className="mt-6"><DaysChart series={r.series} /></div>
        <p className="hint mt-4 max-w-3xl">
          Обращение — заявка с сайта, звонок или сообщение в мессенджер от человека, пришедшего из рекламы. Клиенты {c.clientsEstimated ? `оцениваются: обычно записываются ${Math.round(r.rate * 10)} из 10 обратившихся. Отметьте точные цифры ниже — оценка станет фактом.` : "— по вашим отметкам."}
        </p>
      </section>

      <section className="card p-5 sm:p-7 overflow-x-auto">
        <h2 className="text-lg font-bold">По каналам</h2>
        <table className="mt-4 w-full text-sm min-w-[560px]">
          <thead>
            <tr className="text-left text-muted border-b border-line">
              <th className="py-2 font-semibold">Канал</th>
              <th className="py-2 font-semibold text-right">Расход</th>
              <th className="py-2 font-semibold text-right">Переходы</th>
              <th className="py-2 font-semibold text-right">Цена перехода</th>
              <th className="py-2 font-semibold text-right">Обращения</th>
              <th className="py-2 font-semibold text-right">Цена обращения</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([ch, t]) => (
              <tr key={ch} className="border-b border-line last:border-0">
                <td className="py-3 font-semibold">{CHANNEL_NAME[ch] ?? ch}</td>
                <td className="py-3 text-right">{rub(t.cost)}</td>
                <td className="py-3 text-right">{num(t.clicks)}</td>
                <td className="py-3 text-right">{t.clicks ? rub(t.cost / t.clicks) : "—"}</td>
                <td className="py-3 text-right">{num(t.leads)}</td>
                <td className="py-3 text-right font-semibold">{t.leads ? rub(t.cost / t.leads) : "—"}</td>
              </tr>
            ))}
            {!rows.length ? <tr><td colSpan={6} className="py-6 text-center text-muted">Данных пока нет — показы начнутся после модерации.</td></tr> : null}
          </tbody>
        </table>
      </section>

      <section className="card p-5 sm:p-7">
        <h2 className="text-lg font-bold">Клиенты по неделям</h2>
        <p className="hint mt-1">Сколько обратившихся действительно записались и пришли. Достаточно раз в неделю заглянуть в журнал записи.</p>
        <div className="mt-4 grid gap-4 divide-y divide-line">
          {weeks.map((w) => (
            <div key={w.weekStart} className="pt-4 first:pt-0">
              <ClientsWeek plain weekStart={w.weekStart} leads={w.leads} initial={w.clients} />
            </div>
          ))}
        </div>
      </section>

      <section className="card p-5 sm:p-7">
        <h2 className="text-lg font-bold">Последние обращения</h2>
        {leads.length ? (
          <ul className="mt-3 divide-y divide-line">
            {leads.map((l) => (
              <li key={l.id} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="font-semibold w-24">{KIND[l.kind] ?? l.kind}</span>
                <span className="text-muted w-36">{l.createdAt.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" })}</span>
                <span className="flex-1 min-w-0 truncate">{[l.name, l.contact].filter(Boolean).join(", ") || "—"}</span>
                <span className="pill bg-paper text-muted">{l.source ? SRC[l.source] ?? l.source : "Без метки"}</span>
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

import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, gte, inArray } from "drizzle-orm";
import { RefreshCw, TriangleAlert, FastForward } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getBusinessForUser, accountsFor } from "@/lib/engine/launch";
import { report, weeksForMarking } from "@/lib/engine/report";
import { recentChanges } from "@/lib/engine/ops";
import { getDb, schema } from "@/lib/db";
import { ActionButton } from "@/components/client";
import { ChangeItem } from "@/components/ChangeItem";
import { DaysChart, Delta } from "@/components/charts";
import { ClientsWeek } from "@/components/ClientsWeek";
import { rub, num, pl, isoDay, startOfMonth } from "@/lib/util";

export default async function Dashboard() {
  const user = await requireUser();
  const b = await getBusinessForUser(user.id);
  if (!b) redirect("/app/start");
  if (b.status !== "active") redirect("/app/launch");

  const db = await getDb();
  const [r, changes, accounts, weeks] = await Promise.all([report(b, 7), recentChanges(b.id, 5), accountsFor(user.id), weeksForMarking(b, 2)]);
  const camps = await db.select().from(schema.campaigns).where(eq(schema.campaigns.businessId, b.id));
  const isDemo = camps.length > 0 && camps.every((c) => c.platform === "demo");
  const ads = await db.select({ status: schema.ads.status }).from(schema.ads).where(and(eq(schema.ads.businessId, b.id), inArray(schema.ads.status, ["moderation", "rejected", "active"])));
  const monthCost = (await db.select({ cost: schema.statsDaily.cost }).from(schema.statsDaily).where(and(eq(schema.statsDaily.businessId, b.id), gte(schema.statsDaily.day, isoDay(startOfMonth(r.now)))))).reduce((s, x) => s + x.cost, 0);
  const tracked = await db.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.businessId, b.id)).limit(1);

  const c = r.cur, p = r.prev;
  const cpc = c.clients ? c.cost / c.clients : null;
  const cpcPrev = p.clients ? p.cost / p.clients : null;
  const moderation = ads.filter((a) => a.status === "moderation").length;
  const rejected = ads.filter((a) => a.status === "rejected").length;
  const active = ads.filter((a) => a.status === "active").length;
  const broken = accounts.filter((a) => a.status !== "ok");
  const lastWeek = weeks[1];
  const needMark = lastWeek && lastWeek.leads > 0 && lastWeek.clients === null;
  const monthShare = Math.min(1, monthCost / b.monthlyBudget);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Главное</h1>
          <p className="text-muted mt-1">Последние 7 дней{isDemo ? " · демо-данные" : ""}</p>
        </div>
        <ActionButton url="/api/run" done="Проверили рекламу и обновили статистику" className="btn btn-ghost btn-sm">
          <RefreshCw size={15} /> Проверить сейчас
        </ActionButton>
      </div>

      {/* Итог одной фразой */}
      <section className="card p-5 sm:p-7">
        <p className="text-xl sm:text-2xl leading-snug font-semibold max-w-3xl">
          {c.cost > 0 ? (
            <>
              Реклама привела <span className="marked">{pl(c.leads, "обращение", "обращения", "обращений")}</span>
              {c.clients ? <>, из них {c.clientsEstimated ? "примерно " : ""}{pl(c.clients, "клиент", "клиента", "клиентов")}</> : null}.{" "}
              {cpc ? <>Клиент обошёлся в {rub(cpc)}.</> : <>Потрачено {rub(c.cost)}.</>}
            </>
          ) : moderation ? (
            <>Объявления на модерации. Как только площадки их проверят, начнутся показы — обычно в течение суток.</>
          ) : (
            <>Показов пока не было. Статистика появится в течение суток после старта.</>
          )}
        </p>
        <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-5">
          {[
            { label: "Потрачено", value: rub(c.cost), delta: <Delta cur={c.cost} prev={p.cost} inverse /> },
            { label: "Обращения", value: num(c.leads), delta: <Delta cur={c.leads} prev={p.leads} />, hint: "заявки, звонки, сообщения" },
            { label: c.clientsEstimated ? "Клиенты, оценка" : "Клиенты", value: num(c.clients), delta: <Delta cur={c.clients} prev={p.clients} /> },
            { label: "Стоимость клиента", value: cpc ? rub(cpc) : "—", delta: cpc && cpcPrev ? <Delta cur={cpc} prev={cpcPrev} inverse /> : null },
          ].map((m) => (
            <div key={m.label}>
              <div className="text-sm text-muted">{m.label}</div>
              <div className="text-2xl sm:text-3xl font-extrabold tracking-tight mt-0.5">{m.value}</div>
              <div className="h-4">{m.delta}</div>
            </div>
          ))}
        </div>
        <div className="mt-6">
          <DaysChart series={r.series} />
        </div>
      </section>

      {/* Требует внимания */}
      {broken.length || needMark || rejected || (b.siteUrl && !tracked.length && c.cost > 0) ? (
        <section className="grid gap-3">
          {broken.map((a) => (
            <div key={a.id} className="rounded-xl bg-bad-soft text-bad p-4 flex gap-3 items-start">
              <TriangleAlert size={18} className="shrink-0 mt-0.5" />
              <div className="flex-1 text-sm leading-relaxed"><b>Нет доступа к кабинету {a.login}.</b> {a.statusNote} Робот не может управлять рекламой, пока доступ не восстановлен.</div>
              <a className="btn btn-sm bg-white text-bad" href={`/api/connect/${a.platform}/start?back=/app`}>Подключить заново</a>
            </div>
          ))}
          {needMark ? <ClientsWeek weekStart={lastWeek.weekStart} leads={lastWeek.leads} /> : null}
          {rejected ? (
            <div className="rounded-xl bg-warn-soft text-warn p-4 text-sm leading-relaxed">
              <b>{pl(rejected, "объявление не прошло", "объявления не прошли", "объявлений не прошли")} модерацию.</b> Робот перепишет их при следующей проверке — или поправьте сами в разделе <Link href="/app/ads" className="underline">«Реклама»</Link>.
            </div>
          ) : null}
          {b.siteUrl && !tracked.length && c.cost > 0 ? (
            <div className="rounded-xl bg-info-soft p-4 text-sm leading-relaxed">
              <b>Обращения с сайта пока не приходят.</b> Проверьте, что код счётчика стоит на всех страницах сайта — без него мы видим клики, но не видим записи. <Link href="/app/settings#counter" className="underline">Код счётчика</Link>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6">
        <section className="card p-5 sm:p-7">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-bold">Что сделал робот</h2>
            <Link href="/app/history" className="text-sm font-semibold underline underline-offset-2">Вся история</Link>
          </div>
          {changes.length ? (
            <ul className="mt-5 grid gap-5">{changes.map((ch) => <ChangeItem key={ch.id} c={ch} compact />)}</ul>
          ) : (
            <p className="text-muted mt-3">Пока ничего — робот начнёт действовать, когда накопится статистика.</p>
          )}
        </section>

        <section className="grid gap-6 content-start">
          <div className="card p-5 sm:p-6">
            <h2 className="text-lg font-bold">Бюджет месяца</h2>
            <div className="mt-3 flex items-baseline justify-between">
              <span className="text-2xl font-extrabold">{rub(monthCost)}</span>
              <span className="text-muted">из {rub(b.monthlyBudget)}</span>
            </div>
            <div className="mt-2 h-2.5 rounded-full bg-paper overflow-hidden"><div className={`h-full ${monthShare > 0.95 ? "bg-warn" : "bg-ink"}`} style={{ width: `${monthShare * 100}%` }} /></div>
            <p className="hint mt-2">Робот держит расходы в пределах бюджета. <Link href="/app/settings#budget" className="underline">Изменить бюджет</Link></p>
          </div>
          <div className="card p-5 sm:p-6">
            <h2 className="text-lg font-bold">Объявления</h2>
            <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
              <div><dt className="text-xs text-muted">Работают</dt><dd className="text-2xl font-extrabold">{active}</dd></div>
              <div><dt className="text-xs text-muted">На проверке</dt><dd className="text-2xl font-extrabold">{moderation}</dd></div>
              <div><dt className="text-xs text-muted">Отклонены</dt><dd className="text-2xl font-extrabold">{rejected}</dd></div>
            </dl>
            <Link href="/app/ads" className="btn btn-ghost btn-sm w-full mt-4">Смотреть объявления</Link>
          </div>
          {isDemo ? (
            <div className="card p-5 sm:p-6 border-dashed">
              <h2 className="text-lg font-bold">Демо: промотать время</h2>
              <p className="hint mt-1.5">Статистика моделируется. Промотайте вперёд — робот проверит рекламу за каждый день и примет решения, как в реальном кабинете.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {[1, 3, 7].map((d) => (
                  <ActionButton key={d} url="/api/demo/advance" body={{ days: d }} done={`Прошло ${pl(d, "день", "дня", "дней")}. Загляните в историю`} className="btn btn-ghost btn-sm">
                    <FastForward size={15} /> +{pl(d, "день", "дня", "дней")}
                  </ActionButton>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

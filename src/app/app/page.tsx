import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, gte, inArray } from "drizzle-orm";
import { RefreshCw, TriangleAlert, FastForward, PauseCircle, GraduationCap } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getBusinessForUser, accountsFor } from "@/lib/engine/launch";
import { report, weeksForMarking, campaignStates, LEARNING_DAYS } from "@/lib/engine/report";
import { recentChanges } from "@/lib/engine/ops";
import { getDb, schema } from "@/lib/db";
import { ActionButton } from "@/components/client";
import { ChangeItem } from "@/components/ChangeItem";
import { DaysChart, Delta } from "@/components/charts";
import { ClientsWeek } from "@/components/ClientsWeek";
import { CHANNEL_NAME } from "@/lib/platforms";
import { rub, num, pl, isoDay, startOfMonth } from "@/lib/util";

const SHORT: Record<string, string> = { search: "Поиск", network: "Сайты и приложения", vk: "ВКонтакте" };
const ORDER = ["search", "network", "vk"];

export default async function Dashboard() {
  const user = await requireUser();
  const b = await getBusinessForUser(user.id);
  if (!b) redirect("/app/start");
  if (b.status !== "active") redirect("/app/launch");

  const db = await getDb();
  const [r, changes, accounts, weeks] = await Promise.all([report(b, 7), recentChanges(b.id, 5), accountsFor(user.id), weeksForMarking(b, 2)]);
  const camps = (await db.select().from(schema.campaigns).where(eq(schema.campaigns.businessId, b.id)))
    .filter((c) => c.status !== "archived")
    .sort((x, y) => ORDER.indexOf(x.channel) - ORDER.indexOf(y.channel));
  const states = await campaignStates(b, camps, r.now);
  const isDemo = camps.length > 0 && camps.every((c) => c.platform === "demo");
  const groups = camps.length ? await db.select({ id: schema.adGroups.id, status: schema.adGroups.status }).from(schema.adGroups).where(inArray(schema.adGroups.campaignId, camps.map((c) => c.id))) : [];
  const ads = await db
    .select({ status: schema.ads.status, campaignId: schema.ads.campaignId, adGroupId: schema.ads.adGroupId })
    .from(schema.ads)
    .where(and(eq(schema.ads.businessId, b.id), inArray(schema.ads.status, ["moderation", "rejected", "active"])));
  const monthCost = (await db.select({ cost: schema.statsDaily.cost }).from(schema.statsDaily).where(and(eq(schema.statsDaily.businessId, b.id), gte(schema.statsDaily.day, isoDay(startOfMonth(r.now)))))).reduce((s, x) => s + x.cost, 0);
  const tracked = await db.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.businessId, b.id)).limit(1);

  const c = r.cur, p = r.prev;
  const cpc = c.clients ? c.cost / c.clients : null;
  const cpcPrev = p.clients ? p.cost / p.clients : null;

  // ─── Что сейчас реально показывается ───
  const liveCamp = new Set(camps.filter((x) => x.status === "active").map((x) => x.id));
  const liveGroup = new Set(groups.filter((g) => g.status === "active").map((g) => g.id));
  const showing = (a: (typeof ads)[number]) => liveCamp.has(a.campaignId) && liveGroup.has(a.adGroupId);
  const active = ads.filter((a) => a.status === "active" && showing(a)).length;
  const moderation = ads.filter((a) => a.status === "moderation" && showing(a)).length;
  const rejected = ads.filter((a) => a.status === "rejected").length;
  const stopped = camps.filter((x) => states.get(x.id)?.stopped);
  const allStopped = camps.length > 0 && stopped.length === camps.length;
  const guardStopped = stopped.filter((x) => states.get(x.id)?.stopped === "guard");
  const ownerStopped = stopped.filter((x) => states.get(x.id)?.stopped === "owner" || states.get(x.id)?.stopped === "robot");
  const errorStopped = stopped.filter((x) => states.get(x.id)?.stopped === "error");
  const learning = camps.filter((x) => (states.get(x.id)?.learningLeft ?? 0) > 0);
  const nextMonth = new Date(Date.UTC(r.now.getUTCFullYear(), r.now.getUTCMonth() + 1, 1)).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
  const overBudget = monthCost >= b.monthlyBudget * 0.98;
  const names = (list: typeof camps) => list.map((x) => `«${SHORT[x.channel] ?? CHANNEL_NAME[x.channel] ?? x.channel}»`).join(", ");

  const broken = accounts.filter((a) => a.status !== "ok");
  const lastWeek = weeks.find((w) => w.weekStart < isoDay(r.now) && w !== weeks[0]);
  const needMark = lastWeek && lastWeek.leads > 0 && lastWeek.clients === null;
  const monthShare = b.monthlyBudget ? monthCost / b.monthlyBudget : 0;

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

      {/* ─── Реклама стоит: причина и что делать ─── */}
      {guardStopped.length ? (
        <StopBanner
          tone="bad"
          title={allStopped ? "Реклама остановлена — бюджет месяца израсходован" : `Робот остановил ${names(guardStopped)}: бюджет месяца израсходован`}
          text={
            overBudget
              ? `Потрачено ${rub(monthCost)} из ${rub(b.monthlyBudget)}. Чтобы не выйти за бюджет, показы стоят до ${nextMonth} — тогда робот включит рекламу сам. Хотите продолжить раньше — поднимите бюджет и включите рекламу.`
              : `Бюджет теперь ${rub(b.monthlyBudget)}, потрачено ${rub(monthCost)} — деньги на показы есть. Включите рекламу, и показы возобновятся в течение часа.`
          }
        >
          {overBudget ? (
            <Link href="/app/settings#budget" className="btn btn-primary btn-sm">Поднять бюджет</Link>
          ) : (
            <ActionButton url="/api/campaigns/resume" body={{ ids: guardStopped.map((x) => x.id) }} done="Реклама включена" className="btn btn-primary btn-sm">Включить</ActionButton>
          )}
        </StopBanner>
      ) : null}
      {ownerStopped.length ? (
        <StopBanner
          tone={allStopped ? "warn" : "info"}
          title={allStopped ? "Реклама на паузе — объявления никто не видит" : `На паузе: ${names(ownerStopped)}`}
          text={(() => {
            const one = ownerStopped.length === 1;
            const via = ownerStopped.map((x) => states.get(x.id)?.via).find(Boolean);
            const robot = ownerStopped.find((x) => states.get(x.id)?.stopped === "robot");
            if (robot) return states.get(robot.id)?.note || "Робот остановил показы. Причина — в истории изменений.";
            if (via) return `${one ? "Канал остановлен" : "Каналы остановлены"} вместе с вашим изменением «${via}» — на меньший бюджет хватает не всех каналов. Деньги на ${one ? "нём" : "них"} не тратятся. Поднимите бюджет или включите, если нужно.`;
            return `${one ? "Этот канал" : "Эти каналы"} остановили вы. Деньги на ${one ? "нём" : "них"} не тратятся, настройки и статистика сохранены.`;
          })()}
        >
          {ownerStopped.some((x) => states.get(x.id)?.via) ? <Link href="/app/settings#budget" className="btn btn-ghost btn-sm bg-white">Поднять бюджет</Link> : null}
          <ActionButton url="/api/campaigns/resume" body={{ ids: ownerStopped.map((x) => x.id) }} done="Реклама включена" className={`btn btn-sm ${allStopped ? "btn-primary" : "btn-ghost bg-white"}`}>Включить</ActionButton>
        </StopBanner>
      ) : null}
      {errorStopped.map((x) => (
        <StopBanner key={x.id} tone="bad" title={`${SHORT[x.channel] ?? x.channel}: показы не идут`} text={x.statusNote || "Площадка вернула ошибку. Робот попробует ещё раз при следующей проверке."}>
          <Link href="/app/settings" className="btn btn-ghost btn-sm bg-white">Настройки</Link>
        </StopBanner>
      ))}
      {!stopped.length && !active && moderation ? (
        <StopBanner tone="info" title="Объявления на модерации" text="Площадки проверяют объявления — обычно в течение суток. Показы начнутся сразу после проверки, ничего делать не нужно." />
      ) : null}

      {/* Итог одной фразой */}
      <section className="card p-5 sm:p-7">
        <p className="text-xl sm:text-2xl leading-snug font-semibold max-w-3xl">
          {c.cost > 0 ? (
            <>
              Реклама привела <span className="marked">{pl(c.leads, "обращение", "обращения", "обращений")}</span>
              {c.clients ? <>, из них {c.clientsEstimated ? "примерно " : ""}{pl(c.clients, "клиент", "клиента", "клиентов")}</> : null}.{" "}
              {cpc ? <>Клиент обошёлся в <span className="whitespace-nowrap">{rub(cpc)}</span>.</> : <>Потрачено <span className="whitespace-nowrap">{rub(c.cost)}</span>.</>}
            </>
          ) : moderation && !stopped.length ? (
            <>Объявления на модерации. Как только площадки их проверят, начнутся показы — обычно в течение суток.</>
          ) : allStopped ? (
            <>За неделю показов не было — реклама на паузе.</>
          ) : (
            <>Показов пока не было. Статистика появится в течение суток после старта.</>
          )}
        </p>
        {c.otherLeads ? (
          <p className="text-sm text-muted mt-2 max-w-3xl">
            Ещё {pl(c.otherLeads, "обращение", "обращения", "обращений")} {c.otherLeads % 10 === 1 && c.otherLeads % 100 !== 11 ? "пришло" : "пришли"} не из рекламы — {c.otherLeads === 1 ? "оно не входит" : "они не входят"} в стоимость клиента.
          </p>
        ) : null}
        <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-5">
          {[
            { label: "Потрачено", value: rub(c.cost), delta: <Delta cur={c.cost} prev={p.cost} inverse /> },
            { label: "Обращения из рекламы", value: num(c.leads), delta: <Delta cur={c.leads} prev={p.leads} /> },
            { label: c.clientsEstimated ? "Клиенты, оценка" : "Клиенты", value: num(c.clients), delta: <Delta cur={c.clients} prev={p.clients} /> },
            { label: "Стоимость клиента", value: cpc ? rub(cpc) : "—", delta: cpc && cpcPrev ? <Delta cur={cpc} prev={cpcPrev} inverse /> : null },
          ].map((m) => (
            <div key={m.label} className="min-w-0">
              <div className="text-sm text-muted">{m.label}</div>
              <div className="text-2xl sm:text-3xl font-extrabold tracking-tight mt-0.5">{m.value}</div>
              <div className="h-4">{m.delta}</div>
            </div>
          ))}
        </div>
        <div className="mt-6">
          <DaysChart series={r.series} />
        </div>
        <p className="hint mt-3">
          Те же цифры — в <Link href="/app/stats" className="underline">«Статистике»</Link> за 7 дней. Сравнение — с предыдущими 7 днями.
        </p>
      </section>

      {/* Требует внимания */}
      {broken.length || needMark || rejected || (b.siteUrl && !tracked.length && c.cost > 0) ? (
        <section className="grid gap-3">
          {broken.map((a) => (
            <div key={a.id} className="rounded-xl bg-bad-soft text-bad p-4 flex flex-wrap gap-3 items-start">
              <TriangleAlert size={18} className="shrink-0 mt-0.5" />
              <div className="flex-1 min-w-[12rem] text-sm leading-relaxed"><b>Нет доступа к кабинету {a.login}.</b> {a.statusNote} Робот не может управлять рекламой, пока доступ не восстановлен.</div>
              <a className="btn btn-sm bg-white text-bad" href={`/api/connect/${a.platform}/start?back=/app`}>Подключить заново</a>
            </div>
          ))}
          {needMark ? <ClientsWeek weekStart={lastWeek.weekStart} leads={lastWeek.leads} otherLeads={lastWeek.otherLeads} /> : null}
          {rejected ? (
            <div className="rounded-xl bg-warn-soft text-warn p-4 text-sm leading-relaxed">
              <b>{rejected === 1 ? "1 объявление не прошло модерацию." : `${pl(rejected, "объявление", "объявления", "объявлений")} не прошли модерацию.`}</b>{" "}
              Робот перепишет {rejected === 1 ? "его" : "их"} при следующей проверке — или поправьте сами в разделе <Link href="/app/ads" className="underline">«Реклама»</Link>.
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
        <section className="card p-5 sm:p-7 min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-bold">Что сделал робот</h2>
            <Link href="/app/history" className="text-sm font-semibold underline underline-offset-2 shrink-0">Вся история</Link>
          </div>
          {changes.length ? (
            <ul className="mt-5 grid gap-5">{changes.map((ch) => <ChangeItem key={ch.id} c={ch} compact />)}</ul>
          ) : (
            <p className="text-muted mt-3">Пока ничего — робот начнёт действовать, когда накопится статистика.</p>
          )}
        </section>

        <section className="grid gap-6 content-start min-w-0">
          <div className="card p-5 sm:p-6">
            <h2 className="text-lg font-bold">Бюджет месяца</h2>
            <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-2xl font-extrabold">{rub(monthCost)}</span>
              <span className="text-muted">из {rub(b.monthlyBudget)}</span>
            </div>
            <div className="mt-2 h-2.5 rounded-full bg-paper overflow-hidden">
              <div className={`h-full ${monthShare >= 1 ? "bg-bad" : monthShare > 0.95 ? "bg-warn" : "bg-ink"}`} style={{ width: `${Math.min(1, monthShare) * 100}%` }} />
            </div>
            <p className="hint mt-2">
              {guardStopped.length && overBudget
                ? `Бюджет израсходован${monthCost > b.monthlyBudget ? ` (перерасход ${rub(monthCost - b.monthlyBudget)} — площадки списывают с задержкой)` : ""}. Показы стоят до ${nextMonth}. `
                : monthShare >= 1
                  ? `Потрачено больше бюджета на ${rub(monthCost - b.monthlyBudget)} — площадки списывают с задержкой. Робот остановит показы при следующей проверке. `
                  : "Робот следит, чтобы расходы уложились в бюджет. "}
              <Link href="/app/settings#budget" className="underline">Изменить бюджет</Link>
            </p>
          </div>
          <div className="card p-5 sm:p-6">
            <h2 className="text-lg font-bold">Каналы</h2>
            <ul className="mt-3 grid gap-2.5 text-sm">
              {camps.map((x) => {
                const s = states.get(x.id);
                return (
                  <li key={x.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span className="font-semibold">{SHORT[x.channel] ?? x.channel}</span>
                    {s?.stopped ? (
                      <span className={`pill ${s.stopped === "guard" || s.stopped === "error" ? "bg-bad-soft text-bad" : "bg-paper text-muted"}`}>
                        {s.stopped === "guard" ? "стоит: кончился бюджет" : s.stopped === "error" ? "ошибка площадки" : s.stopped === "owner" ? "на паузе — вы остановили" : "на паузе — остановил робот"}
                      </span>
                    ) : s && s.learningLeft > 0 ? (
                      <span className="pill bg-info-soft text-ink-2" title={`Площадка подбирает аудиторию: после запуска до ${LEARNING_DAYS[x.channel] ?? 14} дней, после изменения бюджета — до 7. Робот в это время не трогает настройки`}>
                        <GraduationCap size={13} /> обучается — не трогаем {pl(s.learningLeft, "день", "дня", "дней")}
                      </span>
                    ) : (
                      <span className="pill bg-good-soft text-good">идёт</span>
                    )}
                  </li>
                );
              })}
            </ul>
            {learning.length ? (
              <p className="hint mt-3">Пока площадка обучается, цифры скачут — это нормально. Робот не меняет стратегию и бюджет, чтобы не сбить обучение.</p>
            ) : null}
            <dl className="mt-4 pt-4 border-t border-line grid grid-cols-3 gap-3 text-center">
              <div><dt className="text-xs text-muted">Показываются</dt><dd className="text-2xl font-extrabold">{active}</dd></div>
              <div><dt className="text-xs text-muted">На проверке</dt><dd className="text-2xl font-extrabold">{moderation}</dd></div>
              <div><dt className="text-xs text-muted">Отклонены</dt><dd className="text-2xl font-extrabold">{rejected}</dd></div>
            </dl>
            <p className="text-xs text-faint text-center mt-1">объявлений</p>
            <Link href="/app/ads" className="btn btn-ghost btn-sm w-full mt-3">Смотреть объявления</Link>
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

function StopBanner({ tone, title, text, children }: { tone: "bad" | "warn" | "info"; title: string; text: string; children?: React.ReactNode }) {
  const cls = tone === "bad" ? "bg-bad-soft border-bad/30" : tone === "warn" ? "bg-warn-soft border-warn/30" : "bg-info-soft border-line-2";
  const ic = tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-ink-2";
  return (
    <section className={`rounded-[var(--radius-card)] border p-4 sm:p-5 flex flex-wrap items-start gap-3 ${cls}`} role="status">
      <PauseCircle size={22} className={`shrink-0 mt-0.5 ${ic}`} />
      <div className="flex-1 min-w-[14rem]">
        <div className="font-bold leading-snug">{title}</div>
        <p className="text-sm text-ink-2 mt-1 leading-relaxed max-w-2xl">{text}</p>
      </div>
      {children ? <div className="flex flex-wrap gap-2 sm:self-center">{children}</div> : null}
    </section>
  );
}

import { isLaunched } from "@/lib/util";
import Link from "next/link";
import { PauseAll } from "@/components/PauseAll";
import { pausedSince } from "@/lib/util";
import { redirect } from "next/navigation";
import { and, eq, gte, inArray } from "drizzle-orm";
import { RefreshCw, TriangleAlert, FastForward, PauseCircle, GraduationCap, Wallet, CheckCircle2, CircleAlert, ExternalLink } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getBusinessForUser, accountsFor } from "@/lib/engine/launch";
import { report, weeksForMarking, campaignStates, LEARNING_DAYS } from "@/lib/engine/report";
import { recentChanges } from "@/lib/engine/ops";
import { getDb, schema } from "@/lib/db";
import { ActionButton } from "@/components/client";
import { ChangeItem } from "@/components/ChangeItem";
import { ModerationCheck } from "@/components/ModerationCheck";
import { isMedical } from "@/lib/niches";
import { DaysChart, Delta } from "@/components/charts";
import { ClientsWeek } from "@/components/ClientsWeek";
import { CHANNEL_NAME } from "@/lib/platforms";
import { rub, num, pl, isoDay } from "@/lib/util";
import { monthStartDay, nextMonthStart } from "@/lib/engine/budget-plan";
import { healthCheck, type Health } from "@/lib/engine/health";
import { balanceText, LOW_DAYS, TOPUP_URL } from "@/lib/engine/balance";
import { CHANNELS, CHANNEL_INFO, TYPE_INFO, adsHref, familyOf, typeOf } from "@/lib/channels";
import { audiencesFor } from "@/lib/engine/retarget";
import { PlatformMark, TypeBadge, AudienceBar } from "@/components/CampaignNav";
import { landingFor } from "@/lib/engine/landing";

const SHORT: Record<string, string> = Object.fromEntries(Object.entries(CHANNEL_INFO).map(([k, v]) => [k, v.short]));
const ORDER: string[] = CHANNELS;

export default async function Dashboard() {
  const user = await requireUser();
  const b = await getBusinessForUser(user.id);
  if (!b) redirect("/app/start");
  if (!isLaunched(b.status)) redirect("/app/launch");

  const db = await getDb();
  const [r, changes, accounts, weeks] = await Promise.all([report(b, 7), recentChanges(b.id, 5), accountsFor(user.id), weeksForMarking(b, 2)]);
  const camps = (await db.select().from(schema.campaigns).where(eq(schema.campaigns.businessId, b.id)))
    .filter((c) => c.status !== "archived")
    .sort((x, y) => ORDER.indexOf(x.channel) - ORDER.indexOf(y.channel));
  const states = await campaignStates(b, camps, r.now);
  const audiences = await audiencesFor(b, camps, r.now);
  const isDemo = camps.length > 0 && camps.every((c) => c.platform === "demo");
  const groups = camps.length ? await db.select({ id: schema.adGroups.id, status: schema.adGroups.status }).from(schema.adGroups).where(inArray(schema.adGroups.campaignId, camps.map((c) => c.id))) : [];
  const ads = await db
    .select({ status: schema.ads.status, statusNote: schema.ads.statusNote, campaignId: schema.ads.campaignId, adGroupId: schema.ads.adGroupId })
    .from(schema.ads)
    .where(and(eq(schema.ads.businessId, b.id), inArray(schema.ads.status, ["moderation", "rejected", "active"])));
  const monthCost = (await db.select({ cost: schema.statsDaily.cost }).from(schema.statsDaily).where(and(eq(schema.statsDaily.businessId, b.id), gte(schema.statsDaily.day, monthStartDay(r.now))))).reduce((s, x) => s + x.cost, 0);
  // Реклама ведёт на сайт (хотя бы в одном канале) — только тогда обращения зависят от кода счётчика на сайте
  const toSite = Boolean(b.siteUrl) && camps.some((x) => landingFor(b, x.channel).kind === "site");
  const tracked = await db.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.businessId, b.id)).limit(1);
  const health = await healthCheck(b);
  // Что робот сделал за 30 дней — те же три рычага, что на лендинге
  const monthAgo = new Date(r.now.getTime() - 30 * 86400_000);
  const recent = (await db.select({ kind: schema.changes.kind, details: schema.changes.details, revertedAt: schema.changes.revertedAt }).from(schema.changes)
    .where(and(eq(schema.changes.businessId, b.id), gte(schema.changes.at, monthAgo), inArray(schema.changes.kind, ["negatives", "test_start", "test_end", "budget"])))).filter((x) => !x.revertedAt);
  const negWords = [...new Set(recent.filter((x) => x.kind === "negatives").flatMap((x) => (Array.isArray(x.details?.words) ? (x.details.words as string[]) : [])))];
  const tests = recent.filter((x) => x.kind === "test_start").length;
  const testsDone = recent.filter((x) => x.kind === "test_end").length;
  const moved = recent.filter((x) => x.kind === "budget" && typeof x.details?.move === "number").reduce((sum, x) => sum + (x.details.move as number), 0);
  const lowBalance = health.balances.filter((x) => x.daysLeft !== null && x.daysLeft <= LOW_DAYS && camps.some((c) => c.accountId === x.accountId && c.status === "active"));

  const c = r.cur, p = r.prev;
  const cpc = c.clients ? c.cost / c.clients : null;
  const cpcPrev = p.clients ? p.cost / p.clients : null;

  // ─── Что сейчас реально показывается ───
  const liveCamp = new Set(camps.filter((x) => x.status === "active").map((x) => x.id));
  const liveGroup = new Set(groups.filter((g) => g.status === "active").map((g) => g.id));
  const showing = (a: (typeof ads)[number]) => liveCamp.has(a.campaignId) && liveGroup.has(a.adGroupId);
  // «Модерацию прошло, но показов нет» (нужны документы, нет денег…) — площадка пишет причину, мы храним её с префиксом
  const isBlocked = (a: (typeof ads)[number]) => a.status === "active" && /^Не показывается/.test(a.statusNote ?? "");
  const blockedAds = ads.filter((a) => isBlocked(a) && liveCamp.has(a.campaignId));
  const blockedDocs = blockedAds.filter((a) => /документ/i.test(a.statusNote ?? "")).length;
  const active = ads.filter((a) => a.status === "active" && !isBlocked(a) && showing(a)).length;
  const moderation = ads.filter((a) => a.status === "moderation" && showing(a)).length;
  const rejected = ads.filter((a) => a.status === "rejected").length;
  // Итог модерации — по объявлениям всех созданных кампаний, включая те, что на паузе: иначе на паузе «прошли 0 из 1, отклонено 1»
  const inCamp = new Set(camps.map((x) => x.id));
  const mod = {
    active: ads.filter((a) => a.status === "active" && inCamp.has(a.campaignId)).length,
    moderation: ads.filter((a) => a.status === "moderation" && inCamp.has(a.campaignId)).length,
    rejected: ads.filter((a) => a.status === "rejected" && inCamp.has(a.campaignId)).length,
  };
  // Ретаргетинг, который копит аудиторию, не «стоит»: он ещё не включался и включится сам
  const runnable = camps.filter((x) => states.get(x.id)?.stopped !== "audience" && !(audiences.get(x.id) && x.status === "paused" && audiences.get(x.id)!.state === "off"));
  const stopped = runnable.filter((x) => states.get(x.id)?.stopped);
  const allStopped = runnable.length > 0 && stopped.length === runnable.length;
  const guardStopped = stopped.filter((x) => states.get(x.id)?.stopped === "guard");
  const ownerStopped = stopped.filter((x) => states.get(x.id)?.stopped === "owner" || states.get(x.id)?.stopped === "robot");
  const errorStopped = stopped.filter((x) => states.get(x.id)?.stopped === "error");
  const platformStopped = stopped.filter((x) => states.get(x.id)?.stopped === "platform");
  const learning = camps.filter((x) => (states.get(x.id)?.learningLeft ?? 0) > 0);
  const nextMonth = nextMonthStart(r.now).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
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
          <h1 className="text-[2.2rem] sm:text-[2.6rem] font-semibold tracking-[-0.045em] leading-none">Главное</h1>
          <p className="text-muted mt-1">Последние 7 дней{isDemo ? " · демо-данные" : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {b.status === "active" ? <PauseAll paused={false} compact /> : null}
          <ActionButton url="/api/run" done="Проверили рекламу и обновили статистику" className="btn btn-ghost btn-sm">
            <RefreshCw size={15} /> Проверить сейчас
          </ActionButton>
        </div>
      </div>
      {b.status === "paused" ? <PauseAll paused since={pausedSince(b.updatedAt)} /> : null}

      {/* ─── Реклама стоит: причина и что делать ─── */}
      {guardStopped.length ? (
        <StopBanner
          tone="bad"
          title={
            overBudget
              ? allStopped ? "Реклама остановлена — бюджет месяца израсходован" : `Робот остановил ${names(guardStopped)}: бюджет месяца израсходован`
              : allStopped ? "Робот остановил рекламу, чтобы уложиться в бюджет месяца" : `Робот остановил ${names(guardStopped)}, чтобы уложиться в бюджет месяца`
          }
          text={(() => {
            if (overBudget) return `Потрачено ${rub(monthCost)} из ${rub(b.monthlyBudget)}. Чтобы не выйти за бюджет, показы стоят до ${nextMonth} — тогда робот включит рекламу сам. Хотите продолжить раньше — поднимите бюджет, и реклама включится сразу.`;
            const one = guardStopped.length === 1;
            return (
              `Бюджет — ${rub(b.monthlyBudget)} в месяц, потрачено ${rub(monthCost)}. До конца месяца ` +
              `на ${allStopped ? "рекламу" : one ? "этот канал" : "эти каналы"} не хватает денег: площадки не принимают лимит меньше своего минимума. ` +
              `Робот включит ${allStopped ? "рекламу" : one ? "канал" : "каналы"} сам ${nextMonth} или сразу, как только вы поднимете бюджет.`
            );
          })()}
        >
          <Link href="/app/settings#budget" className="btn btn-primary btn-sm">Поднять бюджет</Link>
        </StopBanner>
      ) : null}
      {ownerStopped.length > 0 && b.status !== "paused" ? (
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
      <ModerationCheck />
      {mod.moderation || mod.rejected ? (() => {
        const { active: passed, moderation: checking, rejected: declined } = mod;
        const total = checking + passed + declined;
        const noMoney = health.balances.some((x) => x.daysLeft === 0 && !x.demo);
        return (
          <section className={`card p-5 sm:p-6 ${declined ? "border-warn/40" : ""}`} aria-live="polite">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-bold">
                {checking ? "Модерация: " : "Модерация закончилась: "}прошли {passed} из {total}{declined ? `, отклонено ${declined}` : ""}
              </h2>
              {checking ? <span className="text-sm text-muted">на проверке ещё {pl(checking, "объявление", "объявления", "объявлений")}</span> : null}
            </div>
            <div className="mt-3 h-2.5 rounded-full bg-paper overflow-hidden flex" aria-hidden>
              <span className="h-full bg-good" style={{ width: `${(passed / Math.max(1, total)) * 100}%` }} />
              <span className="h-full bg-bad" style={{ width: `${(declined / Math.max(1, total)) * 100}%` }} />
            </div>
            <p className="text-sm text-ink-2 mt-3 leading-relaxed">
              {checking ? "Площадки обычно проверяют объявления в течение суток. Статусы обновляются, когда вы открываете кабинет (не чаще раза в 10 минут), и каждое утро. " : ""}
              {declined ? <>Что делать с отклонёнными: робот перепишет их при следующей проверке, причина и подсказки — в разделе <Link href="/app/ads" className="underline">«Реклама»</Link>. </> : null}
              {allStopped ? "Реклама сейчас на паузе — прошедшие проверку объявления начнут показываться, когда вы её включите." : blockedAds.length ? "Часть прошедших проверку объявлений пока не показывается — причина ниже." : noMoney ? "Показы начнутся, когда пополните рекламный кабинет." : "Прошедшие проверку объявления показываются сразу."}
            </p>
          </section>
        );
      })() : null}

      {/* Один кабинет — одна плашка: все причины, почему площадка не показывает рекламу, списком */}
      {(["yandex", "vk"] as const).map((pf) => {
        const off = platformStopped.filter((x) => x.platform === pf);
        const notes = off.map((x) => states.get(x.id)?.note ?? "");
        const money = notes.some((n) => /средств|пополн/i.test(n)) || health.balances.some((x) => x.platform === pf && x.daysLeft === 0 && !x.demo);
        const other = [...new Set(notes.filter((n) => n && !/средств|пополн/i.test(n)))];
        const docs = pf === "yandex" ? blockedDocs : 0;
        const licenseUnknown = pf === "yandex" && !docs && isMedical(b) && camps.some((x) => x.platform === "yandex" && x.status === "active") && monthCost === 0 && !c.cost;
        const reasons: { text: string; bad: boolean }[] = [];
        if (money) reasons.push({ text: "Нет денег на счёте — пополните кабинет", bad: true });
        if (docs) reasons.push({ text: "Нужна лицензия — Директ не показывает медицинскую рекламу, пока её не проверит. Объявление → «Отправить документы»", bad: true });
        if (licenseUnknown) reasons.push({ text: "Лицензия — проверьте, что она отправлена и проверка закончилась, иначе показов не будет и с деньгами", bad: false });
        for (const n of other) reasons.push({ text: n.replace(/^Не показывается:\s*/, ""), bad: true });
        if (!reasons.length) return null;
        const blocking = money || docs || other.length || off.length;
        return (
          <StopBanner key={pf} tone={blocking ? "bad" : "warn"} icon={money ? "wallet" : undefined}
            title={`${pf === "vk" ? "VK Реклама" : "Яндекс Директ"}: ${blocking ? "реклама не показывается" : "проверьте лицензию"}`}
            text={<ul className="space-y-1">{reasons.map((r) => <li key={r.text} className="flex gap-2"><span className={r.bad ? "text-bad" : "text-warn"}>•</span><span>{r.text}</span></li>)}</ul>}>
            {money ? <a className="btn btn-primary btn-sm" href={pf === "vk" ? "https://ads.vk.ru/hq/budget/transactions" : "https://direct.yandex.ru/"} target="_blank" rel="noreferrer">Пополнить кабинет</a> : null}
            {docs || licenseUnknown ? <a href="https://yandex.ru/support/tooltips-direct/moderation-warning-data-forms.html" target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm bg-white">Как отправить лицензию</a> : null}
          </StopBanner>
        );
      })}
      {blockedAds.length && !platformStopped.length && !blockedDocs ? (
        <StopBanner tone="warn" title="Часть объявлений не показывается" text={`Модерацию прошли, но ${pl(blockedAds.length, "объявление сейчас не показывается", "объявления сейчас не показываются", "объявлений сейчас не показываются")}. Причина — у каждого объявления в разделе «Реклама».`}>
          <Link href="/app/ads" className="btn btn-ghost btn-sm bg-white">Смотреть объявления</Link>
        </StopBanner>
      ) : null}

      {lowBalance.filter((x) => x.daysLeft !== 0 || x.demo).map((x) => (
        <StopBanner key={x.accountId} tone={x.daysLeft === 0 ? "bad" : "warn"} icon="wallet" title={x.daysLeft === 0 ? "Кончились деньги в рекламном кабинете" : "Скоро кончатся деньги в рекламном кабинете"} text={`${balanceText(x)}${x.demo ? " В демо пополнение происходит само." : " Пополнение — в самом кабинете площадки."} Пока денег мало, робот не поднимает недельные лимиты — расход ниже плана из-за остатка, а не из-за площадки.`}>
          {TOPUP_URL[x.platform] && !x.demo ? <a href={TOPUP_URL[x.platform]} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">Пополнить <ExternalLink size={14} /></a> : null}
        </StopBanner>
      ))}

      {/* Итог — в той же подаче, что на лендинге: деньги ÷ цена клиента = клиенты */}
      <section className="rounded-[1.75rem] bg-white ring-1 ring-black/[0.05] p-6 sm:p-8">
        <div className="text-sm text-muted">Итог за 7 дней</div>
        <div className="mt-2 text-[1.6rem] sm:text-[2.1rem] font-semibold tracking-[-0.03em] leading-tight max-w-3xl">
          {c.cost > 0 ? (
            c.clients ? (
              <>На {rub(c.cost)} — <span className="bg-mark px-1.5 rounded-lg">{c.clientsEstimated ? "≈ " : ""}{pl(c.clients, "клиент", "клиента", "клиентов")}</span></>
            ) : (
              <>На {rub(c.cost)} — <span className="bg-mark px-1.5 rounded-lg">{pl(c.leads, "обращение", "обращения", "обращений")}</span></>
            )
          ) : moderation && !stopped.length ? (
            <>Объявления на модерации — показы начнутся после проверки, обычно в течение суток</>
          ) : platformStopped.length || blockedAds.length ? (
            <>Показов пока нет — площадка не показывает рекламу, причины выше</>
          ) : allStopped ? (
            <>За неделю показов не было — реклама на паузе</>
          ) : (
            <>Показов пока не было — цифры появятся в течение суток после старта</>
          )}
        </div>
        {c.cost > 0 ? (
          <p className="mt-3 text-ink-2 leading-relaxed max-w-2xl">
            {pl(c.leads, "обращение", "обращения", "обращений")} из рекламы{c.clients ? `, из них ${c.clientsEstimated ? "примерно " : ""}${pl(c.clients, "клиент", "клиента", "клиентов")}` : ""}.
            {cpc && cpcPrev ? (cpc < cpcPrev ? ` Клиент стал дешевле: было ${rub(cpcPrev)}, стало ${rub(cpc)}.` : cpc > cpcPrev ? ` Клиент подорожал: было ${rub(cpcPrev)}, стало ${rub(cpc)}.` : "") : ""}
            {c.otherLeads ? ` Ещё ${pl(c.otherLeads, "обращение", "обращения", "обращений")} не из рекламы — в цену клиента не входят.` : ""}
          </p>
        ) : null}

        <div className="mt-6 grid sm:grid-cols-2 gap-3">
          <div className="rounded-2xl bg-paper p-5">
            <div className="text-[13px] text-muted">Прошлые 7 дней</div>
            <div className="mt-2 text-[15px] text-muted">{cpcPrev ? `${rub(p.cost)} ÷ ${rub(cpcPrev)} за клиента` : `Потрачено ${rub(p.cost)}`}</div>
            <div className="mt-1 text-4xl font-semibold tracking-[-0.04em] text-ink/45">{num(p.clients || p.leads)} <span className="text-lg font-medium tracking-normal">{p.clients ? "клиентов" : "обращений"}</span></div>
          </div>
          <div className="rounded-2xl bg-white ring-1 ring-black/[0.08] p-5">
            <div className="text-[13px] text-muted">Эти 7 дней</div>
            <div className="mt-2 text-[15px] text-ink-2">{cpc ? `${rub(c.cost)} ÷ ${rub(cpc)} за клиента` : `Потрачено ${rub(c.cost)}`}</div>
            <div className="mt-1 flex items-baseline gap-3 flex-wrap">
              <span className="text-4xl font-semibold tracking-[-0.04em]">{num(c.clients || c.leads)} <span className="text-lg font-medium tracking-normal">{c.clients ? "клиентов" : "обращений"}</span></span>
              <Delta cur={c.clients || c.leads} prev={p.clients || p.leads} />
            </div>
          </div>
        </div>

        <div className="mt-3 grid md:grid-cols-3 gap-3">
          <div className="rounded-2xl ring-1 ring-black/[0.06] p-5 flex flex-col gap-3">
            <div className="font-semibold tracking-tight leading-snug">Не платит за тех, кто не станет клиентом</div>
            {negWords.length ? (
              <div className="flex flex-wrap gap-1.5">{negWords.slice(0, 4).map((w) => <span key={w} className="rounded-full bg-paper px-2.5 py-1 text-[12.5px] line-through decoration-ink/40">{w}</span>)}</div>
            ) : null}
            <div className="mt-auto text-sm text-muted">{negWords.length ? `Убрано ${pl(negWords.length, "лишнее слово", "лишних слова", "лишних слов")} за месяц` : "Лишних запросов пока не нашли"}</div>
          </div>
          <div className="rounded-2xl ring-1 ring-black/[0.06] p-5 flex flex-col gap-3">
            <div className="font-semibold tracking-tight leading-snug">Проверяет, какой текст работает лучше</div>
            <div className="mt-auto text-sm text-muted">{tests || testsDone ? `${tests ? `Запущено ${pl(tests, "сравнение", "сравнения", "сравнений")}` : ""}${tests && testsDone ? ", " : ""}${testsDone ? `${tests ? "з" : "З"}авершено ${testsDone}` : ""} за месяц` : "Начнёт, когда наберутся показы"}</div>
          </div>
          <div className="rounded-2xl ring-1 ring-black/[0.06] p-5 flex flex-col gap-3">
            <div className="font-semibold tracking-tight leading-snug">Переводит деньги туда, где клиенты дешевле</div>
            <div className="mt-auto text-sm text-muted">{moved ? `Перенесено ${rub(moved)} в неделю за месяц` : "Пока переносить нечего — нужна статистика"}</div>
          </div>
        </div>

        <div className="mt-6">
          <DaysChart series={r.series} />
        </div>
        <p className="hint mt-3">
          Подробно — в <Link href="/app/stats" className="underline">«Статистике»</Link>. Сравнение — с предыдущими 7 днями.
        </p>
      </section>

      {/* Требует внимания */}
      {broken.length || needMark || rejected || (toSite && !tracked.length && c.cost > 0) ? (
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
          {toSite && !tracked.length && c.cost > 0 ? (
            <div className="rounded-xl bg-info-soft p-4 text-sm leading-relaxed">
              <b>Обращения с сайта пока не приходят.</b> Проверьте, что код счётчика стоит на всех страницах сайта — без него мы видим клики, но не видим записи. <Link href="/app/settings#counter" className="underline">Код счётчика</Link>
            </div>
          ) : null}
        </section>
      ) : null}

      <HealthCard h={health} />

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
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-bold">Каналы</h2>
              <span className="flex items-center gap-2 text-sm">
                {(["yandex", "vk"] as const).filter((f) => camps.some((x) => familyOf(x.channel) === f)).map((f) => (
                  <Link key={f} href={adsHref(f)} className="inline-flex items-center gap-1 font-semibold text-ink-2 hover:text-ink" title={`Кампании ${f === "yandex" ? "Яндекса" : "VK"}`}>
                    <PlatformMark family={f} size={16} /> {f === "yandex" ? "Яндекс" : "VK"}
                  </Link>
                ))}
              </span>
            </div>
            <ul className="mt-3 grid gap-1 text-sm -mx-2">
              {camps.map((x) => {
                const s = states.get(x.id);
                const aud = audiences.get(x.id);
                const waiting = aud && x.status === "paused" && aud.state !== "on";
                return (
                  <li key={x.id}>
                    <Link href={adsHref(familyOf(x.channel), typeOf(x.channel), `c-${x.id}`)} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1.5 rounded-lg px-2 py-2 hover:bg-paper">
                      <span className="mt-0.5"><PlatformMark family={familyOf(x.channel)} size={20} /></span>
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold">{SHORT[x.channel] ?? x.channel}</span>
                          <TypeBadge type={typeOf(x.channel)} />
                        </span>
                        <span className="block text-xs text-muted truncate">{TYPE_INFO[typeOf(x.channel)].purpose}</span>
                      </span>
                      <span className="col-start-2">
                        {waiting ? (
                          aud!.state === "off" ? <span className="pill bg-paper text-muted">автозапуск выключен</span> : <AudienceBar size={aud!.size} need={aud!.need} compact />
                        ) : s?.stopped ? (
                          <span className={`pill ${s.stopped === "guard" || s.stopped === "error" || s.stopped === "platform" ? "bg-bad-soft text-bad" : "bg-paper text-muted"}`} title={s.note ?? undefined}>
                            {s.stopped === "platform" ? (/средств|пополн/i.test(s.note ?? "") ? "не показывается: нет денег" : /модерац/i.test(s.note ?? "") ? "на модерации" : "не показывается") : s.stopped === "guard" ? (overBudget ? "стоит: кончился бюджет" : "стоит: не хватает бюджета") : s.stopped === "error" ? "ошибка площадки" : s.stopped === "owner" ? "на паузе — вы остановили" : "на паузе — остановил робот"}
                          </span>
                        ) : s && s.learningLeft > 0 ? (
                          <span className="pill bg-info-soft text-ink-2" title={`Площадка подбирает аудиторию: после запуска до ${pl(LEARNING_DAYS[x.channel] ?? 14, "дня", "дней", "дней")}, после изменения бюджета — до 7. Робот в это время не трогает настройки`}>
                            <GraduationCap size={13} /> обучается — {pl(s.learningLeft, "день", "дня", "дней")}
                          </span>
                        ) : (
                          <span className="pill bg-good-soft text-good">идёт</span>
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
              {camps.some((x) => x.channel === "search") ? (
                <li>
                  <Link href={adsHref("yandex", "maps", "maps")} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1.5 rounded-lg px-2 py-2 hover:bg-paper">
                    <span className="mt-0.5"><PlatformMark family="yandex" size={20} /></span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-1.5"><span className="font-semibold">Яндекс Карты</span><TypeBadge type="maps" /></span>
                      <span className="block text-xs text-muted truncate">{TYPE_INFO.maps.purpose}</span>
                    </span>
                    <span className="col-start-2">
                      {b.orgId ? <span className="pill bg-good-soft text-good">подключено</span> : <span className="pill bg-warn-soft text-warn">привяжите организацию</span>}
                    </span>
                  </Link>
                </li>
              ) : null}
            </ul>
            {learning.length ? (
              <p className="hint mt-3">Пока площадка обучается, цифры скачут — это нормально. Чтобы не сбить обучение, робот не меняет у такой кампании стратегию, ставки и недельный лимит (лимит снизит, только если иначе выйдем за бюджет месяца); объявления и аудитории проверяет как обычно.</p>
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

function StopBanner({ tone, title, text, children, icon }: { tone: "bad" | "warn" | "info"; title: string; text: React.ReactNode; children?: React.ReactNode; icon?: "wallet" }) {
  const cls = tone === "bad" ? "bg-bad-soft border-bad/30" : tone === "warn" ? "bg-warn-soft border-warn/30" : "bg-info-soft border-line-2";
  const ic = tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-ink-2";
  return (
    <section className={`rounded-[var(--radius-card)] border p-4 sm:p-5 flex flex-wrap items-start gap-3 ${cls}`} role="status">
      {icon === "wallet" ? <Wallet size={22} className={`shrink-0 mt-0.5 ${ic}`} /> : <PauseCircle size={22} className={`shrink-0 mt-0.5 ${ic}`} />}
      <div className="flex-1 min-w-[14rem]">
        <div className="font-bold leading-snug">{title}</div>
        <div className="text-sm text-ink-2 mt-1 leading-relaxed max-w-2xl">{text}</div>
      </div>
      {children ? <div className="flex flex-wrap gap-2 sm:self-center">{children}</div> : null}
    </section>
  );
}

/** «Здоровье рекламы»: балл 0–100 и чек-лист с кнопкой «исправить» у каждого невыполненного пункта */
function HealthCard({ h }: { h: Health }) {
  const bad = h.items.filter((x) => !x.ok).sort((a, b) => b.weight - a.weight);
  const good = h.items.filter((x) => x.ok);
  const tone = h.score >= 80 ? "text-good" : h.score >= 50 ? "text-warn" : "text-bad";
  const bar = h.score >= 80 ? "bg-good" : h.score >= 50 ? "bg-warn" : "bg-bad";
  const verdict = h.score >= 80 ? "Реклама в хорошей форме" : h.score >= 50 ? "Есть что поправить" : "Реклама работает вполсилы";
  return (
    <section className="card p-5 sm:p-7" aria-labelledby="health-title">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex items-baseline gap-1.5">
          <span className={`text-4xl font-extrabold tracking-tight ${tone}`}>{h.score}</span>
          <span className="text-muted text-sm">из 100</span>
        </div>
        <div className="flex-1 min-w-[12rem]">
          <h2 id="health-title" className="text-lg font-bold leading-snug">Здоровье рекламы: {verdict.toLowerCase()}</h2>
          <div className="mt-2 h-2 rounded-full bg-paper overflow-hidden" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={h.score} aria-label="Здоровье рекламы">
            <div className={`h-full ${bar}`} style={{ width: `${h.score}%` }} />
          </div>
        </div>
      </div>
      {bad.length ? (
        <ul className="mt-5 grid gap-3">
          {bad.map((x) => (
            <li key={x.key} className="rounded-xl border border-line p-3.5 sm:p-4 flex flex-wrap items-start gap-3">
              <CircleAlert size={18} className={`shrink-0 mt-0.5 ${x.weight >= 15 ? "text-bad" : "text-warn"}`} />
              <div className="flex-1 min-w-[12rem]">
                <div className="font-semibold leading-snug">{x.todo}</div>
                {x.hint ? <p className="text-sm text-muted mt-0.5 leading-relaxed">{x.hint}</p> : null}
              </div>
              {x.fix ? (
                x.fix.external ? (
                  <a href={x.fix.href} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm shrink-0">{x.fix.label} <ExternalLink size={14} /></a>
                ) : (
                  <Link href={x.fix.href} className="btn btn-ghost btn-sm shrink-0">{x.fix.label}</Link>
                )
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {good.length ? (
        <details className="mt-4 group">
          <summary className="cursor-pointer text-sm font-semibold text-ink-2 select-none">В порядке: {pl(good.length, "пункт", "пункта", "пунктов")}</summary>
          <ul className="mt-2 grid gap-1.5 text-sm">
            {good.map((x) => (
              <li key={x.key} className="flex items-center gap-2"><CheckCircle2 size={16} className="text-good shrink-0" />{x.title}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

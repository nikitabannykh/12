import { VkConnect } from "@/components/VkConnect";
import { VkPixelSetup } from "@/components/VkPixelSetup";
import { ShowSettingsEditor } from "@/components/ShowSettingsEditor";
import { LandingEditor } from "@/components/LandingEditor";
import { MetricaCounterPicker } from "@/components/MetricaCounterPicker";
import { SiteConnect } from "@/components/SiteConnect";
import { SiteSetupList, siteSummary } from "@/components/SiteSetup";
import { siteTrackingStatus } from "@/lib/engine/site-tracking";
import { pageUrl, type LandingSettings } from "@/lib/engine/landing";
import { timeTargeting } from "@/lib/engine/extras";
import { vkRadiusFor } from "@/lib/platforms/vk-formats";
import { reachExample, type ShowSettings } from "@/lib/engine/show";
import Link from "next/link";
import { SETTINGS_TABS, type SettingsTab } from "@/lib/settings-tabs";
import { SettingsHashRedirect, DeleteProject } from "@/components/SettingsClient";
import { redirect } from "next/navigation";
import { Check, ExternalLink, TriangleAlert } from "lucide-react";
import { requireUser, demoAllowed, isDemoEmail } from "@/lib/auth";
import { AccountSettings } from "@/components/AccountSettings";
import { findUserById } from "@/lib/account";
import { mailConfigured } from "@/lib/mail";
import { accountsFor, getBusinessForUser, channelsFor } from "@/lib/engine/launch";
import { trackingSnippet } from "@/lib/platforms/metrica";
import { yandexConfigured } from "@/lib/platforms/yandex";
import { vkConfigured } from "@/lib/platforms/vk";
import { PLATFORM_NAME } from "@/lib/platforms";
import { ActionButton, CopyButton } from "@/components/client";
import { BudgetEditor } from "@/components/BudgetEditor";
import { NotifySettings } from "@/components/NotifySettings";
import { getNotify, getUnlinked, tgConfigured } from "@/lib/notify";
import { minMonthlyFor } from "@/lib/engine/budget";
import { nicheById } from "@/lib/niches";
import { appUrl, pl, rub } from "@/lib/util";
import { businessLinks, linkKey, shortLink, LINK_LABEL } from "@/lib/links";

/** Адрес для связи: из MAIL_FROM («"Самоход" <hello@…>» или просто адрес), иначе null — как на странице политики */
function contactEmail(): string | null {
  const m = (process.env.MAIL_FROM ?? "").match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
  return m ? m[0] : null;
}

/** Разделы настроек: каждый — отдельная страница (?tab=), в меню слева — подпункты «Настроек» */
const TABS = SETTINGS_TABS;

export default async function Settings({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const q = await searchParams;
  const tab = (TABS.find((t) => t.id === q.tab)?.id ?? "business") as SettingsTab;
  const user = await requireUser();
  const b = await getBusinessForUser(user.id);
  if (!b) redirect("/app/start");
  const accounts = await accountsFor(user.id);
  const snippet = trackingSnippet({ counterId: b.counterId, publicKey: b.publicKey, appUrl: appUrl() });
  const trackerLine = trackingSnippet({ counterId: b.counterId, publicKey: b.publicKey, appUrl: appUrl(), trackerOnly: true });
  const site = b.siteUrl ? await siteTrackingStatus(b.id) : null;
  const landing = `${appUrl()}/p/${b.publicKey}`;
  const channels = channelsFor(accounts).map((c) => c.channel);
  const notify = await getNotify(b.id);
  const connected = Boolean(notify?.telegramChatId);
  const me = await findUserById(user.id);
  const links = businessLinks(b);
  const notifyStatus = { configured: tgConfigured(), connected, name: notify?.telegramName ?? null, digest: notify ? notify.digest === 1 : true, unlinked: connected ? null : await getUnlinked(b.id) };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <h1 className="text-3xl font-extrabold tracking-tight">Настройки</h1>
      <SettingsHashRedirect />
      {/* Разделы — вкладками (на телефоне, где нет бокового меню, это главная навигация) */}
      <nav className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-1 -mt-2" aria-label="Разделы настроек">
        {TABS.map((t) => (
          <Link key={t.id} href={`/app/settings?tab=${t.id}`} scroll={false} aria-current={tab === t.id ? "page" : undefined}
            className={`shrink-0 px-3.5 h-9 grid place-items-center rounded-lg text-sm font-semibold border ${tab === t.id ? "bg-ink text-white border-ink" : "bg-card border-line text-ink-2 hover:border-line-2"}`}>{t.label}</Link>
        ))}
      </nav>

      {tab === "business" ? (
        <>
      <section className="card p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">{b.name}</h2>
            <p className="text-muted mt-1">{nicheById(b.niche).label} · {b.city}{b.address ? `, ${b.address}` : ""}</p>
            <p className="text-sm text-muted mt-2">{b.services.length ? `${pl(b.services.length, "услуга", "услуги", "услуг")} в описании` : "Услуги не указаны"}{b.offer ? ` · предложение: ${b.offer}` : ""}</p>
            {links.length ? (
              <p className="text-sm text-muted mt-1">
                Ссылки:{" "}
                {links.map((l, i) => (
                  <span key={l.url}>
                    <a href={l.url} target="_blank" rel="noreferrer" className="font-semibold text-ink-2 underline underline-offset-2 hover:text-ink">{LINK_LABEL[l.kind]}</a>
                    {i < links.length - 1 ? ", " : ""}
                  </span>
                ))}
              </p>
            ) : null}
          </div>
          <Link href="/app/start" className="btn btn-ghost btn-sm">Изменить описание</Link>
        </div>
      </section>
      <section id="links" className="card p-5 sm:p-7 scroll-mt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Ссылки на бизнес</h2>
            <p className="hint mt-1 max-w-2xl">Сайт, карточки в Яндекс Картах и 2ГИС, онлайн-запись и соцсети — из них заполняется описание. Объявления ведут на {b.siteUrl ? "сайт" : "вашу страницу записи"}.</p>
            {site && site.needed ? (
              <a href="/app/settings?tab=site#site" className={`mt-2 inline-flex items-center gap-1.5 text-sm font-semibold underline underline-offset-2 ${siteSummary(site).done ? "text-good" : "text-warn"}`}>{siteSummary(site).title} →</a>
            ) : null}
          </div>
          <Link href="/app/start#links" className="btn btn-ghost btn-sm">{links.length ? "Изменить" : "Добавить ссылки"}</Link>
        </div>
        {links.length ? (
          <ul className="mt-4 divide-y divide-line">
            {links.map((l) => (
              <li key={l.url} className="py-2.5 grid gap-0.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4 sm:items-center">
                <span className="text-sm font-semibold">{LINK_LABEL[l.kind]}{l.kind === "yandex" && b.orgUrl && b.orgId && linkKey(l.url) === linkKey(b.orgUrl) ? <span className="ml-2 pill bg-good-soft text-good">для Директа</span> : null}</span>
                <a href={l.url} target="_blank" rel="noreferrer" title={l.url} className="min-w-0 inline-flex items-center gap-1.5 text-ink-2 hover:text-ink underline underline-offset-2 [overflow-wrap:anywhere]">
                  {shortLink(l.url, 70)} <ExternalLink size={13} className="shrink-0" />
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted mt-3">Ссылок пока нет. Добавьте сайт или карточку в Яндекс Картах или 2ГИС.</p>
        )}
        {links.some((l) => l.kind === "dgis") && !b.orgId ? (
          <p className="mt-3 text-sm text-warn max-w-2xl">Карточка в 2ГИС есть, а в Яндекс Картах — нет. Для показов на Картах и подсчёта звонков в Директе добавьте и ссылку на Яндекс Карты.</p>
        ) : null}
      </section>
        </>
      ) : null}
      {tab === "site" ? (
        <>
      <section id="landing" className="card p-5 sm:p-7 scroll-mt-6">
        <h2 className="text-lg font-bold">Куда ведёт реклама</h2>
        <p className="hint mt-1 mb-5">Куда попадает человек после клика по объявлению. Можно одну ссылку для всех каналов и свою — для отдельного канала.</p>
        <LandingEditor siteCode={site ? site.state : null} initial={(b.landing ?? {}) as LandingSettings} siteUrl={b.siteUrl} pageUrl={pageUrl(b, appUrl())} channels={channels} live={b.status === "active" || b.status === "paused"} hasYandex={accounts.some((a) => a.platform === "yandex")} />
      </section>
      <section id="site" className="card p-5 sm:p-7 scroll-mt-6">
        {/* старые ссылки (#counter) ведут сюда же */}
        <span id="counter" className="block scroll-mt-6" aria-hidden />
        <h2 className="text-lg font-bold">Подключение сайта</h2>
        {b.siteUrl ? (
          <>
            <p className="hint mt-1 mb-5 max-w-2xl">
              {site?.needed
                ? `Реклама ведёт на ${b.siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}. Чтобы робот видел заявки, звонки и переходы в мессенджеры с сайта и учил на них Директ, поставьте на сайт наш код — это 5 минут.`
                : "Сейчас реклама ведёт не на сайт, но код пригодится, если переключите её на сайт: тогда заявки с него будут считаться сразу."}
            </p>
            {site ? (
              <div className="mb-6 rounded-2xl bg-paper p-4 sm:p-5">
                <div className="font-semibold mb-3">{siteSummary(site).done ? siteSummary(site).title : "Что осталось сделать"}</div>
                <SiteSetupList status={site} />
              </div>
            ) : null}
            <SiteConnect snippet={snippet} trackerLine={trackerLine} siteUrl={b.siteUrl} counterId={b.counterId ?? null} initial={site} contactEmail={contactEmail()} />
            <div className="mt-6 pt-5 border-t border-line">
              <div className="font-semibold">Счётчик Метрики</div>
              <p className="text-sm text-muted mt-1 mb-3 max-w-2xl">Робот смотрит в Метрике, сколько людей после клика действительно изучили сайт, а сколько сразу ушли. Если на сайте уже стоит ваш счётчик, лучше выбрать его — так не нужен второй счётчик, а история визитов сохранится. Тогда на сайт достаточно добавить строку Самохода.</p>
              <MetricaCounterPicker current={b.counterId ?? null} hasYandex={accounts.some((a) => a.platform === "yandex")} />
            </div>
          </>
        ) : (
          <p className="text-muted mt-1 leading-relaxed max-w-2xl">Объявления ведут на вашу страницу записи — обращения с неё считаются автоматически, ничего ставить не нужно. Есть свой сайт? <Link href="/app/start#links" className="font-semibold text-ink-2 underline underline-offset-2">Добавьте ссылку</Link> — здесь появится код для него.</p>
        )}
      </section>
      <section className="card p-5 sm:p-7">
        <h2 className="text-lg font-bold">Страница записи</h2>
        <p className="text-muted mt-1 leading-relaxed max-w-2xl">Простая страница с услугами, ценами, фото и кнопками связи. {b.siteUrl ? "Пригодится, если сайта не станет или захотите проверить её против сайта." : "На неё ведут все объявления."}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <a href={landing} target="_blank" className="btn btn-ghost btn-sm" rel="noreferrer"><ExternalLink size={14} /> Открыть</a>
          <CopyButton text={landing} label="Скопировать ссылку" />
        </div>
        <div className="mt-5 rounded-xl border border-line p-4 max-w-2xl">
          <div className="font-semibold">Куда приходят заявки с этой страницы</div>
          <ul className="mt-2 grid gap-2 text-sm text-ink-2">
            <li className="flex gap-2"><Check size={16} className="text-good shrink-0 mt-0.5" /><span>В кабинет: <Link href="/app/stats#leads" className="font-semibold underline underline-offset-2">Статистика → Последние обращения</Link> — имя, телефон, услуга и с какой рекламы пришёл человек.</span></li>
            <li className="flex gap-2">{connected ? <Check size={16} className="text-good shrink-0 mt-0.5" /> : <TriangleAlert size={16} className="text-warn shrink-0 mt-0.5" />}<span>{connected ? <>В Telegram{notify?.telegramName ? ` (${notify.telegramName})` : ""} — сразу, как человек отправил заявку.</> : <>В Telegram — пока не подключён, поэтому заявку можно пропустить. <Link href="/app/settings?tab=notify" className="font-semibold underline underline-offset-2">Подключить уведомления</Link></>}</span></li>
            <li className="flex gap-2"><Check size={16} className="text-good shrink-0 mt-0.5" /><span>Звонки и сообщения в WhatsApp/Telegram с кнопок страницы идут напрямую на ваш телефон{b.phone ? ` ${b.phone}` : ""} — их мы считаем как нажатия.</span></li>
          </ul>
        </div>
      </section>
        </>
      ) : null}
      {tab === "ads" ? (
        <>
      <section id="show" className="card p-5 sm:p-7 scroll-mt-6">
        <h2 className="text-lg font-bold">Где, кому и когда показывать</h2>
        <p className="hint mt-1 mb-5">Регион, пол и возраст, дни и часы показа — для всех кампаний сразу. Что не задано, подбирает робот.</p>
        <ShowSettingsEditor monthlyBudget={b.monthlyBudget} initial={(b.showSettings ?? {}) as ShowSettings} city={b.city} address={b.address} autoTime={timeTargeting({ ...b, showSettings: {} })?.note ?? null} autoRadiusKm={b.geo ? Math.round(vkRadiusFor(b.city) / 100) / 10 : null} live={b.status === "active" || b.status === "paused"} example={reachExample(b)} />
      </section>
      <section id="budget" className="card p-5 sm:p-7 scroll-mt-6">
        <h2 className="text-lg font-bold">Бюджет</h2>
        <p className="hint mt-1 mb-4">Сколько можно потратить на рекламу за месяц. При изменении робот пропорционально пересчитает лимиты всех каналов. Сейчас: {rub(b.monthlyBudget)}.</p>
        <BudgetEditor monthly={b.monthlyBudget} min={minMonthlyFor(channels.length ? channels : ["search"])} />
      </section>
        </>
      ) : null}
      {tab === "accounts" ? (
        <>
      <section className="card p-5 sm:p-7">
        <h2 className="text-lg font-bold">Рекламные кабинеты</h2>
        <p className="hint mt-1 max-w-2xl">Через них робот создаёт и ведёт рекламу. Деньги остаются в ваших кабинетах — пополняете их вы.</p>
        <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-3">
          {(["yandex", "vk"] as const).map((pf) => {
            const list = accounts.filter((a) => a.platform === pf);
            const name = pf === "yandex" ? "Яндекс Директ" : "VK Реклама";
            const sub = pf === "yandex" ? "Поиск, сайты и приложения (РСЯ), Карты" : "ВКонтакте, Одноклассники, Дзен";
            return (
              <div key={pf} id={pf === "vk" ? "vk" : undefined} className="rounded-2xl border border-line p-4 sm:p-5 scroll-mt-6 min-w-0 [&_.btn]:max-w-full [&_.btn]:h-auto [&_.btn]:min-h-9 [&_.btn]:py-1.5 [&_.btn]:whitespace-normal">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className={`w-7 h-7 rounded-lg grid place-items-center text-white text-xs font-bold ${pf === "yandex" ? "bg-[#fc3f1d]" : "bg-[#0077ff]"}`} aria-hidden>{pf === "yandex" ? "Я" : "VK"}</span>
                  <span className="font-semibold">{name}</span>
                  {!list.length ? <span className="pill bg-paper text-muted">Не подключён</span> : list.every((a) => a.status === "ok") ? <span className="pill bg-good-soft text-good"><Check size={13} /> Подключён</span> : <span className="pill bg-bad-soft text-bad"><TriangleAlert size={13} /> Нет доступа</span>}
                </div>
                <p className="text-sm text-muted mt-1">{sub}</p>
                {list.map((a) => (
                  <div key={a.id} className="mt-3 rounded-xl bg-paper px-3.5 py-3">
                    <div className="text-sm"><span className="text-muted">Аккаунт: </span><b>{a.login && a.login !== PLATFORM_NAME[a.platform] ? a.login : "подключён"}</b></div>
                    {a.status !== "ok" && a.statusNote ? <p className="text-sm text-bad mt-1">{a.statusNote}</p> : null}
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {a.platform === "yandex" || (a.platform === "vk" && vkConfigured()) ? <a className={`btn btn-sm ${a.status === "ok" ? "btn-ghost bg-white" : "btn-primary"}`} href={`/api/connect/${a.platform}/start?back=/app/settings?tab=accounts`}>Подключить заново</a> : null}
                      <ActionButton method="DELETE" url={`/api/accounts/${a.id}`} confirm="Отключить кабинет? Сервис перестанет управлять рекламой в нём." done="Кабинет отключён" className="btn btn-ghost btn-sm bg-white">Отключить</ActionButton>
                    </div>
                  </div>
                ))}
                {!list.length || list.some((a) => a.status !== "ok") ? (
                  <div className="mt-3">
                    {pf === "yandex" ? (
                      yandexConfigured() ? <a className="btn btn-primary btn-sm" href="/api/connect/yandex/start?back=/app/settings?tab=accounts">Подключить Яндекс Директ</a> : <p className="text-sm text-muted">Подключение Директа пока недоступно.</p>
                    ) : (
                      <>
                        <p className="text-sm text-muted mb-3">{vkConfigured() ? "Войдите через VK или подключите по ключам API своего кабинета." : "Подключается по ключам API вашего кабинета — это 2 минуты."}</p>
                        <VkConnect oauth={vkConfigured()} back="/app/settings?tab=accounts" />
                      </>
                    )}
                  </div>
                ) : null}
                {pf === "vk" && list.some((a) => a.status === "ok") ? <div id="vk-pixel" className="mt-4 scroll-mt-6"><VkPixelSetup /></div> : null}
              </div>
            );
          })}
        </div>
        {demoAllowed() && !accounts.length ? <div className="mt-3"><ActionButton url="/api/connect/demo" done="Демо-кабинет подключён" className="btn btn-ghost btn-sm">Подключить демо-кабинет</ActionButton></div> : null}
        <p className="hint mt-4 max-w-2xl">Новые кабинеты используются для следующего запуска. Пополнение баланса — в самих кабинетах Директа и VK Рекламы. Маркировку рекламы площадки делают автоматически, если в кабинете заполнены данные рекламодателя.</p>
      </section>
        </>
      ) : null}
      {tab === "notify" ? (
        <>
      <section id="notify" className="card p-5 sm:p-7 scroll-mt-6">
        <h2 className="text-lg font-bold">Уведомления о заявках</h2>
        <NotifySettings initial={notifyStatus} />
      </section>
        </>
      ) : null}
      {tab === "account" ? (
        <>
      <section id="account" className="card p-5 sm:p-7 scroll-mt-6">
        <h2 className="text-lg font-bold">Аккаунт</h2>
        <AccountSettings email={user.email} hasPassword={Boolean(me?.passwordHash)} verified={Boolean(me?.emailVerifiedAt)} mail={mailConfigured()} demo={isDemoEmail(user.email)} />
      </section>
      <section id="delete" className="card p-5 sm:p-7 scroll-mt-6 border-bad/30">
        <h2 className="text-lg font-bold">Удалить проект «{b.name}»</h2>
        <p className="hint mt-1 mb-4 max-w-2xl">Кампании проекта в Директе и VK остановим (их история останется в кабинетах — удалить её можно там же), а описание, объявления, статистику и историю в Самоходе сотрём. Вернуть будет нельзя.</p>
        <DeleteProject id={b.id} name={b.name} />
      </section>
        </>
      ) : null}
    </div>
  );
}

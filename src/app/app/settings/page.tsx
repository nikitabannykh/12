import { VkConnect } from "@/components/VkConnect";
import { VkPixelSetup } from "@/components/VkPixelSetup";
import { ShowSettingsEditor } from "@/components/ShowSettingsEditor";
import { LandingEditor } from "@/components/LandingEditor";
import { MetricaCounterPicker } from "@/components/MetricaCounterPicker";
import { SiteConnect } from "@/components/SiteConnect";
import { siteTrackingStatus } from "@/lib/engine/site-tracking";
import { pageUrl, type LandingSettings } from "@/lib/engine/landing";
import { timeTargeting } from "@/lib/engine/extras";
import { vkRadiusFor } from "@/lib/platforms/vk-formats";
import type { ShowSettings } from "@/lib/engine/show";
import Link from "next/link";
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

export default async function Settings() {
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

      <section id="notify" className="card p-5 sm:p-7 scroll-mt-6">
        <h2 className="text-lg font-bold">Уведомления о заявках</h2>
        <NotifySettings initial={notifyStatus} />
      </section>

      <section id="landing" className="card p-5 sm:p-7 scroll-mt-6">
        <h2 className="text-lg font-bold">Куда ведёт реклама</h2>
        <p className="hint mt-1 mb-5">Куда попадает человек после клика по объявлению. Можно одну ссылку для всех каналов и свою — для отдельного канала.</p>
        <LandingEditor initial={(b.landing ?? {}) as LandingSettings} siteUrl={b.siteUrl} pageUrl={pageUrl(b, appUrl())} channels={channels} live={b.status === "active" || b.status === "paused"} hasYandex={accounts.some((a) => a.platform === "yandex")} />
      </section>

      <section id="show" className="card p-5 sm:p-7 scroll-mt-6">
        <h2 className="text-lg font-bold">Где, кому и когда показывать</h2>
        <p className="hint mt-1 mb-5">Регион, пол и возраст, дни и часы показа — для всех кампаний сразу. Что не задано, подбирает робот.</p>
        <ShowSettingsEditor initial={(b.showSettings ?? {}) as ShowSettings} city={b.city} address={b.address} autoTime={timeTargeting({ ...b, showSettings: {} })?.note ?? null} autoRadiusKm={b.geo ? Math.round(vkRadiusFor(b.city) / 100) / 10 : null} live={b.status === "active" || b.status === "paused"} />
      </section>

      <section id="budget" className="card p-5 sm:p-7 scroll-mt-6">
        <h2 className="text-lg font-bold">Бюджет</h2>
        <p className="hint mt-1 mb-4">Сколько можно потратить на рекламу за месяц. При изменении робот пропорционально пересчитает лимиты всех каналов. Сейчас: {rub(b.monthlyBudget)}.</p>
        <BudgetEditor monthly={b.monthlyBudget} min={minMonthlyFor(channels.length ? channels : ["search"])} />
      </section>

      <section className="card p-5 sm:p-7">
        <h2 className="text-lg font-bold">Рекламные кабинеты</h2>
        <ul className="mt-4 divide-y divide-line">
          {accounts.map((a) => (
            <li key={a.id} className="py-3 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[12rem]">
                <div className="font-semibold">{PLATFORM_NAME[a.platform]}</div>
                {a.login && a.login !== PLATFORM_NAME[a.platform] ? <div className="text-sm text-muted">{a.login}</div> : null}
              </div>
              {a.status === "ok" ? (
                <span className="pill bg-good-soft text-good"><Check size={13} /> Доступ есть</span>
              ) : (
                <span className="pill bg-bad-soft text-bad" title={a.statusNote ?? ""}><TriangleAlert size={13} /> Нет доступа</span>
              )}
              {a.platform === "yandex" || (a.platform === "vk" && vkConfigured()) ? <a className="btn btn-ghost btn-sm" href={`/api/connect/${a.platform}/start?back=/app/settings`}>Подключить заново</a> : null}
              <ActionButton method="DELETE" url={`/api/accounts/${a.id}`} confirm="Отключить кабинет? Сервис перестанет управлять рекламой в нём." done="Кабинет отключён">Отключить</ActionButton>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          {yandexConfigured() && !accounts.some((a) => a.platform === "yandex") ? <a className="btn btn-primary btn-sm" href="/api/connect/yandex/start?back=/app/settings">Подключить Яндекс Директ</a> : null}

          {demoAllowed() && !accounts.length ? <ActionButton url="/api/connect/demo" done="Демо-кабинет подключён" className="btn btn-ghost btn-sm">Подключить демо-кабинет</ActionButton> : null}
        </div>
        {!accounts.some((a) => a.platform === "vk") || accounts.some((a) => a.platform === "vk" && a.status !== "ok") ? (
          <div id="vk" className="mt-5 pt-5 border-t border-line scroll-mt-6">
            <div className="font-semibold">VK Реклама</div>
            <p className="text-sm text-muted mt-0.5 mb-3">ВКонтакте, Одноклассники, Дзен. {vkConfigured() ? "Войдите через VK или подключите по ключам API своего кабинета." : "Подключается по ключам API вашего кабинета — это 2 минуты."}</p>
            <VkConnect oauth={vkConfigured()} back="/app/settings" />
          </div>
        ) : null}
        {accounts.some((a) => a.platform === "vk" && a.status === "ok") ? <div id="vk-pixel" className="mt-4 scroll-mt-6"><VkPixelSetup /></div> : null}
        <p className="hint mt-4 max-w-2xl">Новые кабинеты используются для следующего запуска. Пополнение баланса — в самих кабинетах Директа и VK Рекламы. Маркировку рекламы площадки делают автоматически, если в кабинете заполнены данные рекламодателя.</p>
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

      <section id="account" className="card p-5 sm:p-7 scroll-mt-6">
        <h2 className="text-lg font-bold">Аккаунт</h2>
        <AccountSettings email={user.email} hasPassword={Boolean(me?.passwordHash)} verified={Boolean(me?.emailVerifiedAt)} mail={mailConfigured()} demo={isDemoEmail(user.email)} />
      </section>

      <section className="card p-5 sm:p-7">
        <h2 className="text-lg font-bold">Страница записи</h2>
        <p className="text-muted mt-1 leading-relaxed max-w-2xl">Простая страница с услугами, ценами, фото и кнопками связи. {b.siteUrl ? "Пригодится, если сайта не станет или захотите проверить её против сайта." : "На неё ведут все объявления."}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <a href={landing} target="_blank" className="btn btn-ghost btn-sm" rel="noreferrer"><ExternalLink size={14} /> Открыть</a>
          <CopyButton text={landing} label="Скопировать ссылку" />
        </div>
      </section>
    </div>
  );
}

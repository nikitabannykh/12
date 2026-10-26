import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, ExternalLink, TriangleAlert } from "lucide-react";
import { requireUser, demoAllowed } from "@/lib/auth";
import { accountsFor, getBusinessForUser, channelsFor } from "@/lib/engine/launch";
import { trackingSnippet } from "@/lib/platforms/metrica";
import { yandexConfigured } from "@/lib/platforms/yandex";
import { vkConfigured } from "@/lib/platforms/vk";
import { PLATFORM_NAME } from "@/lib/platforms";
import { ActionButton, CopyButton } from "@/components/client";
import { BudgetEditor } from "@/components/BudgetEditor";
import { minMonthlyFor } from "@/lib/engine/budget";
import { nicheById } from "@/lib/niches";
import { appUrl, rub } from "@/lib/util";

export default async function Settings() {
  const user = await requireUser();
  const b = await getBusinessForUser(user.id);
  if (!b) redirect("/app/start");
  const accounts = await accountsFor(user.id);
  const snippet = trackingSnippet({ counterId: b.counterId, publicKey: b.publicKey, appUrl: appUrl() });
  const landing = `${appUrl()}/p/${b.publicKey}`;
  const channels = channelsFor(accounts).map((c) => c.channel);

  return (
    <div className="grid gap-6">
      <h1 className="text-3xl font-extrabold tracking-tight">Настройки</h1>

      <section className="card p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">{b.name}</h2>
            <p className="text-muted mt-1">{nicheById(b.niche).label} · {b.city}{b.address ? `, ${b.address}` : ""}</p>
            <p className="text-sm text-muted mt-2">{b.services.length} услуг в описании{b.offer ? ` · предложение: ${b.offer}` : ""}</p>
          </div>
          <Link href="/app/start" className="btn btn-ghost btn-sm">Изменить описание</Link>
        </div>
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
                <div className="text-sm text-muted">{a.login}</div>
              </div>
              {a.status === "ok" ? (
                <span className="pill bg-good-soft text-good"><Check size={13} /> Доступ есть</span>
              ) : (
                <span className="pill bg-bad-soft text-bad" title={a.statusNote ?? ""}><TriangleAlert size={13} /> Нет доступа</span>
              )}
              {a.platform !== "demo" ? <a className="btn btn-ghost btn-sm" href={`/api/connect/${a.platform}/start?back=/app/settings`}>Подключить заново</a> : null}
              <ActionButton method="DELETE" url={`/api/accounts/${a.id}`} confirm="Отключить кабинет? Сервис перестанет управлять рекламой в нём." done="Кабинет отключён">Отключить</ActionButton>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          {yandexConfigured() && !accounts.some((a) => a.platform === "yandex") ? <a className="btn btn-primary btn-sm" href="/api/connect/yandex/start?back=/app/settings">Подключить Яндекс Директ</a> : null}
          {vkConfigured() && !accounts.some((a) => a.platform === "vk") ? <a className="btn btn-primary btn-sm" href="/api/connect/vk/start?back=/app/settings">Подключить VK Рекламу</a> : null}
          {demoAllowed() && !accounts.length ? <ActionButton url="/api/connect/demo" done="Демо-кабинет подключён" className="btn btn-ghost btn-sm">Подключить демо-кабинет</ActionButton> : null}
        </div>
        <p className="hint mt-4 max-w-2xl">Новые кабинеты используются для следующего запуска. Пополнение баланса — в самих кабинетах Директа и VK Рекламы. Маркировку рекламы площадки делают автоматически, если в кабинете заполнены данные рекламодателя.</p>
      </section>

      <section id="counter" className="card p-5 sm:p-7 scroll-mt-6">
        <h2 className="text-lg font-bold">Подсчёт обращений</h2>
        {b.siteUrl ? (
          <>
            <p className="text-muted mt-1 leading-relaxed max-w-2xl">
              Вставьте этот код на все страницы сайта {b.siteUrl.replace(/^https?:\/\//, "")} — перед закрывающим тегом <code className="bg-paper px-1 rounded">&lt;/head&gt;</code>. Если сайт на Tilda, Taplink или WordPress — это поле «Код в head» в настройках сайта.
            </p>
            <pre className="mt-4 bg-ink text-white/90 text-xs leading-relaxed rounded-xl p-4 overflow-x-auto max-h-64">{snippet}</pre>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <CopyButton text={snippet} label="Скопировать код" />
              {b.counterId ? <span className="text-sm text-muted">Счётчик Метрики № {b.counterId}, цели: обращение, заявка, звонок, мессенджер</span> : <span className="text-sm text-muted">Счётчик Метрики создадим при запуске в Директе</span>}
            </div>
            <p className="hint mt-3 max-w-2xl">Код сам замечает заявки из форм, клики по номеру телефона и переходы в WhatsApp и Telegram — и понимает, из какого объявления пришёл человек.</p>
          </>
        ) : (
          <p className="text-muted mt-1 leading-relaxed max-w-2xl">Объявления ведут на вашу страницу записи — обращения с неё считаются автоматически, ничего ставить не нужно.</p>
        )}
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

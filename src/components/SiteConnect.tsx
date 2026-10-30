"use client";
/**
 * «Подключение сайта»: один код перед </head>, инструкции для конструкторов, проверка установки
 * (сервер открывает сайт и ищет код + живой сигнал от кода) и последнее событие с сайта.
 */
import { useEffect, useRef, useState } from "react";
import { Check, CircleHelp, ExternalLink, Loader2, Mail, TriangleAlert } from "lucide-react";
import { api, CopyButton, useToast } from "./client";
import type { SiteTrackingStatus, GoalsState } from "@/lib/engine/site-tracking";

type Props = {
  snippet: string;
  trackerLine: string;
  siteUrl: string;
  counterId: number | null;
  initial: SiteTrackingStatus | null;
  contactEmail: string | null;
};

function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "только что";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} ${plural(m, "минуту", "минуты", "минут")} назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ${plural(h, "час", "часа", "часов")} назад`;
  const d = Math.round(h / 24);
  return `${d} ${plural(d, "день", "дня", "дней")} назад`;
}

const host = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/$/, "");

const TABS = [
  { id: "tilda", label: "Tilda" },
  { id: "wp", label: "WordPress" },
  { id: "wix", label: "Wix" },
  { id: "taplink", label: "Taplink" },
  { id: "other", label: "Другой сайт" },
] as const;
type Tab = (typeof TABS)[number]["id"];

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="grid gap-2">
      {items.map((it, i) => (
        <li key={i} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 text-sm leading-relaxed">
          <span className="w-6 h-6 rounded-full bg-paper text-ink-2 text-xs font-bold grid place-items-center">{i + 1}</span>
          <span className="pt-0.5">{it}</span>
        </li>
      ))}
    </ol>
  );
}

const B = ({ children }: { children: React.ReactNode }) => <b className="font-semibold text-ink">{children}</b>;

function goalsText(g: GoalsState | undefined, counterId: number | null): { ok: boolean | null; text: string } | null {
  if (!counterId || !g) return null;
  switch (g.state) {
    case "ok":
      return { ok: true, text: g.created ? `Цели в счётчике № ${counterId} добавлены (${g.created})` : `Цели Самохода есть в счётчике № ${counterId}` };
    case "no_token":
      return { ok: null, text: "Цели в Метрике проверим, когда подключите Яндекс Директ" };
    case "no_consent":
      return { ok: null, text: "Это ваш счётчик — цели добавим, когда выберете его ниже и разрешите" };
    case "error":
      return { ok: false, text: `Цели в Метрике: ${g.message}` };
    default:
      return null;
  }
}

export function SiteConnect({ snippet, trackerLine, siteUrl, counterId, initial, contactEmail }: Props) {
  const [tab, setTab] = useState<Tab>("tilda");
  const [status, setStatus] = useState<SiteTrackingStatus | null>(initial);
  const [busy, setBusy] = useState(false);
  const [watching, setWatching] = useState(false);
  const [, tick] = useState(0);
  const toast = useToast();
  const startedAt = useRef(0);

  // «только что» → «2 минуты назад» без перезагрузки
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // Живая проверка: владелец открыл сайт со ссылкой ?pz_check=1 — ждём сигнал от кода до 2 минут
  useEffect(() => {
    if (!watching) return;
    const t = setInterval(async () => {
      try {
        const r = await api<{ status: SiteTrackingStatus }>("GET", "/api/site/status");
        setStatus(r.status);
        const seen = r.status?.lastSeen?.at ? Date.parse(r.status.lastSeen.at) : 0;
        if (seen >= startedAt.current - 5000) {
          setWatching(false);
          toast("Код на сайте работает — сигнал получен");
        }
      } catch {
        /* попробуем ещё */
      }
      if (Date.now() - startedAt.current > 120_000) setWatching(false);
    }, 3000);
    return () => clearInterval(t);
  }, [watching, toast]);

  const check = async () => {
    setBusy(true);
    try {
      const r = await api<{ status: SiteTrackingStatus }>("POST", "/api/site/check");
      setStatus(r.status);
      const c = r.status?.check;
      if (c?.found === "key") toast("Код найден на сайте");
      else if (c?.found === "error") toast(`Сайт не открылся: ${c.message ?? "ошибка"}`, "error");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const live = () => {
    startedAt.current = Date.now();
    setWatching(true);
  };

  const checkUrl = (() => {
    try {
      const u = new URL(siteUrl);
      u.searchParams.set("pz_check", "1");
      return u.toString();
    } catch {
      return siteUrl;
    }
  })();

  const devText = [
    `Здравствуйте! Нужно поставить на сайт ${host(siteUrl)} код подсчёта обращений из рекламы (сервис «Самоход»${counterId ? ` и Яндекс Метрика № ${counterId}` : ""}).`,
    "",
    "1. Вставьте код ниже на все страницы сайта — перед закрывающим тегом </head>.",
    counterId ? `2. Если код Яндекс Метрики № ${counterId} на сайте уже стоит — вставьте только последнюю строку (<script … /t.js …>).` : "2. Код Метрики отдельно ставить не нужно.",
    "3. Настраивать ничего не нужно: код сам считает отправку форм с полем телефона или почты, клики по ссылкам tel:, переходы в WhatsApp, Telegram, Viber, VK и в онлайн-запись (DIKIDI, YCLIENTS). Значения полей форм не читаются и никуда не отправляются.",
    "4. Если заявка отправляется без тега <form> (своим скриптом) — после успешной отправки вызовите window.pzLead('form'). Форму или ссылку, которую не нужно считать, пометьте атрибутом data-pz-ignore.",
    `5. Проверка: откройте ${checkUrl} — в настройках Самохода появится «Код работает».`,
    "",
    "Код:",
    snippet,
  ].join("\n");

  const mailto = contactEmail
    ? `mailto:${contactEmail}?subject=${encodeURIComponent(`Помогите установить код на сайт ${host(siteUrl)}`)}&body=${encodeURIComponent(`Здравствуйте! Не получается поставить код Самохода на сайт ${siteUrl}.\nСайт сделан на: \nЧто не получается: \n`)}`
    : null;

  const st = status?.state ?? "unknown";
  const c = status?.check ?? null;
  const goals = goalsText(c?.goals, counterId);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      {/* Статус */}
      <div className={`rounded-xl px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1 ${st === "ok" ? "bg-good-soft" : st === "missing" ? "bg-warn-soft" : "bg-paper"}`}>
        <span className={`inline-flex items-center gap-1.5 font-semibold ${st === "ok" ? "text-good" : st === "missing" ? "text-warn" : "text-ink-2"}`}>
          {st === "ok" ? <Check size={16} /> : st === "missing" ? <TriangleAlert size={16} /> : <CircleHelp size={16} />}
          {st === "ok" ? "Код работает" : st === "missing" ? "Код на сайте не найден" : "Код ещё не проверяли"}
        </span>
        <span className="text-sm text-muted min-w-0 [overflow-wrap:anywhere]">
          {status?.lastEvent
            ? <>Последнее событие с сайта: {ago(status.lastEvent.at)} — {status.lastEvent.label}</>
            : status?.lastSeen
              ? <>Сигнал от кода: {ago(status.lastSeen.at)}{status.lastSeen.host ? ` (${status.lastSeen.host})` : ""}. Обращений с сайта пока не было</>
              : <>С сайта {host(siteUrl)} пока ничего не приходило</>}
        </span>
      </div>

      {/* 1. Код */}
      <div>
        <h3 className="font-bold">1. Скопируйте код</h3>
        <p className="text-sm text-muted mt-1 max-w-2xl leading-relaxed">Один код на все страницы сайта — перед закрывающим тегом <code className="bg-paper px-1 rounded">&lt;/head&gt;</code>. Сам находит заявки из форм, звонки по номеру, переходы в мессенджеры и онлайн-запись, понимает, из какого объявления пришёл человек{counterId ? ", и отправляет цели в Метрику — Директ учится на них" : ""}.</p>
        <pre className="mt-3 bg-ink text-white/90 text-xs leading-relaxed rounded-xl p-4 overflow-x-auto max-h-56">{snippet}</pre>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <CopyButton text={snippet} label="Скопировать код" />
          {counterId ? <CopyButton text={trackerLine} label="Только строку Самохода" /> : null}
        </div>
        <p className="hint mt-2 max-w-2xl">
          {counterId
            ? `Если код Метрики № ${counterId} на сайте уже стоит — достаточно строки Самохода.`
            : "Счётчик Метрики добавится в код после запуска рекламы в Директе — тогда код на сайте нужно будет обновить (проверка ниже подскажет)."}
        </p>
      </div>

      {/* 2. Куда вставить */}
      <div>
        <h3 className="font-bold">2. Вставьте на сайт</h3>
        <div role="tablist" aria-label="Конструктор сайта" className="mt-3 flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} aria-pressed={tab === t.id} className="chip shrink-0" onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="mt-4 min-w-0 rounded-xl border border-line p-4 sm:p-5">
          {tab === "tilda" ? (
            <Steps items={[
              <>Откройте проект → <B>Настройки сайта</B> → <B>Вставка кода</B> (в старом интерфейсе — вкладка «Ещё»).</>,
              <>В поле <B>«HTML-код для вставки внутрь HEAD»</B> вставьте код и нажмите «Сохранить».</>,
              <>Нажмите <B>«Опубликовать все страницы»</B> — без переопубликации код на сайте не появится.</>,
            ]} />
          ) : tab === "wp" ? (
            <Steps items={[
              <>Плагины → Добавить новый → найдите <B>WPCode</B> (бывший «Insert Headers and Footers») → Установить → Активировать.</>,
              <>Code Snippets → <B>Header &amp; Footer</B> → вставьте код в поле <B>Header</B> → Save Changes.</>,
              <>Без плагина: Внешний вид → Редактор файлов темы → <B>header.php</B>, вставьте код перед <code className="bg-paper px-1 rounded">&lt;/head&gt;</code>. При обновлении темы код пропадёт — плагин надёжнее.</>,
              <>Если стоит плагин кеширования (WP Rocket, LiteSpeed, W3 Total Cache) — очистите кеш.</>,
            ]} />
          ) : tab === "wix" ? (
            <Steps items={[
              <>Панель управления сайтом → <B>Настройки</B> → раздел «Расширенные» → <B>Пользовательский код</B>.</>,
              <>Нажмите <B>«+ Добавить код»</B>, вставьте код, укажите «Все страницы» и «Загружать код один раз».</>,
              <>Место размещения — <B>Head</B> → «Применить». Пользовательский код работает на премиум-тарифе с подключённым доменом.</>,
            ]} />
          ) : tab === "taplink" ? (
            <Steps items={[
              <>Откройте <B>Настройки</B> → <B>Общие</B> → <B>HTML-код</B>.</>,
              <>Вставьте код и сохраните. На тарифе BUSINESS код работает на всех страницах Taplink.</>,
              <>Кнопки WhatsApp, Telegram, телефона и онлайн-записи код посчитает сам — отдельно их настраивать не нужно.</>,
            ]} />
          ) : (
            <div className="grid gap-3">
              <Steps items={[
                <>Вставьте код на все страницы перед <code className="bg-paper px-1 rounded">&lt;/head&gt;</code> — в общий шаблон сайта или в поле «код в head» вашего конструктора.</>,
                <>Сайт делал разработчик? Отправьте ему готовую инструкцию — в ней код и всё, что нужно знать.</>,
              ]} />
              <div className="flex flex-wrap gap-2">
                <CopyButton text={devText} label="Скопировать инструкцию" />
                <a className="btn btn-ghost btn-sm" href={`mailto:?subject=${encodeURIComponent(`Код на сайт ${host(siteUrl)}`)}&body=${encodeURIComponent(devText)}`}><Mail size={14} /> Отправить письмом</a>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 3. Проверка */}
      <div>
        <h3 className="font-bold">3. Проверьте</h3>
        <p className="text-sm text-muted mt-1 max-w-2xl leading-relaxed">Проверим код на странице сайта. Или откройте сайт по ссылке проверки — код пришлёт сигнал, и статус обновится сам. Потом нажмите на сайте номер телефона — здесь появится «клик по телефону».</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={check}>
            {busy ? <Loader2 size={16} className="spin" /> : null}
            Проверить установку
          </button>
          <a className="btn btn-ghost btn-sm" href={checkUrl} target="_blank" rel="noreferrer" onClick={live}>
            {watching ? <Loader2 size={14} className="spin" /> : <ExternalLink size={14} />} {watching ? "Ждём сигнал с сайта…" : "Открыть сайт для проверки"}
          </a>
        </div>
        <ul className="mt-4 grid gap-2 text-sm">
          {c ? (
            <Row ok={c.found === "key" ? true : c.found === "error" ? null : false}>
              {c.found === "key" ? `Код найден на ${host(c.url)}` : c.found === "other_key" ? "На сайте стоит код Самохода от другого бизнеса — замените его кодом выше" : c.found === "none" ? noneText(c.url, status) : `Сайт не открылся: ${c.message ?? "ошибка"}`}
              <span className="text-faint"> · проверено {ago(c.at)}</span>
            </Row>
          ) : null}
          {c && counterId && c.counterFound !== null ? (
            <Row ok={c.counterFound ? true : false}>{c.counterFound ? `Счётчик Метрики № ${counterId} на сайте есть` : `Счётчика Метрики № ${counterId} на странице нет — обновите код на сайте`}</Row>
          ) : null}
          {goals ? <Row ok={goals.ok}>{goals.text}</Row> : null}
          <Row ok={status?.lastSeen ? true : null}>
            {status?.lastSeen ? `Сигнал от кода: ${ago(status.lastSeen.at)}${status.lastSeen.host ? ` (${status.lastSeen.host})` : ""}` : "Сигнала от кода ещё не было"}
          </Row>
          <Row ok={status?.lastEvent ? true : null}>
            {status?.lastEvent ? `Последнее событие с сайта: ${ago(status.lastEvent.at)} — ${status.lastEvent.label}` : "Событий с сайта ещё не было"}
          </Row>
        </ul>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer font-semibold text-ink-2">Что код считает и чего не делает</summary>
        <ul className="mt-2 grid gap-1 text-muted leading-relaxed list-disc pl-5 max-w-2xl">
          <li>Отправку форм, где есть поле телефона или почты. Поиск, вход и формы с паролем — не считает.</li>
          <li>Клики по номеру телефона, переходы в WhatsApp, Telegram, Viber, VK и MAX.</li>
          <li>Переходы в онлайн-запись: DIKIDI, YCLIENTS, Altegio, Sonline, EasyWeek, Booksy.</li>
          <li>Что человек ввёл в форму — не читает и никуда не отправляет. Один человек — одно обращение одного типа за 30 минут.</li>
        </ul>
      </details>

      {mailto ? (
        <p className="text-sm text-muted">
          Не получается? <a className="font-semibold text-ink-2 underline underline-offset-2" href={mailto}>Напишите нам</a> — поможем установить.
        </p>
      ) : null}
    </div>
  );
}

const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");

/** Проверка не нашла код в HTML страницы: если сигнал от кода приходит с этого же сайта — значит, сайт собирается скриптами */
function noneText(url: string, status: SiteTrackingStatus | null) {
  const h = (() => { try { return bare(new URL(url).host); } catch { return host(url); } })();
  const seen = status?.state === "ok" ? status.lastSeen?.host : null;
  if (seen && bare(seen) === h) return "В коде страницы скрипт не виден (сайт собирается скриптами), но сигнал от кода приходит — всё в порядке";
  if (seen) return `На ${h} кода не видно, а сигнал приходит с ${seen}. Проверьте, что код стоит на нужном сайте и сайт опубликован`;
  return `На ${h} кода не видно. Вставили — не забудьте опубликовать сайт`;
}

function Row({ ok, children }: { ok: boolean | null; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2 items-start">
      <span className={`mt-0.5 ${ok === true ? "text-good" : ok === false ? "text-warn" : "text-faint"}`}>
        {ok === true ? <Check size={16} /> : ok === false ? <TriangleAlert size={16} /> : <CircleHelp size={16} />}
      </span>
      <span className="[overflow-wrap:anywhere]">{children}</span>
    </li>
  );
}

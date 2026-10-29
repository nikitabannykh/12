import Link from "next/link";
import { ArrowUpRight, Check, CircleCheck, Clock, Dumbbell, FlaskConical, Flower2, Hand, Music, PauseCircle, Scale, Scissors, Search, Sparkles, Stethoscope, Undo2, X } from "lucide-react";
import { LogoMark } from "@/components/Logo";
import { HeroBg } from "@/components/HeroBg";
import { getUser } from "@/lib/auth";

/**
 * Лендинг «Самохода». Тёмная кинематографичная база (свет, стекло, сетка, зерно),
 * между тёмными главами — светлые «листы» с бенто и сравнением.
 * Смысл: автоматизируем работу с рекламой, делаем её простой, а бюджет — эффективным.
 */

const INK = "#07081a";
const NOISE = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='.5'/></svg>\")";
const EASE = "ease-[cubic-bezier(0.32,0.72,0,1)]";

const FAQ = [
  ["Нужен ли опыт в рекламе?", "Нет. Вы рассказываете о бизнесе и выбираете бюджет — настройку, запуск и оптимизацию сервис делает сам. Перед запуском всё можно посмотреть и поправить."],
  ["Чьи деньги и кто платит площадкам?", "Рекламный бюджет лежит в ваших кабинетах Яндекс Директа и VK Рекламы, пополняете их вы. Сервис подключается по доступу, который можно отозвать в любой момент."],
  ["Как робот экономит бюджет?", "Не платит за нецелевые запросы, выключает объявления, которые кликают реже соседних, и переносит деньги в каналы и аудитории, где обращение дешевле. Месячный лимит он не превышает никогда."],
  ["Можно ли вмешаться в работу робота?", "Да. Любое решение отменяется одной кнопкой, тексты можно править вручную или попросить робота переписать их по вашему пожеланию. Всю рекламу можно остановить разом."],
  ["А если у меня нет сайта?", "Сервис сделает страницу записи с формой и кнопками мессенджеров. Вести рекламу можно и на свой сайт, и в Telegram или WhatsApp."],
  ["Для каких бизнесов подходит?", "Для локального бизнеса услуг: салоны и студии красоты, барбершопы, массаж, косметология, остеопатия, фитнес, йога, танцы. Для медицинских услуг объявления пишутся по правилам закона о рекламе."],
] as const;

/* ─── Детали ───────────────────────────────────────────────────── */

function Cta({ href, children, tone = "mark" }: { href: string; children: React.ReactNode; tone?: "mark" | "ink" }) {
  return (
    <Link href={href} className={`group inline-flex items-center gap-3 rounded-full pl-6 pr-1.5 py-1.5 text-[15px] font-semibold transition-transform duration-500 ${EASE} active:scale-[0.98] ${tone === "mark" ? "bg-mark text-ink" : "bg-ink text-white"}`}>
      {children}
      <span className={`w-9 h-9 rounded-full grid place-items-center transition-transform duration-500 ${EASE} group-hover:translate-x-0.5 group-hover:-translate-y-px group-hover:scale-105 ${tone === "mark" ? "bg-ink/10" : "bg-white/15"}`}><ArrowUpRight size={16} strokeWidth={1.75} /></span>
    </Link>
  );
}

function Eyebrow({ children, dark = true }: { children: React.ReactNode; dark?: boolean }) {
  return <span className={`inline-flex rounded-full px-3 py-1 text-[11px] tracking-[0.18em] uppercase font-medium ${dark ? "bg-white/[0.06] ring-1 ring-white/10 text-white/60" : "bg-white ring-1 ring-black/[0.06] text-ink-2"}`}>{children}</span>;
}

/** Двойная рамка: стекло в металлическом лотке */
function Bezel({ children, className = "", inner = "", dark = false }: { children: React.ReactNode; className?: string; inner?: string; dark?: boolean }) {
  return (
    <div className={`rounded-[2rem] p-1.5 ${dark ? "bg-white/[0.04] ring-1 ring-white/10" : "bg-black/[0.03] ring-1 ring-black/[0.05]"} ${className}`}>
      <div className={`h-full rounded-[calc(2rem-0.375rem)] ${/(^|\s)bg-/.test(inner) ? "" : dark ? "bg-[#0d0f26]" : "bg-white"} ${dark ? "shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" : "shadow-[inset_0_1px_1px_rgba(255,255,255,0.9),0_30px_60px_-30px_rgba(29,32,69,0.18)]"} ${inner}`}>{children}</div>
    </div>
  );
}

function Glow({ className }: { className: string }) {
  return <div className={`pointer-events-none absolute rounded-full ${className}`} aria-hidden />;
}

/** Один экран кабинета в тёмной теме */
function DarkShot() {
  const week = [
    { d: "Пт", s: 58, l: 3 }, { d: "Сб", s: 46, l: 4 }, { d: "Вс", s: 52, l: 3 }, { d: "Пн", s: 63, l: 5 },
    { d: "Вт", s: 70, l: 6 }, { d: "Ср", s: 66, l: 6 }, { d: "Чт", s: 64, l: 8 },
  ];
  return (
    <div className="rounded-[1.6rem] overflow-hidden bg-[#0d0f26] ring-1 ring-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] text-left">
      <div className="h-11 flex items-center gap-2 px-4 border-b border-white/[0.06]">
        <span className="w-2.5 h-2.5 rounded-full bg-white/15" /><span className="w-2.5 h-2.5 rounded-full bg-white/15" /><span className="w-2.5 h-2.5 rounded-full bg-white/15" />
        <span className="mx-auto text-[11px] text-white/35 rounded-md bg-white/[0.04] px-3 py-1">Самоход · кабинет</span>
      </div>
      <div className="grid md:grid-cols-[13rem_minmax(0,1fr)]">
        <aside className="hidden md:flex flex-col gap-5 p-4 border-r border-white/[0.06]">
          <span className="flex items-center gap-2 font-semibold"><LogoMark size={22} />Самоход</span>
          <span className="flex items-center gap-2 rounded-xl bg-white/[0.04] ring-1 ring-white/[0.06] px-2.5 py-2 text-sm"><span className="w-6 h-6 rounded-md bg-mark text-ink grid place-items-center text-xs font-bold">С</span>Студия Лак</span>
          <nav className="grid gap-0.5 text-[13.5px]">
            {["Главное", "Реклама", "Статистика", "История", "Настройки"].map((t, i) => <span key={t} className={`rounded-lg px-2.5 py-2 ${i === 0 ? "bg-white/[0.08] text-white" : "text-white/45"}`}>{t}</span>)}
          </nav>
          <div className="mt-auto rounded-xl bg-white/[0.03] ring-1 ring-white/[0.06] p-3 text-[12px] text-white/50">
            <div className="flex items-center gap-1.5 text-white/80"><span className="w-1.5 h-1.5 rounded-full bg-[#3ddc97]" />Робот на связи</div>
            Следующая проверка завтра в 09:00
          </div>
        </aside>
        <div className="p-5 sm:p-7 grid gap-5 min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-[13px] text-white/40">Последние 7 дней</div>
              <div className="mt-1 text-lg sm:text-[1.6rem] font-semibold tracking-tight leading-snug max-w-[34rem]">Реклама привела <span className="text-mark">33 обращения</span>. Одно обошлось в <span className="text-mark">414 ₽</span> — на 28% дешевле, чем на старте.</div>
            </div>
            <span className="rounded-full bg-[#3ddc97]/10 text-[#3ddc97] ring-1 ring-[#3ddc97]/20 px-3 py-1 text-[12px] font-semibold">Здоровье рекламы 86</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px rounded-2xl overflow-hidden bg-white/[0.06]">
            {[["Потрачено", "13 660 ₽", "из 18 000 ₽ лимита"], ["Обращения", "33", "+50% к прошлой неделе"], ["Цена обращения", "414 ₽", "−28% со старта"], ["Сэкономлено", "3 140 ₽", "на мусорных кликах"]].map(([k, v, s], i) => (
              <div key={k} className="bg-[#0d0f26] p-4">
                <div className="text-[12px] text-white/40">{k}</div>
                <div className={`mt-1 text-xl sm:text-2xl font-semibold tracking-tight tabular-nums ${i === 3 ? "text-mark" : ""}`}>{v}</div>
                <div className={`text-[11.5px] ${i === 1 || i === 2 ? "text-[#3ddc97]" : "text-white/35"}`}>{s}</div>
              </div>
            ))}
          </div>
          <div className="grid lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-4">
            <div className="rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.06] p-4">
              <div className="flex justify-between text-[12px] text-white/40"><span>Расход и обращения</span><span className="flex gap-3"><span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-white/20" />расход</span><span className="flex items-center gap-1.5"><span className="w-2 h-[3px] rounded bg-mark" />обращение</span></span></div>
              <div className="mt-4 flex items-end justify-between h-44 px-1">
                {week.map((w, i) => (
                  <div key={w.d} className="flex flex-col items-center gap-[3px] w-6 sm:w-7">
                    {Array.from({ length: w.l }).map((_, j) => <span key={j} className="lp-pop w-full h-[3px] rounded-full bg-mark shadow-[0_0_8px_rgba(255,216,74,0.6)]" style={{ animationDelay: `${600 + i * 90 + j * 40}ms` }} />)}
                    <span className="lp-bar w-full rounded-t-md bg-[linear-gradient(180deg,rgba(255,255,255,0.22),rgba(255,255,255,0.06))]" style={{ height: `${Math.round(w.s * 1.55)}px`, animationDelay: `${200 + i * 70}ms` }} />
                    <span className="text-[10px] text-white/30 mt-1">{w.d}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.06] p-4">
              <div className="text-[12px] text-white/40">Сегодня робот</div>
              <ul className="mt-3 grid gap-3 text-[13.5px]">
                {[["09:04", "Минус-слово «обучение»", "−460 ₽ в неделю"], ["09:07", "Выключил слабое объявление", "кликали в 3 раза реже"], ["09:11", "+15% бюджета во ВКонтакте", "обращение там дешевле"], ["09:15", "Тест заголовка с ценой", "неделя на проверку"]].map(([t, a, b], i) => (
                  <li key={t} className="flex gap-3 lp-pop" style={{ animationDelay: `${900 + i * 220}ms` }}>
                    <span className="text-[11px] text-white/30 tabular-nums pt-0.5">{t}</span>
                    <div className="min-w-0 flex-1"><div className="text-white/90 truncate">{a}</div><div className="text-[11.5px] text-white/40">{b}</div></div>
                    <span className="text-[11px] text-white/30 pt-0.5">отменить</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Страница ─────────────────────────────────────────────────── */

export default async function Home() {
  const user = await getUser();
  const cta = user ? { href: "/app", text: "Открыть кабинет" } : { href: "/login?tab=register", text: "Запустить рекламу" };
  return (
    <main className="min-h-[100dvh] text-white overflow-x-clip" style={{ background: INK }}>
      <div className="pointer-events-none fixed inset-0 z-0 opacity-[0.05] mix-blend-overlay" style={{ backgroundImage: NOISE }} aria-hidden />

      {/* Плавающее меню */}
      <div className="sticky top-0 z-40 pt-4 px-4 flex justify-center">
        <nav className="flex items-center gap-1 rounded-full pl-4 pr-1.5 py-1.5 backdrop-blur-xl bg-[#0d0f26]/70 ring-1 ring-white/10 shadow-[0_20px_40px_-20px_rgba(0,0,0,0.6)]">
          <Link href="/" className="flex items-center gap-2 pr-3 font-semibold tracking-tight"><LogoMark size={22} />Самоход</Link>
          <span className="hidden md:flex items-center gap-0.5 text-[13.5px] text-white/60">
            {[["#how", "Как работает"], ["#features", "Возможности"], ["#levers", "Экономия"], ["#compare", "Сравнение"], ["#faq", "Вопросы"]].map(([h, t]) => <a key={h} href={h} className={`px-3 py-1.5 rounded-full hover:bg-white/10 hover:text-white transition-colors duration-300 ${EASE}`}>{t}</a>)}
          </span>
          {user ? null : <Link href="/login" className="hidden sm:inline px-3 py-1.5 text-[13.5px] text-white/70 hover:text-white">Войти</Link>}
          <Link href={cta.href} className="ml-1 rounded-full px-4 py-2 text-[13.5px] font-semibold bg-white text-ink">{user ? "Кабинет" : "Начать"}</Link>
        </nav>
      </div>

      {/* 1. Первый экран */}
      <section className="relative">
        <Glow className="-top-72 left-1/2 -translate-x-1/2 w-[72rem] h-[42rem] bg-[radial-gradient(closest-side,rgba(255,216,74,0.14),transparent)]" />
        <Glow className="top-[34rem] -left-60 w-[46rem] h-[46rem] bg-[radial-gradient(closest-side,rgba(99,102,241,0.16),transparent)]" />
        <Glow className="top-[40rem] -right-60 w-[40rem] h-[40rem] bg-[radial-gradient(closest-side,rgba(255,216,74,0.08),transparent)]" />
        <HeroBg kind="line" />
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 pt-16 sm:pt-24 text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] ring-1 ring-white/10 px-3.5 py-1.5 text-[12.5px] text-white/70">
            <span className="relative flex w-1.5 h-1.5"><span className="absolute inset-0 rounded-full bg-mark animate-ping opacity-70" /><span className="relative w-1.5 h-1.5 rounded-full bg-mark" /></span>
            Автопилот для Яндекс Директа и VK Рекламы
          </span>
          <h1 className="mt-8 text-[2.9rem] sm:text-[5.6rem] font-semibold tracking-[-0.055em] leading-[0.92] bg-[linear-gradient(180deg,#fff_30%,rgba(255,255,255,0.55))] bg-clip-text text-transparent">Вы ведёте бизнес.<br />Робот ведёт рекламу.</h1>
          <p className="mt-8 mx-auto max-w-[36rem] text-[1.1rem] sm:text-xl text-white/60 leading-relaxed font-light">Он сам настраивает Яндекс и VK, каждый день убирает лишние траты и переносит бюджет туда, где он приносит заявки.</p>
          <div className="mt-10 flex flex-wrap justify-center items-center gap-4">
            <Cta href={cta.href}>{cta.text}</Cta>
            <a href="#how" className={`rounded-full px-6 py-3.5 text-[15px] text-white/80 ring-1 ring-white/15 hover:bg-white/5 transition-colors duration-500 ${EASE}`}>Как это работает</a>
          </div>
        </div>
        <div className="relative mx-auto max-w-[74rem] px-4 sm:px-6 mt-16 sm:mt-20">
          <div className="absolute inset-x-24 top-10 h-72 rounded-full bg-mark/20 blur-[130px]" aria-hidden />
          <div className="relative rounded-[2rem] p-2 bg-white/[0.05] ring-1 ring-white/10 shadow-[0_80px_160px_-40px_rgba(0,0,0,0.85)]">
            <DarkShot />
          </div>
        </div>

        {/* Клиенты */}
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 pt-24 pb-28">
          <p className="text-center text-[11px] uppercase tracking-[0.25em] text-white/35">Рекламу с нами ведут</p>
          <ul className="mt-9 flex flex-wrap justify-center items-center gap-x-14 gap-y-7 opacity-60">
            <li><img src="/clients/sushkof.svg" alt="Сушкоф и пицца" className="h-8 [filter:brightness(0)_invert(1)]" /></li>
            <li className="flex items-center gap-2 text-xl font-semibold"><img src="/clients/goulash-mark.svg" alt="" className="h-7 w-7 grayscale" />Goulash.tech</li>
            <li><img src="/clients/delpesto.png" alt="Del Pesto" className="h-11 [filter:brightness(0)_invert(1)]" /></li>
            <li><img src="/clients/lifemart.svg" alt="Жизньмарт" className="h-10 [filter:brightness(0)_invert(1)]" /></li>
            <li className="rounded-full ring-1 ring-white/20 px-4 py-1.5 text-sm">и ещё 100+ компаний</li>
          </ul>
        </div>
      </section>

      {/* 2. Светлый лист: рычаги экономии */}
      <section id="levers" className="relative z-10 bg-[#f3f4f7] text-ink rounded-t-[2.5rem] sm:rounded-t-[3.5rem] scroll-mt-20">
        <div className="mx-auto max-w-[72rem] px-4 sm:px-6 py-24 sm:py-32">
          <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-8 items-end">
            <div>
              <Eyebrow dark={false}>Эффективный бюджет</Eyebrow>
              <h2 className="mt-6 text-[2.4rem] sm:text-[4rem] font-semibold tracking-[-0.05em] leading-[0.95]">Те же деньги —<br /><span className="text-ink/35">больше клиентов.</span></h2>
            </div>
            <p className="text-lg text-ink-2 leading-relaxed lg:pb-2">Робот делает то же, что хороший специалист по рекламе, только каждый день. Покажем на примере.</p>
          </div>

          {/* Условия примера */}
          <div className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-[1.5rem] bg-white ring-1 ring-black/[0.05] px-5 sm:px-6 py-4">
            <span className="rounded-full bg-mark px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.12em]">Пример</span>
            <span className="text-[15px]"><b>Студия маникюра</b> в Казани</span>
            <span className="text-[15px]">Бюджет на рекламу — <b>15 000 ₽ в месяц</b></span>
            <span className="text-[15px] text-muted">Заявка — это клиент, который позвонил или записался</span>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-12 gap-4">
            {/* Главное: сколько клиентов на те же деньги */}
            <Bezel className="md:col-span-7 md:row-span-2" inner="p-6 sm:p-8 flex flex-col gap-7">
              <div>
                <div className="text-sm text-muted">Итог за месяц</div>
                <div className="mt-2 text-[1.7rem] sm:text-[2.1rem] font-semibold tracking-[-0.03em] leading-tight">На те же 15 000 ₽ — <span className="bg-mark px-1.5 rounded-lg">48 клиентов вместо 29</span></div>
                <p className="mt-3 text-ink-2 leading-relaxed">Каждая заявка стала обходиться дешевле: было 520 ₽ рекламы на одного клиента, стало 310 ₽. Деньги те же — клиентов на 19 больше.</p>
              </div>
              <div className="grid gap-4 mt-auto">
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-paper p-5">
                    <div className="text-[13px] text-muted">До робота</div>
                    <div className="mt-2 text-[15px] text-muted">15 000 ₽ ÷ 520 ₽ за клиента</div>
                    <div className="mt-1 text-4xl font-semibold tracking-[-0.04em] text-ink/45">29 <span className="text-lg font-medium tracking-normal">клиентов</span></div>
                  </div>
                  <div className="rounded-2xl bg-ink text-white p-5">
                    <div className="text-[13px] text-white/60">С роботом</div>
                    <div className="mt-2 text-[15px] text-white/70">15 000 ₽ ÷ 310 ₽ за клиента</div>
                    <div className="mt-1 text-4xl font-semibold tracking-[-0.04em]">48 <span className="text-lg font-medium tracking-normal">клиентов</span></div>
                  </div>
                </div>
                <div className="grid gap-2.5">
                  <div className="flex items-center gap-3"><span className="w-24 text-[13px] text-muted shrink-0">До робота</span><span className="flex-1 h-3 rounded-full bg-paper overflow-hidden"><span className="block h-full rounded-full bg-[#cfd3df]" style={{ width: "60%" }} /></span></div>
                  <div className="flex items-center gap-3"><span className="w-24 text-[13px] font-semibold shrink-0">С роботом</span><span className="flex-1 h-3 rounded-full bg-paper overflow-hidden flex"><span className="block h-full bg-ink" style={{ width: "60%" }} /><span className="block h-full rounded-r-full bg-mark" style={{ width: "40%" }} /></span></div>
                  <div className="flex justify-end"><span className="rounded-full bg-mark px-3 py-1 text-[13px] font-semibold">+19 клиентов за те же деньги</span></div>
                </div>
              </div>
            </Bezel>

            {/* Мусорные запросы */}
            <Bezel className="md:col-span-5" inner="p-6 flex flex-col gap-4 bg-mark">
              <div>
                <div className="text-[1.25rem] font-semibold tracking-tight leading-snug">Не платит за тех, кто не станет клиентом</div>
                <p className="mt-1.5 text-[14.5px] text-ink/70 leading-relaxed">Люди ищут «маникюр обучение» или «вакансии мастера» — им не нужна запись. Робот убирает такие запросы.</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {["маникюр обучение", "вакансии мастера", "своими руками", "гель-лак купить"].map((q) => <span key={q} className="rounded-full bg-ink/[0.08] px-2.5 py-1 text-[12.5px] line-through decoration-ink/50">{q}</span>)}
              </div>
              <div className="mt-auto flex items-baseline gap-2"><span className="text-3xl font-semibold tracking-tight">3 140 ₽</span><span className="text-[14px] text-ink/70">остались у вас за месяц</span></div>
            </Bezel>

            {/* A/B */}
            <Bezel className="md:col-span-5" inner="p-6 flex flex-col gap-4">
              <div>
                <div className="text-[1.25rem] font-semibold tracking-tight leading-snug">Проверяет, какой текст работает лучше</div>
                <p className="mt-1.5 text-[14.5px] text-muted leading-relaxed">Показывает два варианта объявления и оставляет тот, после которого чаще записываются.</p>
              </div>
              <div className="grid gap-2">
                {[["Маникюр с покрытием — 1 900 ₽", "13 заявок", true], ["Маникюр, который держится 3 недели", "9 заявок", false]].map(([t, r, win]) => (
                  <div key={t as string} className={`flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-3 rounded-xl px-3.5 py-2.5 text-[13.5px] ${win ? "bg-good-soft/70 ring-1 ring-good/25" : "bg-paper text-muted"}`}>
                    <span className="flex-1 min-w-0 sm:truncate">{t as string}</span>
                    <span className={`shrink-0 font-semibold ${win ? "text-good" : ""}`}>{r as string}{win ? " · оставил" : " · выключил"}</span>
                  </div>
                ))}
              </div>
            </Bezel>

            {/* Перенос бюджета */}
            <Bezel className="md:col-span-4" inner="p-6 flex flex-col gap-4">
              <div>
                <div className="text-[1.15rem] font-semibold tracking-tight leading-snug">Переводит деньги туда, где клиенты дешевле</div>
                <p className="mt-1.5 text-[14px] text-muted leading-relaxed">Если во ВКонтакте заявка обходится дешевле, чем в Яндексе, — часть бюджета уходит туда.</p>
              </div>
              <div className="mt-auto grid gap-2 text-[13.5px]">
                {[["Яндекс", "450 ₽ за заявку", "−3 000 ₽", false], ["ВКонтакте", "280 ₽ за заявку", "+3 000 ₽", true]].map(([k, c, d, up]) => (
                  <div key={k as string} className="flex items-center gap-3 rounded-xl bg-paper px-3.5 py-2.5">
                    <span className="flex-1 min-w-0"><span className="block font-semibold">{k as string}</span><span className="block text-muted text-[12.5px]">{c as string}</span></span>
                    <span className={`font-semibold ${up ? "text-good" : "text-bad"}`}>{d as string}</span>
                  </div>
                ))}
              </div>
            </Bezel>

            {/* Запуск */}
            <Bezel className="md:col-span-4" inner="p-6 flex flex-col gap-4">
              <div>
                <div className="text-[1.15rem] font-semibold tracking-tight leading-snug">Запускает рекламу за 15 минут</div>
                <p className="mt-1.5 text-[14px] text-muted leading-relaxed">Вы указываете сайт и бюджет — робот сам пишет объявления, подбирает запросы и настраивает кабинеты.</p>
              </div>
              <div className="mt-auto grid grid-cols-2 gap-2 text-center">
                <div className="rounded-xl bg-paper px-3 py-3"><div className="text-[12px] text-muted">Специалист</div><div className="text-lg font-semibold text-muted line-through decoration-1">5–7 дней</div></div>
                <div className="rounded-xl bg-ink text-white px-3 py-3"><div className="text-[12px] text-white/60">Робот</div><div className="text-lg font-semibold">15 минут</div></div>
              </div>
            </Bezel>

            {/* Лимит */}
            <Bezel className="md:col-span-4" inner="p-6 flex flex-col gap-4 bg-ink text-white">
              <div>
                <div className="text-[1.15rem] font-semibold tracking-tight leading-snug">Не потратит больше, чем вы решили</div>
                <p className="mt-1.5 text-[14px] text-white/60 leading-relaxed">Сказали 15 000 ₽ в месяц — значит, 15 000 ₽. Робот распределяет их по дням и не выходит за лимит.</p>
              </div>
              <div className="mt-auto">
                <div className="flex justify-between text-[12.5px] text-white/60"><span>Потрачено 13 660 ₽</span><span>лимит 15 000 ₽</span></div>
                <div className="mt-2 h-2.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full bg-mark" style={{ width: "91%" }} /></div>
                <div className="mt-2 text-[13px] text-mark font-semibold">Ни рубля сверху</div>
              </div>
            </Bezel>
          </div>
          <p className="mt-5 text-[13px] text-faint">Цифры примерные — у каждого бизнеса свои. Все решения робота видны в кабинете, любое можно отменить.</p>
        </div>
      </section>

      {/* 3. Тёмная глава: как работает */}
      <section id="how" className="relative z-10 -mt-10 rounded-t-[2.5rem] sm:rounded-t-[3.5rem] scroll-mt-20" style={{ background: INK }}>
        <Glow className="top-40 -right-40 w-[40rem] h-[40rem] bg-[radial-gradient(closest-side,rgba(99,102,241,0.14),transparent)]" />
        <div className="relative mx-auto max-w-[72rem] px-4 sm:px-6 py-24 sm:py-32">
          <div className="max-w-2xl">
            <Eyebrow>Как работает</Eyebrow>
            <h2 className="mt-6 text-[2.4rem] sm:text-[4rem] font-semibold tracking-[-0.05em] leading-[0.95]">Три шага — <span className="text-white/40">и дальше без вас.</span></h2>
          </div>
          <ol className="mt-16 grid md:grid-cols-3 gap-4">
            {[
              ["Расскажите о бизнесе", "Услуги, цены, адрес. Есть сайт — заполним анкету по нему.", <div key="s" className="flex items-center gap-2 rounded-xl bg-white/[0.04] ring-1 ring-white/10 px-3 h-11 text-sm"><Search size={15} strokeWidth={1.75} className="text-white/40" />studia-lak.ru<span className="ml-auto rounded-lg bg-mark text-ink px-2.5 py-1 text-xs font-semibold">Заполнить</span></div>],
              ["Подключите кабинеты", "Яндекс Директ и VK Реклама — в пару кликов. Деньги остаются у вас.", <div key="a" className="flex gap-2">{[["Я", "#fc3f1d"], ["VK", "#0077ff"]].map(([l, c]) => <span key={l} className="flex-1 flex items-center gap-2 rounded-xl bg-white/[0.04] ring-1 ring-white/10 px-3 h-11 text-sm"><span className="w-6 h-6 rounded-md grid place-items-center text-[10px] font-bold" style={{ background: c }}>{l}</span><CircleCheck size={15} strokeWidth={1.75} className="ml-auto text-[#3ddc97]" /></span>)}</div>],
              ["Проверьте и запустите", "Посмотрите объявления так, как их увидят люди. Дальше робот работает сам.", <div key="l" className="flex items-center gap-2 rounded-xl bg-mark text-ink px-4 h-11 text-sm font-semibold justify-center"><Sparkles size={15} strokeWidth={1.75} />62 объявления готовы</div>],
            ].map(([t, d, ui], i) => (
              <li key={t as string}>
                <Bezel dark inner="p-6 flex flex-col gap-5 h-full">
                  <div className="flex items-center justify-between"><span className="text-[13px] text-white/40">Шаг {i + 1}</span><span className="text-[13px] text-white/40 flex items-center gap-1.5"><Clock size={13} strokeWidth={1.75} />≈ 5 мин</span></div>
                  <div><div className="text-xl font-semibold tracking-tight">{t as string}</div><p className="mt-2 text-white/55 leading-relaxed">{d as string}</p></div>
                  <div className="mt-auto">{ui as React.ReactNode}</div>
                </Bezel>
              </li>
            ))}
          </ol>

          {/* Что умеет робот — со скринами */}
          <div id="features" className="mt-32 scroll-mt-24">
            <div className="max-w-2xl">
              <Eyebrow>Что умеет робот</Eyebrow>
              <h2 className="mt-6 text-[2.4rem] sm:text-[4rem] font-semibold tracking-[-0.05em] leading-[0.95]">Работа директолога. <span className="text-white/40">Каждый день.</span></h2>
            </div>
            <div className="mt-20 grid gap-28">
              {/* 1. Настройка */}
              <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-12 items-center">
                <div>
                  <span className="text-mark text-sm font-semibold">01 · Запуск</span>
                  <h3 className="mt-4 text-[1.9rem] sm:text-[2.6rem] font-semibold tracking-[-0.045em] leading-[1.02]">Настроит рекламу за 15 минут</h3>
                  <p className="mt-5 text-white/55 text-lg leading-relaxed">Подберёт запросы по услугам и проблемам клиентов, соберёт минус-слова, напишет тексты, сделает картинки под каждый формат и страницу записи, если нет сайта.</p>
                  <ul className="mt-6 grid gap-2.5 text-white/75">{["Поиск, сети Яндекса, ВКонтакте и ретаргетинг", "Аудитории VK: искали услугу, интересы, живут рядом", "Перед запуском — всё так, как увидят люди"].map((x) => <li key={x} className="flex gap-3"><Check size={18} strokeWidth={2} className="text-mark shrink-0 mt-0.5" />{x}</li>)}</ul>
                </div>
                <Bezel dark inner="p-5 sm:p-6 grid gap-4">
                  <div className="flex flex-wrap gap-1.5 text-[12px]">{["Поиск · 36", "Сети · 12", "VK · 9", "Ретаргетинг · 5"].map((t, i) => <span key={t} className={`rounded-full px-3 py-1 ${i === 0 ? "bg-white text-ink font-semibold" : "bg-white/[0.06] text-white/60"}`}>{t}</span>)}</div>
                  <div className="rounded-2xl bg-white text-ink p-4">
                    <div className="flex items-center gap-2 text-[11px] text-muted"><span className="w-3.5 h-3.5 rounded-full bg-paper border border-line" />studia-lak.ru<span className="ml-auto rounded bg-paper px-1.5 py-0.5 text-faint">Реклама</span></div>
                    <div className="mt-1.5 text-[#2a3eb1] text-[17px] font-semibold leading-snug">Маникюр с покрытием — 1 900 ₽, Казань</div>
                    <div className="mt-1 text-sm text-ink-2">Покрытие держится 3–4 недели. Стерилизация в сухожаре. Запишитесь онлайн.</div>
                    <div className="mt-2 flex flex-wrap gap-x-4 text-[13px] text-[#2a3eb1]"><span>Цены</span><span>Педикюр</span><span>Наращивание</span><span>Запись</span></div>
                  </div>
                  <div className="grid grid-cols-3 gap-px rounded-2xl overflow-hidden bg-white/[0.06] text-center">
                    {[["62", "объявления"], ["12", "групп запросов"], ["54", "минус-слова"]].map(([n, t]) => <div key={t} className="bg-[#0d0f26] py-3"><div className="text-2xl font-semibold tracking-tight">{n}</div><div className="text-[11px] text-white/40">{t}</div></div>)}
                  </div>
                </Bezel>
              </div>

              {/* 2. Каждое утро */}
              <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-12 items-center">
                <div className="lg:order-2">
                  <span className="text-mark text-sm font-semibold">02 · Оптимизация</span>
                  <h3 className="mt-4 text-[1.9rem] sm:text-[2.6rem] font-semibold tracking-[-0.045em] leading-[1.02]">Каждое утро разбирает вчерашний день</h3>
                  <p className="mt-5 text-white/55 text-lg leading-relaxed">Выключает слабые объявления, проверяет новые тексты и аудитории, убирает нецелевые запросы. Решения — по накопленной статистике, каждое объяснено и отменяется одной кнопкой.</p>
                </div>
                <Bezel dark inner="p-5 sm:p-6" className="lg:order-1">
                  <div className="flex items-center justify-between mb-4"><span className="font-semibold">История решений</span><span className="rounded-full bg-white/[0.06] px-3 py-1 text-[12px] text-white/60">сегодня</span></div>
                  <ul className="relative grid gap-4 before:absolute before:left-[15px] before:top-3 before:bottom-3 before:w-px before:bg-white/10">
                    {[
                      [Search, "Добавил 6 минус-слов", "«своими руками», «вакансии», «обучение»…", "09:04"],
                      [PauseCircle, "Выключил слабое объявление", "его кликали в 3 раза реже соседних", "09:07"],
                      [Scale, "Бюджет: −10% сети, +10% поиск", "в поиске обращение на 40% дешевле", "09:11"],
                      [FlaskConical, "A/B-тест аудиторий VK", "«искали услугу» против «интересы: красота»", "09:15"],
                    ].map(([I, t, s, time], i) => {
                      const Icon = I as typeof Search;
                      return (
                        <li key={t as string} className="relative flex gap-4">
                          <span className={`relative z-10 w-8 h-8 rounded-full grid place-items-center shrink-0 ${i === 0 ? "bg-mark text-ink" : "bg-[#151838] ring-1 ring-white/10 text-white/70"}`}><Icon size={15} strokeWidth={1.75} /></span>
                          <div className="min-w-0 flex-1"><div className="font-medium">{t as string}</div><div className="text-sm text-white/45">{s as string}</div></div>
                          <div className="text-right shrink-0"><div className="text-[11px] text-white/30 tabular-nums">{time as string}</div><div className="text-[11px] text-white/45 flex items-center gap-1 mt-1"><Undo2 size={11} strokeWidth={1.75} />отменить</div></div>
                        </li>
                      );
                    })}
                  </ul>
                </Bezel>
              </div>

              {/* 3. Бюджет */}
              <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-12 items-center">
                <div>
                  <span className="text-mark text-sm font-semibold">03 · Бюджет</span>
                  <h3 className="mt-4 text-[1.9rem] sm:text-[2.6rem] font-semibold tracking-[-0.045em] leading-[1.02]">Каждый рубль — туда, где он работает</h3>
                  <p className="mt-5 text-white/55 text-lg leading-relaxed">Деньги перетекают в каналы, где обращение дешевле. Бюджет лежит в ваших кабинетах, месячный лимит — жёсткая граница, а всю рекламу можно остановить одной кнопкой.</p>
                </div>
                <Bezel dark inner="p-5 sm:p-6 grid gap-5">
                  <div>
                    <div className="flex justify-between text-sm"><span className="text-white/50">Потрачено в октябре</span><span className="font-semibold tabular-nums">41 200 из 70 000 ₽</span></div>
                    <div className="mt-2 h-2.5 rounded-full bg-white/[0.06] overflow-hidden"><div className="h-full w-[59%] rounded-full bg-[linear-gradient(90deg,#fff,rgba(255,255,255,0.7))]" /></div>
                    <div className="mt-1.5 text-[12px] text-white/40">Прогноз на конец месяца — 68 900 ₽, в пределах лимита</div>
                  </div>
                  <div className="grid gap-2.5">
                    {[["Поиск Яндекса", 38, "390 ₽", "+10%"], ["ВКонтакте", 27, "410 ₽", "+15%"], ["Сети Яндекса", 22, "620 ₽", "−20%"], ["Ретаргетинг", 13, "280 ₽", ""]].map(([n, w, c, d]) => (
                      <div key={n as string} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3 text-sm">
                        <span className="text-white/80 truncate">{n as string}</span>
                        <span className="h-2 rounded-full bg-white/[0.06] overflow-hidden"><span className="block h-full rounded-full bg-mark shadow-[0_0_10px_rgba(255,216,74,0.5)]" style={{ width: `${(w as number) * 2.4}%` }} /></span>
                        <span className="flex items-center gap-2 tabular-nums"><span className="text-white/40 text-xs">{c as string}</span>{d ? <span className={`text-[11px] font-semibold w-9 text-right ${(d as string).startsWith("+") ? "text-[#3ddc97]" : "text-[#ff7a7a]"}`}>{d as string}</span> : <span className="w-9" />}</span>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-xl ring-1 ring-[#ff7a7a]/30 text-[#ff9a9a] text-center py-2.5 text-sm font-semibold">Остановить всю рекламу</div>
                </Bezel>
              </div>

              {/* 4. Тексты */}
              <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-12 items-center">
                <div className="lg:order-2">
                  <span className="text-mark text-sm font-semibold">04 · Тексты</span>
                  <h3 className="mt-4 text-[1.9rem] sm:text-[2.6rem] font-semibold tracking-[-0.045em] leading-[1.02]">Перепишет объявления по одной фразе</h3>
                  <p className="mt-5 text-white/55 text-lg leading-relaxed">Не нравятся тексты — напишите, какими они должны быть. Робот перепишет все объявления канала и сохранит прежние. В текстах — только факты о вашем бизнесе, без выдуманных скидок и «лучших мастеров».</p>
                </div>
                <Bezel dark inner="p-5 sm:p-6 grid gap-4" className="lg:order-1">
                  <div className="font-semibold">Переписать тексты — ВКонтакте</div>
                  <div className="rounded-xl ring-2 ring-white/80 bg-white/[0.03] px-4 py-3 text-[15px]">Живее и больше про цену<span className="inline-block w-px h-4 bg-white align-middle ml-0.5 animate-pulse" /></div>
                  <div className="flex flex-wrap gap-1.5">{["Короче", "Понятнее, что за услуга", "Без канцелярита"].map((x) => <span key={x} className="rounded-full ring-1 ring-white/15 px-3 py-1 text-[13px] text-white/70">{x}</span>)}</div>
                  <div className="grid gap-1.5"><div className="text-[12px] text-white/40">Переписываем… 6 из 9</div><div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden"><div className="h-full w-2/3 bg-mark" /></div></div>
                  <div className="flex justify-end"><span className="rounded-full bg-mark text-ink px-4 py-2 text-sm font-semibold flex items-center gap-2"><Sparkles size={14} strokeWidth={1.75} />Переписать</span></div>
                </Bezel>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Светлый лист: сравнение и ниши */}
      <section id="compare" className="relative z-10 -mt-10 bg-white text-ink rounded-t-[2.5rem] sm:rounded-t-[3.5rem] scroll-mt-20">
        <div className="mx-auto max-w-[72rem] px-4 sm:px-6 py-24 sm:py-32">
          <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-8 items-end">
            <div>
              <Eyebrow dark={false}>Сравнение</Eyebrow>
              <h2 className="mt-6 text-[2.4rem] sm:text-[4rem] font-semibold tracking-[-0.05em] leading-[0.95]">Не агентство.<br /><span className="text-ink/35">Не «настрою сам».</span></h2>
            </div>
            <p className="text-lg text-ink-2 leading-relaxed lg:pb-2">Работа специалиста каждый день — без процента от бюджета и без вечеров в кабинете Директа.</p>
          </div>
          <div className="mt-14 grid md:grid-cols-3 gap-4 items-stretch">
            {[
              { t: "Агентство", items: ["Запуск за 1–2 недели", "Оптимизация раз в неделю или месяц", "Фикс плюс процент от бюджета", "Отчёт, если попросить"] },
              { t: "Сами в кабинете", items: ["Нужно разбираться в настройках", "Оптимизация — когда дойдут руки", "Легко слить бюджет на мусор", "Без отчётов"] },
            ].map((c) => (
              <Bezel key={c.t} inner="p-7">
                <div className="text-lg font-semibold text-ink/60">{c.t}</div>
                <ul className="mt-6 grid gap-3.5 text-ink-2">{c.items.map((x) => <li key={x} className="flex gap-3"><X size={18} strokeWidth={1.5} className="text-faint shrink-0 mt-0.5" />{x}</li>)}</ul>
              </Bezel>
            ))}
            <Bezel inner="p-7 bg-ink text-white relative overflow-hidden">
              <Glow className="-top-20 -right-20 w-60 h-60 bg-[radial-gradient(closest-side,rgba(255,216,74,0.35),transparent)]" />
              <div className="relative flex items-center justify-between"><span className="text-lg font-semibold">Самоход</span><span className="rounded-full bg-mark text-ink text-[11px] font-bold px-2.5 py-0.5">наш вариант</span></div>
              <ul className="relative mt-6 grid gap-3.5 text-white/85">{["Запуск за 15 минут", "Оптимизация каждый день", "Бюджет не выходит за лимит", "Объяснение к каждому решению"].map((x) => <li key={x} className="flex gap-3"><Check size={18} strokeWidth={2} className="text-mark shrink-0 mt-0.5" />{x}</li>)}</ul>
            </Bezel>
          </div>

          <div className="mt-24 grid lg:grid-cols-[0.8fr_1.2fr] gap-10 items-center">
            <div>
              <h3 className="text-[2rem] sm:text-[2.8rem] font-semibold tracking-[-0.045em] leading-[1]">Для бизнеса, который живёт записью</h3>
              <p className="mt-4 text-ink-2 text-lg leading-relaxed">Робот знает, как ищут каждую услугу и какие запросы нецелевые, и подстраивается под ваш прайс.</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {([[Hand, "Маникюр и брови"], [Scissors, "Парикмахерские"], [Flower2, "Массаж и SPA"], [Stethoscope, "Остеопатия, косметология"], [Dumbbell, "Йога и фитнес"], [Music, "Танцы"]] as const).map(([I, t]) => (
                <Bezel key={t} inner="px-4 py-5 flex flex-col gap-3"><I size={22} strokeWidth={1.5} className="text-ink-2" /><span className="text-[15px] font-medium leading-snug">{t}</span></Bezel>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 5. Тёмная глава: вопросы и финал */}
      <section id="faq" className="relative z-10 -mt-10 rounded-t-[2.5rem] sm:rounded-t-[3.5rem] scroll-mt-20" style={{ background: INK }}>
        <Glow className="top-20 left-1/2 -translate-x-1/2 w-[60rem] h-[30rem] bg-[radial-gradient(closest-side,rgba(99,102,241,0.12),transparent)]" />
        <div className="relative mx-auto max-w-[72rem] px-4 sm:px-6 py-24 sm:py-32">
          <div className="text-center">
            <Eyebrow>Вопросы</Eyebrow>
            <h2 className="mt-6 text-[2.4rem] sm:text-[4rem] font-semibold tracking-[-0.05em] leading-[0.95]">Что обычно спрашивают</h2>
          </div>
          <div className="mt-14 grid md:grid-cols-2 gap-4">
            {FAQ.map(([q, a]) => (
              <Bezel key={q} dark inner="p-6 sm:p-7">
                <h3 className="text-lg font-semibold tracking-tight">{q}</h3>
                <p className="mt-3 text-white/55 leading-relaxed">{a}</p>
              </Bezel>
            ))}
          </div>

          <div className="relative mt-28 rounded-[2.5rem] overflow-hidden ring-1 ring-white/10 bg-[#0d0f26] px-6 py-16 sm:px-16 sm:py-24 text-center">
            <Glow className="-bottom-40 left-1/2 -translate-x-1/2 w-[50rem] h-[30rem] bg-[radial-gradient(closest-side,rgba(255,216,74,0.25),transparent)]" />
            <div className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_bottom,black_10%,transparent_70%)]" aria-hidden />
            <h2 className="relative text-[2.4rem] sm:text-[4.4rem] font-semibold tracking-[-0.055em] leading-[0.95] bg-[linear-gradient(180deg,#fff_35%,rgba(255,255,255,0.55))] bg-clip-text text-transparent">Отдайте рутину роботу</h2>
            <p className="relative mt-6 mx-auto max-w-xl text-lg text-white/60">Запуск — 15 минут. Дальше сервис сам ведёт рекламу и бережёт ваш бюджет.</p>
            <div className="relative mt-10 flex justify-center"><Cta href={cta.href}>{cta.text}</Cta></div>
          </div>
        </div>

        <footer className="relative mx-auto max-w-[72rem] px-4 sm:px-6 py-10 border-t border-white/[0.06] flex flex-wrap gap-x-8 gap-y-4 justify-between items-center text-sm text-white/40">
          <span className="flex items-center gap-2 text-white/70 font-semibold"><LogoMark size={20} />Самоход</span>
          <span className="max-w-xl">Работаем напрямую через API Яндекс Директа и VK Рекламы. Маркировку рекламы площадки делают автоматически.</span>
          <Link href="/privacy" className="hover:text-white/70 underline underline-offset-4 decoration-white/20">Политика конфиденциальности</Link>
        </footer>
      </section>
    </main>
  );
}

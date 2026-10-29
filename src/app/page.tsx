import Link from "next/link";
import {
  Ban, Check, ChevronDown, CircleCheck, Clock, FlaskConical, MousePointer2, PauseCircle, Pencil, RotateCcw, Scale, Search, ShieldCheck,
  Sparkles, TrendingDown, Undo2, X,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { getUser } from "@/lib/auth";

/**
 * Лендинг «Полного зала» — «Пульт»: продукт в центре.
 * Главный смысл: мы автоматизируем работу с рекламой, делаем её простой, а бюджет — эффективным.
 * Иллюстрации — живые куски интерфейса сервиса; жёлтый только там, где деньги и результат.
 */

const BARS = [24, 31, 27, 40, 36, 49, 45, 57, 52, 63, 60, 69, 66, 78];

const ROUTINE = [
  "Подбор поисковых запросов", "Минус-слова", "Тексты и заголовки", "Картинки под форматы", "Аудитории VK", "A/B-тесты",
  "Ставки и корректировки", "Расписание показов", "Перенос бюджета", "Отчёты", "Ответы модерации", "Ретаргетинг",
];

const FAQ = [
  ["Нужен ли опыт в рекламе?", "Нет. Вы рассказываете о бизнесе и выбираете бюджет — настройку, запуск и оптимизацию сервис делает сам. Перед запуском всё можно посмотреть и поправить."],
  ["Чьи деньги и кто платит площадкам?", "Рекламный бюджет лежит в ваших кабинетах Яндекс Директа и VK Рекламы, пополняете их вы. Сервис подключается по доступу, который можно отозвать в любой момент."],
  ["Как робот экономит бюджет?", "Не платит за нецелевые запросы, выключает объявления, которые кликают реже соседних, и переносит деньги в каналы и аудитории, где обращение дешевле. Месячный лимит он не превышает никогда."],
  ["Можно ли вмешаться в работу робота?", "Да. Любое решение отменяется одной кнопкой, тексты можно править вручную или попросить робота переписать их по вашему пожеланию. Всю рекламу можно остановить разом."],
  ["А если у меня нет сайта?", "Сервис сделает страницу записи с формой и кнопками мессенджеров. Вести рекламу можно и на свой сайт, и в Telegram или WhatsApp."],
  ["Для каких бизнесов подходит?", "Для локального бизнеса услуг: салоны и студии красоты, барбершопы, массаж, косметология, остеопатия, фитнес, йога, танцы. Для медицинских услуг объявления пишутся по правилам закона о рекламе."],
] as const;

/* ─── Кусочки интерфейса ─────────────────────────────────────────── */

function Window({ children, url = "polny-zal.ru/app", className = "" }: { children: React.ReactNode; url?: string; className?: string }) {
  return (
    <div className={`min-w-0 rounded-2xl bg-white border border-line shadow-[0_40px_80px_-40px_rgba(29,32,69,0.4)] overflow-hidden ${className}`}>
      <div className="h-9 bg-paper border-b border-line flex items-center gap-1.5 px-3.5">
        <span className="w-2.5 h-2.5 rounded-full bg-[#ff6159]" /><span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" /><span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
        <span className="mx-auto text-[11px] text-faint bg-white border border-line rounded-md px-3 py-0.5">{url}</span>
      </div>
      {children}
    </div>
  );
}

function Ring({ value }: { value: number }) {
  const r = 17, c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 44 44" className="w-11 h-11 -rotate-90" aria-hidden>
      <circle cx="22" cy="22" r={r} fill="none" stroke="var(--color-line)" strokeWidth="5" />
      <circle cx="22" cy="22" r={r} fill="none" stroke="var(--color-good)" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(value / 100) * c} ${c}`} />
    </svg>
  );
}

function Dashboard() {
  return (
    <div className="relative min-w-0">
      <Window>
        <div className="p-4 sm:p-5 grid grid-cols-[minmax(0,1fr)] gap-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-bold truncate">Студия «Лак» · Казань</div>
              <div className="text-xs text-good flex items-center gap-1.5"><span className="relative flex w-1.5 h-1.5"><span className="absolute inset-0 rounded-full bg-good animate-ping opacity-60" /><span className="relative w-1.5 h-1.5 rounded-full bg-good" /></span> Реклама идёт · 5 каналов</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="relative grid place-items-center"><Ring value={86} /><span className="absolute text-[11px] font-extrabold">86</span></div>
              <div className="hidden sm:block text-[11px] leading-tight text-muted">здоровье<br />рекламы</div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { k: "Бюджет за 14 дней", v: "24 960 ₽", s: "из 32 600 ₽" },
              { k: "Сэкономлено", v: "3 140 ₽", s: "на мусорных кликах", tone: "mark" },
              { k: "Обращения", v: "58", s: "+12 к прошлым" },
              { k: "Цена обращения", v: "430 ₽", s: "−28% со старта", good: true },
            ].map((x) => (
              <div key={x.k} className={`rounded-xl px-3 py-2.5 ${x.tone === "mark" ? "bg-mark" : "bg-paper"}`}>
                <div className="text-[10.5px] text-muted leading-tight">{x.k}</div>
                <div className="text-lg font-extrabold tracking-tight mt-0.5">{x.v}</div>
                <div className={`text-[10.5px] ${x.good ? "text-good font-semibold" : x.tone === "mark" ? "text-ink-2" : "text-faint"}`}>{x.s}</div>
              </div>
            ))}
          </div>

          <div>
            <div className="flex items-center justify-between text-[11px] text-muted mb-1.5">
              <span>Цена обращения по дням</span>
              <span className="flex items-center gap-3"><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-line-2" />до робота</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-ink" />с роботом</span></span>
            </div>
            <div className="flex items-end gap-1 h-20 border-b border-line">
              {BARS.map((h, i) => <div key={i} className={`lp-bar flex-1 rounded-t-[3px] ${i >= 9 ? "bg-ink" : "bg-line-2"}`} style={{ height: `${100 - h + 18}%`, animationDelay: `${150 + i * 45}ms` }} />)}
            </div>
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
            {[
              [Ban, "Минус-слово «обучение»", "14 кликов без обращений", "09:12"],
              [Scale, "+15% бюджета во ВКонтакте", "обращение там дешевле", "09:13"],
              [FlaskConical, "Тест заголовка с ценой", "идёт 3-й день", "09:13"],
            ].map(([I, t, s, time]) => {
              const Icon = I as typeof Ban;
              return (
                <div key={t as string} className="flex items-center gap-2.5 rounded-lg border border-line px-3 py-2 text-[13px]">
                  <span className="w-6 h-6 rounded-md bg-paper grid place-items-center shrink-0"><Icon size={13} /></span>
                  <span className="flex-1 min-w-0 truncate"><b className="font-semibold">{t as string}</b> <span className="text-muted">— {s as string}</span></span>
                  <span className="hidden sm:inline text-faint text-[11px] tabular-nums">{time as string}</span>
                  <span className="text-ink-2 text-[11px] flex items-center gap-1 shrink-0"><Undo2 size={11} /> отменить</span>
                </div>
              );
            })}
          </div>
        </div>
      </Window>

      {/* Всплывающие акценты */}
      <div className="lp-pop hidden md:flex absolute -left-10 top-[56%] items-center gap-2.5 rounded-xl bg-ink text-white pl-2.5 pr-3.5 py-2 shadow-xl" style={{ animationDelay: "900ms" }}>
        <span className="w-7 h-7 rounded-lg bg-mark text-ink grid place-items-center"><TrendingDown size={15} /></span>
        <div className="leading-tight"><div className="text-[11px] text-white/70">сэкономлено за неделю</div><div className="font-bold text-sm">−460 ₽ на мусорных кликах</div></div>
      </div>
      <div className="lp-pop hidden md:flex absolute -right-5 -bottom-5 items-center gap-2 rounded-xl bg-white border border-line pl-2.5 pr-3.5 py-2 shadow-xl" style={{ animationDelay: "1300ms" }}>
        <CircleCheck size={18} className="text-good" />
        <div className="leading-tight"><div className="text-[11px] text-muted">A/B-тест завершён</div><div className="font-bold text-sm">Вариант Б: +34% обращений</div></div>
      </div>
    </div>
  );
}

function Tag({ children, tone = "paper" }: { children: React.ReactNode; tone?: "paper" | "good" | "mark" | "bad" }) {
  const c = { paper: "bg-paper text-ink-2", good: "bg-good-soft text-good", mark: "bg-mark-soft text-ink", bad: "bg-bad-soft text-bad" }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${c}`}>{children}</span>;
}

/* ─── Страница ───────────────────────────────────────────────────── */

export default async function Home() {
  const user = await getUser();
  const cta = user ? { href: "/app", text: "Открыть кабинет" } : { href: "/login?tab=register", text: "Запустить рекламу" };
  return (
    <main className="min-h-dvh bg-white text-ink overflow-x-clip">
      <header className="sticky top-0 z-40 bg-white/85 backdrop-blur border-b border-line/70">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Logo />
          <nav className="hidden md:flex items-center gap-7 text-sm text-ink-2">
            <a href="#features" className="hover:text-ink">Возможности</a>
            <a href="#how" className="hover:text-ink">Как начать</a>
            <a href="#compare" className="hover:text-ink">Сравнение</a>
            <a href="#faq" className="hover:text-ink">Вопросы</a>
          </nav>
          <div className="flex items-center gap-2">
            {user ? null : <Link href="/login" className="hidden sm:inline-flex btn btn-ghost btn-sm border-transparent">Войти</Link>}
            <Link href={cta.href} className="btn btn-primary btn-sm">{user ? "Кабинет" : "Начать"}</Link>
          </div>
        </div>
      </header>

      {/* Первый экран */}
      <section className="relative">
        <div className="absolute inset-x-0 top-0 h-[34rem] lp-dots [mask-image:linear-gradient(to_bottom,black,transparent)] pointer-events-none" aria-hidden />
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 pt-10 sm:pt-20 pb-20 sm:pb-28 grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[0.92fr_1.08fr] gap-14 items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-line bg-white pl-1.5 pr-3 py-1 text-[13px] text-ink-2 shadow-sm">
              <span className="flex -space-x-1"><span className="w-5 h-5 rounded-full bg-[#fc3f1d] ring-2 ring-white" /><span className="w-5 h-5 rounded-full bg-[#0077ff] ring-2 ring-white" /></span>
              Яндекс Директ и VK Реклама
            </div>
            <h1 className="mt-5 text-[2.6rem] sm:text-[3.9rem] font-extrabold tracking-[-0.04em] leading-[1.0]">Реклама в&nbsp;Яндексе и&nbsp;VK на&nbsp;автопилоте</h1>
            <p className="mt-6 text-lg sm:text-[1.3rem] text-ink-2 leading-relaxed max-w-[33rem]">Сервис делает работу директолога: настраивает, запускает и каждый день оптимизирует рекламу. Вам не нужно разбираться в кабинетах, а каждый рубль бюджета работает на результат.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={cta.href} className="btn btn-primary h-12 px-6 text-base">{cta.text}</Link>
              <Link href="/login?demo=1" className="btn btn-ghost h-12 px-6 text-base">Демо без регистрации</Link>
            </div>
            <dl className="mt-10 grid grid-cols-3 gap-4 max-w-md">
              {[["15 мин", "на запуск"], ["5 каналов", "из одного окна"], ["0 ₽", "сверх лимита"]].map(([v, k]) => (
                <div key={k} className="border-l-2 border-mark pl-3">
                  <dt className="text-2xl font-extrabold tracking-tight">{v}</dt>
                  <dd className="text-[13px] text-muted leading-snug">{k}</dd>
                </div>
              ))}
            </dl>
          </div>
          <Dashboard />
        </div>
      </section>

      {/* Рутина, которую забирает робот */}
      <section className="border-y border-line bg-paper">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-14 grid lg:grid-cols-[18rem_1fr] gap-8 items-center">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight leading-snug">Вся рутина — на роботе</h2>
            <p className="mt-2 text-muted leading-relaxed">То, на что у специалиста уходят часы каждую неделю.</p>
          </div>
          <ul className="flex flex-wrap gap-2">
            {ROUTINE.map((r) => (
              <li key={r} className="inline-flex items-center gap-1.5 rounded-full bg-white border border-line pl-2 pr-3.5 py-1.5 text-[0.95rem]">
                <span className="w-5 h-5 rounded-full bg-ink text-white grid place-items-center"><Check size={12} strokeWidth={3} /></span>{r}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Возможности */}
      <section id="features" className="scroll-mt-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-20 sm:py-28 grid gap-24 sm:gap-32">
          {/* 1 */}
          <div className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-2 gap-10 lg:gap-16 items-center">
            <div>
              <Tag tone="mark"><Clock size={12} /> 15 минут</Tag>
              <h2 className="mt-4 text-3xl sm:text-[2.6rem] font-extrabold tracking-[-0.03em] leading-[1.08]">Настроит рекламу за вас</h2>
              <p className="mt-4 text-lg text-ink-2 leading-relaxed max-w-md">Расскажите об услугах и ценах — сервис подберёт запросы, минус-слова, напишет тексты, сделает картинки под каждый формат и страницу записи, если нет сайта.</p>
              <ul className="mt-6 grid gap-2 text-ink-2">
                {["Запросы по услугам, проблемам клиентов и смежным темам", "Аудитории VK: искали услугу, интересы, живут рядом", "Перед запуском — всё так, как увидят люди"].map((x) => <li key={x} className="flex gap-2.5"><Check size={18} className="text-good shrink-0 mt-0.5" />{x}</li>)}
              </ul>
            </div>
            <Window url="polny-zal.ru/app/launch">
              <div className="p-4 sm:p-5 grid grid-cols-[minmax(0,1fr)] gap-3">
                <div className="flex flex-wrap gap-1.5">
                  <Tag>Поиск · 36</Tag><Tag>Сети · 12</Tag><Tag>VK · 9</Tag><Tag>Ретаргетинг · 5</Tag>
                </div>
                <div className="rounded-xl border border-line p-3.5">
                  <div className="flex items-center gap-2 text-[11px] text-muted"><span className="w-3.5 h-3.5 rounded-full bg-paper border border-line" />studia-lak.ru <span className="ml-auto rounded bg-paper px-1.5 py-0.5 text-faint">Реклама</span></div>
                  <div className="mt-1.5 text-[#2a3eb1] text-[17px] font-semibold leading-snug">Маникюр с покрытием — 1 900 ₽, Казань</div>
                  <div className="mt-1 text-sm text-ink-2">Покрытие держится 3–4 недели. Стерилизация в сухожаре. Запишитесь онлайн.</div>
                  <div className="mt-2 flex flex-wrap gap-x-4 text-[13px] text-[#2a3eb1]"><span>Цены</span><span>Педикюр</span><span>Наращивание</span><span>Запись</span></div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[["62", "объявления"], ["12", "групп запросов"], ["54", "минус-слова"]].map(([n, t]) => (
                    <div key={t} className="rounded-lg bg-paper py-2"><div className="font-extrabold text-lg">{n}</div><div className="text-[11px] text-muted">{t}</div></div>
                  ))}
                </div>
              </div>
            </Window>
          </div>

          {/* 2 */}
          <div className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-2 gap-10 lg:gap-16 items-center">
            <div className="md:order-2">
              <Tag tone="good"><RotateCcw size={12} /> каждый день</Tag>
              <h2 className="mt-4 text-3xl sm:text-[2.6rem] font-extrabold tracking-[-0.03em] leading-[1.08]">Оптимизирует, пока вы работаете</h2>
              <p className="mt-4 text-lg text-ink-2 leading-relaxed max-w-md">Каждое утро робот разбирает статистику: выключает слабые объявления, проверяет новые тексты и аудитории, убирает нецелевые запросы. Решения — только по накопленным данным.</p>
              <p className="mt-4 text-sm text-muted flex items-center gap-2"><Undo2 size={15} /> Любое решение отменяется одной кнопкой</p>
            </div>
            <Window url="polny-zal.ru/app/history" className="md:order-1">
              <div className="p-4 sm:p-5">
                <div className="flex items-center justify-between mb-3"><span className="font-bold">История решений</span><Tag>сегодня</Tag></div>
                <ul className="relative grid gap-3 before:absolute before:left-[15px] before:top-2 before:bottom-2 before:w-px before:bg-line">
                  {[
                    [PauseCircle, "Выключено слабое объявление", "Его кликали в 3 раза реже соседних в группе", "bad"],
                    [FlaskConical, "A/B-тест аудиторий VK", "«Искали услугу» против «Интересы: красота»", "paper"],
                    [Scale, "Бюджет: −10% сети, +10% поиск", "В поиске обращение на 40% дешевле", "good"],
                    [Search, "Добавлено 6 минус-слов", "«своими руками», «вакансии», «обучение»…", "paper"],
                  ].map(([I, t, s, tone]) => {
                    const Icon = I as typeof Ban;
                    const bg = tone === "bad" ? "bg-bad-soft text-bad" : tone === "good" ? "bg-good-soft text-good" : "bg-paper text-ink-2";
                    return (
                      <li key={t as string} className="relative flex gap-3">
                        <span className={`relative z-10 w-8 h-8 rounded-lg grid place-items-center shrink-0 ${bg}`}><Icon size={15} /></span>
                        <div className="min-w-0 flex-1 pb-0.5">
                          <div className="font-semibold leading-snug">{t as string}</div>
                          <div className="text-sm text-muted">{s as string}</div>
                        </div>
                        <span className="text-[11px] text-ink-2 flex items-center gap-1 self-start mt-1"><Undo2 size={11} /> отменить</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </Window>
          </div>

          {/* 3 */}
          <div className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-2 gap-10 lg:gap-16 items-center">
            <div>
              <Tag tone="mark"><ShieldCheck size={12} /> бюджет</Tag>
              <h2 className="mt-4 text-3xl sm:text-[2.6rem] font-extrabold tracking-[-0.03em] leading-[1.08]">Каждый рубль — туда, где он работает</h2>
              <p className="mt-4 text-lg text-ink-2 leading-relaxed max-w-md">Бюджет перетекает в каналы, где обращение дешевле. Деньги лежат в ваших кабинетах, а месячный лимит — жёсткая граница: робот её не переходит.</p>
            </div>
            <Window url="polny-zal.ru/app/budget">
              <div className="p-4 sm:p-5 grid grid-cols-[minmax(0,1fr)] gap-4">
                <div>
                  <div className="flex justify-between text-sm"><span className="text-muted">Потрачено в октябре</span><span className="font-semibold tabular-nums">41 200 из 70 000 ₽</span></div>
                  <div className="mt-2 h-2.5 rounded-full bg-paper overflow-hidden"><div className="h-full w-[59%] bg-ink rounded-full" /></div>
                  <div className="mt-1.5 text-[11px] text-muted">Прогноз на конец месяца — 68 900 ₽, в пределах лимита</div>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
                  {[["Поиск Яндекса", 38, "390 ₽", "+10%"], ["ВКонтакте", 27, "410 ₽", "+15%"], ["Сети Яндекса", 22, "620 ₽", "−20%"], ["Ретаргетинг", 13, "280 ₽", ""]].map(([n, w, c, d]) => (
                    <div key={n as string} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3 text-sm">
                      <span className="truncate">{n as string}</span>
                      <span className="h-2 rounded-full bg-paper overflow-hidden"><span className="block h-full rounded-full bg-mark" style={{ width: `${(w as number) * 2.4}%` }} /></span>
                      <span className="flex items-center gap-2 tabular-nums"><span className="text-muted text-xs">{c as string}</span>{d ? <span className={`text-[11px] font-semibold ${(d as string).startsWith("+") ? "text-good" : "text-bad"}`}>{d as string}</span> : <span className="w-7" />}</span>
                    </div>
                  ))}
                </div>
                <button type="button" className="w-full rounded-xl border border-bad/30 text-bad font-semibold py-2.5 text-sm">Остановить всю рекламу</button>
              </div>
            </Window>
          </div>

          {/* 4 */}
          <div className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-2 gap-10 lg:gap-16 items-center">
            <div className="md:order-2">
              <Tag><Pencil size={12} /> тексты</Tag>
              <h2 className="mt-4 text-3xl sm:text-[2.6rem] font-extrabold tracking-[-0.03em] leading-[1.08]">Перепишет тексты по одной фразе</h2>
              <p className="mt-4 text-lg text-ink-2 leading-relaxed max-w-md">Не нравятся объявления — напишите, какими они должны быть. Робот перепишет все тексты канала, а прежние сохранит. В объявлениях — только факты о вашем бизнесе, без выдуманных скидок и «лучших мастеров».</p>
            </div>
            <Window url="polny-zal.ru/app/launch" className="md:order-1">
              <div className="p-4 sm:p-5 grid grid-cols-[minmax(0,1fr)] gap-3">
                <div className="font-bold">Переписать тексты — ВКонтакте</div>
                <div className="rounded-xl border-2 border-ink px-3.5 py-3 text-[15px] relative">Живее и больше про цену<span className="inline-block w-px h-4 bg-ink align-middle ml-0.5 animate-pulse" /></div>
                <div className="flex flex-wrap gap-1.5">
                  {["Короче", "Понятнее, что за услуга", "Без канцелярита"].map((x) => <span key={x} className="rounded-full border border-line px-3 py-1 text-[13px]">{x}</span>)}
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
                  <div className="text-[11px] text-muted">Переписываем… 6 из 9</div>
                  <div className="h-1.5 rounded-full bg-paper overflow-hidden"><div className="h-full w-2/3 bg-ink" /></div>
                </div>
                <div className="flex justify-end"><span className="relative btn btn-primary btn-sm"><Sparkles size={14} /> Переписать<MousePointer2 size={18} className="absolute -right-2 -bottom-3 fill-white text-ink" /></span></div>
              </div>
            </Window>
          </div>
        </div>
      </section>

      {/* Как начать */}
      <section id="how" className="bg-paper border-y border-line scroll-mt-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-20 sm:py-24">
          <h2 className="text-3xl sm:text-[2.6rem] font-extrabold tracking-[-0.03em] leading-tight">Три шага — и реклама работает сама</h2>
          <ol className="mt-12 grid md:grid-cols-3 gap-6 relative">
            <span className="hidden md:block absolute left-[16%] right-[16%] top-5 h-px border-t-2 border-dashed border-line-2" aria-hidden />
            {[
              ["Расскажите о бизнесе", "Услуги, цены, адрес. Есть сайт — заполним анкету по нему.", "≈ 5 минут"],
              ["Подключите кабинеты", "Яндекс Директ и VK Реклама — в пару кликов. Выберите бюджет на месяц.", "≈ 5 минут"],
              ["Проверьте и запустите", "Посмотрите объявления, поправьте что хотите — дальше робот работает сам.", "≈ 5 минут"],
            ].map(([t, d, time], i) => (
              <li key={t} className="relative rounded-2xl bg-white border border-line p-5">
                <span className="relative z-10 w-10 h-10 rounded-full bg-ink text-white font-extrabold grid place-items-center">{i + 1}</span>
                <div className="mt-4 font-bold text-lg">{t}</div>
                <p className="mt-1.5 text-ink-2 leading-relaxed">{d}</p>
                <div className="mt-4 text-[13px] text-muted flex items-center gap-1.5"><Clock size={13} /> {time}</div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Сравнение */}
      <section id="compare" className="scroll-mt-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-20 sm:py-28">
          <h2 className="text-3xl sm:text-[2.6rem] font-extrabold tracking-[-0.03em] leading-tight max-w-[22ch]">Почему не агентство и не «настрою сам»</h2>
          <div className="mt-10 grid md:grid-cols-3 gap-4">
            {[
              { t: "Агентство", items: [["Запуск за 1–2 недели", false], ["Оптимизация раз в неделю или месяц", false], ["Фикс плюс процент от бюджета", false], ["Отчёт, если попросить", false]] },
              { t: "Сами в кабинете", items: [["Нужно разбираться в настройках", false], ["Оптимизация — когда дойдут руки", false], ["Легко слить бюджет на мусор", false], ["Без отчётов", false]] },
              { t: "Полный зал", us: true, items: [["Запуск за 15 минут", true], ["Оптимизация каждый день", true], ["Бюджет не выходит за лимит", true], ["Объяснение к каждому решению", true]] },
            ].map((col) => (
              <div key={col.t} className={`rounded-2xl p-6 ${col.us ? "bg-ink text-white shadow-[0_30px_60px_-30px_rgba(29,32,69,0.6)] md:-translate-y-2" : "border border-line"}`}>
                <div className="flex items-center justify-between">
                  <div className="font-extrabold text-lg">{col.t}</div>
                  {col.us ? <span className="rounded-full bg-mark text-ink text-[11px] font-bold px-2.5 py-0.5">наш вариант</span> : null}
                </div>
                <ul className="mt-5 grid gap-3">
                  {col.items.map(([x, ok]) => (
                    <li key={x as string} className={`flex gap-2.5 ${col.us ? "text-white/90" : "text-ink-2"}`}>
                      {ok ? <Check size={18} className="text-mark shrink-0 mt-0.5" /> : <X size={18} className="text-faint shrink-0 mt-0.5" />}{x as string}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="bg-paper border-t border-line scroll-mt-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-20 sm:py-24 grid lg:grid-cols-[20rem_1fr] gap-10">
          <div>
            <h2 className="text-3xl sm:text-[2.6rem] font-extrabold tracking-[-0.03em] leading-tight">Вопросы</h2>
            <p className="mt-3 text-muted leading-relaxed">Не нашли ответ — откройте демо: там всё работает по-настоящему, только показы моделируются.</p>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group rounded-xl bg-white border border-line px-5 py-4 open:shadow-sm">
                <summary className="cursor-pointer list-none flex items-center justify-between gap-4 font-semibold text-[1.05rem]">
                  {q}
                  <span className="w-7 h-7 rounded-full bg-paper grid place-items-center shrink-0 transition-transform group-open:rotate-180"><ChevronDown size={16} /></span>
                </summary>
                <p className="mt-3 text-ink-2 leading-relaxed">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Финал */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-24">
        <div className="relative overflow-hidden rounded-3xl bg-ink text-white px-6 py-12 sm:px-14 sm:py-16">
          <div className="absolute right-0 bottom-0 flex items-end gap-1.5 h-40 w-[45%] opacity-25 pr-8" aria-hidden>
            {BARS.map((h, i) => <span key={i} className={`flex-1 rounded-t ${i >= 9 ? "bg-mark" : "bg-white/50"}`} style={{ height: `${h}%` }} />)}
          </div>
          <div className="relative max-w-xl">
            <h2 className="text-3xl sm:text-5xl font-extrabold tracking-[-0.03em] leading-[1.05]">Отдайте рутину роботу</h2>
            <p className="mt-4 text-lg text-white/75 leading-relaxed">Запуск — 15 минут. Дальше сервис сам ведёт рекламу и бережёт бюджет. Посмотреть можно на демо — без регистрации и оплаты.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={cta.href} className="btn h-12 px-6 text-base bg-mark text-ink hover:bg-mark/90">{cta.text}</Link>
              <Link href="/login?demo=1" className="btn h-12 px-6 text-base border border-white/25 text-white hover:bg-white/10">Открыть демо</Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 flex flex-wrap gap-x-8 gap-y-3 justify-between items-center text-sm text-muted">
          <Logo size={22} />
          <span className="max-w-xl">Работаем напрямую через API Яндекс Директа и VK Рекламы. Маркировку рекламы площадки делают автоматически.</span>
          <Link href="/privacy" className="underline underline-offset-2">Политика конфиденциальности</Link>
        </div>
      </footer>
    </main>
  );
}

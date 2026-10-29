import Link from "next/link";
import {
  BarChart3, History, Home as HomeIcon, Megaphone, Settings, Ban, Check, ChevronDown, CircleCheck, Clock, FlaskConical, MousePointer2, PauseCircle, Pencil, RotateCcw, Scale, Search, ShieldCheck,
  Sparkles, TrendingDown, Undo2, X, Hand, Scissors, Flower2, Stethoscope, Dumbbell, Music,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { HeroDemo, Window } from "@/components/HeroDemo";
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
        <div className="absolute inset-x-0 top-0 h-[40rem] lp-dots [mask-image:linear-gradient(to_bottom,black,transparent)] pointer-events-none" aria-hidden />
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 pt-12 sm:pt-20 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-line bg-white pl-1.5 pr-3 py-1 text-[13px] text-ink-2 shadow-sm">
            <span className="flex -space-x-1"><span className="w-5 h-5 rounded-full bg-[#fc3f1d] ring-2 ring-white" /><span className="w-5 h-5 rounded-full bg-[#0077ff] ring-2 ring-white" /></span>
            Яндекс Директ и VK Реклама
          </div>
          <h1 className="mt-6 mx-auto max-w-[16ch] text-[2.6rem] sm:text-[4.4rem] font-extrabold tracking-[-0.045em] leading-[0.98]">Реклама в&nbsp;Яндексе и&nbsp;VK на&nbsp;автопилоте</h1>
          <p className="mt-6 mx-auto max-w-[38rem] text-lg sm:text-[1.3rem] text-ink-2 leading-relaxed">Сервис делает работу директолога: настраивает, запускает и каждый день оптимизирует рекламу. Вам не нужно разбираться в кабинетах, а каждый рубль бюджета работает на результат.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href={cta.href} className="btn btn-primary h-12 px-6 text-base">{cta.text}</Link>
            <a href="#features" className="btn btn-ghost h-12 px-6 text-base">Как это работает</a>
          </div>
          <dl className="mt-8 flex flex-wrap justify-center gap-x-8 gap-y-3 text-sm">
            {[["15 мин", "на запуск"], ["5 каналов", "из одного окна"], ["0 ₽", "сверх лимита"]].map(([v, k]) => (
              <div key={k} className="flex items-baseline gap-1.5"><dt className="font-extrabold text-base">{v}</dt><dd className="text-muted">{k}</dd></div>
            ))}
          </dl>
        </div>
        <div className="relative mx-auto max-w-[72rem] px-4 sm:px-6 mt-12 sm:mt-16 pb-16 sm:pb-24">
          <HeroDemo />
        </div>
      </section>

      {/* Клиенты */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pb-16 sm:pb-20">
        <p className="text-center text-sm text-muted">Рекламу с «Полным залом» ведут</p>
        <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-12 gap-y-6">
          <li><img src="/clients/sushkof.svg" alt="Сушкоф и пицца" className="h-8 w-auto [filter:brightness(0)_opacity(0.55)]" /></li>
          <li className="flex items-center gap-2 text-[1.35rem] font-bold tracking-tight text-ink/55"><img src="/clients/goulash-mark.svg" alt="" className="h-7 w-7 grayscale opacity-60" />Goulash.tech</li>
          <li><img src="/clients/delpesto.png" alt="Del Pesto — доставка пиццы" className="h-11 w-auto opacity-60" /></li>
          <li><img src="/clients/lifemart.svg" alt="Жизньмарт" className="h-10 w-auto [filter:brightness(0)_opacity(0.55)]" /></li>
          <li className="rounded-full bg-paper border border-line px-4 py-1.5 text-sm font-semibold text-ink-2">и ещё 100+ компаний</li>
        </ul>
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

      {/* Рычаги эффективного бюджета */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-20 sm:pt-28">
        <div className="max-w-2xl">
          <h2 className="text-3xl sm:text-[2.6rem] font-extrabold tracking-[-0.03em] leading-[1.08]">Пять рычагов, на которых робот экономит бюджет</h2>
          <p className="mt-4 text-lg text-ink-2 leading-relaxed">Не «магия алгоритмов», а понятная работа, которую специалист делает руками, — только каждый день и без выходных.</p>
        </div>
        <div className="mt-12 grid grid-cols-[minmax(0,1fr)] md:grid-cols-6 gap-4">
          {[
            { span: "md:col-span-3", n: "54", u: "минус-слова на старте", t: "Не платить за мусор", items: ["Отсекает «обучение», «вакансии», «своими руками»", "Каждый день дописывает новые по реальным запросам"], dark: true },
            { span: "md:col-span-3", n: "×6", u: "подходов к текстам", t: "Тексты, которые кликают", items: ["Цена, предложение, удобство, результат — в разных объявлениях", "A/B-тест оставляет победителя, слабые выключает"] },
            { span: "md:col-span-2", n: "5", u: "каналов", t: "Деньги туда, где дешевле", items: ["Сравнивает цену обращения по каналам", "Переносит бюджет раз в неделю"] },
            { span: "md:col-span-2", n: "3", u: "аудитории VK в тесте", t: "Точная аудитория", items: ["Искали услугу, интересы, живут рядом", "Остаётся та, где обращение дешевле"] },
            { span: "md:col-span-2", n: "0 ₽", u: "сверх лимита", t: "Без перерасхода", items: ["Месячный лимит — жёсткая граница", "Стоп всей рекламы одной кнопкой"], mark: true },
          ].map((c) => (
            <div key={c.t} className={`${c.span} rounded-3xl p-6 sm:p-7 flex flex-col ${c.dark ? "bg-ink text-white" : c.mark ? "bg-mark" : "bg-paper"}`}>
              <div className="flex items-baseline gap-2">
                <span className={`text-5xl sm:text-6xl font-extrabold tracking-[-0.04em] ${c.dark ? "text-mark" : ""}`}>{c.n}</span>
                <span className={`text-sm ${c.dark ? "text-white/70" : "text-ink-2"}`}>{c.u}</span>
              </div>
              <div className="mt-6 text-xl font-bold">{c.t}</div>
              <ul className={`mt-3 grid gap-1.5 text-[0.95rem] ${c.dark ? "text-white/80" : "text-ink-2"}`}>
                {c.items.map((x) => <li key={x} className="flex gap-2"><Check size={16} className={`shrink-0 mt-0.5 ${c.dark ? "text-mark" : "text-good"}`} />{x}</li>)}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[13px] text-faint">Цифры — пример запуска для студии маникюра; у вашего бизнеса будут свои.</p>
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

      {/* Кому подходит */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pb-20 sm:pb-28">
        <h2 className="text-3xl sm:text-[2.6rem] font-extrabold tracking-[-0.03em] leading-[1.08] max-w-[22ch]">Кому подходит</h2>
        <div className="mt-10 grid md:grid-cols-3 gap-4">
          {[
            ["Ведёте рекламу сами по вечерам", "Директ и VK съедают часы, а результат непонятен. Робот заберёт настройку и ежедневную рутину — вам останется смотреть на цифры."],
            ["Устали от агентства", "Платите за процент от бюджета и ждёте отчёта неделями. Здесь каждое решение видно сразу, а деньги остаются в ваших кабинетах."],
            ["Только начинаете с рекламой", "Не знаете, с чего начать и сколько тратить. Сервис соберёт рекламу по анкете и покажет прогноз до запуска."],
          ].map(([t, d], i) => (
            <div key={t} className="rounded-3xl border border-line p-6 sm:p-7 flex flex-col">
              <span className="w-10 h-10 rounded-xl bg-paper grid place-items-center">{[<Clock key="c" size={18} />, <Undo2 key="u" size={18} />, <Sparkles key="s" size={18} />][i]}</span>
              <div className="mt-3 text-xl font-bold leading-snug">{t}</div>
              <p className="mt-3 text-ink-2 leading-relaxed">{d}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {([[Hand, "Маникюр и брови"], [Scissors, "Парикмахерские"], [Flower2, "Массаж и SPA"], [Stethoscope, "Остеопатия, косметология"], [Dumbbell, "Йога и фитнес"], [Music, "Танцы"]] as const).map(([I, t]) => (
            <div key={t} className="rounded-2xl bg-paper px-4 py-4 text-center">
              <I size={26} className="mx-auto text-ink-2" aria-hidden />
              <div className="mt-2 text-sm font-semibold leading-snug">{t}</div>
            </div>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-ink text-white px-6 py-5">
          <p className="text-lg font-semibold">Узнайте, сколько обращений ждать за ваш бюджет — прогноз до запуска.</p>
          <Link href={cta.href} className="btn bg-mark text-ink hover:bg-mark/90">{cta.text}</Link>
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
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-20 sm:py-24">
          <div className="text-center">
            <h2 className="text-3xl sm:text-[2.6rem] font-extrabold tracking-[-0.03em] leading-tight">Частые вопросы</h2>
            <p className="mt-3 text-muted text-lg">Коротко о том, что обычно спрашивают перед запуском.</p>
          </div>
          <div className="mt-12 grid md:grid-cols-2 gap-4">
            {FAQ.map(([q, a]) => (
              <div key={q} className="rounded-2xl bg-white border border-line p-6 flex gap-4">
                <span className="w-9 h-9 rounded-xl bg-mark grid place-items-center font-extrabold shrink-0">?</span>
                <div>
                  <h3 className="font-bold text-[1.1rem] leading-snug">{q}</h3>
                  <p className="mt-2 text-ink-2 leading-relaxed">{a}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Финал — во всю ширину */}
      <section className="relative overflow-hidden bg-ink text-white">
        <div className="absolute right-0 bottom-0 flex items-end gap-2 h-56 w-[55%] pr-6 sm:pr-16" aria-hidden>
          {BARS.map((h, i) => <span key={i} className={`flex-1 rounded-t ${i >= 9 ? "bg-mark/90" : "bg-white/10"}`} style={{ height: `${h}%` }} />)}
        </div>
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 py-20 sm:py-28">
          <div className="max-w-2xl">
            <h2 className="text-4xl sm:text-6xl font-extrabold tracking-[-0.035em] leading-[1.02]">Отдайте рутину роботу</h2>
            <p className="mt-5 text-lg sm:text-xl text-white/75 leading-relaxed">Запуск — 15 минут. Дальше сервис сам ведёт рекламу и бережёт ваш бюджет.</p>
            <Link href={cta.href} className="mt-9 btn h-12 px-7 text-base bg-mark text-ink hover:bg-mark/90">{cta.text}</Link>
          </div>
        </div>
      </section>

      <footer>
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 flex flex-wrap gap-x-8 gap-y-3 justify-between items-center text-sm text-muted">
          <Logo size={22} />
          <span className="max-w-xl">Работаем напрямую через API Яндекс Директа и VK Рекламы. Маркировку рекламы площадки делают автоматически.</span>
          <Link href="/privacy" className="underline underline-offset-2">Политика конфиденциальности</Link>
        </div>
      </footer>
    </main>
  );
}

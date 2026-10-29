import Link from "next/link";
import {
  ArrowRight, BadgeCheck, Ban, Calculator, Check, ChevronDown, CircleDollarSign, Eye, FlaskConical, Hand, Layers, MessageSquareText,
  MousePointerClick, PauseCircle, RotateCcw, Scale, Search, ShieldCheck, Sparkles, Target, Undo2, Users, Wallet, X,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { ScheduleHero } from "@/components/ScheduleHero";
import { getUser } from "@/lib/auth";

/**
 * Лендинг «Полного зала». Главные смыслы:
 *  1. Работа директолога за 15 минут — без агентства и опыта.
 *  2. Робот ведёт рекламу каждый день, а не раз в месяц.
 *  3. Считаем клиентов и записи, а не клики.
 *  4. Деньги под контролем: ваши кабинеты, жёсткий лимит, стоп одной кнопкой.
 *  5. Честные объявления: только факты из анкеты, медицина — по закону.
 *  6. Каждое решение объяснено и отменяется.
 */

const PAINS = [
  { icon: Wallet, t: "Агентство", d: "Берёт фикс плюс процент от бюджета, отчёт раз в месяц, а что именно поменяли — непонятно." },
  { icon: Layers, t: "Самому в Директе", d: "Сотни настроек, модерация, минус-слова. Пара ошибок — и бюджет ушёл на «маникюр обучение» и «лампа для ногтей»." },
  { icon: Eye, t: "Реклама есть, записей нет", d: "Клики идут, деньги списываются, а сколько стоил живой клиент — никто не считает." },
];

const PILLARS = [
  {
    icon: Sparkles, k: "15 минут", t: "Работа директолога — пока вы пьёте кофе",
    d: "Анкета о бизнесе превращается в готовую рекламу: поисковые запросы по услугам и проблемам клиентов, минус-слова, тексты, картинки под каждый формат и страница записи, если нет сайта.",
  },
  {
    icon: RotateCcw, k: "каждый день", t: "Робот ведёт рекламу, а не просто запускает",
    d: "Отключает слабые объявления, ставит A/B-тесты текстов и аудиторий, убирает мусорные запросы, переносит деньги туда, где клиент дешевле.",
  },
  {
    icon: Target, k: "клиенты, не клики", t: "Считаем, сколько стоит запись",
    d: "Счётчики и цели настраиваются сами. Видно обращения и цену клиента по каждому каналу — и робот оптимизирует именно её.",
  },
  {
    icon: ShieldCheck, k: "ваши деньги", t: "Бюджет — жёсткая граница",
    d: "Деньги лежат в ваших кабинетах Яндекса и VK, мы только управляем. Лимит в месяц не превышается, вся реклама останавливается одной кнопкой.",
  },
  {
    icon: BadgeCheck, k: "без выдумок", t: "В объявлениях — только правда",
    d: "Никаких «скидок» и «лучших мастеров», которых нет: каждое утверждение сверяется с анкетой. Для медицинских услуг — правила закона о рекламе.",
  },
  {
    icon: MessageSquareText, k: "по-человечески", t: "Каждое решение объяснено",
    d: "«Отключили объявление: его кликали втрое реже соседних». Всё в истории простыми словами, любое решение отменяется в один клик.",
  },
];

const LOG = [
  { time: "09:12", icon: Ban, tone: "bad", t: "Минус-слово «обучение»", d: "По запросу «маникюр обучение» было 14 кликов и ни одной записи — больше за такие не платим.", undo: true },
  { time: "09:12", icon: FlaskConical, tone: "info", t: "A/B-тест: цена в заголовке", d: "Проверяем, приведёт ли «Маникюр с покрытием — 1 900 ₽» больше записей, чем текущий заголовок.", undo: true },
  { time: "09:13", icon: Scale, tone: "good", t: "+15% бюджета ВКонтакте", d: "Запись из VK обходится в 640 ₽, из сетей Яндекса — в 1 100 ₽. Переносим часть денег, общий лимит прежний.", undo: true },
  { time: "09:13", icon: PauseCircle, tone: "muted", t: "Выключено слабое объявление", d: "Его кликали в 3 раза реже соседних в той же группе.", undo: true },
] as const;

const COMPARE: { row: string; agency: string; diy: string; us: string }[] = [
  { row: "Запуск", agency: "1–2 недели брифов", diy: "Вечера и выходные", us: "≈ 15 минут" },
  { row: "Оптимизация", agency: "Раз в неделю-месяц", diy: "Когда дойдут руки", us: "Каждый день" },
  { row: "Цена клиента", agency: "В отчёте, если попросить", diy: "Не считается", us: "Видна по каждому каналу" },
  { row: "Деньги", agency: "Часто через счёт агентства", diy: "Ваш кабинет", us: "Ваш кабинет, жёсткий лимит" },
  { row: "Почему так", agency: "«Мы оптимизировали»", diy: "—", us: "Объяснение к каждому решению" },
];

const CHANNELS = [
  { t: "Поиск Яндекса", d: "Тем, кто прямо сейчас ищет услугу" },
  { t: "Сайты и приложения (РСЯ)", d: "Картинки тем, кто недавно интересовался" },
  { t: "ВКонтакте и Одноклассники", d: "Лента соцсетей: рядом с вами, по интересам и поиску" },
  { t: "Ретаргетинг в Яндексе и VK", d: "Возвращает тех, кто был на странице, но не записался" },
];

const NICHES = ["Маникюр и педикюр", "Брови и ресницы", "Парикмахерские", "Барбершопы", "Массаж и SPA", "Косметология", "Остеопатия", "Йога", "Фитнес и пилатес", "Танцы"];

const FAQ = [
  ["Нужен ли опыт в рекламе?", "Нет. Вы отвечаете на вопросы о своём бизнесе, остальное сервис делает сам. Проверить и поправить объявления перед запуском можно в пару кликов."],
  ["Чьи деньги и кто платит площадкам?", "Рекламный бюджет лежит в ваших кабинетах Яндекс Директа и VK Рекламы — вы пополняете их сами. Мы подключаемся по доступу, который можно отозвать в любой момент."],
  ["А если у меня нет сайта?", "Сервис сделает страницу записи с формой и кнопками мессенджеров. Можно вести рекламу и на свой сайт, и в Telegram или WhatsApp."],
  ["Не понравились тексты — что делать?", "Поправьте любое объявление вручную, попросите робота переписать все тексты по вашему пожеланию («живее», «больше про цену») или добавить ещё вариантов."],
  ["Можно ли остановить рекламу?", "Да, одной кнопкой — сразу во всех каналах. И так же включить обратно, без потери статистики."],
  ["Работаете с медицинскими услугами?", "Да: остеопатия, массаж, косметология. Объявления пишутся без обещаний результата, а мы подскажем, какую лицензию указать и куда её загрузить."],
] as const;

const tone = {
  bad: "bg-bad-soft text-bad",
  info: "bg-info-soft text-ink-2",
  good: "bg-good-soft text-good",
  muted: "bg-paper text-muted",
} as const;

export default async function Home() {
  const user = await getUser();
  const cta = user ? { href: "/app", text: "Открыть кабинет" } : { href: "/login?tab=register", text: "Запустить рекламу" };
  return (
    <main className="min-h-dvh overflow-x-clip">
      <header className="sticky top-0 z-40 bg-paper/85 backdrop-blur border-b border-line/60">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Logo />
          <nav className="hidden md:flex items-center gap-6 text-sm text-ink-2">
            <a href="#why" className="hover:text-ink">Почему мы</a>
            <a href="#robot" className="hover:text-ink">Что делает робот</a>
            <a href="#how" className="hover:text-ink">Как начать</a>
            <a href="#faq" className="hover:text-ink">Вопросы</a>
          </nav>
          <div className="flex items-center gap-2">
            {user ? null : <Link href="/login" className="btn btn-ghost btn-sm hidden sm:inline-flex">Войти</Link>}
            <Link href={cta.href} className="btn btn-primary btn-sm">{user ? "Кабинет" : "Начать"}</Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-10 sm:pt-16 pb-16 grid lg:grid-cols-[1.05fr_1fr] gap-10 lg:gap-14 items-center">
        <div>
          <span className="pill bg-mark-soft text-ink font-semibold px-3 py-1 text-sm">Автопилот рекламы для бизнеса услуг</span>
          <h1 className="mt-5 text-[2.4rem] leading-[1.04] sm:text-6xl font-extrabold tracking-[-0.03em]">
            Реклама, которая заполняет&nbsp;запись. <span className="bg-mark px-1.5 -mx-0.5 rounded-md box-decoration-clone">Сама.</span>
          </h1>
          <p className="mt-5 text-lg sm:text-xl text-ink-2 leading-relaxed max-w-[34rem]">
            Расскажите о бизнесе — за 15 минут сервис соберёт рекламу в Яндексе и ВКонтакте, а дальше каждый день будет сам убирать лишнее, тестировать новое и объяснять каждое решение простыми словами.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={cta.href} className="btn btn-primary h-12 px-6 text-base">{cta.text} <ArrowRight size={18} /></Link>
            <Link href="/login?demo=1" className="btn btn-ghost h-12 px-6 text-base">Посмотреть на демо</Link>
          </div>
          <ul className="mt-7 grid sm:grid-cols-3 gap-2.5 text-sm">
            {["Без агентства и директолога", "Деньги — в ваших кабинетах", "Стоп одной кнопкой"].map((x) => (
              <li key={x} className="flex items-center gap-2 text-ink-2"><Check size={16} className="text-good shrink-0" /> {x}</li>
            ))}
          </ul>
        </div>
        <ScheduleHero />
      </section>

      {/* Боль */}
      <section className="bg-card border-y border-line">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-14 sm:py-20">
          <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight max-w-2xl">Реклама для маленького бизнеса обычно выглядит так</h2>
          <div className="mt-10 grid md:grid-cols-3 gap-4">
            {PAINS.map(({ icon: I, t, d }) => (
              <div key={t} className="rounded-2xl border border-line p-5 sm:p-6 bg-paper/50">
                <span className="w-10 h-10 rounded-xl bg-bad-soft text-bad grid place-items-center"><I size={20} /></span>
                <div className="mt-4 font-bold text-lg">{t}</div>
                <p className="mt-1.5 text-muted leading-relaxed">{d}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 text-lg sm:text-xl font-semibold max-w-3xl">«Полный зал» делает работу директолога за вас: запускает, ведёт и считает — а вам остаётся принимать клиентов.</p>
        </div>
      </section>

      {/* Смыслы */}
      <section id="why" className="mx-auto max-w-6xl px-4 sm:px-6 py-14 sm:py-20 scroll-mt-16">
        <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight max-w-2xl">В чём сервис хорош</h2>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {PILLARS.map(({ icon: I, k, t, d }) => (
            <div key={t} className="card p-5 sm:p-6 flex flex-col">
              <div className="flex items-center justify-between">
                <span className="w-10 h-10 rounded-xl bg-mark grid place-items-center"><I size={20} /></span>
                <span className="text-xs font-semibold uppercase tracking-wide text-faint">{k}</span>
              </div>
              <div className="mt-4 font-bold text-lg leading-snug">{t}</div>
              <p className="mt-2 text-muted leading-relaxed text-[0.95rem]">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Что получите при запуске */}
      <section className="bg-ink text-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-14 sm:py-20 grid lg:grid-cols-[1fr_1.1fr] gap-10 items-center">
          <div>
            <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight">Что готово через 15 минут</h2>
            <p className="mt-4 text-white/75 leading-relaxed text-lg max-w-md">Объём работы, на который у специалиста уходит несколько дней. Пример для студии маникюра в Казани с бюджетом 70 000 ₽ в месяц.</p>
            <p className="mt-6 text-sm text-white/60">Перед запуском всё можно посмотреть «как увидят люди», поправить тексты, выключить лишнее или попросить робота переписать.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              ["62", "объявления в 5 каналах"],
              ["12", "групп поиска: по услугам, проблемам клиентов и смежным запросам"],
              ["54", "минус-слова — не платим за «обучение», «вакансии», «своими руками»"],
              ["3", "аудитории VK для A/B-теста: искали услугу, интересы, живут рядом"],
            ].map(([n, t]) => (
              <div key={t} className="rounded-2xl bg-white/[0.07] border border-white/10 p-4 sm:p-5">
                <div className="text-4xl sm:text-5xl font-extrabold text-mark tracking-tight">{n}</div>
                <div className="mt-2 text-sm text-white/80 leading-snug">{t}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Робот каждый день */}
      <section id="robot" className="mx-auto max-w-6xl px-4 sm:px-6 py-14 sm:py-20 grid lg:grid-cols-[0.9fr_1.1fr] gap-10 items-start scroll-mt-16">
        <div className="lg:sticky lg:top-24">
          <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight">Каждое утро робот разбирает вчерашний день</h2>
          <p className="text-muted mt-4 leading-relaxed text-lg max-w-md">Решения — по накопленной статистике, а не наугад. Первые три дня робот только наблюдает. Каждое действие записано в историю с объяснением и кнопкой «Отменить».</p>
          <ul className="mt-6 grid gap-2.5 text-ink-2">
            {[
              [MousePointerClick, "Отключает слабые объявления и пишет новые варианты"],
              [Users, "Сравнивает аудитории и оставляет ту, где запись дешевле"],
              [Search, "Чистит поисковые запросы от нецелевых"],
              [CircleDollarSign, "Переносит бюджет между каналами в рамках лимита"],
              [Hand, "Сам переписывает тексты, отклонённые модерацией"],
            ].map(([I, t]) => {
              const Icon = I as typeof Search;
              return <li key={t as string} className="flex gap-2.5"><Icon size={18} className="mt-0.5 shrink-0 text-ink" /> {t as string}</li>;
            })}
          </ul>
        </div>
        <div className="card p-3 sm:p-4 shadow-[0_24px_60px_-30px_rgba(29,32,69,0.35)]">
          <div className="flex items-center justify-between px-2 pt-1 pb-3">
            <div className="font-bold">История решений</div>
            <span className="text-sm text-muted">сегодня</span>
          </div>
          <ul className="grid gap-2">
            {LOG.map((x) => (
              <li key={x.t} className="rounded-xl border border-line p-3.5 flex gap-3">
                <span className={`w-9 h-9 rounded-lg grid place-items-center shrink-0 ${tone[x.tone]}`}><x.icon size={18} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold leading-snug">{x.t}</div>
                    <span className="text-xs text-faint shrink-0 mt-0.5">{x.time}</span>
                  </div>
                  <p className="text-sm text-muted mt-1 leading-relaxed">{x.d}</p>
                  <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-ink-2"><Undo2 size={13} /> Отменить</span>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-faint px-2 pt-3">Пример записей в истории. Цифры условные.</p>
        </div>
      </section>

      {/* Сравнение */}
      <section className="bg-card border-y border-line">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-14 sm:py-20">
          <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight max-w-2xl">Чем это лучше агентства и «настрою сам»</h2>
          {/* Телефон: карточки по строкам вместо широкой таблицы */}
          <ul className="mt-8 grid gap-3 md:hidden">
            {COMPARE.map((r) => (
              <li key={r.row} className="rounded-xl border border-line p-4">
                <div className="font-bold">{r.row}</div>
                <div className="mt-2 flex gap-2 font-semibold"><Check size={16} className="text-good mt-0.5 shrink-0" />Полный зал: {r.us}</div>
                <div className="mt-1.5 text-sm text-muted">Агентство: {r.agency} · Сам: {r.diy}</div>
              </li>
            ))}
          </ul>
          <div className="mt-10 hidden md:block">
            <table className="w-full text-left border-separate border-spacing-0">
              <thead>
                <tr className="text-sm text-muted">
                  <th className="py-3 pr-4 font-medium w-[22%]"></th>
                  <th className="py-3 px-4 font-medium">Агентство</th>
                  <th className="py-3 px-4 font-medium">Сам в кабинете</th>
                  <th className="py-3 px-4 font-bold text-ink bg-mark-soft rounded-t-xl">Полный зал</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map((r, i) => (
                  <tr key={r.row}>
                    <td className="py-3.5 pr-4 font-semibold border-t border-line">{r.row}</td>
                    <td className="py-3.5 px-4 text-muted border-t border-line"><span className="inline-flex gap-2"><X size={16} className="text-faint mt-0.5 shrink-0" />{r.agency}</span></td>
                    <td className="py-3.5 px-4 text-muted border-t border-line"><span className="inline-flex gap-2"><X size={16} className="text-faint mt-0.5 shrink-0" />{r.diy}</span></td>
                    <td className={`py-3.5 px-4 font-semibold bg-mark-soft border-t border-mark/40 ${i === COMPARE.length - 1 ? "rounded-b-xl" : ""}`}><span className="inline-flex gap-2"><Check size={16} className="text-good mt-0.5 shrink-0" />{r.us}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Каналы и ниши */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 py-14 sm:py-20 grid lg:grid-cols-2 gap-12">
        <div>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Все каналы — в одном окне</h2>
          <p className="text-muted mt-3 leading-relaxed">Бюджет делится между каналами автоматически и перетекает туда, где клиент дешевле.</p>
          <ul className="mt-6 grid gap-2.5">
            {CHANNELS.map((c) => (
              <li key={c.t} className="rounded-xl border border-line bg-card px-4 py-3">
                <div className="font-semibold">{c.t}</div>
                <div className="text-sm text-muted">{c.d}</div>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Для бизнеса, который живёт записью</h2>
          <p className="text-muted mt-3 leading-relaxed">Робот знает, как ищут каждую услугу, какие запросы нецелевые и кто ваша аудитория — и подстраивается под ваш прайс.</p>
          <div className="mt-6 flex flex-wrap gap-2">
            {NICHES.map((n) => <span key={n} className="pill bg-card border border-line px-3.5 py-1.5 text-[0.95rem]">{n}</span>)}
            <span className="pill bg-paper border border-dashed border-line-2 px-3.5 py-1.5 text-[0.95rem] text-muted">и другие услуги</span>
          </div>
          <div className="mt-6 rounded-xl bg-info-soft p-4 text-sm text-ink-2 leading-relaxed flex gap-3">
            <Calculator size={18} className="shrink-0 mt-0.5" />
            <span>До запуска покажем прогноз: сколько обращений ждать за ваш бюджет и сколько будет стоить одно обращение.</span>
          </div>
        </div>
      </section>

      {/* Как начать */}
      <section id="how" className="bg-card border-y border-line scroll-mt-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-14 sm:py-20">
          <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight max-w-xl">Три шага до первых записей</h2>
          <ol className="mt-10 grid md:grid-cols-3 gap-8">
            {[
              ["Расскажите о бизнесе", "Услуги, цены, адрес, чем вы лучше. Есть сайт — заполним по нему. Нет сайта — сделаем страницу записи."],
              ["Подключите кабинеты и выберите бюджет", "Яндекс Директ и VK Реклама подключаются в пару кликов. Покажем, сколько обращений ждать за ваши деньги."],
              ["Проверьте и запустите", "Тексты, запросы и картинки готовы. Поправьте что хотите — и реклама уходит на модерацию, показы включаются сразу во всех каналах."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-4">
                <span className="shrink-0 w-10 h-10 rounded-full bg-mark font-extrabold grid place-items-center text-lg">{i + 1}</span>
                <div>
                  <div className="font-bold text-lg leading-snug">{t}</div>
                  <p className="text-muted mt-1.5 leading-relaxed">{d}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl px-4 sm:px-6 py-14 sm:py-20 scroll-mt-16">
        <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight">Частые вопросы</h2>
        <div className="mt-8 grid gap-2.5">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group card px-5 py-4">
              <summary className="cursor-pointer list-none flex items-center justify-between gap-4 font-semibold text-[1.05rem]">
                {q}
                <ChevronDown size={18} className="shrink-0 text-muted transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-3 text-muted leading-relaxed">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Финальный призыв */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pb-16 sm:pb-24">
        <div className="rounded-3xl bg-mark px-6 py-10 sm:px-12 sm:py-14 grid md:grid-cols-[1fr_auto] gap-6 items-center">
          <div>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">Свободные окна — это недополученные деньги</h2>
            <p className="mt-3 text-ink-2 text-lg max-w-xl">Запустите рекламу сегодня, а робот займётся остальным. Посмотреть, как всё устроено, можно на демо — без кабинетов и оплаты.</p>
          </div>
          <div className="flex flex-col sm:flex-row md:flex-col gap-2.5">
            <Link href={cta.href} className="btn btn-primary h-12 px-6 text-base">{cta.text} <ArrowRight size={18} /></Link>
            <Link href="/login?demo=1" className="btn h-12 px-6 text-base bg-white/70 hover:bg-white">Открыть демо</Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 flex flex-wrap gap-4 justify-between items-center text-sm text-muted">
          <Logo size={22} />
          <span className="max-w-xl">Работаем напрямую через API Яндекс Директа и VK Рекламы. Маркировку рекламы площадки делают автоматически.</span>
          <Link href="/privacy" className="underline underline-offset-2">Политика конфиденциальности</Link>
        </div>
      </footer>
    </main>
  );
}

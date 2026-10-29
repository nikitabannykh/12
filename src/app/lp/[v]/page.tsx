import { notFound } from "next/navigation";
import { MousePointer2, ArrowUpRight, ArrowRight, Ban, Check, CircleCheck, FlaskConical, Globe, PauseCircle, Scale, Search, Sparkles, TrendingDown, X } from "lucide-react";
import { Logo, LogoMark } from "@/components/Logo";
import { HeroDemo } from "@/components/HeroDemo";
import { Command, NicheTabs, Recs, Rotator } from "@/components/LpBits";

/** Черновики первого экрана (5 вариантов) — для выбора, не для поиска */
export const metadata = { title: "Варианты первого экрана", robots: { index: false } };

function Header({ dark = false }: { dark?: boolean }) {
  return (
    <header className={`mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between ${dark ? "text-white" : ""}`}>
      <Logo />
      <nav className={`hidden md:flex gap-7 text-sm ${dark ? "text-white/70" : "text-ink-2"}`}><span>Возможности</span><span>Как начать</span><span>Вопросы</span></nav>
      <span className={`btn btn-sm ${dark ? "bg-mark text-ink" : "btn-primary"}`}>Начать</span>
    </header>
  );
}

/* 1. До и после */
function V1() {
  const mess = ["Ставка на поиске", "Корректировки по полу", "Минус-фразы (0)", "Автотаргетинг", "Стратегия", "Регион показа", "Время показа", "Расширения", "Аудитории", "Креативы 1080×607", "Цели Метрики", "UTM-метки"];
  return (
    <main className="min-h-dvh bg-paper text-ink">
      <Header />
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-12 pb-20">
        <h1 className="text-center text-[2.6rem] sm:text-[4rem] font-extrabold tracking-[-0.04em] leading-[1.0] max-w-[18ch] mx-auto">Та же реклама. Без часов в&nbsp;настройках.</h1>
        <p className="mt-5 text-center text-lg sm:text-xl text-ink-2 max-w-2xl mx-auto">Слева — как рекламу ведут вручную. Справа — как её ведёт робот «Полного зала».</p>
        <div className="mt-12 grid md:grid-cols-2 gap-5">
          <div className="rounded-3xl bg-white border border-line p-6 relative overflow-hidden">
            <div className="flex items-center justify-between"><span className="font-bold text-muted">Вручную</span><span className="text-sm text-bad font-semibold">часы каждую неделю</span></div>
            <div className="mt-5 grid grid-cols-2 gap-2 opacity-80">
              {mess.map((m, i) => (
                <div key={m} className={`rounded-lg border px-3 py-2 text-[13px] ${i % 4 === 1 ? "border-bad/40 bg-bad-soft text-bad" : "border-line text-ink-2"}`} style={{ transform: `rotate(${(i % 3 - 1) * 1.2}deg)` }}>{m}</div>
              ))}
            </div>
            <div className="mt-5 rounded-xl bg-bad-soft text-bad text-sm px-4 py-3 flex gap-2"><X size={16} className="mt-0.5 shrink-0" />Без минус-слов деньги уходят на «маникюр обучение» и «лампа для ногтей»</div>
          </div>
          <div className="rounded-3xl bg-ink text-white p-6 shadow-[0_40px_80px_-40px_rgba(29,32,69,0.6)]">
            <div className="flex items-center justify-between"><span className="font-bold">С роботом</span><span className="text-sm text-mark font-semibold">15 минут один раз</span></div>
            <div className="mt-6 text-white/70 text-sm">Цена обращения</div>
            <div className="text-5xl font-extrabold tracking-tight">430 ₽ <span className="text-xl text-mark align-middle">−28%</span></div>
            <ul className="mt-6 grid gap-2.5 text-[15px]">
              {["Мусорные запросы отсечены автоматически", "Бюджет перетекает туда, где дешевле", "Каждое утро — проверка и отчёт"].map((x) => <li key={x} className="flex gap-2.5"><Check size={18} className="text-mark shrink-0 mt-0.5" />{x}</li>)}
            </ul>
            <span className="mt-7 btn h-12 px-6 bg-mark text-ink w-full">Запустить рекламу</span>
          </div>
        </div>
      </section>
    </main>
  );
}

/* 2. Один день робота */
function V2() {
  const log = [
    ["08:58", Search, "Проверил 5 кампаний", "Яндекс и VK, 62 объявления"],
    ["09:04", Ban, "Минус-слово «обучение»", "−460 ₽ в неделю"],
    ["09:07", PauseCircle, "Выключил слабое объявление", "кликали в 3 раза реже"],
    ["09:11", Scale, "+15% бюджета во ВКонтакте", "обращение там на 30% дешевле"],
    ["09:15", FlaskConical, "Запустил A/B-тест заголовка", "цена против выгоды"],
  ] as const;
  return (
    <main className="min-h-dvh bg-white text-ink">
      <Header />
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-10 sm:pt-16 pb-20 grid lg:grid-cols-[1fr_1fr] gap-12 items-center">
        <div>
          <h1 className="text-[2.6rem] sm:text-[4rem] font-extrabold tracking-[-0.04em] leading-[1.0]">Пока вы пьёте утренний кофе, робот уже поработал</h1>
          <p className="mt-6 text-lg sm:text-xl text-ink-2 leading-relaxed max-w-[32rem]">Каждое утро «Полный зал» разбирает рекламу в Яндексе и VK, убирает лишние траты и пишет, что сделал. Вам — только читать.</p>
          <div className="mt-8 flex gap-3"><span className="btn btn-primary h-12 px-6 text-base">Запустить рекламу</span><span className="btn btn-ghost h-12 px-6 text-base">Как это работает</span></div>
        </div>
        <div className="rounded-3xl bg-paper p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <span className="font-bold">Сегодня, четверг</span>
            <span className="rounded-full bg-mark px-3 py-1 text-sm font-bold flex items-center gap-1.5"><TrendingDown size={14} />сэкономлено 1 240 ₽</span>
          </div>
          <ol className="mt-5 relative grid gap-3 before:absolute before:left-[4.1rem] before:top-3 before:bottom-3 before:w-px before:bg-line-2">
            {log.map(([t, I, a, b], i) => (
              <li key={t} className={`relative grid grid-cols-[3.2rem_2rem_1fr] items-center gap-3 rounded-2xl ${i === 1 ? "bg-white shadow-sm border border-line" : ""} px-1 py-2`}>
                <span className="text-sm text-muted tabular-nums text-right">{t}</span>
                <span className={`relative z-10 w-8 h-8 rounded-full grid place-items-center ${i === 1 ? "bg-ink text-white" : "bg-white border border-line"}`}><I size={15} /></span>
                <div><div className="font-semibold leading-snug">{a}</div><div className="text-sm text-muted">{b}</div></div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </main>
  );
}

/* 3. Калькулятор бюджета */
function V3() {
  return (
    <main className="min-h-dvh bg-paper text-ink">
      <Header />
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-10 sm:pt-16 pb-20 grid lg:grid-cols-[1.05fr_0.95fr] gap-12 items-center">
        <div>
          <h1 className="text-[2.6rem] sm:text-[4rem] font-extrabold tracking-[-0.04em] leading-[1.0]">Сколько обращений принесёт ваш бюджет?</h1>
          <p className="mt-6 text-lg sm:text-xl text-ink-2 leading-relaxed max-w-[32rem]">Выберите сумму — робот покажет прогноз, а после запуска сам будет вести рекламу в Яндексе и VK, чтобы каждый рубль работал.</p>
          <ul className="mt-7 grid gap-2 text-ink-2">
            {["Прогноз — до запуска, бесплатно", "Деньги в ваших кабинетах", "Ни рубля сверх лимита"].map((x) => <li key={x} className="flex gap-2"><Check size={18} className="text-good mt-0.5" />{x}</li>)}
          </ul>
        </div>
        <div className="rounded-3xl bg-white border border-line p-6 sm:p-8 shadow-[0_40px_80px_-40px_rgba(29,32,69,0.35)]">
          <div className="text-sm text-muted">Бюджет в месяц</div>
          <div className="text-5xl font-extrabold tracking-tight mt-1">50 000 ₽</div>
          <div className="mt-5 h-2.5 rounded-full bg-paper relative"><div className="absolute inset-y-0 left-0 w-[42%] rounded-full bg-ink" /><span className="absolute top-1/2 -translate-y-1/2 left-[42%] -ml-3 w-6 h-6 rounded-full bg-white border-[3px] border-ink shadow" /></div>
          <div className="mt-2 flex justify-between text-xs text-faint"><span>15 000</span><span>150 000 ₽</span></div>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-mark p-4"><div className="text-sm">Обращений в месяц</div><div className="text-3xl font-extrabold">80–120</div></div>
            <div className="rounded-2xl bg-paper p-4"><div className="text-sm text-muted">Цена обращения</div><div className="text-3xl font-extrabold">≈ 500 ₽</div></div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-[13px]">
            {[["Поиск", "38%"], ["ВКонтакте", "27%"], ["Сети и ретаргетинг", "35%"]].map(([k, v]) => <div key={k} className="rounded-lg bg-paper px-3 py-2"><span className="text-muted">{k}</span> <b>{v}</b></div>)}
          </div>
          <span className="mt-6 btn btn-primary h-12 w-full text-base">Получить прогноз и запустить</span>
          <p className="mt-2 text-center text-xs text-faint">Прогноз зависит от ниши и города</p>
        </div>
      </section>
    </main>
  );
}

/* 4. Одно поле: адрес сайта */
function V4() {
  return (
    <main className="min-h-dvh bg-white text-ink overflow-hidden">
      <Header />
      <section className="relative mx-auto max-w-6xl px-4 sm:px-6 pt-16 sm:pt-24 pb-24 text-center">
        <div className="absolute inset-0 pointer-events-none hidden lg:block" aria-hidden>
          <div className="absolute left-0 top-20 w-64 rounded-2xl bg-white border border-line p-3.5 text-left shadow-xl -rotate-6">
            <div className="text-[11px] text-muted">Реклама · studia-lak.ru</div>
            <div className="text-[#2a3eb1] font-semibold leading-snug mt-1">Маникюр с покрытием — 1 900 ₽</div>
            <div className="text-xs text-ink-2 mt-1">Держится 3–4 недели. Запись онлайн.</div>
          </div>
          <div className="absolute right-0 top-10 w-56 rounded-2xl bg-white border border-line overflow-hidden text-left shadow-xl rotate-6">
            <div className="h-20 bg-[linear-gradient(135deg,#f3e9ec,#e8c9d3)]" />
            <div className="p-3 text-[13px] font-semibold">Маникюр, который держится 3–4 недели <span className="block text-[11px] text-muted font-normal">ВКонтакте</span></div>
          </div>
          <div className="absolute right-10 bottom-10 rounded-xl bg-ink text-white px-4 py-2.5 shadow-xl -rotate-3 text-left"><div className="text-[11px] text-white/70">готово</div><div className="font-bold">62 объявления · 5 каналов</div></div>
          <div className="absolute left-12 bottom-14 rounded-xl bg-mark px-4 py-2.5 shadow-xl rotate-3 text-left"><div className="text-[11px]">минус-слова</div><div className="font-bold">54 нецелевых запроса</div></div>
        </div>
        <h1 className="relative text-[2.6rem] sm:text-[4.4rem] font-extrabold tracking-[-0.045em] leading-[0.98] max-w-[15ch] mx-auto">Вставьте адрес сайта — робот сделает рекламу</h1>
        <p className="relative mt-6 text-lg sm:text-xl text-ink-2 max-w-2xl mx-auto">Запросы, тексты, картинки и аудитории для Яндекса и VK — за 15 минут. Дальше робот сам ведёт рекламу и бережёт бюджет.</p>
        <div className="relative mt-9 mx-auto max-w-xl flex items-center gap-2 rounded-2xl bg-white border-2 border-ink p-2 shadow-[0_20px_50px_-20px_rgba(29,32,69,0.4)]">
          <Globe size={20} className="ml-2 text-muted shrink-0" />
          <span className="flex-1 text-left text-lg text-faint">ваш-сайт.ru</span>
          <span className="btn btn-primary h-12 px-5 text-base">Создать рекламу <ArrowRight size={18} /></span>
        </div>
        <p className="relative mt-3 text-sm text-muted">Нет сайта? Заполните короткую анкету — сделаем и страницу записи.</p>
      </section>
    </main>
  );
}

/* 5. Тёмный, с карточками объявлений */
function V5() {
  return (
    <main className="min-h-dvh bg-ink text-white overflow-hidden">
      <Header dark />
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-12 sm:pt-20 pb-24 grid lg:grid-cols-[1.1fr_0.9fr] gap-10 items-center">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm"><Sparkles size={14} className="text-mark" />Автопилот для Яндекс Директа и VK Рекламы</span>
          <h1 className="mt-6 text-[2.8rem] sm:text-[4.8rem] font-extrabold tracking-[-0.045em] leading-[0.95]">Реклама, которая настраивает себя сама</h1>
          <p className="mt-6 text-lg sm:text-xl text-white/70 leading-relaxed max-w-[32rem]">Робот делает работу директолога каждый день: убирает лишние траты, тестирует новое и переносит бюджет туда, где он приносит обращения.</p>
          <div className="mt-8 flex gap-3"><span className="btn h-12 px-6 text-base bg-mark text-ink">Запустить рекламу</span><span className="btn h-12 px-6 text-base border border-white/25">Как это работает</span></div>
          <div className="mt-10 flex gap-8 text-sm">{[["15 мин", "запуск"], ["5", "каналов"], ["0 ₽", "сверх лимита"]].map(([a, b]) => <div key={b}><div className="text-2xl font-extrabold text-mark">{a}</div><div className="text-white/60">{b}</div></div>)}</div>
        </div>
        <div className="relative h-[30rem] hidden sm:block">
          <div className="absolute right-6 top-0 w-80 rounded-2xl bg-white text-ink p-4 shadow-2xl rotate-3">
            <div className="text-[11px] text-muted">Поиск Яндекса · реклама</div>
            <div className="text-[#2a3eb1] font-semibold leading-snug mt-1">Маникюр с покрытием — 1 900 ₽, Казань</div>
            <div className="text-[13px] text-ink-2 mt-1">Покрытие держится 3–4 недели. Запишитесь онлайн.</div>
          </div>
          <div className="absolute left-0 top-32 w-72 rounded-2xl bg-white text-ink overflow-hidden shadow-2xl -rotate-3">
            <div className="h-28 bg-[linear-gradient(135deg,#f3e9ec,#e8c9d3)] relative"><span className="absolute left-3 bottom-2 rounded-md bg-white px-2 py-0.5 text-xs font-bold">1 900 ₽</span></div>
            <div className="p-3.5"><div className="text-[11px] text-muted">Студия «Лак» · ВКонтакте</div><div className="font-semibold mt-0.5">Маникюр, который держится 3–4 недели</div></div>
          </div>
          <div className="absolute right-0 bottom-0 w-72 rounded-2xl bg-[#2c3063] border border-white/15 p-4 shadow-2xl">
            <div className="flex items-center gap-2 text-sm"><CircleCheck size={16} className="text-mark" />A/B-тест завершён</div>
            <div className="mt-1 font-bold text-lg">Вариант Б: +34% обращений</div>
            <div className="mt-3 flex items-end gap-1 h-12">{[30, 42, 38, 55, 50, 68, 74].map((h, i) => <span key={i} className={`flex-1 rounded-t ${i > 3 ? "bg-mark" : "bg-white/25"}`} style={{ height: `${h}%` }} />)}</div>
          </div>
        </div>
      </section>
    </main>
  );
}


/* 6. Выдача поисковика: ваша реклама первой */
function V6() {
  return (
    <main className="min-h-dvh bg-white text-ink">
      <Header />
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-10 pb-20 grid lg:grid-cols-[0.85fr_1.15fr] gap-12 items-start">
        <div className="lg:pt-10">
          <h1 className="text-[2.6rem] sm:text-[3.8rem] font-extrabold tracking-[-0.04em] leading-[1.0]">Человек ищет «маникюр рядом». Первым он видит вас.</h1>
          <p className="mt-6 text-lg sm:text-xl text-ink-2 leading-relaxed">Робот сам пишет объявления, подбирает запросы и держит вас в верхних строчках — по цене, которую вы готовы платить.</p>
          <div className="mt-8 flex gap-3"><span className="btn btn-primary h-12 px-6 text-base">Запустить рекламу</span></div>
        </div>
        <div className="rounded-3xl border border-line bg-white shadow-[0_40px_80px_-40px_rgba(29,32,69,0.35)] overflow-hidden">
          <div className="px-5 pt-5 pb-3 border-b border-line">
            <div className="flex items-center gap-3 rounded-full border-2 border-[#ffcc00] px-4 h-12">
              <Search size={18} className="text-muted" />
              <span className="text-lg">маникюр рядом</span><span className="inline-block w-px h-6 bg-ink animate-pulse" />
              <span className="ml-auto text-xs text-faint">Казань</span>
            </div>
            <div className="mt-3 flex gap-5 text-sm text-muted"><span className="text-ink font-semibold border-b-2 border-ink pb-1">Поиск</span><span>Карты</span><span>Картинки</span></div>
          </div>
          <div className="p-5 grid gap-4">
            <div className="relative rounded-2xl ring-[3px] ring-mark p-4 bg-mark-soft/40">
              <span className="absolute -top-3 right-4 rounded-full bg-ink text-white text-[11px] font-bold px-2.5 py-1">это ваша реклама — её сделал робот</span>
              <div className="text-[13px] text-muted">studia-lak.ru · <span className="text-faint">Реклама</span></div>
              <div className="text-[#2a3eb1] text-xl font-semibold leading-snug mt-1">Маникюр с покрытием — 1 900 ₽, Казань</div>
              <div className="text-ink-2 mt-1">Покрытие держится 3–4 недели. Стерилизация в сухожаре. Запишитесь онлайн за минуту.</div>
              <div className="mt-2 flex gap-4 text-sm text-[#2a3eb1]"><span>Цены</span><span>Педикюр</span><span>Наращивание</span><span>Запись онлайн</span></div>
            </div>
            {[["nails-salon.ru", "Ногтевая студия на Пушкина"], ["otzovik.com", "Маникюр рядом — отзывы и адреса"], ["2gis.ru", "Маникюрные салоны Казани: 412 мест"]].map(([h, t], i) => (
              <div key={h} className="px-1" style={{ opacity: 0.55 - i * 0.12 }}>
                <div className="text-[13px] text-muted">{h}</div>
                <div className="text-[#2a3eb1] font-semibold">{t}</div>
                <div className="h-2 rounded bg-paper mt-2 w-4/5" /><div className="h-2 rounded bg-paper mt-1.5 w-3/5" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

/* 7. Стена запросов: за что платим, за что нет */
function V7() {
  const good = ["маникюр рядом", "маникюр с покрытием цена", "педикюр казань", "наращивание ногтей запись", "маникюр баумана", "ногтевая студия", "маникюр сегодня", "покрытие гель лак"];
  const bad = ["маникюр обучение", "лампа для ногтей", "вакансии мастер маникюра", "маникюр своими руками", "фрезы для маникюра", "курсы ногтевого сервиса", "гель лак купить", "маникюр фото идеи"];
  const row = (shift: number) => [...good, ...bad].map((_, i, a) => a[(i * 5 + shift) % a.length]);
  const Chip = ({ q }: { q: string }) => bad.includes(q)
    ? <span className="shrink-0 rounded-full border border-line px-5 py-2.5 text-xl text-faint line-through decoration-bad decoration-2">{q}</span>
    : <span className="shrink-0 rounded-full bg-mark px-5 py-2.5 text-xl font-semibold">{q}</span>;
  return (
    <main className="min-h-dvh bg-paper text-ink overflow-hidden">
      <Header />
      <section className="pt-12 pb-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 text-center">
          <h1 className="text-[2.6rem] sm:text-[4.4rem] font-extrabold tracking-[-0.045em] leading-[0.98] max-w-[16ch] mx-auto">Платите только за тех, кто хочет к вам</h1>
          <p className="mt-6 text-lg sm:text-xl text-ink-2 max-w-2xl mx-auto">Каждый день робот разбирает, по каким запросам показывалась реклама, и вычёркивает лишние. Жёлтые — ваши клиенты. Зачёркнутые — больше ни рубля.</p>
        </div>
        <div className="mt-12 grid gap-3 [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
          {[0, 3, 6].map((sh, r) => (
            <div key={sh} className="overflow-hidden">
              <div className={`flex gap-3 w-max ${r % 2 ? "lp-marquee-rev" : "lp-marquee"}`}>
                {[...row(sh), ...row(sh)].map((q, i) => <Chip key={i} q={q} />)}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-12 flex justify-center gap-3"><span className="btn btn-primary h-12 px-6 text-base">Запустить рекламу</span><span className="btn btn-ghost h-12 px-6 text-base">Как это работает</span></div>
      </section>
    </main>
  );
}

/* 8. Уведомления на экране телефона */
function V8() {
  const n = [
    ["сейчас", "Новая заявка из рекламы", "Анна, маникюр с покрытием, завтра 18:00"],
    ["9:15", "Робот запустил A/B-тест", "Заголовок с ценой против заголовка с выгодой"],
    ["9:11", "Бюджет перенесён", "+15% во ВКонтакте — там обращение дешевле"],
    ["9:04", "Сэкономлено 460 ₽ в неделю", "Больше не платим за «маникюр обучение»"],
  ];
  return (
    <main className="min-h-dvh bg-[#e9e7f5] text-ink overflow-hidden">
      <Header />
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-8 grid lg:grid-cols-[1fr_auto] gap-12 items-center">
        <div className="pb-16">
          <h1 className="text-[2.6rem] sm:text-[4rem] font-extrabold tracking-[-0.04em] leading-[1.0]">Реклама, о которой вы узнаёте из уведомлений</h1>
          <p className="mt-6 text-lg sm:text-xl text-ink-2 leading-relaxed max-w-[32rem]">Настраивать и следить больше не нужно. Робот ведёт рекламу в Яндексе и VK, а вам приходят только заявки и короткие сводки в Telegram.</p>
          <div className="mt-8 flex gap-3"><span className="btn btn-primary h-12 px-6 text-base">Запустить рекламу</span></div>
        </div>
        <div className="relative w-[320px] h-[600px] mx-auto rounded-t-[3rem] bg-[linear-gradient(160deg,#2b2f63,#1d2045_45%,#4b3a68)] p-3 pb-0 self-end shadow-[0_-20px_60px_-20px_rgba(29,32,69,0.5)]">
          <div className="text-center text-white pt-10">
            <div className="text-sm opacity-80">четверг, 29 октября</div>
            <div className="text-7xl font-semibold tracking-tight mt-1">9:41</div>
          </div>
          <div className="mt-8 grid gap-2 px-1">
            {n.map(([t, a, b], i) => (
              <div key={a} className="lp-pop rounded-2xl bg-white/85 backdrop-blur px-3 py-2.5 flex gap-2.5" style={{ animationDelay: `${300 + i * 350}ms` }}>
                <span className="w-8 h-8 rounded-lg bg-ink grid place-items-center shrink-0"><span className="grid grid-cols-2 gap-0.5">{[0, 1, 2, 3].map((k) => <span key={k} className="w-1.5 h-1.5 rounded-[2px] bg-mark" />)}</span></span>
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between text-[11px] text-muted"><span>Полный зал</span><span>{t}</span></div>
                  <div className="text-[13px] font-bold leading-snug">{a}</div>
                  <div className="text-[12px] text-ink-2 leading-snug">{b}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

/* 9. Квитанция: куда ушёл каждый рубль */
function V9() {
  const rows: [string, string, boolean?][] = [["Поиск Яндекса", "11 820 ₽"], ["ВКонтакте", "8 460 ₽"], ["Сайты Яндекса", "4 680 ₽"], ["Мусорные клики", "0 ₽", true], ["Работа директолога", "0 ₽", true]];
  return (
    <main className="min-h-dvh bg-paper text-ink overflow-hidden">
      <Header />
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-10 pb-20 grid lg:grid-cols-[1.1fr_0.9fr] gap-12 items-center">
        <div>
          <h1 className="text-[2.6rem] sm:text-[4rem] font-extrabold tracking-[-0.04em] leading-[1.0]">Каждый рубль рекламы — с объяснением, куда он ушёл</h1>
          <p className="mt-6 text-lg sm:text-xl text-ink-2 leading-relaxed max-w-[32rem]">Робот ведёт рекламу в Яндексе и VK, не платит за мусор и раз в неделю показывает простой итог: сколько потрачено и что это принесло.</p>
          <div className="mt-8 flex gap-3"><span className="btn btn-primary h-12 px-6 text-base">Запустить рекламу</span></div>
        </div>
        <div className="mx-auto w-[340px] rotate-[-2deg]">
          <div className="bg-white px-6 pt-7 pb-6 font-mono text-[13px] shadow-[0_30px_60px_-30px_rgba(29,32,69,0.45)]">
            <div className="text-center font-sans font-extrabold text-lg">ПОЛНЫЙ ЗАЛ</div>
            <div className="text-center text-muted">итог недели · 21–27 октября</div>
            <div className="my-4 border-t border-dashed border-line-2" />
            {rows.map(([k, v, z]) => (
              <div key={k} className={`flex justify-between py-1 ${z ? "text-good" : ""}`}><span>{k}</span><span className="tabular-nums">{v}</span></div>
            ))}
            <div className="my-4 border-t border-dashed border-line-2" />
            <div className="flex justify-between font-bold text-base"><span>ИТОГО</span><span>24 960 ₽</span></div>
            <div className="flex justify-between mt-1"><span>Обращений</span><span>58</span></div>
            <div className="flex justify-between"><span>Одно обращение</span><span className="bg-mark px-1">430 ₽</span></div>
            <div className="my-4 border-t border-dashed border-line-2" />
            <div className="text-center text-muted">сэкономлено на мусоре: 3 140 ₽</div>
            <div className="mt-3 flex justify-center gap-[2px] h-8">{Array.from({ length: 38 }).map((_, i) => <span key={i} className="bg-ink" style={{ width: [1, 2, 1, 3][i % 4] }} />)}</div>
          </div>
          <div className="h-3 bg-[linear-gradient(135deg,white_25%,transparent_25%),linear-gradient(225deg,white_25%,transparent_25%)] bg-[length:12px_12px]" />
        </div>
      </section>
    </main>
  );
}

/* 10. Один большой график: цена обращения падает, события робота на линии */
function V10() {
  const pts = [92, 88, 90, 84, 80, 76, 78, 70, 66, 63, 60, 57, 55, 52];
  const W = 1000, H = 300;
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => H - ((v - 40) / 60) * H;
  const d = pts.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  const ev = [[3, "минус-слова"], [6, "тест заголовка"], [9, "бюджет → VK"], [12, "слабое объявление выкл."]] as const;
  return (
    <main className="min-h-dvh bg-white text-ink overflow-hidden">
      <Header />
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-10 pb-16">
        <div className="grid lg:grid-cols-[1fr_auto] gap-8 items-end">
          <h1 className="text-[2.6rem] sm:text-[4.2rem] font-extrabold tracking-[-0.045em] leading-[0.98] max-w-[16ch]">Вы занимаетесь клиентами. Цена обращения падает сама.</h1>
          <div className="pb-2"><span className="btn btn-primary h-12 px-6 text-base">Запустить рекламу</span></div>
        </div>
        <div className="mt-10 relative">
          <div className="flex items-baseline justify-between text-sm text-muted"><span>Цена обращения, ₽ · 14 дней</span><span><b className="text-ink text-2xl">520 ₽</b> → <b className="text-ink text-4xl">310 ₽</b></span></div>
          <svg viewBox={`0 0 ${W} ${H + 40}`} className="mt-3 w-full h-auto overflow-visible">
            {[0, 1, 2, 3].map((k) => <line key={k} x1="0" x2={W} y1={(H / 3) * k} y2={(H / 3) * k} stroke="var(--color-line)" />)}
            <path d={`${d} L${W},${H} L0,${H} Z`} fill="var(--color-mark-soft)" />
            <path d={d} fill="none" stroke="var(--color-ink)" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
            {ev.map(([i, t]) => (
              <g key={t}>
                <line x1={x(i)} x2={x(i)} y1={y(pts[i])} y2={H} stroke="var(--color-ink)" strokeDasharray="4 5" opacity=".35" />
                <circle cx={x(i)} cy={y(pts[i])} r="9" fill="var(--color-mark)" stroke="var(--color-ink)" strokeWidth="3" />
                <text x={x(i)} y={y(pts[i]) - 22} textAnchor={i >= 12 ? "end" : "middle"} fontSize="20" fontWeight="700" fill="var(--color-ink)">{t}</text>
              </g>
            ))}
            {["пн", "ср", "пт", "вс", "вт", "чт", "сб"].map((dd, k) => <text key={dd + k} x={(W / 6) * k} y={H + 32} fontSize="16" fill="var(--color-muted)" textAnchor={k === 0 ? "start" : k === 6 ? "end" : "middle"}>{dd}</text>)}
          </svg>
          <p className="mt-2 text-sm text-faint">Пример: студия маникюра, первые две недели с роботом.</p>
        </div>
      </section>
    </main>
  );
}


/* 11. Заголовок из плашек, ниша меняется */
function V11() {
  const P = ({ c, children }: { c: string; children: React.ReactNode }) => <span className={`inline-flex items-center rounded-[1.1rem] px-4 sm:px-5 py-1 sm:py-1.5 ${c}`}>{children}</span>;
  return (
    <main className="min-h-dvh bg-white text-ink overflow-hidden">
      <Header />
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-16 sm:pt-24 pb-24 text-center">
        <h1 className="flex flex-wrap justify-center gap-2.5 sm:gap-3 text-[2.2rem] sm:text-[4rem] font-extrabold tracking-[-0.04em] leading-none">
          <P c="bg-ink text-white">Реклама</P><P c="bg-mark">в Яндексе и VK</P><P c="border-2 border-ink">на автопилоте</P>
          <span className="basis-full h-0" />
          <P c="bg-paper">для</P>
          <P c="bg-good-soft text-good min-w-[7ch] justify-center"><Rotator words={["маникюра", "барбершопа", "остеопата", "йоги", "массажа", "косметолога"]} /></P>
          <span className="relative">
            <P c="border-2 border-dashed border-line-2 text-faint">и вас</P>
            <MousePointer2 className="absolute -right-5 -bottom-5 w-8 h-8 fill-white text-ink" />
          </span>
        </h1>
        <p className="mt-8 text-lg sm:text-xl text-ink-2 max-w-2xl mx-auto">Робот настраивает рекламу под вашу нишу, каждый день убирает лишние траты и переносит бюджет туда, где обращения дешевле.</p>
        <div className="mt-9 flex justify-center gap-3"><span className="btn btn-primary h-12 px-6 text-base">Запустить рекламу</span><span className="btn btn-ghost h-12 px-6 text-base">Как это работает</span></div>
      </section>
    </main>
  );
}

/* 12. Утро: робот уже сделал 4 вещи */
function V12() {
  return (
    <main className="min-h-dvh bg-paper text-ink">
      <Header />
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-10 sm:pt-16 pb-20 grid lg:grid-cols-[1fr_1fr] gap-12 items-center">
        <div>
          <h1 className="text-[2.6rem] sm:text-[4rem] font-extrabold tracking-[-0.04em] leading-[1.0]">Доброе утро. Робот уже навёл порядок в рекламе.</h1>
          <p className="mt-6 text-lg sm:text-xl text-ink-2 leading-relaxed max-w-[32rem]">Каждое утро он разбирает Яндекс и VK, делает то, что сделал бы директолог, и коротко объясняет. Не согласны — отменяете одной кнопкой.</p>
          <div className="mt-8 flex gap-3"><span className="btn btn-primary h-12 px-6 text-base">Запустить рекламу</span></div>
        </div>
        <div className="rounded-3xl bg-white border border-line p-5 sm:p-6 shadow-[0_40px_80px_-40px_rgba(29,32,69,0.35)]">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-ink grid place-items-center"><span className="grid grid-cols-3 gap-0.5">{Array.from({ length: 9 }).map((_, k) => <span key={k} className="w-1.5 h-1.5 rounded-[2px] bg-mark" />)}</span></span>
            <div><div className="font-bold">Доброе утро, Анна</div><div className="text-sm text-muted">Робот проверил 5 кампаний · 09:12</div></div>
          </div>
          <div className="mt-5"><Recs /></div>
        </div>
      </section>
    </main>
  );
}

/* 13. Вкладки по нишам */
function V13() {
  return (
    <main className="min-h-dvh bg-paper text-ink">
      <Header />
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-10 sm:pt-16 pb-20 grid lg:grid-cols-[1fr_1fr] gap-12 items-center">
        <div>
          <h1 className="text-[2.6rem] sm:text-[4rem] font-extrabold tracking-[-0.04em] leading-[1.0]">Реклама, которая знает ваш бизнес</h1>
          <p className="mt-6 text-lg sm:text-xl text-ink-2 leading-relaxed max-w-[32rem]">Робот знает, как ищут вашу услугу, какие запросы мусорные и что пропустит модерация. Выберите нишу — посмотрите, что он подготовит.</p>
          <div className="mt-8 flex gap-3"><span className="btn btn-primary h-12 px-6 text-base">Запустить рекламу</span></div>
        </div>
        <NicheTabs />
      </section>
    </main>
  );
}

/* 14. Команда словами (концепт) */
function V14() {
  return (
    <main className="min-h-dvh bg-white text-ink">
      <Header />
      <section className="mx-auto max-w-4xl px-4 sm:px-6 pt-16 sm:pt-24 pb-24">
        <h1 className="text-center text-[2.6rem] sm:text-[4.2rem] font-extrabold tracking-[-0.045em] leading-[0.98]">Управляйте рекламой как сотрудником — словами</h1>
        <p className="mt-6 text-center text-lg sm:text-xl text-ink-2 max-w-2xl mx-auto">Не нужно искать настройку в кабинете Директа. Скажите, что изменить, — робот сделает во всех кампаниях и отчитается.</p>
        <div className="mt-10"><Command /></div>
        <div className="mt-10 flex justify-center gap-3"><span className="btn btn-primary h-12 px-6 text-base">Запустить рекламу</span></div>
      </section>
    </main>
  );
}

/* 15. Карта: реклама находит тех, кто рядом */
function V15() {
  const dots = Array.from({ length: 70 }, (_, i) => {
    const a = (i * 137.5) * Math.PI / 180, r = 40 + ((i * 53) % 260);
    return { x: 400 + Math.cos(a) * r, y: 260 + Math.sin(a) * r * 0.75, on: r < 170 && i % 3 !== 0 };
  });
  return (
    <main className="min-h-dvh bg-white text-ink overflow-hidden">
      <Header />
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-10 sm:pt-16 pb-16 grid lg:grid-cols-[0.9fr_1.1fr] gap-10 items-center">
        <div>
          <h1 className="text-[2.6rem] sm:text-[4rem] font-extrabold tracking-[-0.04em] leading-[1.0]">Реклама для тех, кто живёт в 3 км от вас</h1>
          <p className="mt-6 text-lg sm:text-xl text-ink-2 leading-relaxed max-w-[32rem]">Робот показывает рекламу людям рядом, которые ищут вашу услугу, и не тратит бюджет на весь город.</p>
          <ul className="mt-6 grid gap-2 text-ink-2">{["Радиус вокруг адреса во ВКонтакте", "Поиск Яндекса в вашем городе", "Часы показа — по часам работы"].map((x) => <li key={x} className="flex gap-2"><Check size={18} className="text-good mt-0.5" />{x}</li>)}</ul>
          <div className="mt-8 flex gap-3"><span className="btn btn-primary h-12 px-6 text-base">Запустить рекламу</span></div>
        </div>
        <div className="relative rounded-3xl bg-[#eef1f6] overflow-hidden aspect-[8/5.2] border border-line">
          <svg viewBox="0 0 800 520" className="absolute inset-0 w-full h-full">
            {[60, 150, 250, 340, 430].map((y, k) => <path key={y} d={`M0 ${y} C 200 ${y + (k % 2 ? 30 : -25)}, 500 ${y + (k % 2 ? -30 : 25)}, 800 ${y}`} stroke="white" strokeWidth={k === 2 ? 14 : 8} fill="none" />)}
            {[90, 260, 420, 560, 700].map((x, k) => <path key={x} d={`M${x} 0 C ${x + (k % 2 ? 30 : -20)} 200, ${x + (k % 2 ? -25 : 30)} 330, ${x} 520`} stroke="white" strokeWidth={k === 2 ? 14 : 8} fill="none" />)}
            <path d="M560 420 q60 -40 140 -10 l 0 110 l -160 0 z" fill="#d7ead6" />
            <ellipse cx="400" cy="260" rx="190" ry="142" fill="rgba(255,216,74,0.18)" stroke="var(--color-ink)" strokeWidth="2.5" strokeDasharray="8 8" />
            {dots.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r={d.on ? 7 : 5} fill={d.on ? "var(--color-mark)" : "#b9c0d3"} stroke={d.on ? "var(--color-ink)" : "none"} strokeWidth="2" className={d.on ? "lp-pop" : ""} style={d.on ? { animationDelay: `${300 + i * 30}ms` } : undefined} />)}
            <g transform="translate(400 260)"><circle r="22" fill="var(--color-ink)" /><text y="7" textAnchor="middle" fontSize="20" fill="var(--color-mark)" fontWeight="800">●</text></g>
          </svg>
          <div className="absolute left-[50%] top-[50%] translate-x-4 -translate-y-14 rounded-xl bg-ink text-white px-3 py-1.5 text-sm font-semibold shadow-lg">Студия «Лак» · ул. Баумана</div>
          <div className="absolute right-4 top-4 rounded-xl bg-white px-3 py-2 text-sm shadow"><b>3 км</b> <span className="text-muted">радиус</span></div>
          <div className="absolute left-4 bottom-4 rounded-xl bg-white px-3 py-2 text-sm shadow flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-mark border-2 border-ink" />видят рекламу <span className="w-3 h-3 rounded-full bg-[#b9c0d3] ml-2" />далеко — не тратим</div>
        </div>
      </section>
    </main>
  );
}


/* ─── Премиальные черновики ─────────────────────────────────────── */

function PillNav({ dark = false }: { dark?: boolean }) {
  return (
    <div className="pt-5 px-4 flex justify-center relative z-20">
      <nav className={`flex items-center gap-1 rounded-full pl-4 pr-1.5 py-1.5 backdrop-blur-xl ${dark ? "bg-white/[0.06] ring-1 ring-white/10 text-white" : "bg-white/70 ring-1 ring-black/[0.06] shadow-[0_10px_40px_-20px_rgba(29,32,69,0.25)]"}`}>
        <span className="flex items-center gap-2 pr-4 font-bold tracking-tight"><LogoMark size={22} />Полный зал</span>
        <span className={`hidden md:flex items-center gap-1 text-[13.5px] ${dark ? "text-white/60" : "text-ink-2"}`}>
          {["Как работает", "Возможности", "Клиенты", "Вопросы"].map((x) => <span key={x} className={`px-3 py-1.5 rounded-full ${dark ? "hover:bg-white/10" : "hover:bg-black/5"}`}>{x}</span>)}
        </span>
        <span className={`ml-2 rounded-full px-4 py-2 text-[13.5px] font-semibold ${dark ? "bg-white text-ink" : "bg-ink text-white"}`}>Начать</span>
      </nav>
    </div>
  );
}

function Cta({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <span className={`group inline-flex items-center gap-3 rounded-full pl-6 pr-1.5 py-1.5 text-[15px] font-semibold transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] ${dark ? "bg-mark text-ink" : "bg-ink text-white"}`}>
      {children}
      <span className={`w-9 h-9 rounded-full grid place-items-center transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:-translate-y-px ${dark ? "bg-ink/10" : "bg-white/15"}`}><ArrowUpRight size={16} strokeWidth={1.75} /></span>
    </span>
  );
}

const NOISE = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='.5'/></svg>\")";

/* 16. Тёмный, кинематографичный: продукт под наклоном в стеклянной раме */
function V16() {
  return (
    <main className="min-h-[100dvh] bg-[#07081a] text-white overflow-hidden relative">
      <div className="pointer-events-none fixed inset-0 opacity-[0.05] mix-blend-overlay" style={{ backgroundImage: NOISE }} aria-hidden />
      <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[70rem] h-[40rem] rounded-full bg-[radial-gradient(closest-side,rgba(255,216,74,0.16),transparent)]" aria-hidden />
      <div className="pointer-events-none absolute top-60 -left-40 w-[40rem] h-[40rem] rounded-full bg-[radial-gradient(closest-side,rgba(99,102,241,0.18),transparent)]" aria-hidden />
      <div className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)]" aria-hidden />
      <PillNav dark />
      <section className="relative mx-auto max-w-6xl px-4 sm:px-6 pt-20 sm:pt-28 text-center">
        <span className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] ring-1 ring-white/10 px-3.5 py-1.5 text-[12.5px] text-white/70">
          <span className="relative flex w-1.5 h-1.5"><span className="absolute inset-0 rounded-full bg-mark animate-ping opacity-70" /><span className="relative w-1.5 h-1.5 rounded-full bg-mark" /></span>
          Автопилот для Яндекс Директа и VK Рекламы
        </span>
        <h1 className="mt-8 text-[3rem] sm:text-[5.6rem] font-semibold tracking-[-0.055em] leading-[0.92] bg-[linear-gradient(180deg,#fff_30%,rgba(255,255,255,0.55))] bg-clip-text text-transparent">
          Ваш рекламный отдел.<br />Без отдела.
        </h1>
        <p className="mt-8 mx-auto max-w-[36rem] text-[1.15rem] sm:text-xl text-white/60 leading-relaxed font-light">Робот настраивает рекламу в Яндексе и VK, каждый день убирает лишние траты и переносит бюджет туда, где он приносит заявки.</p>
        <div className="mt-10 flex flex-wrap justify-center items-center gap-4">
          <Cta dark>Запустить рекламу</Cta>
          <span className="rounded-full px-6 py-3.5 text-[15px] text-white/80 ring-1 ring-white/15 hover:bg-white/5">Как это работает</span>
        </div>
      </section>
      <section className="relative mx-auto max-w-[76rem] px-4 sm:px-6 mt-20 pb-24 [perspective:2000px]">
        <div className="absolute inset-x-20 top-24 h-80 rounded-full bg-mark/25 blur-[120px]" aria-hidden />
        <div className="relative [transform:rotateX(14deg)] origin-top rounded-[2.2rem] p-2 bg-white/[0.06] ring-1 ring-white/10 shadow-[0_80px_160px_-40px_rgba(0,0,0,0.8)]">
          <div className="rounded-[calc(2.2rem-0.5rem)] overflow-hidden shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)] bg-white text-ink p-4 sm:p-6">
            <HeroDemo />
          </div>
        </div>
        <div className="absolute -left-2 top-40 hidden lg:flex items-center gap-3 rounded-2xl bg-[#13153a]/90 ring-1 ring-white/10 px-4 py-3 shadow-2xl lp-pop" style={{ animationDelay: "900ms" }}>
          <span className="w-9 h-9 rounded-xl bg-mark text-ink grid place-items-center"><TrendingDown size={17} strokeWidth={1.75} /></span>
          <div><div className="text-[11px] text-white/50">за неделю</div><div className="font-semibold">−3 140 ₽ лишних трат</div></div>
        </div>
        <div className="absolute -right-2 top-72 hidden lg:flex items-center gap-3 rounded-2xl bg-[#13153a]/90 ring-1 ring-white/10 px-4 py-3 shadow-2xl lp-pop" style={{ animationDelay: "1400ms" }}>
          <CircleCheck size={20} strokeWidth={1.75} className="text-mark" />
          <div><div className="text-[11px] text-white/50">A/B-тест</div><div className="font-semibold">+34% обращений</div></div>
        </div>
      </section>
      <section className="relative mx-auto max-w-6xl px-4 sm:px-6 pb-24">
        <p className="text-center text-[12px] uppercase tracking-[0.25em] text-white/35">Рекламу с нами ведут</p>
        <div className="mt-8 flex flex-wrap justify-center items-center gap-x-14 gap-y-6 opacity-60 [&_img]:[filter:brightness(0)_invert(1)]">
          <img src="/clients/sushkof.svg" alt="Сушкоф" className="h-8" /><span className="flex items-center gap-2 text-xl font-semibold"><img src="/clients/goulash-mark.svg" alt="" className="h-7 w-7 !filter-none grayscale" />Goulash.tech</span><img src="/clients/delpesto.png" alt="Del Pesto" className="h-10" /><img src="/clients/lifemart.svg" alt="Жизньмарт" className="h-10" />
        </div>
      </section>
    </main>
  );
}

/* 17. Светлый, «мягкая структура»: асимметричный бенто с живыми деталями */
function Bezel({ children, className = "", inner = "" }: { children: React.ReactNode; className?: string; inner?: string }) {
  return (
    <div className={`rounded-[2rem] p-1.5 bg-black/[0.03] ring-1 ring-black/[0.05] ${className}`}>
      <div className={`h-full rounded-[calc(2rem-0.375rem)] ${/bg-/.test(inner) ? "" : "bg-white"} shadow-[inset_0_1px_1px_rgba(255,255,255,0.9),0_30px_60px_-30px_rgba(29,32,69,0.18)] ${inner}`}>{children}</div>
    </div>
  );
}

function V17() {
  const days = [44, 52, 40, 61, 58, 70, 66, 79, 74, 86];
  return (
    <main className="min-h-[100dvh] bg-[#f3f4f7] text-ink overflow-hidden">
      <PillNav />
      <section className="mx-auto max-w-[72rem] px-4 sm:px-6 pt-20 sm:pt-28 pb-28">
        <div className="grid lg:grid-cols-[1.15fr_0.85fr] gap-10 items-end">
          <div>
            <span className="inline-flex rounded-full bg-white ring-1 ring-black/[0.06] px-3 py-1 text-[10.5px] uppercase tracking-[0.2em] font-semibold text-ink-2">Яндекс Директ · VK Реклама</span>
            <h1 className="mt-7 text-[3rem] sm:text-[5.4rem] font-bold tracking-[-0.055em] leading-[0.9]">Реклама работает.<br /><span className="text-ink/35">Вы — нет.</span></h1>
          </div>
          <div className="lg:pb-3">
            <p className="text-lg text-ink-2 leading-relaxed">Робот делает всю работу директолога: настраивает, запускает и каждый день оптимизирует рекламу, чтобы бюджет приносил заявки, а не клики.</p>
            <div className="mt-7"><Cta>Запустить рекламу</Cta></div>
          </div>
        </div>

        <div className="mt-16 grid grid-cols-1 md:grid-cols-12 gap-4 md:auto-rows-[12.5rem]">
          <Bezel className="md:col-span-7 md:row-span-2" inner="p-7 flex flex-col">
            <div className="flex items-center justify-between text-sm"><span className="text-muted">Цена обращения</span><span className="rounded-full bg-good-soft text-good px-2.5 py-0.5 text-xs font-semibold">−41% за 2 недели</span></div>
            <div className="mt-2 flex items-baseline gap-3"><span className="text-6xl font-bold tracking-[-0.04em]">310 ₽</span><span className="text-xl text-faint line-through">520 ₽</span></div>
            <div className="mt-auto flex items-end gap-2 h-36">
              {days.map((h, i) => <span key={i} className={`lp-bar flex-1 rounded-[10px] ${i >= 6 ? "bg-ink" : "bg-[#e4e6ee]"}`} style={{ height: `${110 - h}%`, animationDelay: `${i * 60}ms` }} />)}
            </div>
          </Bezel>
          <Bezel className="md:col-span-5" inner="p-6 flex flex-col justify-between bg-mark">
            <div className="text-sm text-ink/70">Не заплатили за мусор</div>
            <div><div className="text-5xl font-bold tracking-[-0.04em]">3 140 ₽</div><div className="text-sm text-ink/70 mt-1">«обучение», «вакансии», «своими руками»</div></div>
          </Bezel>
          <Bezel className="md:col-span-5" inner="p-6 flex flex-col justify-between">
            <div className="text-sm text-muted">Сегодня, 09:12</div>
            <div className="grid gap-2 text-[14px]">
              {["Минус-слово «обучение»", "+15% бюджета во ВКонтакте", "Выключено слабое объявление"].map((x, i) => (
                <div key={x} className="flex items-center gap-2.5 lp-pop" style={{ animationDelay: `${600 + i * 250}ms` }}><span className="w-5 h-5 rounded-full bg-ink text-mark grid place-items-center"><Check size={11} strokeWidth={3} /></span>{x}</div>
              ))}
            </div>
          </Bezel>
          <Bezel className="md:col-span-4" inner="p-6 flex flex-col justify-between">
            <div className="text-sm text-muted">Запуск</div>
            <div className="text-5xl font-bold tracking-[-0.04em]">15 мин</div>
            <div className="text-sm text-muted">вместо недели работы специалиста</div>
          </Bezel>
          <Bezel className="md:col-span-4" inner="p-6 flex flex-col justify-between">
            <div className="text-sm text-muted">Каналы</div>
            <div className="flex -space-x-2">{[["Я", "#fc3f1d"], ["VK", "#0077ff"], ["Р", "#1d2045"], ["◎", "#ffd84a"]].map(([l, c]) => <span key={c} className="w-12 h-12 rounded-full ring-4 ring-white grid place-items-center text-white font-bold" style={{ background: c }}>{l}</span>)}</div>
            <div className="text-sm text-muted">поиск, сети, ВКонтакте, ретаргетинг</div>
          </Bezel>
          <Bezel className="md:col-span-4" inner="p-6 flex flex-col justify-between bg-ink text-white">
            <div className="text-sm text-white/60">Сверх лимита</div>
            <div className="text-5xl font-bold tracking-[-0.04em] text-mark">0 ₽</div>
            <div className="text-sm text-white/60">бюджет — жёсткая граница</div>
          </Bezel>
        </div>
      </section>
    </main>
  );
}


/* 18. Тёмный: один экран кабинета в тёмной теме */
function DarkShot() {
  const week = [
    { d: "Пт", s: 58, l: 3 }, { d: "Сб", s: 46, l: 4 }, { d: "Вс", s: 52, l: 3 }, { d: "Пн", s: 63, l: 5 },
    { d: "Вт", s: 70, l: 6 }, { d: "Ср", s: 66, l: 6 }, { d: "Чт", s: 64, l: 8 },
  ];
  const nav = ["Главное", "Реклама", "Статистика", "История", "Настройки"];
  return (
    <div className="rounded-[1.6rem] overflow-hidden bg-[#0d0f26] ring-1 ring-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] text-left">
      <div className="h-11 flex items-center gap-2 px-4 border-b border-white/[0.06]">
        <span className="w-2.5 h-2.5 rounded-full bg-white/15" /><span className="w-2.5 h-2.5 rounded-full bg-white/15" /><span className="w-2.5 h-2.5 rounded-full bg-white/15" />
        <span className="mx-auto text-[11px] text-white/35 rounded-md bg-white/[0.04] px-3 py-1">polny-zal.ru/app</span>
      </div>
      <div className="grid md:grid-cols-[13rem_minmax(0,1fr)]">
        <aside className="hidden md:flex flex-col gap-5 p-4 border-r border-white/[0.06]">
          <span className="flex items-center gap-2 font-semibold"><LogoMark size={22} />Полный зал</span>
          <span className="flex items-center gap-2 rounded-xl bg-white/[0.04] ring-1 ring-white/[0.06] px-2.5 py-2 text-sm"><span className="w-6 h-6 rounded-md bg-mark text-ink grid place-items-center text-xs font-bold">С</span>Студия Лак</span>
          <nav className="grid gap-0.5 text-[13.5px]">
            {nav.map((t, i) => <span key={t} className={`rounded-lg px-2.5 py-2 ${i === 0 ? "bg-white/[0.08] text-white" : "text-white/45"}`}>{t}</span>)}
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
              <div className="mt-1 text-xl sm:text-[1.6rem] font-semibold tracking-tight leading-snug max-w-[34rem]">Реклама привела <span className="text-mark">33 обращения</span>. Одно обошлось в <span className="text-mark">414 ₽</span> — на 28% дешевле, чем на старте.</div>
            </div>
            <span className="rounded-full bg-[#3ddc97]/10 text-[#3ddc97] ring-1 ring-[#3ddc97]/20 px-3 py-1 text-[12px] font-semibold">Здоровье рекламы 86</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px rounded-2xl overflow-hidden bg-white/[0.06]">
            {[["Потрачено", "13 660 ₽", "из 18 000 ₽ лимита"], ["Обращения", "33", "+50% к прошлой неделе"], ["Цена обращения", "414 ₽", "−28% со старта"], ["Сэкономлено", "3 140 ₽", "на мусорных кликах"]].map(([k, v, s], i) => (
              <div key={k} className="bg-[#0d0f26] p-4">
                <div className="text-[12px] text-white/40">{k}</div>
                <div className={`mt-1 text-2xl font-semibold tracking-tight tabular-nums ${i === 3 ? "text-mark" : ""}`}>{v}</div>
                <div className={`text-[11.5px] ${i === 1 || i === 2 ? "text-[#3ddc97]" : "text-white/35"}`}>{s}</div>
              </div>
            ))}
          </div>
          <div className="grid lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-4">
            <div className="rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.06] p-4">
              <div className="flex justify-between text-[12px] text-white/40"><span>Расход и обращения</span><span className="flex gap-3"><span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-white/20" />расход</span><span className="flex items-center gap-1.5"><span className="w-2 h-[3px] rounded bg-mark" />обращение</span></span></div>
              <div className="mt-4 flex items-end justify-between h-44 px-1">
                {week.map((w, i) => (
                  <div key={w.d} className="flex flex-col items-center gap-[3px] w-7">
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

function V18() {
  return (
    <main className="min-h-[100dvh] bg-[#07081a] text-white overflow-hidden relative">
      <div className="pointer-events-none fixed inset-0 opacity-[0.05] mix-blend-overlay" style={{ backgroundImage: NOISE }} aria-hidden />
      <div className="pointer-events-none absolute -top-48 left-1/2 -translate-x-1/2 w-[72rem] h-[42rem] rounded-full bg-[radial-gradient(closest-side,rgba(255,216,74,0.14),transparent)]" aria-hidden />
      <div className="pointer-events-none absolute top-[38rem] -left-60 w-[46rem] h-[46rem] rounded-full bg-[radial-gradient(closest-side,rgba(99,102,241,0.16),transparent)]" aria-hidden />
      <div className="pointer-events-none absolute top-[44rem] -right-60 w-[40rem] h-[40rem] rounded-full bg-[radial-gradient(closest-side,rgba(255,216,74,0.08),transparent)]" aria-hidden />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[60rem] [background-image:linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(ellipse_at_top,black_15%,transparent_65%)]" aria-hidden />
      <PillNav dark />
      <section className="relative mx-auto max-w-6xl px-4 sm:px-6 pt-20 sm:pt-28 text-center">
        <span className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] ring-1 ring-white/10 px-3.5 py-1.5 text-[12.5px] text-white/70">
          <span className="relative flex w-1.5 h-1.5"><span className="absolute inset-0 rounded-full bg-mark animate-ping opacity-70" /><span className="relative w-1.5 h-1.5 rounded-full bg-mark" /></span>
          Автопилот для Яндекс Директа и VK Рекламы
        </span>
        <h1 className="mt-8 text-[3rem] sm:text-[5.6rem] font-semibold tracking-[-0.055em] leading-[0.92] bg-[linear-gradient(180deg,#fff_30%,rgba(255,255,255,0.55))] bg-clip-text text-transparent">Ваш рекламный отдел.<br />Без отдела.</h1>
        <p className="mt-8 mx-auto max-w-[36rem] text-[1.15rem] sm:text-xl text-white/60 leading-relaxed font-light">Робот настраивает рекламу в Яндексе и VK, каждый день убирает лишние траты и переносит бюджет туда, где он приносит заявки.</p>
        <div className="mt-10 flex flex-wrap justify-center items-center gap-4">
          <Cta dark>Запустить рекламу</Cta>
          <span className="rounded-full px-6 py-3.5 text-[15px] text-white/80 ring-1 ring-white/15">Как это работает</span>
        </div>
      </section>
      <section className="relative mx-auto max-w-[74rem] px-4 sm:px-6 mt-20 pb-28">
        <div className="absolute inset-x-24 top-10 h-72 rounded-full bg-mark/20 blur-[130px]" aria-hidden />
        <div className="relative rounded-[2rem] p-2 bg-white/[0.05] ring-1 ring-white/10 shadow-[0_80px_160px_-40px_rgba(0,0,0,0.85)]">
          <DarkShot />
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#07081a] to-transparent" aria-hidden />
      </section>
    </main>
  );
}

export default async function Variant({ params }: { params: Promise<{ v: string }> }) {
  const { v } = await params;
  const C = { "1": V1, "2": V2, "3": V3, "4": V4, "5": V5, "6": V6, "7": V7, "8": V8, "9": V9, "10": V10, "11": V11, "12": V12, "13": V13, "14": V14, "15": V15, "16": V16, "17": V17, "18": V18 }[v];
  if (!C) notFound();
  return <C />;
}

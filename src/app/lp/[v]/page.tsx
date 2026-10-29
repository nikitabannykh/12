import { notFound } from "next/navigation";
import { MousePointer2, ArrowRight, Ban, Check, CircleCheck, FlaskConical, Globe, PauseCircle, Scale, Search, Sparkles, TrendingDown, X } from "lucide-react";
import { Logo } from "@/components/Logo";
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

export default async function Variant({ params }: { params: Promise<{ v: string }> }) {
  const { v } = await params;
  const C = { "1": V1, "2": V2, "3": V3, "4": V4, "5": V5, "6": V6, "7": V7, "8": V8, "9": V9, "10": V10, "11": V11, "12": V12, "13": V13, "14": V14, "15": V15 }[v];
  if (!C) notFound();
  return <C />;
}

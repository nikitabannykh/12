import { notFound } from "next/navigation";
import { ArrowRight, Ban, Check, CircleCheck, FlaskConical, Globe, PauseCircle, Scale, Search, Sparkles, TrendingDown, X } from "lucide-react";
import { Logo } from "@/components/Logo";

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

export default async function Variant({ params }: { params: Promise<{ v: string }> }) {
  const { v } = await params;
  const C = { "1": V1, "2": V2, "3": V3, "4": V4, "5": V5 }[v];
  if (!C) notFound();
  return <C />;
}

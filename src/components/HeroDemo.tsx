"use client";
/**
 * Первый экран лендинга: «как это работает» прямо в окне кабинета.
 * Четыре шага сменяют друг друга сами (пауза при наведении, можно кликнуть):
 * адрес сайта → объявления → кабинеты и бюджет → готово (главная с результатами).
 * Каждый шаг монтируется заново, поэтому его анимации проигрываются с начала.
 */
import { useEffect, useState } from "react";
import {
  BarChart3, Ban, Check, ChevronDown, CircleCheck, FileText, Globe, History, Home, Loader2, Megaphone, PauseCircle, Rocket, RotateCcw, Scale,
  Settings, Sparkles, TrendingDown, Undo2,
} from "lucide-react";
import { Logo } from "./Logo";

const STEPS = [
  { t: "Адрес сайта", url: "polny-zal.ru/app/business", ms: 5200 },
  { t: "Объявления", url: "polny-zal.ru/app/launch", ms: 5600 },
  { t: "Кабинеты и бюджет", url: "polny-zal.ru/app/launch", ms: 5000 },
  { t: "Готово", url: "polny-zal.ru/app", ms: 7500 },
] as const;

export function Window({ children, url = "polny-zal.ru/app", className = "" }: { children: React.ReactNode; url?: string; className?: string }) {
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

/** Печатает текст по букве */
function useTyped(text: string, delay = 300, speed = 70) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let i = 0;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => { i++; setN(i); if (i < text.length) t = setTimeout(tick, speed); };
    t = setTimeout(tick, delay);
    return () => clearTimeout(t);
  }, [text, delay, speed]);
  return text.slice(0, n);
}

/** Считает от 0 до target */
function Count({ to, delay = 0, ms = 1100 }: { to: number; delay?: number; ms?: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now() + delay;
    const f = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - start) / ms));
      setV(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [to, delay, ms]);
  return <>{new Intl.NumberFormat("ru-RU").format(v)}</>;
}

/** Появляется через delay мс */
function After({ ms, children }: { ms: number; children: React.ReactNode }) {
  const [on, setOn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOn(true), ms); return () => clearTimeout(t); }, [ms]);
  return on ? <>{children}</> : null;
}

const pop = (ms: number) => ({ className: "lp-pop", style: { animationDelay: `${ms}ms` } });

/* ─── Шаги ─────────────────────────────────────────────────────── */

function StepSite() {
  const url = useTyped("studia-lak.ru", 250, 75);
  const typed = url.length === 13;
  return (
    <div className="grid gap-4">
      <div>
        <div className="text-xl sm:text-2xl font-extrabold tracking-tight">Расскажите о бизнесе</div>
        <div className="text-[13px] text-muted">Есть сайт — заполним анкету по нему</div>
      </div>
      <div className="rounded-2xl bg-white border border-line p-4 sm:p-5 grid gap-4">
        <div className="flex flex-wrap gap-2">
          <div className="flex-1 min-w-[12rem] flex items-center gap-2 rounded-xl border-2 border-ink px-3 h-11 text-[15px]">
            <Globe size={16} className="text-muted" />{url}<span className="inline-block w-px h-5 bg-ink animate-pulse" />
          </div>
          <span className={`rounded-xl px-4 h-11 flex items-center gap-2 text-sm font-semibold ${typed ? "bg-ink text-white" : "bg-line text-muted"}`}>
            {typed ? <Filling /> : null}
            Заполнить по сайту
          </span>
        </div>
        {typed ? (
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            {[["Название", "Студия «Лак»"], ["Город и адрес", "Казань, ул. Баумана, 15"], ["Часы работы", "Ежедневно 10:00–21:00"], ["Телефон", "+7 900 123-45-67"]].map(([k, v], i) => (
              <div key={k} {...pop(900 + i * 180)}><div className="text-[11px] text-muted">{k}</div><div className="rounded-lg bg-paper px-3 py-2 font-semibold">{v}</div></div>
            ))}
            <div className="sm:col-span-2 lp-pop" style={{ animationDelay: `${1700}ms` }}>
              <div className="text-[11px] text-muted">Услуги и цены</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {["Маникюр с покрытием — 1 900 ₽", "Педикюр — 2 400 ₽", "Наращивание — от 3 000 ₽", "Дизайн ногтей"].map((s, i) => (
                  <span key={s} className="lp-pop rounded-full bg-mark-soft px-3 py-1 text-[13px] font-semibold" style={{ animationDelay: `${1900 + i * 150}ms` }}>{s}</span>
                ))}
              </div>
            </div>
          </div>
        ) : <div className="h-40" />}
      </div>
    </div>
  );
}

function Filling() {
  const [done, setDone] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDone(true), 1500); return () => clearTimeout(t); }, []);
  return done ? <Check size={15} className="text-mark" /> : <Loader2 size={15} className="spin" />;
}

function StepAds() {
  const tasks = ["Подбираем поисковые запросы", "Собираем минус-слова", "Пишем тексты", "Делаем картинки"];
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xl sm:text-2xl font-extrabold tracking-tight">Готовим объявления</div>
          <div className="text-[13px] text-muted">Робот делает работу директолога — около минуты</div>
        </div>
        <div className="flex gap-2 text-center">
          {[[62, "объявления"], [12, "групп"], [54, "минус-слова"]].map(([n, t], i) => (
            <div key={t} className="rounded-xl bg-white border border-line px-3 py-1.5 min-w-[4.5rem]">
              <div className="font-extrabold text-lg leading-tight tabular-nums"><Count to={n as number} delay={300 + i * 250} ms={1800} /></div>
              <div className="text-[10.5px] text-muted">{t}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="grid md:grid-cols-[13rem_minmax(0,1fr)] gap-3">
        <ul className="rounded-2xl bg-white border border-line p-4 grid gap-2.5 text-[13px] content-start">
          {tasks.map((t, i) => (
            <li key={t} className="flex items-center gap-2">
              <After ms={500 + i * 600}><span className="w-5 h-5 rounded-full bg-good text-white grid place-items-center lp-pop"><Check size={12} strokeWidth={3} /></span></After>
              <span>{t}</span>
            </li>
          ))}
        </ul>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="rounded-2xl bg-white border border-line p-3.5 lp-pop" style={{ animationDelay: `${1300}ms` }}>
            <div className="flex items-center gap-1.5 text-[11px] text-muted"><span className="w-3 h-3 rounded-full bg-paper border border-line" />studia-lak.ru<span className="ml-auto rounded bg-paper px-1.5 text-faint">Реклама</span></div>
            <div className="mt-1 text-[#2a3eb1] font-semibold leading-snug">Маникюр с покрытием — 1 900 ₽, Казань</div>
            <div className="mt-1 text-[12.5px] text-ink-2">Покрытие держится 3–4 недели. Запишитесь онлайн.</div>
            <div className="mt-1.5 flex gap-3 text-[12px] text-[#2a3eb1]"><span>Цены</span><span>Педикюр</span><span>Запись</span></div>
          </div>
          <div className="rounded-2xl bg-white border border-line overflow-hidden lp-pop" style={{ animationDelay: `${2000}ms` }}>
            <div className="h-20 bg-[linear-gradient(135deg,#f3e9ec,#e8c9d3)] relative">
              <span className="absolute left-3 bottom-2 rounded-md bg-white/90 px-2 py-0.5 text-[11px] font-bold">1 900 ₽</span>
            </div>
            <div className="p-3">
              <div className="text-[11px] text-muted flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#0077ff]" />Студия «Лак» · ВКонтакте</div>
              <div className="mt-0.5 font-semibold text-[13.5px] leading-snug">Маникюр, который держится 3–4 недели</div>
            </div>
          </div>
          <div className="sm:col-span-2 rounded-2xl bg-white border border-line p-3 flex items-center gap-3 lp-pop" style={{ animationDelay: `${2800}ms` }}>
            <Sparkles size={16} className="text-ink-2 shrink-0" />
            <div className="text-[12.5px]"><b>Аудитории VK для A/B-теста:</b> искали «маникюр», интересы: красота, живут рядом</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepAccounts() {
  return (
    <div className="grid gap-4">
      <div>
        <div className="text-xl sm:text-2xl font-extrabold tracking-tight">Подключите кабинеты</div>
        <div className="text-[13px] text-muted">Деньги остаются в ваших кабинетах — мы только управляем</div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {[["Яндекс Директ", "Поиск, Карты, сайты-партнёры", "#fc3f1d", "Я", 700], ["VK Реклама", "ВКонтакте, Одноклассники", "#0077ff", "VK", 1500]].map(([t, d, c, l, ms]) => (
          <div key={t as string} className="rounded-2xl bg-white border border-line p-4 flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl grid place-items-center text-white font-extrabold text-sm shrink-0" style={{ background: c as string }}>{l as string}</span>
            <div className="min-w-0 flex-1"><div className="font-bold">{t as string}</div><div className="text-[12px] text-muted truncate">{d as string}</div></div>
            <Connect ms={ms as number} />
          </div>
        ))}
      </div>
      <div className="rounded-2xl bg-white border border-line p-4 sm:p-5 lp-pop" style={{ animationDelay: `${2100}ms` }}>
        <div className="flex items-baseline justify-between"><span className="font-bold">Бюджет в месяц</span><span className="text-2xl font-extrabold tabular-nums"><Count to={70000} delay={2300} ms={900} /> ₽</span></div>
        <div className="mt-3 h-2 rounded-full bg-paper relative">
          <div className="absolute inset-y-0 left-0 rounded-full bg-ink transition-[width] duration-1000" style={{ width: "58%" }} />
          <span className="absolute top-1/2 -translate-y-1/2 left-[58%] -ml-2.5 w-5 h-5 rounded-full bg-white border-2 border-ink shadow" />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
          {[["Поиск", "38%"], ["ВКонтакте", "27%"], ["Сети и ретаргетинг", "35%"]].map(([k, v]) => <div key={k} className="rounded-lg bg-paper px-2.5 py-1.5"><span className="text-muted">{k}</span> <b>{v}</b></div>)}
        </div>
      </div>
      <After ms={3300}>
        <div className="flex justify-end lp-pop">
          <span className="rounded-xl bg-mark px-5 h-11 flex items-center gap-2 font-bold shadow-[0_10px_30px_-10px_rgba(255,216,74,0.9)]"><Rocket size={17} /> Запустить рекламу</span>
        </div>
      </After>
    </div>
  );
}

function Connect({ ms }: { ms: number }) {
  const [state, setState] = useState<0 | 1 | 2>(0);
  useEffect(() => {
    const a = setTimeout(() => setState(1), ms);
    const b = setTimeout(() => setState(2), ms + 700);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [ms]);
  if (state === 2) return <span className="lp-pop rounded-lg bg-good-soft text-good px-3 h-9 flex items-center gap-1.5 text-[13px] font-bold"><CircleCheck size={15} />Подключено</span>;
  return <span className="rounded-lg bg-ink text-white px-3 h-9 flex items-center gap-1.5 text-[13px] font-semibold">{state === 1 ? <Loader2 size={14} className="spin" /> : null}Подключить</span>;
}

const WEEK = [
  { d: "Пт", spend: 58, leads: 3 }, { d: "Сб", spend: 44, leads: 4 }, { d: "Вс", spend: 50, leads: 3 }, { d: "Пн", spend: 62, leads: 4 },
  { d: "Вт", spend: 71, leads: 6 }, { d: "Ср", spend: 68, leads: 5 }, { d: "Чт", spend: 66, leads: 8 },
];

function StepDone() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xl sm:text-2xl font-extrabold tracking-tight">Главное</div>
          <div className="text-[13px] text-muted">Последние 7 дней</div>
        </div>
        <div className="hidden sm:flex gap-2 text-[12.5px] font-semibold">
          <span className="rounded-lg border border-bad/30 text-bad bg-white px-3 py-1.5 flex items-center gap-1.5"><PauseCircle size={13} />Остановить всю рекламу</span>
          <span className="rounded-lg border border-line bg-white px-3 py-1.5 flex items-center gap-1.5"><RotateCcw size={13} />Проверить сейчас</span>
        </div>
      </div>
      <div className="rounded-2xl bg-white border border-line p-4 sm:p-5">
        <div className="text-base sm:text-xl font-bold leading-snug">Реклама привела <span className="marked"><Count to={33} ms={1200} /> обращения</span>, из них примерно 20 клиентов. Клиент обошёлся в 683 ₽.</div>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[["Потрачено", 13660, " ₽", "+20%", "bad"], ["Обращения из рекламы", 33, "", "+50%", "good"], ["Клиенты, оценка", 20, "", "+54%", "good"], ["Стоимость клиента", 683, " ₽", "−22%", "good"]].map(([k, v, u, d, t]) => (
            <div key={k as string}>
              <div className="text-[12px] text-muted">{k as string}</div>
              <div className="text-xl sm:text-[1.6rem] font-extrabold tracking-tight leading-tight tabular-nums"><Count to={v as number} ms={1200} />{u as string}</div>
              <div className={`text-[11px] font-semibold ${t === "bad" ? "text-bad" : "text-good"}`}>{d as string}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-end justify-around h-28 sm:h-32">
          {WEEK.map((w, i) => (
            <div key={w.d} className="flex flex-col items-center gap-0.5 w-6 sm:w-7">
              {Array.from({ length: w.leads }).map((_, j) => <span key={j} className="lp-pop w-full h-[3px] rounded-full bg-mark" style={{ animationDelay: `${500 + i * 90 + j * 40}ms` }} />)}
              <span className="lp-bar w-full rounded-t-[4px] bg-line-2" style={{ height: `${w.spend}px`, animationDelay: `${150 + i * 70}ms` }} />
              <span className="text-[10px] text-faint mt-1">{w.d}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-4 text-[11px] text-muted"><span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-line-2" />Расход</span><span className="flex items-center gap-1.5"><span className="w-2.5 h-[3px] rounded-full bg-mark" />Обращение из рекламы</span></div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="rounded-2xl bg-white border border-line p-4 flex items-center gap-3">
          <div className="relative grid place-items-center"><Ring value={86} /><span className="absolute text-[11px] font-extrabold">86</span></div>
          <div className="min-w-0"><div className="font-bold text-sm">Здоровье рекламы: всё в порядке</div><div className="text-[12px] text-muted truncate">Робот проверил 5 кампаний сегодня в 09:12</div></div>
        </div>
        <div className="rounded-2xl bg-white border border-line p-4">
          <div className="text-[12px] text-muted">Сегодня робот</div>
          <div className="mt-1 grid gap-1 text-[13px]">
            <div className="flex items-center gap-2 lp-pop" style={{ animationDelay: "900ms" }}><Ban size={13} className="text-bad" />Минус-слово «обучение»<span className="ml-auto text-faint flex items-center gap-1 text-[11px]"><Undo2 size={11} />отменить</span></div>
            <div className="flex items-center gap-2 lp-pop" style={{ animationDelay: "1300ms" }}><Scale size={13} className="text-good" />+15% бюджета во ВКонтакте<span className="ml-auto text-faint flex items-center gap-1 text-[11px]"><Undo2 size={11} />отменить</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Демонстрация ─────────────────────────────────────────────── */

export function HeroDemo() {
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const [run, setRun] = useState(0); // перезапуск полосы прогресса
  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => { setStep((s) => (s + 1) % STEPS.length); setRun((r) => r + 1); }, STEPS[step].ms);
    return () => clearTimeout(t);
  }, [step, paused, run]);

  const prelaunch = step < 3;
  const nav: [typeof Home, string, boolean][] = prelaunch
    ? [[FileText, "Данные о бизнесе", step === 0], [Rocket, "Запуск рекламы", step > 0], [Settings, "Настройки", false]]
    : [[Home, "Главное", true], [Megaphone, "Реклама", false], [BarChart3, "Статистика", false], [History, "История", false], [Settings, "Настройки", false]];

  return (
    <div className="relative" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      {/* Шаги */}
      <ol className="mb-4 grid grid-cols-4 gap-2 max-w-3xl mx-auto">
        {STEPS.map((s, i) => (
          <li key={s.t}>
            <button type="button" onClick={() => { setStep(i); setRun((r) => r + 1); }}
              className={`w-full text-left rounded-xl px-3 py-2 transition-colors ${i === step ? "bg-ink text-white" : "bg-white border border-line hover:border-ink text-ink-2"}`}>
              <span className="flex items-center gap-2 text-[13px] font-semibold">
                <span className={`w-5 h-5 rounded-full grid place-items-center text-[11px] font-extrabold shrink-0 ${i === step ? "bg-mark text-ink" : i < step ? "bg-good text-white" : "bg-paper"}`}>{i < step ? <Check size={11} strokeWidth={3} /> : i + 1}</span>
                <span className="truncate">{s.t}</span>
              </span>
              <span className={`mt-2 block h-[3px] rounded-full overflow-hidden ${i === step ? "bg-white/20" : "bg-transparent"}`}>
                {i === step ? <span key={`${run}-${paused}`} className="lp-progress block h-full bg-mark" style={{ animationDuration: `${s.ms}ms`, animationPlayState: paused ? "paused" : "running" }} /> : null}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <Window url={STEPS[step].url} className="rounded-[20px]">
        <div className="grid md:grid-cols-[13.5rem_minmax(0,1fr)] bg-paper text-left min-h-[34rem]">
          <aside className="hidden md:flex flex-col gap-4 bg-white border-r border-line p-4">
            <Logo size={24} />
            <div className="flex items-center gap-2 rounded-xl border border-line px-2.5 py-2 text-sm font-semibold">
              <span className="w-6 h-6 rounded-md bg-mark grid place-items-center text-xs font-extrabold">С</span>Студия Лак<ChevronDown size={14} className="ml-auto text-muted" />
            </div>
            <nav className="grid gap-0.5 text-[13.5px]">
              {nav.map(([I, t, on], i) => (
                <div key={t}>
                  <div className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 font-semibold ${on ? "bg-ink text-white" : "text-ink-2"}`}><I size={15} />{t}</div>
                  {!prelaunch && i === 1 ? (
                    <div className="grid gap-0.5 pl-7 py-0.5 text-[12.5px] text-ink-2">
                      <div className="flex items-center gap-2 px-2 py-1"><span className="w-3.5 h-3.5 rounded-full bg-[#fc3f1d] text-white text-[8px] font-bold grid place-items-center">Я</span>Яндекс<span className="ml-auto text-faint">4</span></div>
                      <div className="flex items-center gap-2 px-2 py-1"><span className="w-3.5 h-3.5 rounded bg-[#0077ff] text-white text-[7px] font-bold grid place-items-center">VK</span>VK<span className="ml-auto text-faint">2</span></div>
                    </div>
                  ) : null}
                </div>
              ))}
            </nav>
          </aside>
          <div key={`${step}-${run}`} className="p-4 sm:p-6 min-w-0 lp-fade">
            {step === 0 ? <StepSite /> : step === 1 ? <StepAds /> : step === 2 ? <StepAccounts /> : <StepDone />}
          </div>
        </div>
      </Window>

      {step === 3 ? (
        <div key={`t-${run}`}>
          <div className="lp-pop hidden lg:flex absolute -left-14 top-[48%] items-center gap-2.5 rounded-xl bg-ink text-white pl-2.5 pr-4 py-2.5 shadow-2xl" style={{ animationDelay: "1600ms" }}>
            <span className="w-8 h-8 rounded-lg bg-mark text-ink grid place-items-center"><TrendingDown size={16} /></span>
            <div className="leading-tight"><div className="text-[11px] text-white/70">сэкономлено за неделю</div><div className="font-bold">−460 ₽ на мусорных кликах</div></div>
          </div>
          <div className="lp-pop hidden lg:flex absolute -right-12 top-[28%] items-center gap-2.5 rounded-xl bg-white border border-line pl-2.5 pr-4 py-2.5 shadow-2xl" style={{ animationDelay: "2300ms" }}>
            <CircleCheck size={20} className="text-good" />
            <div className="leading-tight"><div className="text-[11px] text-muted">A/B-тест завершён</div><div className="font-bold">Вариант Б: +34% обращений</div></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

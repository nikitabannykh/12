"use client";
/** Интерактивные кусочки черновиков первого экрана (/lp/11…15) */
import { useEffect, useState } from "react";
import { Check, CornerDownLeft, Undo2 } from "lucide-react";

/** Слово, которое меняется по кругу */
export function Rotator({ words, className = "" }: { words: string[]; className?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((x) => (x + 1) % words.length), 1800); return () => clearInterval(t); }, [words.length]);
  return <span key={i} className={`lp-fade inline-block ${className}`}>{words[i]}</span>;
}

/** Утренние рекомендации: принять или отменить */
export function Recs() {
  const items = [
    ["Не платить за «маникюр обучение»", "14 кликов без обращений · −460 ₽ в неделю"],
    ["Перенести 15% бюджета во ВКонтакте", "обращение там на 30% дешевле"],
    ["Выключить слабое объявление", "его кликают в 3 раза реже соседних"],
    ["Проверить заголовок с ценой", "A/B-тест на неделю"],
  ];
  const [done, setDone] = useState<Record<number, "ok" | "no">>({});
  useEffect(() => {
    const ts = items.map((_, i) => setTimeout(() => setDone((d) => (d[i] ? d : { ...d, [i]: "ok" })), 1600 + i * 900));
    return () => ts.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <ul className="grid gap-2.5">
      {items.map(([t, s], i) => (
        <li key={t} className={`rounded-2xl border px-4 py-3 flex items-center gap-3 transition-colors ${done[i] === "ok" ? "bg-good-soft/60 border-good/30" : done[i] === "no" ? "bg-paper border-line opacity-60" : "bg-white border-line"}`}>
          <div className="min-w-0 flex-1">
            <div className="font-semibold leading-snug">{t}</div>
            <div className="text-sm text-muted">{s}</div>
          </div>
          {done[i] === "ok" ? <span className="lp-pop text-good font-semibold text-sm flex items-center gap-1"><Check size={16} />Сделано</span>
            : done[i] === "no" ? <span className="text-muted text-sm">Пропущено</span>
            : <span className="flex gap-1.5"><button type="button" onClick={() => setDone({ ...done, [i]: "no" })} className="rounded-lg border border-line px-2.5 h-8 text-sm"><Undo2 size={14} /></button><button type="button" onClick={() => setDone({ ...done, [i]: "ok" })} className="rounded-lg bg-ink text-white px-3 h-8 text-sm font-semibold">Да</button></span>}
        </li>
      ))}
    </ul>
  );
}

/** Вкладки по нишам: заголовок и пример объявления меняются */
const NICHES = [
  { k: "Салонам", q: "маникюр рядом", t: "Маникюр с покрытием — 1 900 ₽, Казань", d: "Покрытие держится 3–4 недели. Запишитесь онлайн.", n: "62 объявления · 54 минус-слова" },
  { k: "Клиникам", q: "остеопат екатеринбург", t: "Приём остеопата — Екатеринбург, Чайковского", d: "Первичный приём 60 минут. Запись онлайн. Есть противопоказания.", n: "41 объявление · лицензия проверена" },
  { k: "Барбершопам", q: "мужская стрижка рядом", t: "Мужская стрижка — 1 500 ₽, у метро Площадь 1905", d: "Стрижка и борода за час. Запишитесь онлайн.", n: "38 объявлений · 47 минус-слов" },
  { k: "Студиям", q: "йога для начинающих", t: "Йога для начинающих — первое занятие 500 ₽", d: "Группы до 10 человек. Утро и вечер. Запись онлайн.", n: "29 объявлений · 3 аудитории VK" },
];
export function NicheTabs() {
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true);
  useEffect(() => { if (!auto) return; const t = setInterval(() => setI((x) => (x + 1) % NICHES.length), 3200); return () => clearInterval(t); }, [auto]);
  const n = NICHES[i];
  return (
    <div>
      <div className="inline-flex rounded-2xl bg-white border border-line p-1 gap-1">
        {NICHES.map((x, j) => (
          <button key={x.k} type="button" onClick={() => { setI(j); setAuto(false); }} className={`rounded-xl px-4 h-10 text-sm font-semibold ${i === j ? "bg-ink text-white" : "text-ink-2 hover:bg-paper"}`}>{x.k}</button>
        ))}
      </div>
      <div key={i} className="lp-fade mt-6 rounded-3xl bg-white border border-line p-6 shadow-[0_40px_80px_-40px_rgba(29,32,69,0.35)] text-left">
        <div className="flex items-center gap-2 rounded-full bg-paper px-4 h-11 text-[15px]"><span className="text-muted">Ищут:</span><b>{n.q}</b></div>
        <div className="mt-4 rounded-2xl ring-2 ring-mark p-4">
          <div className="text-xs text-muted">Реклама</div>
          <div className="text-[#2a3eb1] text-lg font-semibold leading-snug mt-0.5">{n.t}</div>
          <div className="text-ink-2 mt-1 text-[15px]">{n.d}</div>
        </div>
        <div className="mt-4 text-sm text-muted">Робот подготовил: <b className="text-ink">{n.n}</b></div>
      </div>
    </div>
  );
}

/** Команда словами: печатается, робот отвечает */
export function Command() {
  const cmd = "Не показывай рекламу ночью и убери слово «дёшево»";
  const [n, setN] = useState(0);
  useEffect(() => { if (n >= cmd.length) return; const t = setTimeout(() => setN(n + 1), 45); return () => clearTimeout(t); }, [n, cmd.length]);
  const done = n >= cmd.length;
  return (
    <div className="text-left">
      <div className="rounded-2xl bg-white border-2 border-ink px-5 py-4 flex items-center gap-3 text-lg shadow-[0_20px_50px_-20px_rgba(29,32,69,0.4)]">
        <span className="flex-1">{cmd.slice(0, n)}<span className="inline-block w-px h-5 bg-ink align-middle animate-pulse" /></span>
        <span className={`rounded-xl px-3 h-10 grid place-items-center ${done ? "bg-ink text-white" : "bg-line text-muted"}`}><CornerDownLeft size={18} /></span>
      </div>
      {done ? (
        <div className="mt-4 grid gap-2">
          {["Расписание: показы с 8:00 до 22:00 во всех кампаниях", "Переписал 7 объявлений без слова «дёшево» — старые тексты сохранены", "Ушло на модерацию. Статистика не сбросилась"].map((x, i) => (
            <div key={x} className="lp-pop rounded-xl bg-white border border-line px-4 py-3 flex gap-2.5" style={{ animationDelay: `${300 + i * 400}ms` }}><Check size={18} className="text-good shrink-0 mt-0.5" />{x}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

"use client";
/**
 * Фоны первого экрана — варианты для выбора.
 *  slots  — клетки-окна записи, которые заполняются жёлтым (мотив логотипа «Самоход»)
 *  floor  — перспективная сетка-пол, уходящая к горизонту, с линией света
 *  spot   — точечная матрица, которая подсвечивается вокруг курсора
 *  beams  — мягкие лучи света сверху
 *  pulses — тонкие линии, по которым бегут импульсы данных
 */
import { useEffect, useRef } from "react";

const COLS = 26, ROWS = 12;
/** Длительность «роста» графика первого экрана, с — точки загораются, когда до них доходит линия */
const REVEAL_S = 2.6;
/** Детерминированный «случайный» набор: одинаковый на сервере и в браузере */
const rnd = (i: number) => { const x = Math.sin(i * 9301 + 49297) * 233280; return x - Math.floor(x); };

export function HeroBg({ kind }: { kind: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (kind !== "spot") return;
    const el = ref.current;
    if (!el) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, [kind]);

  if (kind === "slots") {
    return (
      <div className="pointer-events-none absolute inset-x-0 -top-16 h-[52rem] overflow-hidden [mask-image:radial-gradient(ellipse_70%_60%_at_50%_30%,black_30%,transparent_75%)]" aria-hidden>
        <div className="absolute left-1/2 -translate-x-1/2 grid gap-[6px]" style={{ gridTemplateColumns: `repeat(${COLS}, 58px)` }}>
          {Array.from({ length: COLS * ROWS }, (_, i) => {
            const r = rnd(i);
            const on = r > 0.82, hot = r > 0.965;
            return (
              <span key={i} className={`h-[58px] rounded-[10px] ring-1 ring-white/[0.05] ${on ? "lp-slot" : ""}`}
                style={on ? { animationDelay: `${Math.round(r * 9000) % 6000}ms`, ["--slot" as string]: hot ? "rgba(255,216,74,0.55)" : "rgba(255,216,74,0.14)" } : undefined} />
            );
          })}
        </div>
      </div>
    );
  }

  if (kind === "floor") {
    return (
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute left-1/2 top-[30rem] -translate-x-1/2 w-[260%] h-[70rem] [perspective:600px]">
          <div className="lp-floor absolute inset-0 origin-top [transform:rotateX(72deg)] [background-image:linear-gradient(rgba(255,216,74,0.35)_1.5px,transparent_1.5px),linear-gradient(90deg,rgba(255,216,74,0.35)_1.5px,transparent_1.5px)] [background-size:80px_80px] [mask-image:linear-gradient(to_bottom,transparent,black_25%,black_60%,transparent)]" />
        </div>
        <div className="absolute left-0 right-0 top-[30rem] h-px bg-[linear-gradient(90deg,transparent,rgba(255,216,74,0.9),transparent)] shadow-[0_0_40px_8px_rgba(255,216,74,0.35)]" />
      </div>
    );
  }

  if (kind === "spot") {
    return (
      <div ref={ref} className="pointer-events-none absolute inset-x-0 -top-16 h-[60rem] [--mx:50%] [--my:20rem]" aria-hidden>
        <div className="absolute inset-0 [background-image:radial-gradient(rgba(255,255,255,0.12)_1.2px,transparent_1.2px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)]" />
        <div className="absolute inset-0 [background-image:radial-gradient(rgba(255,216,74,0.9)_1.4px,transparent_1.4px)] [background-size:22px_22px] [mask-image:radial-gradient(circle_220px_at_var(--mx)_var(--my),black,transparent)]" />
        <div className="absolute inset-0 [background:radial-gradient(circle_260px_at_var(--mx)_var(--my),rgba(255,216,74,0.10),transparent)]" />
      </div>
    );
  }

  if (kind === "beams") {
    return (
      <div className="pointer-events-none absolute inset-x-0 -top-24 h-[56rem] overflow-hidden" aria-hidden>
        {[[-28, "rgba(255,216,74,0.22)", 0], [-8, "rgba(140,140,255,0.18)", 1.5], [12, "rgba(255,216,74,0.16)", 3], [30, "rgba(255,255,255,0.10)", 4.5]].map(([deg, c, d], i) => (
          <div key={i} className="lp-beam absolute top-0 left-1/2 w-[18rem] h-[60rem] origin-top blur-[40px]"
            style={{ ["--deg" as string]: `${deg}deg`, background: `linear-gradient(180deg, ${c}, transparent 70%)`, animationDelay: `${d}s`, marginLeft: "-9rem" }} />
        ))}
        <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.4),transparent)]" />
      </div>
    );
  }


  if (kind === "chart" || kind === "line") {
    // кривая роста: слева внизу → справа вверху, с небольшими «колебаниями»
    const pts = [[0,700],[120,660],[220,680],[330,610],[430,630],[540,540],[640,560],[760,450],[860,470],[980,350],[1080,370],[1200,230],[1300,250],[1440,90]];
    const d = pts.map(([x,y],i)=> (i?"L":"M")+x+" "+y).join(" ");
    const area = d + " L1440 900 L0 900 Z";
    const sharp = kind === "line";
    return (
      <div className="pointer-events-none absolute inset-x-0 -top-10 h-[56rem] overflow-hidden" aria-hidden>
        {/* График «растёт» слева направо: открываем его маской, а не штрихом (stroke-dash с pathLength и non-scaling-stroke
            в Chrome мигает концом линии в правом верхнем углу до старта анимации) */}
        <svg viewBox="0 0 1440 900" preserveAspectRatio="none" className="lp-reveal absolute inset-0 w-full h-full">
          <defs>
            <linearGradient id="hb-a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffd84a" stopOpacity={sharp ? 0.22 : 0.4} /><stop offset="0.7" stopColor="#ffd84a" stopOpacity="0" /></linearGradient>
            <linearGradient id="hb-l" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#ffd84a" stopOpacity="0" /><stop offset="0.35" stopColor="#ffd84a" stopOpacity="0.6" /><stop offset="1" stopColor="#ffd84a" /></linearGradient>
            <filter id="hb-b"><feGaussianBlur stdDeviation={sharp ? 18 : 28} /></filter>
          </defs>
          <path d={area} fill="url(#hb-a)" filter="url(#hb-b)" />
          <path d={d} fill="none" stroke="url(#hb-l)" strokeWidth={sharp ? 26 : 60} strokeLinejoin="round" filter="url(#hb-b)" opacity={sharp ? 0.6 : 0.55} />
          {sharp ? <path d={d} fill="none" stroke="url(#hb-l)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /> : null}
        </svg>
        {sharp ? pts.filter((_,i)=>i%2===1 || i===pts.length-1).map(([x,y],i,arr)=>(
          <span key={i} className="lp-pop absolute w-2.5 h-2.5 -ml-[5px] -mt-[5px] rounded-full bg-mark shadow-[0_0_14px_4px_rgba(255,216,74,0.6)]"
            style={{ left: `${x/14.4}%`, top: `${y/9}%`, animationDelay: `${(0.2 + (x / 1440) * REVEAL_S).toFixed(2)}s`, opacity: 0.35 + 0.65*(i/(arr.length-1)) }} />
        )) : null}
        <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse 48% 42% at 50% 45%, rgba(7,8,26,${sharp ? 0.92 : 0.75}), transparent)` }} />
      </div>
    );
  }

  if (kind === "bars") {
    // столбики из клеток: слева низкие, справа высокие — «зал заполняется»
    const N = 22, CELLS = 10;
    return (
      <div className="pointer-events-none absolute inset-x-0 -top-10 h-[50rem] overflow-hidden [mask-image:linear-gradient(to_bottom,transparent_6%,black_30%,black_60%,transparent)]" aria-hidden>
        <div className="absolute inset-x-[2%] bottom-[14rem] flex items-end justify-between gap-[6px] blur-[1.5px]">
          {Array.from({ length: N }, (_, i) => {
            const h = Math.max(1, Math.round(1 + (i / (N - 1)) ** 1.6 * (CELLS - 1) + (rnd(i) - 0.5) * 2.2));
            return (
              <div key={i} className="flex-1 flex flex-col-reverse gap-[6px]">
                {Array.from({ length: CELLS }, (_, j) => {
                  const on = j < h, top = j === h - 1;
                  return <span key={j} className={`aspect-square rounded-[8px] ${on ? "lp-pop" : "ring-1 ring-white/[0.04]"}`}
                    style={on ? { background: `rgba(255,216,74,${top ? 0.38 : 0.04 + 0.12 * (i / N)})`, boxShadow: top ? "0 0 24px 4px rgba(255,216,74,0.25)" : undefined, animationDelay: `${i * 70 + j * 45}ms` } : undefined} />;
                })}
              </div>
            );
          })}
        </div>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_42%_38%_at_50%_42%,rgba(7,8,26,0.92),transparent)]" />
      </div>
    );
  }

  // pulses
  const lines = 15;
  return (
    <div className="pointer-events-none absolute inset-x-0 -top-16 h-[56rem] overflow-hidden [mask-image:radial-gradient(ellipse_at_top,black_25%,transparent_72%)]" aria-hidden>
      <div className="absolute inset-0 flex justify-between px-[4%]">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className="relative w-px h-full bg-white/[0.05]">
            <span className="lp-pulse absolute left-1/2 -translate-x-1/2 w-[2px] h-28 rounded-full bg-[linear-gradient(180deg,transparent,rgba(255,216,74,0.95))] shadow-[0_0_12px_2px_rgba(255,216,74,0.5)]"
              style={{ animationDelay: `${(rnd(i) * 6).toFixed(2)}s`, animationDuration: `${(4 + rnd(i + 7) * 5).toFixed(2)}s` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

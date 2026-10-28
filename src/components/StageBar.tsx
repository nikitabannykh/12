import Link from "next/link";
import { Check, ChevronRight } from "lucide-react";

/**
 * Два больших этапа подготовки: «1. Данные о бизнесе → 2. Запуск рекламы».
 * Один и тот же блок наверху /app/start и /app/launch: текущий этап выделен, пройденный — с галочкой и ссылкой назад.
 */
export function StageBar({ current, dataDone, canLaunch }: {
  current: 1 | 2;
  /** Данные сохранены хотя бы раз — этап 1 пройден */
  dataDone: boolean;
  /** Можно открыть этап 2 (анкета сохранена) */
  canLaunch: boolean;
}) {
  const stages = [
    { n: 1, title: "Данные о бизнесе", href: "/app/start", done: dataDone && current !== 1, reachable: true },
    { n: 2, title: "Запуск рекламы", href: "/app/launch", done: false, reachable: canLaunch },
  ] as const;
  return (
    <nav aria-label="Этапы" className="card px-2 py-2 sm:px-3">
      <ol className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1">
        {stages.map((s, i) => {
          const cur = s.n === current;
          const inner = (
            <>
              <span className={`grid place-items-center size-6 sm:size-7 shrink-0 rounded-full text-sm font-extrabold ${cur ? "bg-ink text-white" : s.done ? "bg-good text-white" : "bg-paper text-faint border border-line"}`}>
                {s.done ? <Check size={15} strokeWidth={3} /> : s.n}
              </span>
              <span className="min-w-0">
                <span className={`block font-bold leading-tight text-sm sm:text-base ${cur ? "text-ink" : s.done ? "text-ink-2" : "text-faint"}`}>{s.title}</span>
                {cur ? <span className="max-sm:hidden block text-xs text-muted leading-tight">сейчас</span> : s.done ? <span className="block text-xs text-good leading-tight">готово<span className="max-sm:hidden"> · изменить</span></span> : !s.reachable ? <span className="max-sm:hidden block text-xs text-faint leading-tight">после данных</span> : null}
              </span>
            </>
          );
          const cls = `flex items-center gap-2 sm:gap-2.5 rounded-lg px-2 sm:px-3 py-2 min-w-0 ${cur ? "bg-mark-soft" : ""}`;
          return (
            <li key={s.n} className="contents">
              {i > 0 ? <ChevronRight size={18} className="text-faint" aria-hidden /> : null}
              {cur || !s.reachable ? (
                <div className={cls} aria-current={cur ? "step" : undefined} title={!s.reachable ? "Сначала сохраните данные о бизнесе" : undefined}>{inner}</div>
              ) : (
                <Link href={s.href} className={`${cls} hover:bg-paper`}>{inner}</Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

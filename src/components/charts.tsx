/** Дни: столбик — расход, жёлтые отметки — обращения (как занятые окна в журнале) */
export function DaysChart({ series }: { series: { day: string; cost: number; leads: number }[] }) {
  const maxCost = Math.max(1, ...series.map((s) => s.cost));
  const maxLeads = Math.max(1, ...series.map((s) => s.leads));
  const wd = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  const dense = series.length > 14;
  return (
    <div>
      <div className="flex items-end gap-[3px] sm:gap-1.5 h-44" role="img" aria-label="Расходы и обращения по дням">
        {series.map((s) => (
          <div key={s.day} className="flex-1 h-full flex flex-col justify-end items-center gap-1 group relative min-w-0">
            <div className="absolute bottom-full mb-1 hidden group-hover:block z-10 bg-ink text-white text-xs rounded-md px-2 py-1 whitespace-nowrap">
              {new Date(s.day).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}: {Math.round(s.cost).toLocaleString("ru-RU")} ₽, {s.leads} обр.
            </div>
            <div className="flex flex-col-reverse gap-[2px] w-full items-center">
              {Array.from({ length: Math.min(s.leads, dense ? 8 : 12) }).map((_, i) => (
                <span key={i} className={`block w-full max-w-[22px] ${dense ? "h-1" : "h-1.5"} rounded-sm bg-mark`} />
              ))}
            </div>
            <div className="w-full max-w-[22px] rounded-t-[4px] bg-line-2" style={{ height: `${(s.cost / maxCost) * (100 - Math.min(maxLeads, 12) * 4)}%`, minHeight: s.cost ? 3 : 0 }} />
          </div>
        ))}
      </div>
      <div className="flex gap-[3px] sm:gap-1.5 mt-1.5 text-[10px] sm:text-[11px] text-faint">
        {series.map((s, i) => (
          <div key={s.day} className="flex-1 text-center min-w-0">{dense ? (i % 5 === 0 ? new Date(s.day).getDate() : "") : wd[new Date(s.day).getUTCDay()]}</div>
        ))}
      </div>
      <div className="flex gap-4 mt-3 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-line-2" /> Расход</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded-sm bg-mark" /> Обращение</span>
      </div>
    </div>
  );
}

export function Delta({ cur, prev, inverse = false }: { cur: number; prev: number; inverse?: boolean }) {
  if (!prev || !Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  const d = (cur - prev) / prev;
  if (Math.abs(d) < 0.03) return <span className="text-xs text-faint">как раньше</span>;
  const good = inverse ? d < 0 : d > 0;
  return <span className={`text-xs font-semibold ${good ? "text-good" : "text-bad"}`}>{d > 0 ? "+" : "−"}{Math.round(Math.abs(d) * 100)}%</span>;
}

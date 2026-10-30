"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarDays } from "lucide-react";

/** Выбор периода, как в Директе: готовые периоды + свои даты */
export function PeriodPicker({ presets, current, from, to }: { presets: { id: string; label: string }[]; current: string; from: string; to: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(current === "custom");
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  return (
    <div className="grid gap-2 justify-items-end w-full sm:w-auto">
      <div className="flex flex-wrap gap-1.5 sm:justify-end" role="tablist" aria-label="Период">
        {presets.map((p) => (
          <Link key={p.id} href={`/app/stats?p=${p.id}`} scroll={false} role="tab" aria-selected={current === p.id}
            className={`px-3 h-8 grid place-items-center rounded-lg text-sm font-semibold border ${current === p.id ? "bg-ink text-white border-ink" : "bg-card border-line text-ink-2 hover:border-line-2"}`}>
            {p.label}
          </Link>
        ))}
        <button type="button" onClick={() => setOpen((x) => !x)} aria-expanded={open}
          className={`px-3 h-8 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold border ${current === "custom" ? "bg-ink text-white border-ink" : "bg-card border-line text-ink-2 hover:border-line-2"}`}>
          <CalendarDays size={15} /> Свои даты
        </button>
      </div>
      {open ? (
        <form className="flex flex-wrap items-center gap-2 text-sm" onSubmit={(e) => { e.preventDefault(); if (f && t) router.push(`/app/stats?from=${f}&to=${t}`, { scroll: false }); }}>
          <label className="flex items-center gap-1.5">с <input type="date" value={f} max={t || undefined} onChange={(e) => setF(e.target.value)} className="h-8 rounded-lg border border-line bg-card px-2" /></label>
          <label className="flex items-center gap-1.5">по <input type="date" value={t} min={f || undefined} onChange={(e) => setT(e.target.value)} className="h-8 rounded-lg border border-line bg-card px-2" /></label>
          <button className="btn btn-primary btn-sm">Показать</button>
        </form>
      ) : null}
    </div>
  );
}

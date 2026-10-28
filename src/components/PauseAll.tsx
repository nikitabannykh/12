"use client";
/** Вся реклама разом: «Остановить всю рекламу» / баннер «Реклама остановлена» с «Возобновить» */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, OctagonPause, Play } from "lucide-react";
import { api, useToast } from "./client";

export function PauseAll({ paused, since, compact = false }: { paused: boolean; since?: string | null; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();

  async function run(next: boolean) {
    if (next && !confirm("Остановить всю рекламу во всех кабинетах? Деньги перестанут тратиться сразу, настройки и статистика сохранятся. Робот ничего не включит, пока вы не возобновите.")) return;
    setBusy(true);
    try {
      const r = await api<{ stopped?: number; resumed?: number }>("POST", "/api/business/pause", { paused: next });
      toast(next ? `Реклама остановлена${r.stopped ? ` — ${r.stopped} кампаний на паузе` : ""}` : `Реклама возобновлена${r.resumed ? ` — включили ${r.resumed} кампаний` : ""}`);
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (paused) {
    return (
      <div className="rounded-2xl border-2 border-warn/40 bg-warn-soft px-4 py-3.5 sm:px-5 flex flex-wrap items-center justify-between gap-3" role="status">
        <div className="min-w-0">
          <div className="font-bold flex items-center gap-2"><OctagonPause size={18} className="text-warn" /> Вся реклама остановлена{since ? ` ${since}` : ""}</div>
          <p className="text-sm text-ink-2 mt-0.5">Деньги не тратятся, статистика и настройки сохранены. Робот ничего не меняет, пока вы не возобновите.</p>
        </div>
        <button className="btn btn-mark" onClick={() => run(false)} disabled={busy}>{busy ? <Loader2 size={16} className="spin" /> : <Play size={16} />} Возобновить рекламу</button>
      </div>
    );
  }
  return (
    <button className={`btn ${compact ? "btn-sm" : ""} btn-ghost text-bad border-bad/30 hover:bg-bad/5`} onClick={() => run(true)} disabled={busy}>
      {busy ? <Loader2 size={15} className="spin" /> : <OctagonPause size={15} />} Остановить всю рекламу
    </button>
  );
}

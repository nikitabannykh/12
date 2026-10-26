"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { api, useToast } from "./client";

const fmt = (iso: string) => {
  const s = new Date(iso + "T00:00:00Z");
  const e = new Date(s);
  e.setUTCDate(e.getUTCDate() + 6);
  const o: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", timeZone: "UTC" };
  return `${s.toLocaleDateString("ru-RU", o)} — ${e.toLocaleDateString("ru-RU", o)}`;
};

/** Владелец отмечает, сколько обратившихся стали клиентами. Это делает «стоимость клиента» точной. */
export function ClientsWeek({ weekStart, leads, initial, plain = false }: { weekStart: string; leads: number; initial?: number | null; plain?: boolean }) {
  const [v, setV] = useState(initial != null ? String(initial) : "");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();
  const save = async () => {
    setBusy(true);
    try {
      await api("POST", "/api/clients", { weekStart, clients: Number(v) });
      toast("Сохранили — стоимость клиента пересчитана");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const body = (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-[14rem] text-sm leading-relaxed">
        {plain ? <b>{fmt(weekStart)}</b> : <b>Сколько клиентов пришло из рекламы на прошлой неделе?</b>}
        <div className="text-muted">{plain ? "" : `${fmt(weekStart)}. `}Обращений было {leads}. Посмотрите в журнале записи — так стоимость клиента будет точной.</div>
      </div>
      <div className="flex gap-2">
        <input className="field w-24" inputMode="numeric" value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ""))} aria-label="Клиентов" placeholder="0" />
        <button className="btn btn-primary" onClick={save} disabled={busy || v === ""}>{busy ? <Loader2 size={16} className="spin" /> : null}Сохранить</button>
      </div>
    </div>
  );
  return plain ? body : <div className="rounded-xl bg-mark-soft p-4">{body}</div>;
}

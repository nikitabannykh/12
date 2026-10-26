"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { api, useToast } from "@/components/client";

type S = "booked" | "no_answer" | "spam";
const OPTIONS: { v: S; label: string; on: string }[] = [
  { v: "booked", label: "Записался", on: "bg-good text-white border-good" },
  { v: "no_answer", label: "Не дозвонились", on: "bg-ink-2 text-white border-ink-2" },
  { v: "spam", label: "Спам", on: "bg-bad text-white border-bad" },
];

/** Статус заявки в один тап (как кнопки в Telegram). Повторное нажатие снимает отметку. */
export function LeadStatus({ id, initial }: { id: string; initial: S | null }) {
  const [status, setStatus] = useState<S | null>(initial);
  const [busy, setBusy] = useState<S | null>(null);
  const toast = useToast();
  const router = useRouter();
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Чем закончилась заявка">
      {OPTIONS.map((o) => {
        const on = status === o.v;
        return (
          <button
            key={o.v}
            type="button"
            aria-pressed={on}
            disabled={busy !== null}
            className={`h-8 px-3 rounded-full border text-xs font-semibold inline-flex items-center gap-1 transition-colors ${on ? o.on : "bg-card border-line-2 text-ink-2 hover:bg-paper"}`}
            onClick={async () => {
              const next = on ? null : o.v;
              setBusy(o.v);
              try {
                await api("PATCH", `/api/leads/${encodeURIComponent(id)}`, { status: next });
                setStatus(next);
                router.refresh();
              } catch (e) {
                toast((e as Error).message, "error");
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === o.v ? <Loader2 size={12} className="spin" /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

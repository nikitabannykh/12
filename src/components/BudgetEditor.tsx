"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { api, useToast } from "./client";

export function BudgetEditor({ monthly, min }: { monthly: number; min: number }) {
  const [v, setV] = useState(String(monthly));
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();
  const n = Number(v) || 0;
  return (
    <form
      className="flex flex-wrap items-center gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (n < min) return toast(`Минимум — ${min.toLocaleString("ru-RU")} ₽ в месяц`, "error");
        setBusy(true);
        try {
          await api("PATCH", "/api/budget", { monthly: n });
          toast("Бюджет изменён, лимиты кампаний пересчитаны");
          router.refresh();
        } catch (err) {
          toast((err as Error).message, "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      <input className="field w-40 text-lg font-bold" inputMode="numeric" value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ""))} aria-label="Бюджет в месяц" />
      <span className="text-muted font-semibold">₽ в месяц</span>
      <button className="btn btn-primary" disabled={busy || n === monthly}>{busy ? <Loader2 size={16} className="spin" /> : null}Сохранить</button>
    </form>
  );
}

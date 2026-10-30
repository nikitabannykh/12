"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { api, useToast } from "./client";
import { MAX_MONTHLY } from "@/lib/engine/budget";

const rub = (n: number) => `${n.toLocaleString("ru-RU")} ₽`;

export function BudgetEditor({ monthly, min }: { monthly: number; min: number }) {
  const [v, setV] = useState(String(monthly));
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const toast = useToast();
  const router = useRouter();
  // Только цифры (пробелы между разрядами можно): «abc» — не «меньше минимума», а не число
  const digits = v.replace(/[\s\u00a0]/g, "");
  const n = /^\d+$/.test(digits) ? Number(digits) : NaN;
  return (
    <form
      className="flex flex-wrap items-center gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!Number.isFinite(n)) return toast("Введите сумму числом, например 30000", "error");
        if (n < min) return toast(`Минимум — ${rub(min)} в месяц: меньше площадка не принимает`, "error");
        if (n > MAX_MONTHLY) return toast(`Максимум — ${rub(MAX_MONTHLY)} в месяц`, "error");
        setBusy(true);
        try {
          const r = await api<{ activated?: string[]; addable?: { channel: string; name: string }[] }>("PATCH", "/api/budget", { monthly: n });
          const added: string[] = [];
          // Бюджет вырос — запускаем каналы, которые раньше не помещались (по шагам, как в мастере запуска)
          for (const ch of r.addable ?? []) {
            setStage(`Запускаем канал «${ch.name}»…`);
            try {
              let body: string | undefined = JSON.stringify({ channel: ch.channel });
              for (let i = 0; i < 40; i++) {
                const res = await fetch("/api/launch/channel", { method: "POST", headers: { "Content-Type": "application/json" }, body });
                const d = await res.json().catch(() => null);
                if (res.status === 409 && /Идёт запуск/.test(d?.error ?? "")) { await new Promise((z) => setTimeout(z, 3000)); continue; }
                if (!res.ok) throw new Error(d?.error || `ошибка ${res.status}`);
                if (d?.done) break;
                body = undefined;
              }
              added.push(ch.name);
            } catch (err) {
              toast(`«${ch.name}» не запустили: ${(err as Error).message}`, "error");
            }
          }
          setStage(null);
          const on = [...(r.activated ?? []), ...added];
          toast(on.length ? `Бюджет изменён. Включили: ${on.join(", ")}` : "Бюджет изменён. Что поменялось в каналах — в истории изменений");
          router.refresh();
        } catch (err) {
          toast((err as Error).message, "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      <input className="field w-40 text-lg font-bold" inputMode="numeric" value={v} maxLength={12} onChange={(e) => setV(e.target.value)} aria-label="Бюджет в месяц" />
      <span className="text-muted font-semibold">₽ в месяц</span>
      <button className="btn btn-primary" disabled={busy || n === monthly}>{busy ? <Loader2 size={16} className="spin" /> : null}Сохранить</button>
      {stage ? <p className="w-full text-sm font-semibold inline-flex items-center gap-2"><Loader2 size={14} className="spin" /> {stage}</p> : null}
      <p className="hint w-full">При увеличении бюджета включим и выключенные каналы, а те, что раньше не помещались, — запустим. От {rub(min)} до {rub(MAX_MONTHLY)} в месяц. Если на все каналы не хватит, робот оставит самые важные и предупредит.</p>
    </form>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FlaskConical, Loader2, Pause, Pencil, Play, Plus } from "lucide-react";
import { api, useToast } from "./client";
import { EditAdModal } from "./LaunchWizard";
import type { Channel } from "@/lib/platforms/types";

export function AdActions({ ad, channel, canTest }: { ad: { id: string; title: string; title2: string | null; text: string; status: string }; channel: Channel; canTest: boolean }) {
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const router = useRouter();
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast(ok);
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };
  const paused = ad.status === "paused";
  const live = ad.status === "active" || ad.status === "moderation";
  return (
    <div className="flex flex-wrap gap-1.5">
      <button className="btn btn-ghost btn-sm" onClick={() => setEdit(true)} disabled={!!busy || ad.status === "archived"}><Pencil size={14} /> Текст</button>
      {paused || live ? (
        <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => run("st", () => api("PATCH", `/api/ads/${ad.id}`, { status: paused ? "active" : "paused" }), paused ? "Объявление включено" : "Объявление остановлено")}>
          {busy === "st" ? <Loader2 size={14} className="spin" /> : paused ? <Play size={14} /> : <Pause size={14} />}
          {paused ? "Включить" : "Остановить"}
        </button>
      ) : null}
      {canTest && ad.status === "active" ? (
        <button className="btn btn-ghost btn-sm" disabled={!!busy} title="Робот напишет другой вариант и сравнит с этим"
          onClick={() => run("ab", () => api("POST", `/api/ads/${ad.id}/variant`), "Новый вариант создан — сравниваем")}>
          {busy === "ab" ? <Loader2 size={14} className="spin" /> : <FlaskConical size={14} />} A/B-тест
        </button>
      ) : null}
      <EditAdModal
        edit={edit ? { ad, channel } : null}
        onClose={() => setEdit(false)}
        onSave={async (v) => {
          try {
            const res = await api<{ unchanged?: boolean }>("PATCH", `/api/ads/${ad.id}`, v);
            toast(res.unchanged ? "Текст не изменился" : "Сохранили. Площадка проверит новый текст — пока идёт старый");
            setEdit(false);
            router.refresh();
          } catch (e) {
            toast((e as Error).message, "error");
          }
        }}
      />
    </div>
  );
}

export function BudgetInline({ campaignId, weekly, min }: { campaignId: string; weekly: number; min: number }) {
  const [v, setV] = useState(String(weekly));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();
  if (!editing) {
    return (
      <button className="font-semibold underline decoration-dotted underline-offset-4 hover:decoration-solid" onClick={() => setEditing(true)} title="Изменить недельный лимит">
        {new Intl.NumberFormat("ru-RU").format(weekly)} ₽ в неделю
      </button>
    );
  }
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api("PATCH", `/api/campaigns/${campaignId}`, { weeklyBudget: Number(v) });
          toast("Лимит изменён");
          setEditing(false);
          router.refresh();
        } catch (err) {
          toast((err as Error).message, "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      <input className="field h-9 w-28" inputMode="numeric" value={v} min={min} onChange={(e) => setV(e.target.value.replace(/\D/g, ""))} aria-label="Лимит в неделю" autoFocus />
      <span className="text-sm text-muted">₽/нед</span>
      <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : null}Сохранить</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Отмена</button>
    </form>
  );
}

/**
 * «Добавить канал» — для подключённых, но ещё не запущенных каналов. Запуск делает POST /api/launch/channel;
 * пока такого маршрута нет (404 без JSON-ошибки), честно говорим «скоро».
 */
export function AddChannelButton({ channel, name, weekly }: { channel: Channel; name: string; weekly: number }) {
  const [busy, setBusy] = useState(false);
  const [soon, setSoon] = useState(false);
  const toast = useToast();
  const router = useRouter();
  if (soon) return <span className="pill bg-paper text-muted whitespace-normal rounded-lg">«{name}» — скоро: добавить канал здесь пока нельзя</span>;
  return (
    <button
      className="btn btn-ghost btn-sm"
      disabled={busy}
      onClick={async () => {
        if (!window.confirm(`Запустить канал «${name}»? Робот создаст кампанию с лимитом около ${new Intl.NumberFormat("ru-RU").format(weekly)} ₽ в неделю, лимиты других каналов пересчитаются в пределах месячного бюджета.`)) return;
        setBusy(true);
        try {
          const call = () => fetch("/api/launch/channel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel }) });
          let res = await call();
          let data = await res.json().catch(() => null);
          // Запуск может идти шагами (как в мастере): повторяем, пока сервер не скажет, что готово
          for (let i = 0; res.ok && data?.done === false && i < 10; i++) {
            res = await call();
            data = await res.json().catch(() => null);
          }
          if (res.status === 404 && !data?.error) {
            setSoon(true);
            return;
          }
          if (!res.ok) throw new Error(data?.error || `Не получилось добавить канал (ошибка ${res.status})`);
          toast(`Канал «${name}» добавлен — объявления ушли на модерацию`);
          router.refresh();
        } catch (e) {
          toast((e as Error).message, "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} Добавить канал «{name}»
    </button>
  );
}

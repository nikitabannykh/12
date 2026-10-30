"use client";
/** Свой счётчик Метрики на сайте: выбрать существующий вместо созданного сервисом (с согласием на цели) */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { api, useToast } from "./client";

type Counter = { id: number; name: string; site: string };

export function MetricaCounterPicker({ current, hasYandex }: { current: number | null; hasYandex: boolean }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Counter[] | null>(null);
  const [pick, setPick] = useState<number | null>(current);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();

  if (!hasYandex) return <p className="text-sm text-muted">Есть свой счётчик Метрики на сайте? Подключите Яндекс Директ — и его можно будет выбрать здесь.</p>;

  const load = async () => {
    setOpen(true);
    if (list) return;
    setBusy(true);
    try {
      const r = await api<{ counters: Counter[] }>("GET", "/api/metrica/counter");
      setList(r.counters);
    } catch (e) {
      toast((e as Error).message, "error");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!pick || !consent) return;
    setBusy(true);
    try {
      const r = await api<{ warnings: string[] }>("POST", "/api/metrica/counter", { counterId: pick, consent: true });
      toast(r.warnings.length ? `Счётчик подключён. ${r.warnings.join(" ")}` : "Счётчик подключён — цели добавлены");
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost btn-sm" onClick={load}>
        На сайте уже есть свой счётчик Метрики? Выбрать его
      </button>
    );
  }
  return (
    <div className="rounded-xl border border-line p-4 grid gap-3">
      <div className="font-semibold">Ваш счётчик Метрики</div>
      {busy && !list ? <div className="text-sm text-muted inline-flex items-center gap-2"><Loader2 size={14} className="spin" /> Загружаем счётчики…</div> : null}
      {list && !list.length ? <p className="text-sm text-muted">В подключённом аккаунте Яндекса счётчиков нет.</p> : null}
      {list?.length ? (
        <div className="grid gap-2 max-h-64 overflow-y-auto">
          {list.map((c) => (
            <label key={c.id} className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 cursor-pointer ${pick === c.id ? "border-ink bg-paper/60" : "border-line"}`}>
              <input type="radio" className="mt-1" checked={pick === c.id} onChange={() => setPick(c.id)} />
              <span className="min-w-0">
                <span className="font-medium">№ {c.id}{c.name ? ` — ${c.name}` : ""}</span>
                {c.site ? <span className="block text-sm text-muted [overflow-wrap:anywhere]">{c.site}</span> : null}
                {c.id === current ? <span className="block text-xs text-good mt-0.5">используется сейчас</span> : null}
              </span>
            </label>
          ))}
        </div>
      ) : null}
      {list?.length ? (
        <label className="flex items-start gap-2.5 text-sm leading-relaxed">
          <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>
            Разрешаю добавить в этот счётчик 5 целей Самохода — «Обращение», «Заявка с сайта», «Клик по телефону», «Переход в мессенджер» и «Клиент записался». Мои цели и настройки счётчика не меняются; Директ будет учиться на цели «Обращение».
          </span>
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || !pick || !consent || pick === current} onClick={save}>
          {busy && list ? <Loader2 size={16} className="spin" /> : null}
          Использовать этот счётчик
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Отмена</button>
      </div>
    </div>
  );
}

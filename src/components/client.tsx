"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";

type Toast = { id: number; text: string; tone: "ok" | "error" };
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, text, tone }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), tone === "error" ? 9000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 w-[min(92vw,460px)]" role="status" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={`flex items-start gap-3 rounded-xl px-4 py-3 shadow-lg text-sm leading-snug ${t.tone === "error" ? "bg-bad text-white" : "bg-ink text-white"}`}>
            <span className="flex-1 whitespace-pre-line">{t.text}</span>
            <button aria-label="Закрыть" onClick={() => setList((l) => l.filter((x) => x.id !== t.id))}>
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
  return data as T;
}

/** Кнопка, которая вызывает API, показывает загрузку и обновляет страницу */
export function ActionButton({
  method = "POST", url, body, children, className = "btn btn-ghost btn-sm", done, confirm, onDone, refresh = true, disabled,
}: {
  method?: string; url: string; body?: unknown; children: React.ReactNode; className?: string; done?: string; confirm?: string;
  onDone?: (data: any) => void; refresh?: boolean; disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();
  return (
    <button
      className={className}
      disabled={busy || disabled}
      onClick={async () => {
        if (confirm && !window.confirm(confirm)) return;
        setBusy(true);
        try {
          const data = await api(method, url, body);
          if (done) toast(done);
          onDone?.(data);
          if (refresh) router.refresh();
        } catch (e) {
          toast((e as Error).message, "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 size={16} className="spin" /> : null}
      {children}
    </button>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} className="m-auto w-[min(94vw,560px)] rounded-2xl p-0 backdrop:bg-ink/40 shadow-2xl">
      <div className="flex items-center justify-between px-6 pt-5">
        <h2 className="text-lg font-bold">{title}</h2>
        <button aria-label="Закрыть" onClick={onClose} className="p-1 rounded-md hover:bg-paper">
          <X size={20} />
        </button>
      </div>
      <div className="px-6 pb-6 pt-4">{children}</div>
    </dialog>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${checked ? "bg-good" : "bg-line-2"} disabled:opacity-50`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5.5" : "translate-x-0.5"}`} />
    </button>
  );
}

/** Переключатель, который сразу сохраняет состояние через API */
export function LiveToggle({ url, field = "status", on, label, onValue = "active", offValue = "paused", confirmOff }: { url: string; field?: string; on: boolean; label: string; onValue?: string; offValue?: string; confirmOff?: string }) {
  const [state, setState] = useState(on);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();
  useEffect(() => setState(on), [on]);
  return (
    <Toggle
      checked={state}
      label={label}
      disabled={busy}
      onChange={async (v) => {
        if (!v && confirmOff && !window.confirm(confirmOff)) return;
        setBusy(true);
        setState(v);
        try {
          await api("PATCH", url, { [field]: v ? onValue : offValue });
          toast(v ? "Включено" : "Остановлено");
          router.refresh();
        } catch (e) {
          setState(!v);
          toast((e as Error).message, "error");
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}

export function CopyButton({ text, label = "Скопировать" }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setOk(true);
        setTimeout(() => setOk(false), 2000);
      }}
    >
      {ok ? "Скопировано" : label}
    </button>
  );
}

/** Показываем сообщение из адресной строки после OAuth-редиректа */
export function UrlNotice() {
  const toast = useToast();
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const err = p.get("error");
    const connected = p.get("connected");
    if (err) toast(err, "error");
    if (connected) toast(connected === "yandex" ? "Яндекс Директ подключён" : connected === "vk" ? "VK Реклама подключена" : "Кабинет подключён");
    if (err || connected) {
      p.delete("error");
      p.delete("connected");
      const q = p.toString();
      window.history.replaceState(null, "", window.location.pathname + (q ? `?${q}` : ""));
    }
  }, [toast]);
  return null;
}

/** Фото с телефона уменьшаем в браузере до JPEG ≤ 1600 px — так оно быстро загружается и проходит лимит сервера */
export async function resizeToJpeg(file: File, max = 1600): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = bad;
      i.src = url;
    });
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}

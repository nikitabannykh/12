"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, LogOut, Settings, CircleAlert, CheckCircle2, Info, TriangleAlert } from "lucide-react";

type Item = { id: string; at: string; tone: "good" | "bad" | "warn" | "info"; title: string; text?: string; href?: string; group: "now" | "event"; unread: boolean };

const ICON = { good: CheckCircle2, bad: CircleAlert, warn: TriangleAlert, info: Info };
const TONE = { good: "text-good", bad: "text-bad", warn: "text-warn", info: "text-ink-2" };

function ago(at: string) {
  const m = Math.round((Date.now() - Date.parse(at)) / 60000);
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ч назад`;
  return new Date(at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

/** Закрыть попап кликом снаружи или Esc */
function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, close]);
  return ref;
}

export function BellMenu() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ items: Item[]; unread: number } | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const ref = useOutside(open, close);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/inbox", { cache: "no-store" });
      if (r.ok) setData(await r.json());
    } catch { /* сеть — попробуем позже */ }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, [load]);
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) {
      await load();
      fetch("/api/inbox", { method: "POST" }).catch(() => {});
      setData((d) => (d ? { ...d, unread: d.items.filter((x) => x.group === "now" && x.tone === "bad").length } : d));
    }
  };
  const now = data?.items.filter((x) => x.group === "now") ?? [];
  const events = data?.items.filter((x) => x.group === "event") ?? [];
  const badge = data?.unread ?? 0;
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={toggle} aria-expanded={open} aria-label={`Уведомления${badge ? `: ${badge}` : ""}`}
        className="relative w-10 h-10 grid place-items-center rounded-full bg-card ring-1 ring-black/[0.06] hover:ring-black/[0.12]">
        <Bell size={19} />
        {badge ? <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-bad text-white text-[11px] font-bold grid place-items-center">{badge > 99 ? "99+" : badge}</span> : null}
      </button>
      {open ? (
        <div className="absolute right-0 mt-2 w-[min(92vw,26rem)] max-h-[75vh] overflow-y-auto rounded-2xl bg-card ring-1 ring-black/[0.08] shadow-xl z-50">
          <div className="px-4 pt-4 pb-2 font-bold">Уведомления</div>
          {!data ? <p className="px-4 pb-4 text-sm text-muted">Загружаем…</p> : null}
          {now.length ? (
            <div className="px-2 pb-2">
              <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted">Требует внимания</div>
              {now.map((x) => <Row key={x.id} x={x} onGo={close} />)}
            </div>
          ) : data ? <p className="px-4 pb-2 text-sm text-good flex items-center gap-1.5"><CheckCircle2 size={15} /> Сейчас всё в порядке</p> : null}
          {events.length ? (
            <div className="px-2 pb-2 border-t border-line pt-2">
              <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted">События</div>
              {events.map((x) => <Row key={x.id} x={x} onGo={close} />)}
            </div>
          ) : null}
          <div className="border-t border-line px-4 py-3 text-sm"><Link href="/app/history" onClick={close} className="underline">Вся история действий</Link></div>
        </div>
      ) : null}
    </div>
  );
}

function Row({ x, onGo }: { x: Item; onGo: () => void }) {
  const I = ICON[x.tone];
  const body = (
    <div className={`flex gap-2.5 rounded-xl px-2 py-2 ${x.href ? "hover:bg-paper" : ""} `}>
      <I size={17} className={`shrink-0 mt-0.5 ${TONE[x.tone]}`} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold leading-snug flex items-start gap-1.5"><span className="flex-1">{x.title}</span>{x.unread ? <span className="mt-1.5 w-2 h-2 rounded-full bg-bad shrink-0" aria-label="новое" /> : null}</div>
        {x.text ? <div className="text-[13px] text-ink-2 leading-snug mt-0.5 line-clamp-3">{x.text}</div> : null}
        {x.group === "event" ? <div className="text-xs text-faint mt-0.5">{ago(x.at)}</div> : null}
      </div>
    </div>
  );
  return x.href ? <Link href={x.href} onClick={onGo} className="block">{body}</Link> : body;
}

export function ProfileMenu({ email, label }: { email: string; label: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useOutside(open, close);
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label="Профиль"
        className="h-10 pl-1 pr-3 inline-flex items-center gap-2 rounded-full bg-card ring-1 ring-black/[0.06] hover:ring-black/[0.12]">
        <span className="w-8 h-8 rounded-full bg-ink text-white grid place-items-center text-sm font-bold uppercase">{label.charAt(0) || "?"}</span>
        <span className="hidden sm:block text-sm font-semibold max-w-[12rem] truncate">{label}</span>
      </button>
      {open ? (
        <div className="absolute right-0 mt-2 w-64 rounded-2xl bg-card ring-1 ring-black/[0.08] shadow-xl z-50 p-2">
          <div className="px-2 py-2 text-sm text-muted truncate">{email}</div>
          <Link href="/app/settings" onClick={close} className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold hover:bg-paper"><Settings size={16} /> Настройки</Link>
          <form action="/api/auth/logout" method="post">
            <button className="w-full flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold hover:bg-paper text-left"><LogOut size={16} /> Выйти</button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

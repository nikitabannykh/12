"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Loader2, Plus } from "lucide-react";
import { api, useToast } from "./client";

export type ProjectLite = { id: string; name: string; status: string; city: string };

const STATUS: Record<string, string> = { active: "реклама идёт", launching: "запускается", paused: "на паузе", draft: "не запущен" };

/**
 * Переключатель проектов: «Студия Лак ▾» → список своих бизнесов и «+ Новый проект».
 * Выбор хранится на сервере (users.current_business_id) — все страницы и API работают с выбранным.
 */
export function ProjectSwitcher({ projects, current, limit, variant }: { projects: ProjectLite[]; current: string | null; limit: number; variant: "side" | "top" }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const toast = useToast();
  const cur = projects.find((p) => p.id === current);
  const label = cur?.name ?? (projects.length ? "Новый проект" : "Мой бизнес");

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  async function pick(id: string) {
    if (id === current) return setOpen(false);
    setBusy(id);
    try {
      const r = await api<{ next: string }>("POST", "/api/projects", { id });
      setOpen(false);
      router.push(r.next);
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  const full = projects.length >= limit;
  return (
    <div ref={ref} className={`relative ${variant === "top" ? "min-w-0 max-w-[60%]" : ""}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center gap-2 rounded-lg text-left font-semibold hover:bg-paper ${variant === "side" ? "px-2 py-2 border border-line" : "px-2 py-1.5 text-sm"}`}
      >
        <span className="grid place-items-center size-7 shrink-0 rounded-md bg-mark text-ink text-sm font-extrabold" aria-hidden>{(label.trim()[0] ?? "+").toUpperCase()}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDown size={16} className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className={`absolute z-50 mt-1.5 card shadow-lg p-1.5 ${variant === "top" ? "right-0 w-72 max-w-[calc(100vw-2rem)]" : "inset-x-0"}`} role="listbox" aria-label="Проекты">
          <p className="px-2.5 pt-1.5 pb-1 text-xs font-semibold text-faint uppercase tracking-wide">Проекты</p>
          {projects.map((p) => (
            <button key={p.id} type="button" role="option" aria-selected={p.id === current} onClick={() => pick(p.id)} className="w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-paper">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold truncate">{p.name}</span>
                <span className="block text-xs text-muted truncate">{p.city} · {STATUS[p.status] ?? p.status}</span>
              </span>
              {busy === p.id ? <Loader2 size={16} className="spin" /> : p.id === current ? <Check size={16} className="text-good" /> : null}
            </button>
          ))}
          {!current && projects.length ? (
            <div className="flex items-center gap-2.5 rounded-md px-2.5 py-2 bg-paper">
              <span className="flex-1 font-semibold">Новый проект</span>
              <Check size={16} className="text-good" />
            </div>
          ) : null}
          <div className="border-t border-line mt-1.5 pt-1.5">
            <button type="button" disabled={full || busy !== null || (!current && projects.length > 0)} onClick={() => pick("new")} className="w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left font-semibold hover:bg-paper disabled:opacity-50 disabled:cursor-not-allowed">
              {busy === "new" ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
              Новый проект
            </button>
            {full ? <p className="px-2.5 pb-1.5 text-xs text-muted">Можно до {limit} проектов{limit === 3 ? " в демо" : ""}.</p> : <p className="px-2.5 pb-1.5 text-xs text-muted">Другой салон или филиал — со своей анкетой и рекламой.</p>}
          </div>
        </div>
      ) : null}
    </div>
  );
}

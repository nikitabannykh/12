"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { api, useToast } from "./client";
import { HASH_TAB } from "@/lib/settings-tabs";

/** Старые ссылки вида /app/settings#site — открываем нужный раздел */
export function SettingsHashRedirect() {
  const router = useRouter();
  const sp = useSearchParams();
  const path = usePathname();
  useEffect(() => {
    const h = window.location.hash.slice(1);
    const tab = HASH_TAB[h];
    if (tab && sp.get("tab") !== tab) router.replace(`${path}?tab=${tab}#${h}`, { scroll: false });
    else if (h) document.getElementById(h)?.scrollIntoView({ block: "start" });
  }, [router, sp, path]);
  return null;
}

/** Удаление проекта: подтверждение вводом названия */
export function DeleteProject({ id, name }: { id: string; name: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const ok = text.trim().toLowerCase() === name.trim().toLowerCase();
  return (
    <div className="grid gap-2 max-w-md">
      <label className="text-sm text-ink-2">Чтобы подтвердить, введите название проекта: <b>{name}</b></label>
      <input className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder={name} />
      <button
        type="button"
        disabled={!ok || busy}
        className="btn btn-sm justify-self-start bg-bad text-white disabled:opacity-40"
        onClick={async () => {
          setBusy(true);
          try {
            const r = await api<{ next: string; warnings: string[] }>("DELETE", "/api/projects", { id, confirm: text });
            toast(r.warnings.length ? `Проект удалён. ${r.warnings.join(" ")}` : "Проект удалён");
            window.location.href = r.next;
          } catch (e) {
            toast((e as Error).message, "error");
            setBusy(false);
          }
        }}
      >
        {busy ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />} Удалить проект
      </button>
    </div>
  );
}

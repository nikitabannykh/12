"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Статусы с площадки без перезагрузки. У Директа нет уведомлений о пополнении и проверке документов,
 * поэтому спрашиваем сами: сразу при открытии, при возврате на вкладку (пополнили счёт в Директе — вернулись)
 * и, пока реклама стоит, каждые 30 секунд; когда всё идёт — раз в 5 минут. Сервер сам ограничивает частоту.
 */
export function ModerationCheck() {
  const router = useRouter();
  useEffect(() => {
    let off = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = (fast: boolean) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(check, fast ? 30_000 : 300_000);
    };
    async function check() {
      if (off) return;
      if (document.visibilityState !== "visible") return schedule(false);
      try {
        const r = await fetch("/api/moderation/check", { method: "POST" });
        const d = r.ok ? await r.json() : null;
        if (off) return;
        if (d?.changed) { router.refresh(); window.dispatchEvent(new Event("pz:status")); }
        schedule(Boolean(d?.fast || d?.notServing || d?.blocked || d?.moderation));
      } catch {
        schedule(false);
      }
    }
    check();
    const onVis = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => { off = true; if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", onVis); window.removeEventListener("focus", onVis); };
  }, [router]);
  return null;
}

"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Статусы с площадки без перезагрузки: проверяем при открытии кабинета, при возврате на вкладку
 * (пополнили счёт в Директе — вернулись сюда) и раз в минуту, пока вкладка открыта. Сервер сам ограничивает частоту.
 */
export function ModerationCheck() {
  const router = useRouter();
  useEffect(() => {
    let off = false;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/moderation/check", { method: "POST" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (!off && d?.changed) router.refresh(); })
        .catch(() => {});
    };
    check();
    const t = setInterval(check, 65_000);
    const onVis = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => { off = true; clearInterval(t); document.removeEventListener("visibilitychange", onVis); window.removeEventListener("focus", onVis); };
  }, [router]);
  return null;
}

"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Пока объявления на модерации — при открытии кабинета тихо проверяем статусы (сервер сам ограничивает: раз в 10 минут) */
export function ModerationCheck() {
  const router = useRouter();
  useEffect(() => {
    let off = false;
    fetch("/api/moderation/check", { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!off && d?.changed) router.refresh(); })
      .catch(() => {});
    return () => { off = true; };
  }, [router]);
  return null;
}

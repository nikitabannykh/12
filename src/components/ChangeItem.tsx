import { Bot, User } from "lucide-react";
import type { Change } from "@/lib/db/schema";
import { ActionButton } from "./client";

export function when(d: Date) {
  const now = Date.now();
  const diff = (now - d.getTime()) / 1000;
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  const sameDay = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
  if (sameDay) return `сегодня в ${time}`;
  return `${d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" })}, ${time}`;
}

const KIND: Record<string, string> = {
  launch: "Запуск", pause: "Отключение", resume: "Включение", budget: "Бюджет", ad_new: "Новое объявление", ad_text: "Текст",
  negatives: "Минус-слова", test_start: "A/B-тест", test_end: "Итог теста", strategy: "Стратегия", revert: "Отмена", profile: "Описание",
};

export function ChangeItem({ c, compact = false }: { c: Change; compact?: boolean }) {
  const robot = c.actor === "robot";
  return (
    <li className="flex gap-3 sm:gap-4">
      <span className={`shrink-0 w-8 h-8 rounded-full grid place-items-center ${robot ? "bg-mark" : "bg-paper border border-line"}`} title={robot ? "Решение робота" : "Ваше действие"}>
        {robot ? <Bot size={16} /> : <User size={15} />}
      </span>
      <div className="flex-1 min-w-0 pb-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-semibold leading-snug">{c.title}</span>
        </div>
        <div className="text-xs text-faint mt-0.5">{KIND[c.kind] ?? "Изменение"} · {when(c.at)} · {robot ? "робот" : "вы"}</div>
        <p className={`text-[0.93rem] text-ink-2 mt-1.5 leading-relaxed ${compact ? "line-clamp-2" : ""}`}>{c.reason}</p>
        {!compact && c.undo?.length && !c.revertedAt ? (
          <div className="mt-2">
            <ActionButton url={`/api/changes/${c.id}/revert`} done="Отменили — всё как было" confirm="Вернуть как было до этого изменения?">Отменить</ActionButton>
          </div>
        ) : null}
        {c.revertedAt ? <div className="mt-1.5 text-xs font-semibold text-warn">Отменено {when(c.revertedAt)}</div> : null}
      </div>
    </li>
  );
}

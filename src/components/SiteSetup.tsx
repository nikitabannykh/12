import Link from "next/link";
import { Check, Globe, TriangleAlert } from "lucide-react";
import type { SiteTrackingStatus } from "@/lib/engine/site-tracking";

/**
 * Подключение сайта — одним списком и с одним статусом везде (Главное, Настройки, «Здоровье рекламы»):
 * адрес → код на сайте → обращения → Метрика.
 */
type Step = { title: string; text: string; state: "done" | "todo" | "bad" };

const host = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/$/, "");
const when = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function siteSteps(s: SiteTrackingStatus): Step[] {
  const url = s.siteUrl ? host(s.siteUrl) : null;
  return [
    { title: "Адрес сайта указан", text: url ?? "Укажите сайт в «О бизнесе»", state: url ? "done" : "todo" },
    s.state === "ok"
      ? { title: "Код Самохода стоит на сайте", text: s.lastSeen ? `Последний сигнал — ${when(s.lastSeen.at)}${s.lastSeen.host ? `, ${s.lastSeen.host}` : ""}` : "Найден при проверке", state: "done" }
      : s.state === "missing"
        ? { title: "Код на сайте не найден", text: "Скопируйте код и вставьте на сайт перед </head> — инструкции для Tilda, WordPress и других ниже. Затем нажмите «Проверить».", state: "bad" }
        : { title: "Поставьте код на сайт", text: "Одна строка перед </head>. Без неё мы видим клики, но не видим заявки, звонки и сообщения с сайта.", state: "todo" },
    s.lastEvent
      ? { title: "Обращения с сайта приходят", text: `Последнее: ${s.lastEvent.label}, ${when(s.lastEvent.at)}`, state: "done" }
      : { title: "Первое обращение с сайта", text: s.state === "ok" ? "Код стоит — ждём первую заявку, звонок или сообщение. Можно проверить самому: оставьте тестовую заявку." : "Появится, когда код будет стоять на сайте.", state: "todo" },
    s.counterId && s.goalsOk
      ? { title: "Метрика подключена", text: `Счётчик № ${s.counterId}, цели Самохода добавлены — Директ учится на заявках`, state: "done" }
      : { title: "Метрика (по желанию)", text: s.counterId ? `Счётчик № ${s.counterId} выбран, цели ещё не добавлены` : "Без Метрики заявки всё равно считаются. С ней робот видит ещё и качество визитов, а Директ учится на заявках.", state: "todo" },
  ];
}

/** Короткий итог: «Сайт подключён» / «Шаг 2 из 4: поставьте код» */
export function siteSummary(s: SiteTrackingStatus): { done: boolean; title: string; text: string; tone: "good" | "warn" | "bad" } {
  const steps = siteSteps(s);
  const core = steps.slice(0, 2);
  if (core.every((x) => x.state === "done")) {
    return { done: true, tone: "good", title: steps[2].state === "done" ? "Сайт подключён — обращения считаются" : "Сайт подключён — ждём первое обращение", text: steps[2].text };
  }
  const i = steps.findIndex((x) => x.state !== "done");
  return { done: false, tone: steps[i].state === "bad" ? "bad" : "warn", title: `Подключение сайта: шаг ${i + 1} из ${steps.length} — ${steps[i].title.toLowerCase()}`, text: steps[i].text };
}

export function SiteSetupList({ status }: { status: SiteTrackingStatus }) {
  const steps = siteSteps(status);
  return (
    <ol className="grid gap-3">
      {steps.map((x, i) => (
        <li key={x.title} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3 items-start">
          <span className={`w-7 h-7 rounded-full grid place-items-center text-xs font-bold ${x.state === "done" ? "bg-good text-white" : x.state === "bad" ? "bg-bad-soft text-bad" : "bg-paper text-ink-2"}`}>
            {x.state === "done" ? <Check size={15} /> : x.state === "bad" ? <TriangleAlert size={14} /> : i + 1}
          </span>
          <div className="min-w-0 text-sm">
            <div className={`font-semibold ${x.state === "done" ? "" : x.state === "bad" ? "text-bad" : ""}`}>{x.title}</div>
            <div className="text-muted mt-0.5 leading-relaxed">{x.text}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Плашка для «Главного» и других мест: статус + одна кнопка в «Подключение сайта» */
export function SiteSetupBanner({ status }: { status: SiteTrackingStatus }) {
  const sum = siteSummary(status);
  if (sum.done) return null;
  return (
    <section className={`rounded-[var(--radius-card)] border p-4 sm:p-5 flex items-start gap-3 ${sum.tone === "bad" ? "bg-bad-soft border-bad/30" : "bg-warn-soft border-warn/30"}`} role="status">
      {sum.tone === "bad" ? <TriangleAlert size={22} className="shrink-0 mt-0.5 text-bad" /> : <Globe size={22} className="shrink-0 mt-0.5 text-warn" />}
      <div className="flex-1 min-w-0">
        <div className="font-bold leading-snug">{sum.title}</div>
        <p className="text-sm text-ink-2 mt-1 leading-relaxed max-w-2xl">{sum.text}</p>
        <Link href="/app/settings?tab=site#site" className="btn btn-primary btn-sm mt-3">Открыть инструкцию и код</Link>
      </div>
    </section>
  );
}

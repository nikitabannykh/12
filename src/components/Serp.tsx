/**
 * Схема выдачи Яндекса: где стоит ваше объявление среди мест для рекламы.
 * Тексты конкурентов Директ не отдаёт — соседние места показаны как блоки с ценой клика за это место.
 */
import type { ReactNode } from "react";

type Tier = { trafficVolume: number; bid: number; price: number };
const rub = (n: number) => `${new Intl.NumberFormat("ru-RU").format(Math.round(n))} ₽`;

const TOP = [
  { label: "1-е место", min: 95 },
  { label: "2-е место", min: 80 },
  { label: "3-е место", min: 70 },
  { label: "4-е место", min: 55 },
];

export function slotOf(tv: number) {
  if (tv >= 95) return 0;
  if (tv >= 80) return 1;
  if (tv >= 70) return 2;
  if (tv >= 55) return 3;
  if (tv >= 12) return 4; // низ страницы
  return 5;
}

function priceFor(tiers: Tier[], slot: number) {
  if (!tiers.length) return null;
  const want = slot <= 3 ? [100, 85, 75, 65][slot] : 15;
  return [...tiers].sort((a, b) => Math.abs(a.trafficVolume - want) - Math.abs(b.trafficVolume - want))[0]?.price ?? null;
}

function Competitor({ label, price }: { label: string; price: number | null }) {
  return (
    <div className="min-w-0 rounded-lg border border-dashed border-line-2 px-3 py-2.5 flex items-center justify-between gap-3">
      <div className="min-w-0 grid gap-1.5 flex-1">
        <div className="h-2.5 w-3/4 rounded bg-line" />
        <div className="h-2 w-full rounded bg-paper" />
      </div>
      <div className="text-right text-xs text-faint leading-tight max-w-[60%]">
        <div>{label} · конкурент</div>
        {price ? <div>клик ≈ {rub(price)}</div> : null}
      </div>
    </div>
  );
}

export function SerpScheme({ query, tv, tiers, yourCpc, ad }: { query: string; tv: number; tiers: Tier[]; yourCpc: number | null; ad: ReactNode }) {
  const mine = slotOf(tv);
  const Mine = (
    <div className="rounded-lg ring-2 ring-mark bg-white relative">
      <span className="absolute -top-2.5 left-3 pill bg-mark text-ink text-[11px] font-bold whitespace-normal max-w-[calc(100%-1.5rem)]">Вы · {mine <= 3 ? TOP[mine].label : mine === 4 ? "внизу страницы" : "дальше 1-й страницы"}{yourCpc ? ` · клик ≈ ${rub(yourCpc)}` : ""}</span>
      <div className="pt-2">{ad}</div>
    </div>
  );
  return (
    <div className="min-w-0 rounded-xl border border-line bg-paper/50 p-3 sm:p-4">
      <div className="flex items-center gap-2 rounded-full bg-white border border-line px-4 py-2 text-sm">
        <span className="font-extrabold text-bad">Я</span>
        <span className="truncate">{query}</span>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2">
        {TOP.map((t, i) => (i === mine ? <div key={i}>{Mine}</div> : <Competitor key={i} label={t.label} price={priceFor(tiers, i)} />))}
        <div className="my-1 grid gap-1.5 px-1">
          <div className="text-[11px] uppercase tracking-wide text-faint font-semibold">Обычные результаты поиска</div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="grid gap-1">
              <div className="h-2.5 w-2/3 rounded bg-line" />
              <div className="h-2 w-full rounded bg-white" />
            </div>
          ))}
        </div>
        {mine === 4 ? Mine : <Competitor label="Низ страницы" price={priceFor(tiers, 4)} />}
        {mine === 5 ? Mine : null}
      </div>
      <p className="mt-3 text-xs text-muted leading-relaxed">
        Схема по данным Директа за 14 дней: средний объём трафика {Math.round(tv)} из 100. Тексты соседних объявлений Яндекс не показывает — серые блоки только обозначают места и цену клика за них. Выдача у каждого своя: зависит от города, устройства и истории поиска.
      </p>
    </div>
  );
}

/** Таблица «сколько стоит каждое место» */
export function AuctionTable({ tiers, tv, ceiling }: { tiers: Tier[]; tv: number | null; ceiling: number | null }) {
  const rows = [0, 1, 2, 3, 4].map((slot) => ({ slot, label: slot <= 3 ? TOP[slot].label : "Низ страницы", price: priceFor(tiers, slot) })).filter((r) => r.price);
  const mine = tv !== null ? slotOf(tv) : -1;
  const max = Math.max(...rows.map((r) => r.price!));
  return (
    <div className="grid gap-1.5 text-sm">
      {rows.map((r) => (
        <div key={r.slot} className={`grid grid-cols-[7.5rem_1fr_4.5rem] items-center gap-2 ${r.slot === mine ? "font-semibold" : ""}`}>
          <span className={r.slot === mine ? "text-ink" : "text-muted"}>{r.label}{r.slot === mine ? " · вы" : ""}</span>
          <div className="h-2 rounded-full bg-paper overflow-hidden"><div className={`h-full rounded-full ${r.slot === mine ? "bg-mark" : "bg-line-2"}`} style={{ width: `${Math.round((r.price! / max) * 100)}%` }} /></div>
          <span className="text-right tabular-nums">{rub(r.price!)}</span>
        </div>
      ))}
      {ceiling ? <div className="text-xs text-muted mt-1">Предел цены клика: {rub(ceiling)} — выше Директ не поднимет ставку.</div> : null}
    </div>
  );
}

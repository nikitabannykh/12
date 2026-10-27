import Link from "next/link";
import { TYPE_INFO, FAMILY_NAME, adsHref, type CampaignType, type Family } from "@/lib/channels";

/**
 * Навигация по кампаниям: значки площадки и типа, фильтры-«чипы» (состояние в URL — ссылкой можно поделиться),
 * полоска «копим аудиторию». Серверные компоненты: фильтры — обычные ссылки, без JS.
 */

/** Знак площадки: красный «Я» и синий «VK» — узнаются быстрее подписи */
export function PlatformMark({ family, size = 18, label = false }: { family: Family; size?: number; label?: boolean }) {
  const mark =
    family === "yandex" ? (
      <span className="inline-grid place-items-center rounded-full bg-[#fc3f1d] text-white font-extrabold leading-none shrink-0" style={{ width: size, height: size, fontSize: size * 0.62 }} aria-hidden>
        Я
      </span>
    ) : (
      <span className="inline-grid place-items-center rounded-[5px] bg-[#0077ff] text-white font-extrabold leading-none shrink-0 tracking-tight" style={{ width: size, height: size, fontSize: size * 0.46 }} aria-hidden>
        VK
      </span>
    );
  if (!label) return <span title={FAMILY_NAME[family]} className="inline-flex">{mark}<span className="sr-only">{FAMILY_NAME[family]}</span></span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-2 whitespace-nowrap">
      {mark}
      {FAMILY_NAME[family]}
    </span>
  );
}

export function TypeBadge({ type, className = "" }: { type: CampaignType; className?: string }) {
  const t = TYPE_INFO[type];
  return <span className={`pill ${t.cls} ${className}`}>{t.label}</span>;
}

/** «Поиск — ловим тех, кто ищет сейчас» */
export function Purpose({ type, className = "" }: { type: CampaignType; className?: string }) {
  const t = TYPE_INFO[type];
  return (
    <span className={className}>
      <b className="font-semibold text-ink-2">{t.label}</b> — {t.purpose}
    </span>
  );
}

export function AudienceBar({ size, need, compact = false }: { size: number; need: number; compact?: boolean }) {
  const share = Math.min(1, need ? size / need : 0);
  return (
    <div className={compact ? "min-w-[7rem]" : ""}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-ink-2 font-semibold whitespace-nowrap">копим аудиторию</span>
        <span className="tabular-nums text-muted whitespace-nowrap">{Math.min(size, need)} из {need}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-paper overflow-hidden" role="meter" aria-valuemin={0} aria-valuemax={need} aria-valuenow={Math.min(size, need)} aria-label="Аудитория ретаргетинга">
        <div className="h-full rounded-full bg-good" style={{ width: `${Math.max(4, Math.round(share * 100))}%` }} />
      </div>
    </div>
  );
}

type Chip = { key: string; label: React.ReactNode; count: number; href: string; active: boolean };

function ChipRow({ title, chips }: { title: string; chips: Chip[] }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-xs font-semibold uppercase tracking-wide text-faint shrink-0 w-[4.5rem] hidden sm:block">{title}</span>
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0 snap-x" role="group" aria-label={title}>
        {chips.map((c) => (
          <Link
            key={c.key}
            href={c.href}
            scroll={false}
            aria-current={c.active ? "true" : undefined}
            aria-disabled={!c.count && !c.active ? true : undefined}
            className={`snap-start shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-full border text-sm font-semibold whitespace-nowrap transition-colors ${
              c.active ? "bg-ink text-white border-ink" : c.count ? "bg-card border-line-2 text-ink hover:border-ink" : "bg-card border-line text-faint"
            }`}
          >
            {c.label}
            <span className={`tabular-nums text-xs rounded-full px-1.5 min-w-5 text-center ${c.active ? "bg-white/20" : "bg-paper text-muted"}`}>{c.count}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/**
 * Фильтры «Площадка» и «Тип». Счётчики: у площадок — по всем типам, у типов — внутри выбранной площадки.
 * Липкие при прокрутке; на телефоне каждая строка прокручивается вбок.
 */
export function CampaignFilters({
  p, t, families, types,
}: {
  p: Family | null;
  t: CampaignType | null;
  families: { all: number } & Record<Family, number>;
  types: { all: number } & Partial<Record<CampaignType, number>>;
}) {
  const typeOrder: CampaignType[] = ["search", "network", "feed", "retarget", "maps"];
  const platform: Chip[] = [
    { key: "all", label: "Все", count: families.all, href: adsHref(null, t), active: !p },
    { key: "yandex", label: <><PlatformMark family="yandex" size={16} /> Яндекс</>, count: families.yandex, href: adsHref("yandex", t), active: p === "yandex" },
    { key: "vk", label: <><PlatformMark family="vk" size={16} /> VK</>, count: families.vk, href: adsHref("vk", t), active: p === "vk" },
  ];
  const type: Chip[] = [
    { key: "all", label: "Все типы", count: types.all, href: adsHref(p, null), active: !t },
    ...typeOrder
      .filter((x) => (types[x] ?? 0) > 0 || t === x)
      .map((x) => ({ key: x, label: TYPE_INFO[x].label, count: types[x] ?? 0, href: adsHref(p, x), active: t === x })),
  ];
  return (
    <div className="sticky top-0 z-30 -mx-4 sm:-mx-8 px-4 sm:px-8 py-2.5 bg-paper/90 backdrop-blur supports-[backdrop-filter]:bg-paper/75 border-b border-line grid gap-2">
      <ChipRow title="Площадка" chips={platform} />
      <ChipRow title="Тип" chips={type} />
    </div>
  );
}

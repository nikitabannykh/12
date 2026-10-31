"use client";

import Link from "next/link";
import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { PlatformMark } from "./CampaignNav";
import { SETTINGS_TABS } from "@/lib/settings-tabs";
import { BarChart3, FileText, History, Home, Lock, Megaphone, Rocket, Settings } from "lucide-react";

type Item = { href: string; label: string; short?: string; icon: typeof Home };
const FULL: Item[] = [
  { href: "/app", label: "Главное", icon: Home },
  { href: "/app/ads", label: "Реклама", icon: Megaphone },
  { href: "/app/stats", label: "Статистика", icon: BarChart3 },
  { href: "/app/history", label: "История", icon: History },
  { href: "/app/settings", label: "Настройки", icon: Settings },
];
/** До запуска — два этапа подготовки (как в StageBar) и настройки */
const SETUP: Item[] = [
  { href: "/app/start", label: "Данные о бизнесе", short: "Данные", icon: FileText },
  { href: "/app/launch", label: "Запуск рекламы", short: "Запуск", icon: Rocket },
  { href: "/app/settings", label: "Настройки", icon: Settings },
];

/** Разделы настроек — подпункты «Настроек» в боковом меню (видны, когда открыты настройки) */
function SettingsSubLinks() {
  const sp = useSearchParams();
  const cur = sp.get("tab") ?? "business";
  return (
    <div className="grid gap-0.5 pl-[2.6rem] -mt-0.5 mb-1">
      {SETTINGS_TABS.map((t) => (
        <Link key={t.id} href={`/app/settings?tab=${t.id}`} aria-current={cur === t.id ? "page" : undefined}
          className={`flex items-center h-8 px-2 rounded-md text-sm font-semibold ${cur === t.id ? "bg-paper text-ink" : "text-muted hover:text-ink hover:bg-paper"}`}>{t.label}</Link>
      ))}
    </div>
  );
}

/** Кампании по площадкам — подпункты «Рекламы» в боковом меню */
export type AdsCounts = { yandex: number; vk: number };

function AdsSubLinks({ counts }: { counts: AdsCounts }) {
  const path = usePathname();
  const sp = useSearchParams();
  const cur = path.startsWith("/app/ads") ? sp.get("p") : null;
  const list = (["yandex", "vk"] as const).filter((f) => counts[f] > 0);
  if (list.length < 1) return null;
  return (
    <div className="grid gap-0.5 pl-[2.6rem] -mt-0.5 mb-1">
      {list.map((f) => {
        const on = cur === f;
        return (
          <Link
            key={f}
            href={`/app/ads?p=${f}`}
            aria-current={on ? "page" : undefined}
            className={`flex items-center gap-2 h-8 px-2 rounded-md text-sm font-semibold ${on ? "bg-paper text-ink" : "text-muted hover:text-ink hover:bg-paper"}`}
          >
            <PlatformMark family={f} size={16} />
            <span className="flex-1">{f === "yandex" ? "Яндекс" : "VK"}</span>
            <span className="tabular-nums text-xs text-faint">{counts[f]}</span>
          </Link>
        );
      })}
    </div>
  );
}

/**
 * Новый проект, данных ещё нет: остальные разделы пустые и всё равно ведут обратно к анкете — ссылками их не показываем.
 * Вместо меню — что сейчас происходит и что откроется дальше (без кликабельных пунктов)
 */
function Onboarding() {
  const later = [
    { label: "Реклама", icon: Megaphone },
    { label: "Статистика", icon: BarChart3 },
    { label: "История", icon: History },
    { label: "Настройки", icon: Settings },
  ];
  return (
    <div className="grid gap-5" aria-label="Подготовка проекта">
      <div className="grid gap-1">
        <div className="flex items-center gap-3 h-10 px-3 rounded-lg font-semibold text-[0.95rem] bg-ink text-white" aria-current="step">
          <FileText size={18} strokeWidth={2.3} />Данные о бизнесе
        </div>
        <div className="flex items-center gap-3 h-10 px-3 font-semibold text-[0.95rem] text-faint cursor-default" title="Откроется после данных о бизнесе">
          <Rocket size={18} strokeWidth={1.8} /><span className="flex-1">Запуск рекламы</span><Lock size={14} />
        </div>
      </div>
      <div className="rounded-xl bg-paper p-3.5 text-sm text-muted leading-relaxed">
        <div className="font-semibold text-ink-2">Дальше откроются</div>
        <ul className="mt-2 grid gap-1.5">
          {later.map(({ label, icon: Icon }) => <li key={label} className="flex items-center gap-2"><Icon size={15} strokeWidth={1.8} />{label}</li>)}
        </ul>
        <p className="mt-2.5 text-xs">Сохраните данные о бизнесе — робот подготовит рекламу, и разделы станут доступны.</p>
      </div>
    </div>
  );
}

export function Nav({ launched, variant, ads, onboarding = false }: { launched: boolean; variant: "side" | "bottom"; ads?: AdsCounts; onboarding?: boolean }) {
  const path = usePathname();
  if (onboarding) return variant === "side" ? <Onboarding /> : null;
  const items = launched ? FULL : SETUP;
  const isActive = (href: string) => (href === "/app" ? path === "/app" : path.startsWith(href));
  if (variant === "bottom") {
    return (
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-card border-t border-line grid" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }} aria-label="Разделы">
        {items.map(({ href, label, short, icon: Icon }) => (
          <Link key={href} href={href} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${isActive(href) ? "text-ink" : "text-faint"}`} aria-current={isActive(href) ? "page" : undefined}>
            <Icon size={20} strokeWidth={isActive(href) ? 2.4 : 1.8} />
            {short ?? label}
          </Link>
        ))}
      </nav>
    );
  }
  return (
    <nav className="grid gap-1" aria-label="Разделы">
      {items.map(({ href, label, icon: Icon }) => (
        <div key={href} className="contents">
          <Link
            href={href}
            aria-current={isActive(href) ? "page" : undefined}
            className={`flex items-center gap-3 h-10 px-3 rounded-lg font-semibold text-[0.95rem] ${isActive(href) ? "bg-ink text-white" : "text-ink-2 hover:bg-paper"}`}
          >
            <Icon size={18} strokeWidth={isActive(href) ? 2.3 : 1.8} />
            {label}
          </Link>
          {href === "/app/settings" && path.startsWith("/app/settings") ? (
            <Suspense fallback={null}>
              <SettingsSubLinks />
            </Suspense>
          ) : null}
          {href === "/app/ads" && ads ? (
            <Suspense fallback={null}>
              <AdsSubLinks counts={ads} />
            </Suspense>
          ) : null}
        </div>
      ))}
    </nav>
  );
}

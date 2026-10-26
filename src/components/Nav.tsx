"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, History, Home, Megaphone, Rocket, Settings } from "lucide-react";

const FULL = [
  { href: "/app", label: "Главное", icon: Home },
  { href: "/app/ads", label: "Реклама", icon: Megaphone },
  { href: "/app/stats", label: "Статистика", icon: BarChart3 },
  { href: "/app/history", label: "История", icon: History },
  { href: "/app/settings", label: "Настройки", icon: Settings },
];
const SETUP = [
  { href: "/app/launch", label: "Запуск", icon: Rocket },
  { href: "/app/settings", label: "Настройки", icon: Settings },
];

export function Nav({ launched, variant }: { launched: boolean; variant: "side" | "bottom" }) {
  const path = usePathname();
  const items = launched ? FULL : SETUP;
  const isActive = (href: string) => (href === "/app" ? path === "/app" : path.startsWith(href));
  if (variant === "bottom") {
    return (
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-card border-t border-line grid" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }} aria-label="Разделы">
        {items.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${isActive(href) ? "text-ink" : "text-faint"}`} aria-current={isActive(href) ? "page" : undefined}>
            <Icon size={20} strokeWidth={isActive(href) ? 2.4 : 1.8} />
            {label}
          </Link>
        ))}
      </nav>
    );
  }
  return (
    <nav className="grid gap-1" aria-label="Разделы">
      {items.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={isActive(href) ? "page" : undefined}
          className={`flex items-center gap-3 h-10 px-3 rounded-lg font-semibold text-[0.95rem] ${isActive(href) ? "bg-ink text-white" : "text-ink-2 hover:bg-paper"}`}
        >
          <Icon size={18} strokeWidth={isActive(href) ? 2.3 : 1.8} />
          {label}
        </Link>
      ))}
    </nav>
  );
}

import { isLaunched } from "@/lib/util";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Nav } from "@/components/Nav";
import { ToastProvider, UrlNotice } from "@/components/client";
import { requireUser } from "@/lib/auth";
import { getBusinessForUser, listProjects, projectLimit } from "@/lib/engine/launch";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { BellMenu, ProfileMenu } from "@/components/TopBar";
import { ModerationCheck } from "@/components/ModerationCheck";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { familyOf } from "@/lib/channels";

export const dynamic = "force-dynamic";

const who = (u: { email: string; name: string | null }) => (u.email.includes("@demo.") ? "Демо-аккаунт" : u.name || u.email.split("@")[0]);

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const b = await getBusinessForUser(user.id);
  const projects = await listProjects(user.id);
  const limit = projectLimit(user.email);
  const launched = isLaunched(b?.status);
  // Подпункты «Рекламы»: сколько кампаний на каждой площадке
  let ads: { yandex: number; vk: number } | undefined;
  if (launched && b) {
    const db = await getDb();
    const rows = await db.select({ channel: schema.campaigns.channel }).from(schema.campaigns).where(and(eq(schema.campaigns.businessId, b.id), inArray(schema.campaigns.status, ["active", "paused"])));
    // Как в фильтрах «Рекламы»: карточка «Яндекс Карты» (места показа поиска) считается вместе с кампаниями Яндекса
    const maps = rows.some((r) => r.channel === "search") ? 1 : 0;
    ads = { yandex: rows.filter((r) => familyOf(r.channel) === "yandex").length + maps, vk: rows.filter((r) => familyOf(r.channel) === "vk").length };
  }
  return (
    <ToastProvider>
      <UrlNotice />
      {launched ? <ModerationCheck /> : null}
      <div className="md:grid md:grid-cols-[240px_1fr] min-h-dvh">
        {/* Белый фон и граница — на всю высоту колонки, а меню внутри прилипает к верху экрана */}
        <aside className="hidden md:block border-r border-line bg-card">
          <div className="flex flex-col gap-8 px-4 py-5 sticky top-0 h-dvh overflow-y-auto">
          <div className="grid gap-4">
            <Link href="/app" className="px-2"><Logo size={26} /></Link>
            <ProjectSwitcher projects={projects} current={b?.id ?? null} limit={limit} variant="side" />
          </div>
          <Nav launched={launched} variant="side" ads={ads} onboarding={!b} />
          </div>
        </aside>
        <div className="min-w-0">
          <header className="md:hidden flex items-center justify-between gap-2 px-4 h-14 border-b border-line bg-card">
            <Link href="/app"><Logo size={24} /></Link>
            {/* На телефоне проекты переключаются в меню профиля: в шапке не помещаются */}
            <div className="flex items-center gap-1.5 min-w-0">
              {b ? <BellMenu /> : null}
              <ProfileMenu email={user.email} label={who(user)} projects={{ list: projects, current: b?.id ?? null, limit }} />
            </div>
          </header>
          {/* Шапка справа: уведомления и профиль */}
          <div className="hidden md:flex justify-end items-center gap-2 mx-auto max-w-[1040px] px-8 pt-5 -mb-4">
            {b ? <BellMenu /> : null}
            <ProfileMenu email={user.email} label={who(user)} />
          </div>
          <main className={`mx-auto max-w-[1040px] px-4 sm:px-8 py-6 sm:py-10 ${b ? "pb-28" : "pb-12"} md:pb-12`}>{children}</main>
        </div>
      </div>
      <Nav launched={launched} variant="bottom" onboarding={!b} />
    </ToastProvider>
  );
}

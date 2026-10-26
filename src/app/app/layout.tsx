import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Nav } from "@/components/Nav";
import { ToastProvider, UrlNotice } from "@/components/client";
import { requireUser } from "@/lib/auth";
import { getBusinessForUser } from "@/lib/engine/launch";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const b = await getBusinessForUser(user.id);
  const launched = b?.status === "active";
  return (
    <ToastProvider>
      <UrlNotice />
      <div className="md:grid md:grid-cols-[240px_1fr] min-h-dvh">
        <aside className="hidden md:flex flex-col gap-8 border-r border-line bg-card px-4 py-5 sticky top-0 h-dvh">
          <Link href="/app" className="px-2"><Logo size={26} /></Link>
          <Nav launched={launched} variant="side" />
          <div className="mt-auto px-2 text-sm">
            {b ? <div className="font-semibold truncate">{b.name}</div> : null}
            <div className="text-muted truncate">{user.email.includes("@demo.") ? "Демо-аккаунт" : user.email}</div>
            <form action="/api/auth/logout" method="post" className="mt-2">
              <button className="text-muted hover:text-ink underline underline-offset-2">Выйти</button>
            </form>
          </div>
        </aside>
        <div className="min-w-0">
          <header className="md:hidden flex items-center justify-between px-4 h-14 border-b border-line bg-card">
            <Link href="/app"><Logo size={24} /></Link>
            {b ? <span className="text-sm font-semibold truncate max-w-[45%]">{b.name}</span> : null}
          </header>
          <main className="mx-auto max-w-[1040px] px-4 sm:px-8 py-6 sm:py-10 pb-28 md:pb-12">{children}</main>
        </div>
      </div>
      <Nav launched={launched} variant="bottom" />
    </ToastProvider>
  );
}

import Link from "next/link";
import { Logo } from "@/components/Logo";

/** Общая раскладка страниц входа, регистрации и восстановления пароля */
export function AuthShell({ title, lead, children }: { title: string; lead?: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="min-h-dvh flex flex-col px-4 py-6 sm:py-10">
      <div className="w-full max-w-[400px] mx-auto">
        <Link href="/" className="inline-block"><Logo /></Link>
      </div>
      <div className="flex-1 grid content-start justify-items-center sm:content-center">
        <div className="w-full max-w-[400px] pt-8 pb-8 sm:pt-8">
          <h1 className="text-[1.75rem] sm:text-3xl font-extrabold tracking-tight leading-tight">{title}</h1>
          {lead ? <p className="text-muted mt-2 leading-relaxed">{lead}</p> : null}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </main>
  );
}

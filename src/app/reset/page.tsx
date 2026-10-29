import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { ResetRequestForm } from "@/components/AuthForms";
import { mailConfigured } from "@/lib/mail";

export const metadata = { title: "Восстановление пароля — Самоход" };

export default async function Reset({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const sp = await searchParams;
  const email = typeof sp.email === "string" ? sp.email.slice(0, 254) : "";
  return (
    <AuthShell title="Восстановление пароля" lead="Пришлём на почту ссылку, по которой можно задать новый пароль. Так же задаётся пароль, если вы входили через Google.">
      <ResetRequestForm initialEmail={email} mail={mailConfigured()} />
      <p className="text-sm text-muted mt-6"><Link href="/login" className="underline underline-offset-2 hover:text-ink">← Вернуться ко входу</Link></p>
    </AuthShell>
  );
}

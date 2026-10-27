import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { ResetConfirmForm } from "@/components/AuthForms";
import { checkResetToken, MSG } from "@/lib/account";

export const metadata = { title: "Новый пароль — Полный зал", referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function ResetToken({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const raw = decodeURIComponent(token);
  // Только проверяем ссылку — гасится она при сохранении пароля
  const checked = await checkResetToken(raw);
  if (!checked) {
    return (
      <AuthShell title="Ссылка не работает" lead={MSG.linkExpired}>
        <Link href="/reset" className="btn btn-primary h-12 w-full">Получить новую ссылку</Link>
        <p className="text-sm text-muted mt-6"><Link href="/login" className="underline underline-offset-2 hover:text-ink">← Вернуться ко входу</Link></p>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Новый пароль" lead={<>Для <b className="text-ink font-semibold break-all">{checked.user.email}</b></>}>
      <ResetConfirmForm token={raw} />
    </AuthShell>
  );
}

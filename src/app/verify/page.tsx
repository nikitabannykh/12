import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { findUserById, MSG, readVerifyToken } from "@/lib/account";

export const metadata = { title: "Подтверждение почты — Самоход", referrer: "no-referrer" };
export const dynamic = "force-dynamic";

/** Подтверждение почты, открытое не в том браузере, где выполнен вход: спрашиваем, кто регистрировался */
export default async function VerifyEmail({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const t = readVerifyToken(token);
  const u = t ? await findUserById(t.u) : null;
  if (!t || !u || u.email !== t.e) {
    return (
      <AuthShell title="Ссылка не работает" lead={MSG.linkExpired}>
        <Link href="/login" className="btn btn-primary h-12 w-full">Ко входу</Link>
      </AuthShell>
    );
  }
  if (u.emailVerifiedAt) {
    return (
      <AuthShell title="Почта уже подтверждена" lead={<>Адрес <b className="text-ink font-semibold break-all">{u.email}</b> подтверждён.</>}>
        <Link href="/login" className="btn btn-primary h-12 w-full">Войти</Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Подтверждение почты" lead={<>На адрес <b className="text-ink font-semibold break-all">{u.email}</b> зарегистрировали аккаунт с паролем. Это были вы?</>}>
      <div className="grid gap-3">
        <form action="/api/auth/verify" method="post">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="action" value="mine" />
          <button className="btn btn-primary h-12 w-full">Да, это я — подтвердить почту</button>
        </form>
        <form action="/api/auth/verify" method="post">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="action" value="notme" />
          <button className="btn h-12 w-full">Нет, я не регистрировался</button>
        </form>
        <p className="text-sm text-muted leading-relaxed">Если нажать «Нет», чужой пароль сотрётся, все, кто вошёл с ним, выйдут, а вы войдёте в аккаунт и сможете задать свой пароль в настройках.</p>
      </div>
    </AuthShell>
  );
}

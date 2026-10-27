import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { checkMagicToken, MSG } from "@/lib/account";

export const metadata = { title: "Вход по ссылке — Полный зал", referrer: "no-referrer" };
export const dynamic = "force-dynamic";

/** Страница из письма «Вход по ссылке»: вход — по кнопке (POST), чтобы почтовые сканеры не тратили ссылку */
export default async function MagicLink({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const raw = decodeURIComponent(token);
  const checked = await checkMagicToken(raw);
  if (!checked) {
    return (
      <AuthShell title="Ссылка не работает" lead={MSG.linkExpired}>
        <Link href="/login" className="btn btn-primary h-12 w-full">Ко входу</Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Вход по ссылке" lead={<>Войти как <b className="text-ink font-semibold break-all">{checked.token.e}</b>{checked.user ? "" : " — аккаунт создастся автоматически"}.</>}>
      <form action="/api/auth/magic/confirm" method="post">
        <input type="hidden" name="token" value={raw} />
        <button className="btn btn-primary h-12 w-full">Войти</button>
      </form>
    </AuthShell>
  );
}

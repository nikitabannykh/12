import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { demoAllowed, getUser, googleConfigured } from "@/lib/auth";
import { secretError } from "@/lib/crypto";

const ERRORS: Record<string, string> = {
  google_not_configured: "Вход через Google ещё не настроен на сервере. Пока можно зайти в демо.",
  google: "Google не подтвердил вход. Попробуйте ещё раз.",
  state: "Сессия входа устарела. Попробуйте ещё раз.",
  email: "В аккаунте Google не подтверждена почта.",
  origin: "Вход отклонён: форма была отправлена не со страницы сервиса. Откройте страницу входа заново.",
  toomany: "Слишком много входов в демо с вашего адреса. Попробуйте через час.",
  secret: "Сервис пока не настроен: администратору нужно задать APP_SECRET.",
};

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; demo?: string }> }) {
  const configError = secretError();
  if (!configError && (await getUser())) redirect("/app");
  const sp = await searchParams;
  const google = googleConfigured();
  const demo = demoAllowed();
  return (
    <main className="min-h-dvh grid place-items-center px-4">
      <div className="w-full max-w-sm">
        <Link href="/" className="inline-block mb-10"><Logo /></Link>
        <h1 className="text-3xl font-extrabold tracking-tight">Вход</h1>
        <p className="text-muted mt-2">Один аккаунт — для настройки, статистики и истории изменений.</p>
        {configError ? (
          <div role="alert" className="mt-5 rounded-xl bg-bad-soft text-bad px-4 py-3 text-sm leading-relaxed">
            <b>Вход временно недоступен.</b> {configError}
          </div>
        ) : null}
        {sp.error && !(configError && sp.error === "secret") ? <div className="mt-5 rounded-xl bg-bad-soft text-bad px-4 py-3 text-sm">{ERRORS[sp.error] ?? "Не получилось войти"}</div> : null}
        <div className="mt-8 grid gap-3">
          <a href="/api/auth/google/start" className={`btn h-12 bg-white border border-line-2 hover:border-ink ${google ? "" : "pointer-events-none opacity-50"}`} aria-disabled={!google}>
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
            </svg>
            Войти через Google
          </a>
          {demo ? (
            <form action="/api/auth/demo" method="post">
              <button className={`btn w-full h-12 ${sp.demo ? "btn-mark" : "btn-ghost"}`}>Войти в демо без регистрации</button>
            </form>
          ) : null}
        </div>
        {demo ? <p className="hint mt-4">В демо реклама не тратит деньги: подключается тренировочный кабинет, а показы и обращения моделируются. Можно промотать время и посмотреть, как работает робот.</p> : null}
      </div>
    </main>
  );
}

import { redirect } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { AuthPanel, CleanUrl } from "@/components/AuthForms";
import { demoAllowed, getUser, googleConfigured } from "@/lib/auth";
import { secretError } from "@/lib/crypto";
import { mailConfigured } from "@/lib/mail";

export const metadata = { title: "Вход — Самоход" };

const ERRORS: Record<string, string> = {
  google_not_configured: "Вход через Google ещё не настроен на сервере. Войдите по почте и паролю.",
  google: "Google не подтвердил вход. Попробуйте ещё раз.",
  state: "Сессия входа устарела. Попробуйте ещё раз.",
  email: "В аккаунте Google не подтверждена почта.",
  origin: "Вход отклонён: форма была отправлена не со страницы сервиса. Откройте страницу входа заново.",
  toomany: "Слишком много входов в демо с вашего адреса. Попробуйте через час.",
  secret: "Сервис пока не настроен: администратору нужно задать APP_SECRET.",
  link: "Ссылка устарела или уже использована. Запросите новую.",
};

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; demo?: string; tab?: string; verified?: string }> }) {
  const configError = secretError();
  if (!configError && (await getUser())) redirect("/app");
  const sp = await searchParams;
  const tab = sp.tab === "register" ? "register" : "login";
  const error = sp.error && !(configError && sp.error === "secret") ? ERRORS[sp.error] ?? "Не получилось войти" : null;
  return (
    <AuthShell
      title={tab === "register" ? "Регистрация" : "Вход"}
      lead="Один аккаунт — для настройки рекламы, статистики и истории изменений."
    >
      <CleanUrl />
      {configError ? (
        <div role="alert" className="mb-5 rounded-xl bg-bad-soft text-bad px-4 py-3 text-sm leading-relaxed">
          <b>Вход временно недоступен.</b> {configError}
        </div>
      ) : null}
      {sp.verified ? <div role="status" className="mb-5 rounded-xl bg-good-soft text-good px-4 py-3 text-sm leading-relaxed">Почта подтверждена. Войдите с паролем.</div> : null}
      <AuthPanel
        key={tab}
        initialTab={tab}
        google={googleConfigured()}
        demo={demoAllowed()}
        mail={mailConfigured()}
        demoHighlight={Boolean(sp.demo)}
        initialError={error}
      />
    </AuthShell>
  );
}

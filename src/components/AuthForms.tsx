"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Loader2, Mail } from "lucide-react";

type Result = { ok?: boolean; error?: string; code?: string; redirect?: string; message?: string };

async function post(url: string, body: unknown): Promise<Result & { status: number }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as Result;
    return { ...data, status: res.status, error: res.ok ? undefined : data.error || `Ошибка ${res.status}` };
  } catch {
    return { status: 0, error: "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз." };
  }
}

export function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function PasswordField({
  id, label, value, onChange, autoComplete, hint, aside, autoFocus,
}: {
  id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string; hint?: string; aside?: React.ReactNode; autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="label">{label}</label>
        {aside}
      </div>
      <div className="relative">
        <input
          id={id} type={show ? "text" : "password"} className="field pr-11" value={value} onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete} required minLength={autoComplete === "new-password" ? 8 : undefined} maxLength={200} autoFocus={autoFocus}
        />
        <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-1 top-1 h-9 w-9 grid place-items-center rounded-lg text-muted hover:text-ink" aria-label={show ? "Скрыть пароль" : "Показать пароль"}>
          {show ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {hint ? <p className="hint mt-1.5">{hint}</p> : null}
    </div>
  );
}

function Alert({ tone = "bad", children }: { tone?: "bad" | "good"; children: React.ReactNode }) {
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${tone === "bad" ? "bg-bad-soft text-bad" : "bg-good-soft text-good"}`}>
      {children}
    </div>
  );
}

type Tab = "login" | "register";

/** Страница входа: вкладки «Вход» / «Регистрация», ссылка на почту, Google и демо */
export function AuthPanel({
  initialTab, google, demo, mail, demoHighlight, initialError,
}: {
  initialTab: Tab; google: boolean; demo: boolean; mail: boolean; demoHighlight?: boolean; initialError?: string | null;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<null | "submit" | "magic">(null);
  const [error, setError] = useState<{ text: string; code?: string } | null>(initialError ? { text: initialError } : null);
  const [sent, setSent] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  const switchTab = (t: Tab) => {
    setTab(t);
    setError(null);
    setSent(null);
    setPassword("");
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete("error");
      if (t === "register") u.searchParams.set("tab", "register");
      else u.searchParams.delete("tab");
      window.history.replaceState(null, "", u.pathname + u.search);
    } catch {}
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSent(null);
    setBusy("submit");
    const r = await post(tab === "login" ? "/api/auth/login" : "/api/auth/register", { email, password });
    if (r.ok && r.redirect) {
      window.location.assign(r.redirect);
      return;
    }
    setBusy(null);
    setError({ text: r.error ?? "Не получилось", code: r.code });
  };

  const magic = async () => {
    setError(null);
    setSent(null);
    if (!email.trim()) {
      setError({ text: "Введите почту — пришлём на неё ссылку для входа" });
      emailRef.current?.focus();
      return;
    }
    setBusy("magic");
    const r = await post("/api/auth/magic", { email });
    setBusy(null);
    if (r.ok) setSent(r.message ?? "Отправили ссылку");
    else setError({ text: r.error ?? "Не получилось" });
  };

  const resetHref = `/reset${email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ""}`;

  return (
    <div>
      <div role="tablist" aria-label="Вход или регистрация" className="grid grid-cols-2 p-1 rounded-xl bg-white border border-line">
        {(["login", "register"] as const).map((t) => (
          <button
            key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => switchTab(t)}
            className={`h-10 rounded-[9px] text-[0.95rem] font-semibold transition-colors ${tab === t ? "bg-ink text-white" : "text-muted hover:text-ink"}`}
          >
            {t === "login" ? "Вход" : "Регистрация"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-6 grid gap-4" noValidate={false}>
        <div>
          <label htmlFor="email" className="label">Почта</label>
          <input
            ref={emailRef} id="email" type="email" inputMode="email" autoComplete="email" className="field" required maxLength={254}
            value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.ru"
          />
        </div>
        <PasswordField
          key={tab}
          id="password" label={tab === "login" ? "Пароль" : "Придумайте пароль"} value={password} onChange={setPassword}
          autoComplete={tab === "login" ? "current-password" : "new-password"}
          hint={tab === "register" ? "Не короче 8 символов" : undefined}
          aside={tab === "login" ? <Link href={resetHref} className="text-sm text-muted hover:text-ink underline underline-offset-2">Забыли пароль?</Link> : null}
        />

        {error ? (
          <Alert>
            {error.text}
            {error.code === "no_password" ? (
              <span className="flex flex-wrap gap-x-4 gap-y-1 mt-2 font-semibold">
                {google ? <a href="/api/auth/google/start" className="underline underline-offset-2">Войти через Google</a> : null}
                <Link href={resetHref} className="underline underline-offset-2">Задать пароль</Link>
              </span>
            ) : error.code === "bad_login" ? (
              <span className="flex flex-wrap gap-x-4 gap-y-1 mt-2 font-semibold">
                {google ? <a href="/api/auth/google/start" className="underline underline-offset-2">Войти через Google</a> : null}
                {mail ? <button type="button" onClick={magic} className="underline underline-offset-2">Войти по ссылке</button> : null}
                <Link href={resetHref} className="underline underline-offset-2">Восстановить пароль</Link>
              </span>
            ) : error.code === "exists" ? (
              <span className="flex flex-wrap gap-x-4 gap-y-1 mt-2 font-semibold">
                <button type="button" onClick={() => switchTab("login")} className="underline underline-offset-2">Войти</button>
                <Link href={resetHref} className="underline underline-offset-2">Восстановить пароль</Link>
              </span>
            ) : null}
          </Alert>
        ) : null}
        {sent ? <Alert tone="good">{sent}</Alert> : null}

        <button className="btn btn-primary h-12 w-full" disabled={busy !== null}>
          {busy === "submit" ? <Loader2 size={16} className="spin" /> : null}
          {tab === "login" ? "Войти" : "Создать аккаунт"}
        </button>
        {tab === "register" ? (
          <p className="hint -mt-1">Регистрируясь, вы соглашаетесь с <Link href="/privacy" className="underline underline-offset-2">политикой обработки данных</Link>.</p>
        ) : null}
      </form>

      {mail || google || demo ? (
        <>
          <div className="flex items-center gap-3 my-6 text-sm text-faint" aria-hidden="true">
            <span className="h-px flex-1 bg-line-2" />или<span className="h-px flex-1 bg-line-2" />
          </div>
          <div className="grid gap-3">
            {mail ? (
              <button type="button" onClick={magic} disabled={busy !== null} className="btn btn-ghost h-12 w-full bg-white">
                {busy === "magic" ? <Loader2 size={16} className="spin" /> : <Mail size={18} />}
                Войти по ссылке на почту
              </button>
            ) : null}
            {google ? (
              <a href="/api/auth/google/start" className="btn btn-ghost h-12 w-full bg-white">
                <GoogleIcon />
                {tab === "login" ? "Войти через Google" : "Зарегистрироваться через Google"}
              </a>
            ) : null}
            {demo ? (
              <form action="/api/auth/demo" method="post">
                <button className={`btn w-full h-12 ${demoHighlight ? "btn-mark" : "btn-ghost"}`}>Войти в демо без регистрации</button>
              </form>
            ) : null}
          </div>
          {demo ? <p className="hint mt-3">В демо реклама не тратит деньги: подключается тренировочный кабинет, а показы и обращения моделируются.</p> : null}
        </>
      ) : null}
    </div>
  );
}

/** /reset — запрос ссылки для нового пароля */
export function ResetRequestForm({ initialEmail, mail }: { initialEmail: string; mail: boolean }) {
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        setSent(null);
        const r = await post("/api/auth/reset", { email });
        setBusy(false);
        if (r.ok) setSent(r.message ?? "Письмо отправлено");
        else setError(r.error ?? "Не получилось");
      }}
    >
      {!mail ? <Alert>Восстановление по почте пока не настроено — напишите в поддержку.</Alert> : null}
      <div>
        <label htmlFor="email" className="label">Почта, с которой вы входите</label>
        <input id="email" type="email" inputMode="email" autoComplete="email" className="field" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.ru" autoFocus={!initialEmail} />
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {sent ? <Alert tone="good">{sent}</Alert> : null}
      <button className="btn btn-primary h-12 w-full" disabled={busy}>
        {busy ? <Loader2 size={16} className="spin" /> : null}
        Прислать ссылку
      </button>
    </form>
  );
}

/** /reset/[token] — новый пароль */
export function ResetConfirmForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const r = await post("/api/auth/reset/confirm", { token, password });
        if (r.ok) {
          window.location.assign(r.redirect ?? "/app");
          return;
        }
        setBusy(false);
        setError(r.error ?? "Не получилось");
      }}
    >
      <PasswordField id="password" label="Новый пароль" value={password} onChange={setPassword} autoComplete="new-password" hint="Не короче 8 символов. После смены все другие устройства выйдут из аккаунта." autoFocus />
      {error ? <Alert>{error}</Alert> : null}
      <button className="btn btn-primary h-12 w-full" disabled={busy}>
        {busy ? <Loader2 size={16} className="spin" /> : null}
        Сохранить и войти
      </button>
    </form>
  );
}

/** Убирает ?error= из адреса после показа, чтобы при обновлении страницы ошибка не возвращалась */
export function CleanUrl() {
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.has("error")) {
        u.searchParams.delete("error");
        window.history.replaceState(null, "", u.pathname + u.search);
      }
    } catch {}
  }, []);
  return null;
}

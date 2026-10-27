"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { ActionButton, api, useToast } from "./client";
import { PasswordField } from "./AuthForms";

type Props = { email: string; hasPassword: boolean; verified: boolean; mail: boolean; demo: boolean };

/** «Настройки → Аккаунт»: почта, смена пароля, «Задать пароль» для входивших через Google или по ссылке */
export function AccountSettings({ email, hasPassword, verified, mail, demo }: Props) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const router = useRouter();

  if (demo) {
    return <p className="text-muted mt-1">Демо-аккаунт — пароль и почта не нужны. Чтобы сохранить настоящую рекламу, зарегистрируйтесь по почте.</p>;
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ message: string }>("POST", "/api/auth/password", hasPassword ? { current, password } : { password });
      toast(r.message);
      setOpen(false);
      setCurrent("");
      setPassword("");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 grid gap-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0">
          <div className="text-sm text-muted">Почта для входа</div>
          <div className="font-semibold break-all">{email}</div>
        </div>
        {verified ? (
          <span className="pill bg-good-soft text-good"><Check size={13} /> Подтверждена</span>
        ) : (
          <span className="pill bg-warn-soft text-warn">Не подтверждена</span>
        )}
        {!verified && mail ? (
          <ActionButton url="/api/auth/verify/send" refresh={false} onDone={(d) => toast(d.message)}>Отправить письмо ещё раз</ActionButton>
        ) : null}
      </div>

      <div className="pt-5 border-t border-line">
        <div className="font-semibold">Пароль</div>
        {!open ? (
          <div className="mt-1 flex flex-wrap items-center gap-3 justify-between">
            <p className="text-sm text-muted max-w-xl">
              {hasPassword ? "Вы входите по почте и паролю." : "Пароль не задан — вы входите через Google или по ссылке из письма. Задайте пароль, чтобы входить и по почте."}
            </p>
            <button className={`btn btn-sm ${hasPassword ? "btn-ghost" : "btn-primary"}`} onClick={() => setOpen(true)}>
              {hasPassword ? "Сменить пароль" : "Задать пароль"}
            </button>
          </div>
        ) : (
          <form onSubmit={save} className="mt-3 grid gap-4 max-w-sm">
            {hasPassword ? <PasswordField id="current-password" label="Текущий пароль" value={current} onChange={setCurrent} autoComplete="current-password" autoFocus /> : null}
            <PasswordField
              id="new-password" label={hasPassword ? "Новый пароль" : "Придумайте пароль"} value={password} onChange={setPassword} autoComplete="new-password"
              hint="Не короче 8 символов. Другие устройства выйдут из аккаунта." autoFocus={!hasPassword}
            />
            {/* Подсказка менеджеру паролей, к какому логину относится пароль */}
            <input type="email" autoComplete="username" value={email} readOnly hidden />
            {error ? <div role="alert" className="rounded-xl bg-bad-soft text-bad px-4 py-3 text-sm">{error}</div> : null}
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-primary btn-sm" disabled={busy}>
                {busy ? <Loader2 size={16} className="spin" /> : null}
                {hasPassword ? "Сохранить пароль" : "Задать пароль"}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); setError(null); }}>Отмена</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

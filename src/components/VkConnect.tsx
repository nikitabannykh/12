"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2 } from "lucide-react";
import { api, useToast } from "./client";

/**
 * Подключение VK Рекламы. Два способа:
 *  1) «Войти через VK» — если на сервере настроено OAuth-приложение (нужно одобрение VK для чужих кабинетов);
 *  2) по ключам API своего кабинета — работает всегда, без участия разработчика.
 */
export function VkConnect({ oauth, back, compact = false }: { oauth: boolean; back: string; compact?: boolean }) {
  const [open, setOpen] = useState(!oauth && !compact);
  const [clientId, setId] = useState("");
  const [clientSecret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ login: string }>("POST", "/api/connect/vk/keys", { clientId, clientSecret });
      toast(`VK Реклама подключена: ${r.login}`);
      setSecret("");
      router.refresh();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {oauth ? <a className="btn btn-primary btn-sm" href={`/api/connect/vk/start?back=${encodeURIComponent(back)}`}>Подключить VK Рекламу</a> : null}
        <button type="button" className={`btn btn-sm ${oauth ? "btn-ghost" : "btn-primary"}`} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <KeyRound size={14} /> {oauth ? "По ключам API" : "Подключить VK Рекламу по ключам API"}
        </button>
      </div>
      {open ? (
        <form onSubmit={save} className="rounded-xl border border-line p-4 grid gap-3 max-w-xl">
          <ol className="text-sm text-muted leading-relaxed list-decimal pl-5 grid gap-1">
            <li>Откройте <a className="underline" href="https://ads.vk.com/hq/settings/access" target="_blank" rel="noreferrer">ads.vk.com → Настройки → Доступ к API</a>.</li>
            <li>Нажмите «Запросить доступ к API», укажите имя и контакт. Юрлицу нужно заполнить реквизиты в разделе «Бюджет».</li>
            <li>Когда доступ дадут, там появятся <b>client_id</b> и <b>client_secret</b>. Секрет показывается только 10 минут — сразу скопируйте его сюда.</li>
          </ol>
          <div>
            <label className="label" htmlFor="vk-id">client_id</label>
            <input id="vk-id" className="field" value={clientId} onChange={(e) => setId(e.target.value)} autoComplete="off" spellCheck={false} required />
          </div>
          <div>
            <label className="label" htmlFor="vk-secret">client_secret</label>
            <input id="vk-secret" className="field" type="password" value={clientSecret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} required />
          </div>
          <p className="hint">Ключ храним зашифрованным и используем только для управления рекламой в этом кабинете. Отключить можно в любой момент — здесь или удалив ключ в VK.</p>
          <button className="btn btn-primary btn-sm self-start" disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : null} Проверить и подключить</button>
        </form>
      ) : null}
    </div>
  );
}

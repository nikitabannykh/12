"use client";
/** «Настроить VK за меня»: пиксель и событие «Заявка» — с согласия владельца, без похода в кабинет VK */
import { useEffect, useState } from "react";
import { Check, ExternalLink, Loader2 } from "lucide-react";
import { api, useToast } from "./client";

type State = { pixel: number | null; goal: boolean; email: string | null; url: string };

export function VkPixelSetup() {
  const [st, setSt] = useState<State | null>(null);
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function load() {
    try {
      const s = await api<State>("GET", "/api/connect/vk/pixel");
      setSt(s);
      setEmail((e) => e || s.email || "");
    } catch {
      setSt(null);
    }
  }
  useEffect(() => { load(); }, []);

  if (!st) return null;
  if (st.pixel && st.goal) return <div className="text-sm text-good"><Check size={14} className="inline -mt-0.5" /> Пиксель VK {st.pixel} и событие «Заявка» подключены</div>;

  if (st.pixel) {
    return (
      <div className="rounded-lg bg-paper p-3 text-sm grid gap-2">
        <div><Check size={14} className="inline -mt-0.5 text-good" /> Пиксель VK {st.pixel} подключён. Осталось одно: событие «Заявка» — через API VK его создать нельзя.</div>
        <ol className="list-decimal pl-5 text-ink-2 grid gap-0.5">
          <li>Откройте <a className="underline font-semibold inline-flex items-center gap-1" href="https://ads.vk.ru/hq/pixels" target="_blank" rel="noreferrer">Конверсии → Пиксели <ExternalLink size={12} /></a> и выберите пиксель {st.pixel}.</li>
          <li>«События» → «Добавить событие» → «JS-событие», ID: <code className="px-1 bg-white rounded">lead</code>, название «Заявка».</li>
          <li>Нажмите «Проверить» здесь.</li>
        </ol>
        <button className="btn btn-ghost btn-sm justify-self-start" disabled={busy} onClick={async () => { setBusy(true); await load(); setBusy(false); }}>{busy ? <Loader2 size={14} className="spin" /> : null} Проверить</button>
      </div>
    );
  }

  return (
    <form
      className="rounded-lg bg-paper p-3 text-sm grid gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const r = await api<{ pixel: number; goal: boolean; note: string | null }>("POST", "/api/connect/vk/pixel", { email, consent });
          toast(r.goal ? "Пиксель VK подключён" : "Пиксель VK создан — осталось добавить событие «Заявка»");
          await load();
        } catch (err) {
          toast((err as Error).message, "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="font-semibold">Пиксель VK — нужен, чтобы VK искал тех, кто записывается</div>
      <p className="text-muted">Создадим его в вашем кабинете сами. VK требует для пикселя email владельца — укажите свой (на него VK может прислать уведомления). Код пикселя на страницу записи поставим тоже мы.</p>
      <input className="field h-9" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@mail.ru" autoComplete="email" />
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>Разрешаю создать пиксель VK в моём кабинете с этим email для сайта <span className="break-all">{st.url}</span></span>
      </label>
      <button className="btn btn-primary btn-sm justify-self-start" disabled={!consent || !email || busy}>{busy ? <Loader2 size={14} className="spin" /> : null} Настроить VK за меня</button>
    </form>
  );
}

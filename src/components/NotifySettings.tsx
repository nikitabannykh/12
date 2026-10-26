"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Send } from "lucide-react";
import { ActionButton, api, useToast } from "./client";

type Status = { configured: boolean; connected: boolean; name: string | null; digest: boolean };

/** Блок «Уведомления о заявках»: привязка Telegram, проверка, утренняя сводка */
export function NotifySettings({ initial, link, linkError }: { initial: Status; link: string | null; linkError?: string | null }) {
  const [s, setS] = useState(initial);
  const [waiting, setWaiting] = useState(false);
  const [digestBusy, setDigestBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const toast = useToast();
  const router = useRouter();

  useEffect(() => setS(initial), [initial]);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  // После перехода в Telegram ждём, пока владелец нажмёт «Start», — до 5 минут
  const startWaiting = () => {
    if (timer.current) clearInterval(timer.current);
    setWaiting(true);
    const started = Date.now();
    timer.current = setInterval(async () => {
      try {
        const st = await api<Status>("GET", "/api/notify");
        if (st.connected) {
          clearInterval(timer.current!);
          setWaiting(false);
          setS(st);
          toast("Telegram подключён — заявки будут приходить туда");
          router.refresh();
          return;
        }
      } catch {
        /* попробуем ещё раз */
      }
      if (Date.now() - started > 5 * 60e3) {
        clearInterval(timer.current!);
        setWaiting(false);
      }
    }, 3000);
  };

  if (!s.configured) {
    return <p className="text-muted mt-1 leading-relaxed max-w-2xl">Telegram-уведомления пока не настроены на сервере. Новые заявки видны в разделе «Статистика → Последние обращения».</p>;
  }

  if (!s.connected) {
    return (
      <>
        <p className="text-muted mt-1 leading-relaxed max-w-2xl">Каждая новая заявка придёт в Telegram сразу — с именем, телефоном и объявлением, из которого пришёл человек. Чем быстрее перезвонить, тем больше людей записывается.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {link ? (
            <a href={link} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm" onClick={startWaiting}>
              <Send size={14} /> Подключить Telegram
            </a>
          ) : (
            <span className="text-sm text-bad">{linkError || "Не удалось получить ссылку на бота. Обновите страницу."}</span>
          )}
          {waiting ? <span className="text-sm text-muted inline-flex items-center gap-2"><Loader2 size={14} className="spin" /> Откройте бота и нажмите «Запустить» (Start)…</span> : null}
        </div>
        <p className="hint mt-3 max-w-2xl">Откроется чат с ботом. Нажмите «Запустить» — и эта страница сама увидит подключение. Ссылка действует час.</p>
      </>
    );
  }

  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <span className="pill bg-good-soft text-good"><Check size={13} /> Заявки приходят в Telegram{s.name ? `: ${s.name}` : ""}</span>
      </div>
      <label className="mt-4 flex items-start gap-3 max-w-2xl cursor-pointer">
        <input
          type="checkbox"
          className="mt-1 w-4 h-4"
          checked={s.digest}
          disabled={digestBusy}
          onChange={async (e) => {
            const digest = e.target.checked;
            setDigestBusy(true);
            try {
              await api("PATCH", "/api/notify", { digest });
              setS((x) => ({ ...x, digest }));
              toast(digest ? "Утренняя сводка включена" : "Утренняя сводка выключена");
            } catch (err) {
              toast((err as Error).message, "error");
            } finally {
              setDigestBusy(false);
            }
          }}
        />
        <span>
          <span className="font-medium">Утренняя сводка</span>
          <span className="block text-sm text-muted">Раз в день: сколько потрачено вчера, сколько было обращений и что поменял робот.</span>
        </span>
      </label>
      <div className="mt-4 flex flex-wrap gap-2">
        <ActionButton url="/api/notify/test" done="Проверочное сообщение отправлено — загляните в Telegram" refresh={false}>Отправить проверку</ActionButton>
        <ActionButton method="DELETE" url="/api/notify" confirm="Отключить уведомления в Telegram? Заявки по-прежнему будут видны в «Статистике»." done="Уведомления отключены">Отключить</ActionButton>
      </div>
    </>
  );
}

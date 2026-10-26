"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Send } from "lucide-react";
import { ActionButton, api, useToast } from "./client";

type Unlinked = { reason: string; at: string; chat: string | null };
type Status = { configured: boolean; connected: boolean; name: string | null; digest: boolean; unlinked?: Unlinked | null };

const dateText = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });

/** Блок «Уведомления о заявках»: привязка Telegram, проверка, утренняя сводка */
export function NotifySettings({ initial }: { initial: Status }) {
  const [s, setS] = useState(initial);
  const [waiting, setWaiting] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [digestBusy, setDigestBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const toast = useToast();
  const router = useRouter();

  useEffect(() => setS(initial), [initial]);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  // Ссылка одноразовая и живёт 15 минут — получаем её по нажатию. Окно открываем сразу (иначе браузер заблокирует всплывающее окно)
  const connect = async () => {
    setLinkError(null);
    setLinkBusy(true);
    const w = window.open("", "_blank");
    try {
      const { url } = await api<{ url: string }>("POST", "/api/notify/link");
      setLink(url);
      if (w) w.location.href = url;
      startWaiting();
    } catch (e) {
      w?.close();
      setLinkError((e as Error).message);
    } finally {
      setLinkBusy(false);
    }
  };

  // После перехода в Telegram ждём, пока владелец нажмёт «Start» и «Подключить», — до 15 минут
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
      if (Date.now() - started > 15 * 60e3) {
        clearInterval(timer.current!);
        setWaiting(false);
      }
    }, 3000);
  };

  if (!s.configured) {
    return <p className="text-muted mt-1 leading-relaxed max-w-2xl">Telegram-уведомления пока не настроены на сервере. Новые заявки видны в разделе «Статистика → Последние обращения».</p>;
  }

  if (!s.connected) {
    const u = s.unlinked;
    return (
      <>
        {u ? (
          <p className="mt-2 rounded-xl bg-warn-soft text-ink px-4 py-3 text-sm leading-relaxed max-w-2xl" role="status">
            <b>Уведомления отключены {dateText(u.at)}</b>{u.chat ? ` (были в чате ${u.chat})` : ""}: {u.reason}. Новые заявки по-прежнему видны в «Статистике», а в Telegram — после повторного подключения.
          </p>
        ) : null}
        <p className="text-muted mt-2 leading-relaxed max-w-2xl">Каждая новая заявка придёт в Telegram сразу — с именем, телефоном и объявлением, из которого пришёл человек. Чем быстрее перезвонить, тем больше людей записывается.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className="btn btn-primary btn-sm" onClick={connect} disabled={linkBusy}>
            {linkBusy ? <Loader2 size={14} className="spin" /> : <Send size={14} />} {u ? "Подключить снова" : "Подключить Telegram"}
          </button>
          {link && waiting ? <a href={link} target="_blank" rel="noreferrer" className="text-sm font-semibold underline">Telegram не открылся? Нажмите сюда</a> : null}
        </div>
        {linkError ? <p className="text-sm text-bad mt-2" role="alert">{linkError}</p> : null}
        {waiting ? <p className="text-sm text-muted mt-3 inline-flex items-center gap-2"><Loader2 size={14} className="spin shrink-0" /> В Telegram нажмите «Запустить» (Start), затем «Подключить»…</p> : null}
        <p className="hint mt-3 max-w-2xl">Откроется чат с ботом. Он спросит, подключить ли уведомления для «вашего бизнеса», — нажмите «Подключить», и эта страница сама увидит подключение. Ссылка одноразовая и действует 15 минут: не пересылайте её никому.</p>
      </>
    );
  }

  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <span className="pill bg-good-soft text-good whitespace-normal"><Check size={13} className="shrink-0" /> Заявки приходят в Telegram{s.name ? `: ${s.name}` : ""}</span>
      </div>
      <p className="hint mt-2 max-w-2xl">Не узнаёте этот чат? Нажмите «Отключить» и подключите Telegram заново — старая ссылка уже не сработает.</p>
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
        <ActionButton method="DELETE" url="/api/notify" confirm="Отключить уведомления в Telegram? Заявки по-прежнему будут видны в «Статистике»." done="Уведомления отключены" onDone={() => setS((x) => ({ ...x, connected: false, name: null, unlinked: null }))}>Отключить</ActionButton>
      </div>
    </>
  );
}

"use client";
/** «Куда ведёт реклама»: страница записи, сайт или любая ссылка — для всех каналов и отдельно для каждого */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Link2, Loader2 } from "lucide-react";
import { api, useToast } from "./client";
import { isMessenger, linkLabel, normalizeUrl, type LandingMode, type LandingSettings, type LandingTarget } from "@/lib/engine/landing";

const CH_NAME: Record<string, string> = {
  search: "Поиск Яндекса", network: "Сайты и приложения (РСЯ)", vk: "ВКонтакте", retarget_yandex: "Ретаргетинг в Яндексе", retarget_vk: "Ретаргетинг ВКонтакте",
};

function TargetPicker({ value, onChange, siteUrl, pageUrl, allowAuto, autoLabel, yandex }: {
  value: LandingTarget; onChange: (t: LandingTarget) => void; siteUrl: string | null; pageUrl: string; allowAuto?: boolean; autoLabel?: string; yandex?: boolean;
}) {
  const opts: { v: LandingMode; label: string; hint: string; disabled?: boolean }[] = [
    ...(allowAuto ? [{ v: "auto" as const, label: autoLabel ?? "Как для всех", hint: "" }] : []),
    { v: "page", label: "Страница записи", hint: "Наша страница с формой записи и кнопками связи. Заявки считаются сами." },
    { v: "site", label: siteUrl ? `Сайт — ${siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}` : "Сайт (не указан)", hint: "Заявки считаются, если на сайте стоит наш код — статус и инструкция ниже, в «Подключение сайта».", disabled: !siteUrl },
    { v: "link", label: "Другая ссылка", hint: "Онлайн-запись (YCLIENTS, DIKIDI), Taplink, нужная страница сайта, WhatsApp или Telegram. Заявки там мы не видим — считаем переходы; записи отмечайте в «Статистике»." },
  ];
  const url = value.mode === "link" ? value.url ?? "" : "";
  const norm = url ? normalizeUrl(url) : null;
  return (
    <div className="grid gap-2">
      {opts.map((o) => (
        <label key={o.v} className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 cursor-pointer ${value.mode === o.v ? "border-ink bg-paper/60" : "border-line"} ${o.disabled ? "opacity-50 cursor-not-allowed" : ""}`}>
          <input type="radio" className="mt-1" checked={value.mode === o.v} disabled={o.disabled} onChange={() => onChange({ mode: o.v, url: o.v === "link" ? value.url ?? "" : null })} />
          <span className="min-w-0">
            <span className="font-medium">{o.label}</span>
            {o.v === "page" ? <a href={pageUrl} target="_blank" rel="noreferrer" className="ml-2 text-sm text-ink-2 underline inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>открыть <ExternalLink size={12} /></a> : null}
            {o.hint && value.mode === o.v ? <span className="block text-sm text-muted mt-0.5">{o.hint}</span> : null}
          </span>
        </label>
      ))}
      {value.mode === "link" ? (
        <div className="grid gap-1 pl-1">
          <input className="field" placeholder="https://dikidi.net/… , https://wa.me/79001234567 или @telegram" value={url} onChange={(e) => onChange({ mode: "link", url: e.target.value })} />
          {url && !norm ? <span className="text-sm text-bad">Не похоже на ссылку — проверьте адрес</span> : null}
          {norm ? <span className="text-sm text-muted">Будет вести на: <a href={norm} target="_blank" rel="noreferrer" className="underline">{linkLabel(norm)}</a> · {norm}</span> : null}
          {norm && yandex && isMessenger(norm) ? <span className="text-sm text-warn">Яндекс Директ обычно не пропускает ссылки на мессенджеры и соцсети. Для Яндекса лучше страница записи или сайт — а мессенджер оставьте для ВКонтакте.</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export function LandingEditor({ initial, siteUrl, pageUrl, channels, live, hasYandex }: {
  initial: LandingSettings; siteUrl: string | null; pageUrl: string; channels: string[]; live: boolean; hasYandex: boolean;
}) {
  const start: LandingSettings = initial?.mode ? initial : { mode: "auto" };
  const [s, setS] = useState<LandingSettings>(start);
  const [saved, setSaved] = useState(JSON.stringify(start));
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();
  const main: LandingTarget = s.mode === "auto" ? { mode: siteUrl ? "site" : "page" } : s;
  const dirty = JSON.stringify(s) !== saved;
  const perCount = Object.keys(s.channels ?? {}).length;

  async function save() {
    setBusy(true);
    try {
      const r = await api<{ settings: LandingSettings; updated: number; warnings: string[] }>("PUT", "/api/landing", s);
      setS(r.settings);
      setSaved(JSON.stringify(r.settings));
      if (r.warnings.length) toast(`Сохранили. Обратите внимание:\n${r.warnings.slice(0, 3).join("\n")}`, "error");
      else toast(live && r.updated ? `Сохранили и поменяли ссылки в ${r.updated} кампаниях — объявления пройдут модерацию заново` : live ? "Сохранили" : "Сохранили — применим при запуске");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <div className="font-semibold flex items-center gap-2"><Link2 size={16} /> Для всех каналов</div>
        <TargetPicker value={main} onChange={(t) => setS({ ...s, ...t })} siteUrl={siteUrl} pageUrl={pageUrl} yandex={hasYandex} />
      </div>
      {channels.length > 1 ? (
        <details className="rounded-xl border border-line" open={perCount > 0}>
          <summary className="cursor-pointer px-4 py-3 font-semibold">Отдельно для каналов{perCount ? ` · задано: ${perCount}` : ""}</summary>
          <div className="px-4 pb-4 grid gap-4">
            <p className="text-sm text-muted">Например, ВКонтакте — в WhatsApp или Telegram, а поиск Яндекса — на сайт.</p>
            {channels.map((ch) => (
              <div key={ch} className="grid gap-1.5">
                <div className="text-sm font-semibold">{CH_NAME[ch] ?? ch}</div>
                <TargetPicker allowAuto autoLabel="Как для всех каналов" value={s.channels?.[ch] ?? { mode: "auto" }} siteUrl={siteUrl} pageUrl={pageUrl} yandex={!/vk/.test(ch)}
                  onChange={(t) => {
                    const next = { ...(s.channels ?? {}) };
                    if (t.mode === "auto") delete next[ch];
                    else next[ch] = t;
                    setS({ ...s, channels: next });
                  }} />
              </div>
            ))}
          </div>
        </details>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary" disabled={!dirty || busy} onClick={save}>{busy ? <Loader2 size={16} className="spin" /> : null} Сохранить</button>
        {dirty ? <button type="button" className="btn btn-ghost" onClick={() => setS(JSON.parse(saved))}>Отменить</button> : null}
        <span className="text-sm text-muted">{live ? "Ссылки поменяем в кабинетах сразу; объявления пройдут модерацию заново, статистика сохранится." : "Применим при запуске рекламы."}</span>
      </div>
    </div>
  );
}

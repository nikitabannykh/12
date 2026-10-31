"use client";
/** «Куда ведёт реклама»: страница записи, сайт или любая ссылка — для всех каналов и отдельно для каждого */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, ExternalLink, Link2, Loader2 } from "lucide-react";
import { api, useToast } from "./client";
import { isMessenger, linkLabel, normalizeUrl, type LandingMode, type LandingSettings, type LandingTarget } from "@/lib/engine/landing";

const CH_NAME: Record<string, string> = {
  search: "Поиск Яндекса", network: "Сайты и приложения (РСЯ)", vk: "ВКонтакте", retarget_yandex: "Ретаргетинг в Яндексе", retarget_vk: "Ретаргетинг ВКонтакте",
};

type SiteCode = "ok" | "missing" | "unknown" | null;

/** Явно: стоит ли наш код на сайте — без него заявки с сайта не считаются */
function SiteCodeNote({ code }: { code: SiteCode }) {
  if (!code) return null;
  return code === "ok" ? (
    <span className="mt-1.5 inline-flex items-center gap-1.5 text-sm font-semibold text-good"><CheckCircle2 size={15} /> Код на сайте стоит — заявки с сайта считаются</span>
  ) : (
    <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-bad-soft text-bad px-2.5 py-1.5 text-sm">
      <CircleAlert size={15} className="shrink-0" />
      <b className="font-semibold">{code === "missing" ? "Код на сайте не найден" : "Код на сайт ещё не установлен"}</b>
      <span className="text-ink-2">— заявки с сайта не считаются.</span>
      <a href="/app/settings?tab=site#site" className="font-semibold underline underline-offset-2" onClick={(e) => e.stopPropagation()}>Поставить код →</a>
    </span>
  );
}

function TargetPicker({ value, onChange, siteUrl, pageUrl, allowAuto, autoLabel, yandex, siteCode = null, newSite, onNewSite }: {
  value: LandingTarget; onChange: (t: LandingTarget) => void; siteUrl: string | null; pageUrl: string; allowAuto?: boolean; autoLabel?: string; yandex?: boolean; siteCode?: SiteCode;
  /** Сайт ещё не указан — его можно вписать прямо здесь (только в выборе «для всех каналов») */
  newSite?: string; onNewSite?: (v: string) => void;
}) {
  const opts: { v: LandingMode; label: string; hint: string; disabled?: boolean }[] = [
    ...(allowAuto ? [{ v: "auto" as const, label: autoLabel ?? "Как для всех", hint: "" }] : []),
    { v: "page", label: "Страница записи", hint: "Наша страница с формой записи и кнопками связи. Заявки считаются сами." },
    { v: "site", label: siteUrl ? `Сайт — ${siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}` : onNewSite ? "Свой сайт" : "Сайт (не указан)", hint: "", disabled: !siteUrl && !onNewSite && !newSite },
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
            {o.v === "site" && value.mode === "site" && siteUrl ? <SiteCodeNote code={siteCode} /> : null}
            {o.v === "site" && !siteUrl && onNewSite && value.mode === "site" ? (
              <span className="mt-2 grid gap-1" onClick={(e) => e.preventDefault()}>
                <input className="field" autoFocus placeholder="Адрес сайта, например lak-studio.ru" value={newSite ?? ""} onChange={(e) => onNewSite(e.target.value)} />
                <span className="text-sm text-muted">Проверим, что сайт открывается, и сохраним его в данных о бизнесе. Чтобы считать заявки с сайта, после сохранения поставьте на него наш код.</span>
              </span>
            ) : null}
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

export function LandingEditor({ initial, siteUrl, pageUrl, channels, live, hasYandex, siteCode = null }: {
  initial: LandingSettings; siteUrl: string | null; pageUrl: string; channels: string[]; live: boolean; hasYandex: boolean; siteCode?: SiteCode;
}) {
  const start: LandingSettings = initial?.mode ? initial : { mode: "auto" };
  const [s, setS] = useState<LandingSettings>(start);
  const [saved, setSaved] = useState(JSON.stringify(start));
  const [busy, setBusy] = useState(false);
  const [newSite, setNewSite] = useState("");
  const toast = useToast();
  const router = useRouter();
  const main: LandingTarget = s.mode === "auto" ? { mode: siteUrl ? "site" : "page" } : s;
  const dirty = JSON.stringify(s) !== saved || Boolean(newSite.trim());
  const perCount = Object.keys(s.channels ?? {}).length;

  async function save(next: LandingSettings = s, quiet = false) {
    setBusy(true);
    try {
      const m: LandingTarget = next.mode === "auto" ? { mode: siteUrl ? "site" : "page" } : next;
      if (!siteUrl && m.mode === "site" && !newSite.trim()) throw new Error("Впишите адрес сайта");
      const r = await api<{ settings: LandingSettings; updated: number; warnings: string[] }>("PUT", "/api/landing", newSite.trim() ? { ...next, siteUrl: newSite.trim() } : next);
      setNewSite("");
      setS(r.settings);
      setSaved(JSON.stringify(r.settings));
      if (r.warnings.length) toast(`Сохранили. Обратите внимание:\n${r.warnings.slice(0, 3).join("\n")}`, "error");
      else if (!quiet) toast(live && r.updated ? `Сохранили и поменяли ссылки в ${r.updated} кампаниях — объявления пройдут модерацию заново` : live ? "Сохранили" : "Сохранили — применим при запуске");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  /**
   * До запуска выбор сохраняем сразу — кнопка не нужна. Ждём только ввода: своя ссылка или адрес нового сайта.
   * У идущей рекламы — по кнопке: смена ссылки отправляет объявления на повторную модерацию
   */
  const needsInput = (t: LandingSettings) => {
    const all = [t.mode === "auto" ? null : t, ...Object.values(t.channels ?? {})].filter(Boolean) as LandingTarget[];
    return all.some((x) => (x.mode === "link" && !String(x.url ?? "").trim()) || (x.mode === "site" && !siteUrl));
  };
  // Своя ссылка печатается по буквам — её сохраняем кнопкой, остальное сразу
  const hasLink = (t: LandingSettings) => t.mode === "link" || Object.values(t.channels ?? {}).some((x) => x?.mode === "link");
  const change = (next: LandingSettings) => {
    setS(next);
    if (!live && !needsInput(next) && !hasLink(next)) void save(next, true);
  };
  const showSave = live || dirty;

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <div className="font-semibold flex items-center gap-2"><Link2 size={16} /> Для всех каналов</div>
        <TargetPicker siteCode={siteCode} value={main} onChange={(t) => change({ ...s, ...t })} siteUrl={siteUrl} pageUrl={pageUrl} yandex={hasYandex} newSite={newSite} onNewSite={siteUrl ? undefined : setNewSite} />
      </div>
      {channels.length > 1 ? (
        <details className="rounded-xl border border-line" open={perCount > 0}>
          <summary className="cursor-pointer px-4 py-3 font-semibold">Отдельно для каналов{perCount ? ` · задано: ${perCount}` : ""}</summary>
          <div className="px-4 pb-4 grid gap-4">
            <p className="text-sm text-muted">Например, ВКонтакте — в WhatsApp или Telegram, а поиск Яндекса — на сайт.</p>
            {channels.map((ch) => (
              <div key={ch} className="grid gap-1.5">
                <div className="text-sm font-semibold">{CH_NAME[ch] ?? ch}</div>
                <TargetPicker siteCode={siteCode} allowAuto autoLabel="Как для всех каналов" value={s.channels?.[ch] ?? { mode: "auto" }} siteUrl={siteUrl} pageUrl={pageUrl} yandex={!/vk/.test(ch)} newSite={newSite}
                  onChange={(t) => {
                    const next = { ...(s.channels ?? {}) };
                    if (t.mode === "auto") delete next[ch];
                    else next[ch] = t;
                    change({ ...s, channels: next });
                  }} />
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {showSave ? <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary" disabled={!dirty || busy} onClick={() => save()}>{busy ? <Loader2 size={16} className="spin" /> : null} Сохранить</button>
        {dirty ? <button type="button" className="btn btn-ghost" onClick={() => { setS(JSON.parse(saved)); setNewSite(""); }}>Отменить</button> : null}
        <span className="text-sm text-muted">{live ? "Ссылки поменяем в кабинетах сразу; объявления пройдут модерацию заново, статистика сохранится." : "Впишите адрес и сохраните."}</span>
      </div> : <p className="text-sm text-muted inline-flex items-center gap-1.5">{busy ? <><Loader2 size={14} className="spin" /> Сохраняем…</> : "Выбор сохраняется сразу и применится при запуске."}</p>}
    </div>
  );
}

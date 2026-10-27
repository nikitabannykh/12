"use client";

/**
 * Анкета бизнеса в три шага:
 *  1. «Ссылка» — одно поле (+ ещё ссылки): сайт, Яндекс Карты, 2ГИС, Taplink, VK, YCLIENTS/DIKIDI → «Заполнить автоматически».
 *     Пока читаем — живой список источников: «Яндекс Карты: адрес, часы, 15 услуг с ценами».
 *  2. «Проверка» — компактная карточка найденного: у каждого поля чип источника, подсвечены только
 *     недостающие обязательные (сфера, город, телефон или мессенджер, хотя бы одна услуга). Всё правится на месте.
 *  3. «Все поля» — полная анкета (BusinessForm) с теми же данными.
 * Тот же мастер открывается из «Настройки → Изменить описание» (сразу на проверке, с кнопкой «Обновить по ссылке»).
 */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, CircleAlert, ImageOff, Link2, Loader2, Plus, Star, Trash2, TriangleAlert, X } from "lucide-react";
import { api, useToast } from "./client";
import { BusinessForm, businessPayload, type BusinessInput } from "./BusinessForm";
import type { Draft, DraftField, ImportEvent, ImportReport, SourceKind } from "@/lib/importer/types";
import { SOURCE_NAME } from "@/lib/importer/types";

type NicheLite = { id: string; label: string; examples: string[] };
type Step = "link" | "review" | "full";
type Row = { key: string; kind: SourceKind; state: "loading" | ImportReport["status"]; text: string };

const MAX_LINKS = 5;
const PHOTO_LIMIT = 6;
/** Сколько услуг показывать в короткой карточке до «Ещё N услуг» */
const SHOW_SERVICES = 6;

/** Источник по ссылке — для подписи прямо в поле, пока человек вставляет ссылку */
function guessKind(raw: string): SourceKind | null {
  const s = raw.trim().toLowerCase();
  if (!s || !/[.]/.test(s)) return null;
  if (/(yandex\.[a-z.]+|ya\.ru)\/(web-)?maps/.test(s)) return "yandex";
  if (/(^|\/\/|\.)2gis\./.test(s) || s.includes("go.2gis.com")) return "dgis";
  if (/dikidi\./.test(s)) return "dikidi";
  if (/yclients\./.test(s)) return "yclients";
  if (/taplink\./.test(s)) return "taplink";
  if (/(^|\/\/|\.)(vk\.com|vk\.ru)/.test(s)) return "vk";
  return "site";
}

const KIND_LABEL: Record<SourceKind, string> = { ...SOURCE_NAME, site: "Сайт" };

const EXAMPLES = ["lak-studio.ru", "yandex.ru/maps/org/…", "2gis.ru/kazan/firm/…", "taplink.cc/lak", "vk.com/lak_studio"];

const REQUIRED_TEXT: Record<Draft["missing"][number], string> = {
  name: "название",
  niche: "сферу",
  city: "город",
  contact: "телефон или мессенджер",
  services: "хотя бы одну услугу",
};

function missingOf(f: BusinessInput): Draft["missing"] {
  const m: Draft["missing"] = [];
  if (!f.name.trim()) m.push("name");
  if (!f.niche) m.push("niche");
  if (f.city.trim().length < 2) m.push("city");
  if (!f.phone.trim() && !f.whatsapp.trim() && !f.telegram.trim()) m.push("contact");
  if (!f.services.some((s) => s.name.trim())) m.push("services");
  return m;
}

/** Черновик → анкета. replace — для новой анкеты; fill — только пустые поля (обновление существующей) */
function applyDraft(f: BusinessInput, d: Draft, mode: "replace" | "fill"): BusinessInput {
  const pick = (cur: string, v: string | null | undefined) => (mode === "fill" ? cur.trim() || v || "" : v || cur);
  const hasServices = f.services.some((s) => s.name.trim());
  return {
    ...f,
    name: pick(f.name, d.name).slice(0, 80),
    niche: mode === "fill" ? f.niche || d.niche || "" : d.niche || f.niche,
    city: pick(f.city, d.city).slice(0, 60),
    address: pick(f.address, d.address).slice(0, 200),
    phone: pick(f.phone, d.phone).slice(0, 40),
    whatsapp: pick(f.whatsapp, d.whatsapp).slice(0, 60),
    telegram: pick(f.telegram, d.telegram).slice(0, 60),
    hours: pick(f.hours, d.hours).slice(0, 80),
    siteUrl: pick(f.siteUrl, d.siteUrl).slice(0, 300),
    orgUrl: pick(f.orgUrl, d.orgUrl).slice(0, 500),
    description: pick(f.description, d.description).slice(0, 1500),
    review: pick(f.review, d.review).slice(0, 300),
    services: d.services.length && (mode === "replace" || !hasServices) ? d.services.slice(0, 15).map((s) => ({ name: s.name.slice(0, 80), price: (s.price ?? "").slice(0, 40) })) : f.services,
    advantages: d.advantages.length && (mode === "replace" || !f.advantages.length) ? d.advantages.slice(0, 8).map((a) => a.slice(0, 100)) : f.advantages,
  };
}

/** Читает поток NDJSON из /api/business/import */
async function runImport(urls: string[], onEvent: (e: ImportEvent) => void): Promise<Draft> {
  const res = await fetch("/api/business/import", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify({ urls }),
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Ошибка ${res.status}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let draft: Draft | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const e = JSON.parse(line) as ImportEvent;
      if (e.type === "done") draft = e.draft;
      else if (e.type === "error") throw new Error(e.error);
      else onEvent(e);
    }
    if (done) break;
  }
  if (!draft) throw new Error("Соединение прервалось. Попробуйте ещё раз.");
  return draft;
}

export function BusinessOnboarding({
  initial, niches, next, nicheLock, editing,
}: { initial: BusinessInput; niches: NicheLite[]; next: string; nicheLock: "launched" | "plan" | null; editing: boolean }) {
  const [step, setStep] = useState<Step>(editing ? "review" : "link");
  const [f, setF] = useState<BusinessInput>(initial);
  const [links, setLinks] = useState<string[]>(() => {
    const pre = [initial.siteUrl, initial.orgUrl].filter(Boolean);
    return editing && pre.length ? pre : [""];
  });
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sources, setSources] = useState<Partial<Record<DraftField, string>>>({});
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const router = useRouter();
  const top = useRef<HTMLDivElement>(null);

  // Ссылки вида /app/start#org и #hours ведут сразу в нужное поле полной анкеты
  useEffect(() => {
    if (/^#(org|hours)$/.test(window.location.hash)) setStep("full");
  }, []);

  const go = (s: Step) => {
    setStep(s);
    if (s === "full" && !f.services.length) setF((x) => ({ ...x, services: [{ name: "", price: "" }] }));
    requestAnimationFrame(() => top.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  async function autofill() {
    const urls = links.map((l) => l.trim()).filter(Boolean);
    if (!urls.length) return toast("Вставьте хотя бы одну ссылку", "error");
    setRunning(true);
    setRows([]);
    try {
      const d = await runImport(urls, (e) => {
        if (e.type === "progress" && e.url && e.kind) {
          const key = e.url;
          setRows((r) => (r.some((x) => x.key === key) ? r : [...r, { key, kind: e.kind!, state: "loading", text: e.text }]));
        } else if (e.type === "source") {
          const rep = e.report;
          setRows((r) => r.map((x) => (x.key === rep.url ? { ...x, state: rep.status, text: rep.status === "ok" ? rep.summary || "почти ничего не нашли" : rep.message || rep.summary } : x)));
        }
      });
      const usable = d.reports.some((r) => r.status === "ok" || r.status === "partial" || r.status === "blocked");
      const anything = d.name || d.address || d.phone || d.services.length || d.orgUrl || d.siteUrl;
      if (!usable || !anything) {
        toast("По этим ссылкам ничего не нашли. Проверьте адрес или заполните вручную.", "error");
        setRunning(false);
        return;
      }
      setDraft(d);
      setSources(d.sources);
      setPhotos(d.photos.slice(0, PHOTO_LIMIT));
      setF((x) => applyDraft(x, d, editing ? "fill" : "replace"));
      // Дать прочитать итог по источникам — и на проверку
      await new Promise((r) => setTimeout(r, 700));
      setRunning(false);
      go("review");
    } catch (e) {
      toast((e as Error).message, "error");
      setRunning(false);
    }
  }

  async function save(values: BusinessInput) {
    const miss = missingOf(values);
    if (miss.length) {
      setStep("review");
      toast(`Осталось указать: ${miss.map((m) => REQUIRED_TEXT[m]).join(", ")}`, "error");
      requestAnimationFrame(() => document.querySelector("[data-missing='true']")?.scrollIntoView({ behavior: "smooth", block: "center" }));
      return;
    }
    setBusy("Сохраняем…");
    try {
      await api("POST", "/api/business", businessPayload(values));
      if (draft?.photoToken && photos.length) {
        setBusy("Сохраняем фото…");
        const r = await api<{ saved: number }>("POST", "/api/business/import/photos", { token: draft.photoToken, urls: photos }).catch(() => ({ saved: 0 }));
        if (r.saved) toast(`Добавили ${r.saved} фото — их можно поменять в разделе «Реклама»`);
      }
      router.push(next);
      router.refresh();
    } catch (err) {
      toast((err as Error).message, "error");
      setBusy(null);
    }
  }

  return (
    <div ref={top} className="grid grid-cols-[minmax(0,1fr)] gap-6 scroll-mt-6">
      {step === "link" ? (
        <LinkStep
          links={links}
          setLinks={setLinks}
          rows={rows}
          running={running}
          onRun={autofill}
          onManual={() => go(editing ? "review" : "full")}
          editing={editing}
        />
      ) : step === "review" ? (
        <ReviewStep
          f={f}
          setF={setF}
          niches={niches}
          nicheLock={nicheLock}
          initialNiche={initial.niche}
          draft={draft}
          sources={sources}
          clearSource={(k) => setSources((s) => (s[k] ? { ...s, [k]: undefined } : s))}
          photos={photos}
          setPhotos={setPhotos}
          busy={busy}
          onSave={() => save(f)}
          onFull={() => go("full")}
          onRelink={() => go("link")}
        />
      ) : (
        <>
          <button type="button" onClick={() => go("review")} className="justify-self-start inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
            <ArrowLeft size={16} /> Короткая карточка
          </button>
          <BusinessForm initial={initial} value={f} onChange={setF} niches={niches} next={next} nicheLock={nicheLock} onSubmit={save} onImport={() => go("link")} />
        </>
      )}
    </div>
  );
}

// ─── Шаг 1: ссылка ───────────────────────────────────────────────────

function LinkStep({ links, setLinks, rows, running, onRun, onManual, editing }: {
  links: string[]; setLinks: React.Dispatch<React.SetStateAction<string[]>>; rows: Row[]; running: boolean; onRun: () => void; onManual: () => void; editing: boolean;
}) {
  const setAt = (i: number, v: string) => setLinks((l) => l.map((x, j) => (j === i ? v : x)));
  const done = rows.filter((r) => r.state !== "loading").length;
  return (
    <section className="card overflow-hidden">
      <div className="p-5 sm:p-8 grid grid-cols-[minmax(0,1fr)] gap-5">
        <div className="grid gap-1.5">
          <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight">{editing ? "Обновить по ссылке" : "Начнём со ссылки"}</h2>
          <p className="text-muted leading-relaxed max-w-xl">
            Прочитаем адрес, часы, телефон, услуги с ценами и фото — останется проверить. Лучше всего сразу две ссылки: сайт и карточку в Яндекс Картах или 2ГИС.
          </p>
        </div>

        <form
          className="grid grid-cols-[minmax(0,1fr)] gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!running) onRun();
          }}
        >
          <label htmlFor="link-0" className="label mb-0">Ссылка на ваш сайт, Яндекс Карты, 2ГИС, Taplink, VK или YCLIENTS</label>
          {links.map((v, i) => {
            const kind = guessKind(v);
            return (
              <div key={i} className="relative">
                <Link2 size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-faint pointer-events-none" aria-hidden />
                <input
                  id={`link-${i}`}
                  className="field h-14 text-base sm:text-lg pl-11 pr-28"
                  value={v}
                  onChange={(e) => setAt(i, e.target.value)}
                  onPaste={(e) => {
                    // Вставили несколько ссылок разом — раскладываем по полям
                    const text = e.clipboardData.getData("text");
                    const parts = text.split(/[\s,;]+/).filter((p) => /\.[a-zа-я]{2,}/i.test(p));
                    if (parts.length > 1) {
                      e.preventDefault();
                      setLinks((l) => [...l.slice(0, i), ...parts, ...l.slice(i + 1)].filter((x, j, a) => x || j === a.length - 1).slice(0, MAX_LINKS));
                    }
                  }}
                  placeholder={i === 0 ? "lak-studio.ru или yandex.ru/maps/org/…" : "Ещё одна ссылка"}
                  inputMode="url"
                  autoComplete="url"
                  autoCapitalize="off"
                  spellCheck={false}
                  disabled={running}
                  maxLength={500}
                  autoFocus={i === 0 && !editing}
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  {kind ? <span className="pill bg-info-soft text-ink-2 max-w-[6.5rem] truncate">{KIND_LABEL[kind]}</span> : null}
                  {links.length > 1 && !running ? (
                    <button type="button" aria-label="Убрать ссылку" onClick={() => setLinks((l) => l.filter((_, j) => j !== i))} className="p-1.5 rounded-md text-muted hover:text-ink hover:bg-paper">
                      <X size={16} />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {links.length < MAX_LINKS && !running ? (
              <button type="button" className="inline-flex items-center gap-1.5 text-sm font-semibold hover:underline underline-offset-4" onClick={() => setLinks((l) => [...l, ""])}>
                <Plus size={16} /> ещё ссылка
              </button>
            ) : null}
            <p className="text-sm text-faint [overflow-wrap:anywhere]">
              Например: {EXAMPLES.map((x, i) => (
                <span key={x}>
                  <code className="font-sans text-muted">{x}</code>
                  {i < EXAMPLES.length - 1 ? ", " : ""}
                </span>
              ))}
            </p>
          </div>

          {rows.length ? <Progress rows={rows} running={running} done={done} /> : null}

          <div className="grid sm:flex gap-2 sm:gap-3 pt-1">
            <button className="btn btn-primary h-12 px-6 text-base" disabled={running}>
              {running ? <Loader2 size={18} className="spin" /> : null}
              {running ? "Читаем…" : "Заполнить автоматически"}
            </button>
            <button type="button" className="btn btn-ghost h-12 px-5" onClick={onManual} disabled={running}>
              {editing ? "Отмена" : "Заполнить вручную"}
            </button>
          </div>
        </form>
      </div>
      <div className="border-t border-line bg-paper/60 px-5 sm:px-8 py-3.5 text-sm text-muted leading-relaxed">
        Берём только то, что опубликовано на ваших страницах, — ничего не придумываем. Если какая-то площадка не отдаст данные, подскажем, что дописать.
      </div>
    </section>
  );
}

function Progress({ rows, running, done }: { rows: Row[]; running: boolean; done: number }) {
  const pct = rows.length ? Math.round((done / rows.length) * 100) : 0;
  return (
    <div className="rounded-xl border border-line bg-paper/50 p-3.5 sm:p-4 grid gap-2.5" aria-live="polite">
      <div className="h-1.5 rounded-full bg-line overflow-hidden">
        <div className={`h-full rounded-full bg-mark transition-[width] duration-500 ${running && done === rows.length ? "animate-pulse" : ""}`} style={{ width: `${Math.max(8, running && done === rows.length ? 92 : pct)}%` }} />
      </div>
      <ul className="grid gap-2">
        {rows.map((r) => (
          <li key={r.key} className="flex items-start gap-2.5 text-sm leading-snug">
            <span className="mt-0.5 shrink-0">
              {r.state === "loading" ? <Loader2 size={16} className="spin text-muted" /> : r.state === "ok" ? <Check size={16} className="text-good" /> : r.state === "error" ? <CircleAlert size={16} className="text-bad" /> : <TriangleAlert size={16} className="text-warn" />}
            </span>
            <span className="min-w-0">
              <span className="font-semibold">{KIND_LABEL[r.kind]}</span>
              <span className="text-muted">{r.state === "loading" ? " — читаем…" : r.text ? ` — ${r.text}` : ""}</span>
            </span>
          </li>
        ))}
        {running && done === rows.length ? (
          <li className="flex items-center gap-2.5 text-sm text-muted"><Loader2 size={16} className="spin" /> Собираем анкету…</li>
        ) : null}
      </ul>
    </div>
  );
}

// ─── Шаг 2: проверка ─────────────────────────────────────────────────

function SourceChip({ label }: { label?: string }) {
  if (!label) return null;
  const warn = /провер/.test(label);
  return <span className={`pill ${warn ? "bg-warn-soft text-warn" : "bg-good-soft text-good"} font-medium`}>{label}</span>;
}

/** Строка карточки: подпись + чип источника слева, значение справа (на телефоне — друг под другом) */
function Field({ label, htmlFor, chip, missing, missingText, children }: { label: string; htmlFor?: string; chip?: string; missing?: boolean; missingText?: string; children: React.ReactNode }) {
  return (
    <div data-missing={missing ? "true" : undefined} className={`grid gap-1.5 sm:grid-cols-[11rem_1fr] sm:gap-4 py-3.5 px-4 sm:px-6 ${missing ? "bg-mark-soft/70" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:block sm:pt-2.5">
        <label htmlFor={htmlFor} className="text-sm font-semibold">{label}</label>
        {missing ? (
          <span className="pill bg-mark text-ink sm:mt-1.5 sm:flex sm:w-fit">{missingText ?? "Не нашли — заполните"}</span>
        ) : chip ? (
          <span className="sm:mt-1.5 sm:flex"><SourceChip label={chip} /></span>
        ) : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function ReviewStep({ f, setF, niches, nicheLock, initialNiche, draft, sources, clearSource, photos, setPhotos, busy, onSave, onFull, onRelink }: {
  f: BusinessInput; setF: React.Dispatch<React.SetStateAction<BusinessInput>>; niches: NicheLite[]; nicheLock: "launched" | "plan" | null; initialNiche: string;
  draft: Draft | null; sources: Partial<Record<DraftField, string>>; clearSource: (k: DraftField) => void;
  photos: string[]; setPhotos: React.Dispatch<React.SetStateAction<string[]>>; busy: string | null; onSave: () => void; onFull: () => void; onRelink: () => void;
}) {
  const set = <K extends keyof BusinessInput>(k: K, v: BusinessInput[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    clearSource(k as DraftField);
  };
  const miss = useMemo(() => missingOf(f), [f]);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const [allServices, setAllServices] = useState(false);
  const niche = niches.find((n) => n.id === f.niche);
  const services = f.services.length ? f.services : [{ name: "", price: "" }];
  const contactChip = sources.phone ?? sources.whatsapp ?? sources.telegram;
  const found = draft
    ? [
        draft.services.length ? `${draft.services.length} ${plural(draft.services.length, "услугу", "услуги", "услуг")}${draft.services.some((s) => s.price) ? " с ценами" : ""}` : "",
        draft.address ? "адрес" : "",
        draft.hours ? "часы работы" : "",
        draft.phone || draft.whatsapp || draft.telegram ? "контакты" : "",
        draft.photos.length ? `${draft.photos.length} фото` : "",
      ].filter(Boolean)
    : [];
  const notes = draft?.reports.filter((r) => r.status !== "ok" && r.message) ?? [];
  const fieldCls = "field";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <section className="card overflow-hidden">
        <header className="p-5 sm:px-6 sm:pt-6 sm:pb-5 border-b border-line grid gap-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-xl font-extrabold tracking-tight">{draft ? "Вот что нашли" : "Коротко о бизнесе"}</h2>
              <p className="text-muted mt-1 leading-relaxed">
                {draft
                  ? found.length
                    ? `Нашли ${joinRu(found)}. Проверьте и поправьте, если что-то не так.`
                    : "Нашли немного — допишите недостающее, это пара минут."
                  : "Здесь главное. Остальное — в «Показать все поля»."}
              </p>
            </div>
            <button type="button" onClick={onRelink} className="btn btn-ghost btn-sm shrink-0">
              <Link2 size={15} /> {draft ? "Другие ссылки" : "Обновить по ссылке"}
            </button>
          </div>
          {notes.length ? (
            <ul className="grid gap-1.5 mt-1">
              {notes.map((n) => (
                <li key={n.url} className="flex items-start gap-2 text-sm text-warn leading-snug">
                  <TriangleAlert size={15} className="mt-0.5 shrink-0" />
                  <span><span className="font-semibold">{KIND_LABEL[n.kind]}:</span> {n.message}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {miss.length ? (
            <p className="text-sm leading-snug">
              <span className="marked font-semibold">Осталось указать: {miss.map((m) => REQUIRED_TEXT[m]).join(", ")}</span>
            </p>
          ) : null}
        </header>

        <div className="divide-y divide-line">
          <Field label="Название" htmlFor="r-name" chip={sources.name} missing={miss.includes("name")}>
            <input id="r-name" className={fieldCls} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Студия «Лак»" maxLength={80} />
          </Field>

          <Field label="Чем занимаетесь" htmlFor="r-niche" chip={sources.niche} missing={miss.includes("niche")} missingText="Выберите сферу">
            <select
              id="r-niche"
              className={`${fieldCls} pr-8`}
              value={f.niche}
              onChange={(e) => set("niche", e.target.value)}
              disabled={nicheLock === "launched"}
            >
              <option value="" disabled>Выберите…</option>
              {niches.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
            </select>
            {nicheLock === "launched" ? <p className="hint mt-1.5">Сферу нельзя сменить, пока реклама запущена.</p> : nicheLock === "plan" && f.niche !== initialNiche ? <p className="mt-1.5 text-sm text-warn">План объявлений подготовим заново под новую сферу.</p> : null}
          </Field>

          <Field label="Город и адрес" htmlFor="r-city" chip={sources.address ?? sources.city} missing={miss.includes("city")} missingText="Укажите город">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <input id="r-city" className={fieldCls} value={f.city} onChange={(e) => set("city", e.target.value)} placeholder="Город" maxLength={60} aria-label="Город" />
              <input className={fieldCls} value={f.address} onChange={(e) => set("address", e.target.value)} placeholder="Улица, дом" maxLength={200} aria-label="Адрес" />
            </div>
          </Field>

          <Field label="Часы работы" htmlFor="r-hours" chip={sources.hours}>
            <input id="r-hours" className={fieldCls} value={f.hours} onChange={(e) => set("hours", e.target.value)} placeholder="Ежедневно 10:00–21:00" maxLength={80} />
          </Field>

          <Field label="Телефон и мессенджеры" htmlFor="r-phone" chip={contactChip} missing={miss.includes("contact")} missingText="Нужен телефон или мессенджер">
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="grid gap-1">
                <span className="text-xs text-muted">Телефон</span>
                <input id="r-phone" className={fieldCls} value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+7 900 000-00-00" inputMode="tel" maxLength={40} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-muted">WhatsApp</span>
                <input className={fieldCls} value={f.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} placeholder="+7 900 000-00-00" maxLength={60} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-muted">Telegram</span>
                <input className={fieldCls} value={f.telegram} onChange={(e) => set("telegram", e.target.value)} placeholder="@lak_studio" maxLength={60} />
              </label>
            </div>
          </Field>

          <Field label="Услуги и цены" chip={sources.services} missing={miss.includes("services")} missingText="Добавьте хотя бы одну">
            <div className="grid gap-2">
              {services.map((s, i) => (allServices || i < SHOW_SERVICES || services.length <= SHOW_SERVICES + 2 ? (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_8rem_auto] gap-2 max-sm:pb-3 max-sm:border-b max-sm:border-line max-sm:last-of-type:border-0">
                  <input className={`${fieldCls} max-sm:col-span-2`} aria-label={`Услуга ${i + 1}`} maxLength={80} value={s.name} placeholder={niche?.examples[i % (niche?.examples.length || 1)] ?? "Услуга"} onChange={(e) => set("services", services.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <input className={fieldCls} aria-label={`Цена услуги ${i + 1}`} maxLength={40} value={s.price ?? ""} placeholder="1 900 ₽" onChange={(e) => set("services", services.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
                  <button type="button" className="btn btn-ghost px-2.5" aria-label={`Удалить услугу ${i + 1}`} onClick={() => set("services", services.filter((_, j) => j !== i))} disabled={services.length === 1 && !s.name}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ) : null))}
              {!allServices && services.length > SHOW_SERVICES + 2 ? (
                <button type="button" className="justify-self-start text-sm font-semibold underline underline-offset-4" onClick={() => setAllServices(true)}>
                  Ещё {services.length - SHOW_SERVICES} {plural(services.length - SHOW_SERVICES, "услуга", "услуги", "услуг")}
                </button>
              ) : null}
              {services.length < 15 && (allServices || services.length <= SHOW_SERVICES + 2) ? (
                <button type="button" className="btn btn-ghost btn-sm justify-self-start" onClick={() => set("services", [...services, { name: "", price: "" }])}>
                  <Plus size={16} /> Добавить услугу
                </button>
              ) : null}
            </div>
          </Field>

          {f.advantages.length || sources.advantages ? (
            <Field label="Почему выбирают вас" htmlFor="r-adv" chip={sources.advantages}>
              <textarea id="r-adv" className={fieldCls} rows={Math.min(5, Math.max(2, f.advantages.length))} value={f.advantages.join("\n")} onChange={(e) => set("advantages", e.target.value.split("\n").slice(0, 8))} placeholder={"Каждое с новой строки"} />
              <p className="hint mt-1.5">Каждое с новой строки. Только правда — объявления строятся на этих фактах.</p>
            </Field>
          ) : null}

          {f.description || sources.description ? (
            <Field label="О вас" htmlFor="r-desc" chip={sources.description}>
              <textarea id="r-desc" className={fieldCls} rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={1500} />
            </Field>
          ) : null}

          {draft?.rating ? (
            <Field label="Рейтинг" chip={sources.rating}>
              <p className="sm:pt-2.5 flex items-center gap-1.5 font-semibold">
                <Star size={16} className="fill-mark text-[#d9a400]" /> {draft.rating.value.toFixed(1).replace(".", ",")}
                {draft.rating.count ? <span className="font-normal text-muted">· {draft.rating.count} {plural(draft.rating.count, "оценка", "оценки", "оценок")}</span> : null}
              </p>
            </Field>
          ) : null}

          {f.review && sources.review ? (
            <Field label="Отзыв клиента" htmlFor="r-review" chip={sources.review}>
              <textarea id="r-review" className={fieldCls} rows={2} value={f.review} onChange={(e) => set("review", e.target.value)} maxLength={300} />
              <p className="hint mt-1.5">Сделаем из него рекламную картинку. Не подходит — сотрите.</p>
            </Field>
          ) : null}

          <Field label="Сайт и карты" htmlFor="r-site" chip={sources.siteUrl ?? sources.orgUrl}>
            <div className="grid gap-2 sm:grid-cols-2">
              <input id="r-site" className={fieldCls} value={f.siteUrl} onChange={(e) => set("siteUrl", e.target.value)} placeholder="Сайт или Taplink" maxLength={300} inputMode="url" aria-label="Сайт" />
              <input className={fieldCls} value={f.orgUrl} onChange={(e) => set("orgUrl", e.target.value)} placeholder="Ссылка на Яндекс Карты" maxLength={500} inputMode="url" aria-label="Организация в Яндекс Картах" />
            </div>
          </Field>

          {draft?.photos.length ? (
            <Field label="Фото для рекламы" chip={sources.photos}>
              <div className="grid gap-2">
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                  {draft.photos.filter((p) => !broken.has(p)).map((p) => {
                    const on = photos.includes(p);
                    return (
                      <button
                        key={p}
                        type="button"
                        aria-pressed={on}
                        aria-label={on ? "Не брать это фото" : "Взять это фото"}
                        onClick={() => setPhotos((list) => (on ? list.filter((x) => x !== p) : list.length < PHOTO_LIMIT ? [...list, p] : list))}
                        className={`relative aspect-square rounded-lg overflow-hidden border-2 transition ${on ? "border-ink" : "border-transparent opacity-50 hover:opacity-80"}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p} alt="" referrerPolicy="no-referrer" className="size-full object-cover bg-line" onError={() => setBroken((b) => new Set(b).add(p))} />
                        {on ? <span className="absolute top-1 right-1 grid place-items-center size-5 rounded-full bg-ink text-white"><Check size={13} /></span> : null}
                      </button>
                    );
                  })}
                  {draft.photos.every((p) => broken.has(p)) ? <span className="col-span-full text-sm text-muted inline-flex items-center gap-1.5"><ImageOff size={15} /> Превью не загрузились — фото всё равно попробуем скачать</span> : null}
                </div>
                <p className="hint">Выбрано {photos.length} из {PHOTO_LIMIT}. Сохраним после «Дальше»; маленькие и неподходящие пропустим.</p>
              </div>
            </Field>
          ) : null}
        </div>
      </section>

      <div className="sticky bottom-20 md:bottom-4 z-10">
        <div className="card shadow-lg p-3 sm:p-3.5 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2">
          <button type="button" className="btn btn-ghost h-11 sm:h-12" onClick={onFull} disabled={Boolean(busy)}>
            Показать все поля
          </button>
          <button type="button" className="btn btn-primary h-12 px-6 text-base" onClick={onSave} disabled={Boolean(busy)}>
            {busy ? <Loader2 size={18} className="spin" /> : null}
            {busy ?? "Всё верно — дальше"}
          </button>
        </div>
      </div>
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

const joinRu = (list: string[]) => (list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} и ${list[list.length - 1]}`);

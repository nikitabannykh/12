"use client";

/**
 * Анкета бизнеса по шагам: 1. Ссылки → 2. О бизнесе → 3. Услуги и цены → 4. Фото → 5. Контакты и юр. данные.
 *  - Строго по порядку: виден один шаг, внизу только «Назад» и «Дальше». «Дальше» проверяет обязательные поля шага
 *    (ошибки — прямо у полей). Вперёд по точкам шагов нельзя, назад — можно, в том числе к ссылкам: добавить ссылку и
 *    прочитать заново. Повторное чтение не трогает то, что владелец уже заполнил, — только дописывает пустое
 *    и показывает, что изменилось («на сайте другое — заменить?»).
 *  - Шаг 1: «Заполнить по ссылке» (после чтения — сразу шаг 2) или «Пропустить — заполню вручную».
 *  - Сверху — «Шаг N из 5», тонкая полоса «Заполнено на N%» и точки шагов.
 *  - Черновик сохраняется в браузере (localStorage) — перезагрузка страницы ничего не теряет.
 *  - Тот же мастер открывается из «Настройки → Изменить описание».
 */
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CircleAlert, ImageOff, Link2, Loader2, Plus, RotateCcw, Star, Trash2, TriangleAlert, X } from "lucide-react";
import { api, useToast } from "./client";
import { businessPayload, type BusinessInput } from "./BusinessForm";
import type { Draft, DraftField, ImportEvent, ImportReport, SourceKind } from "@/lib/importer/types";
import { SOURCE_NAME } from "@/lib/importer/types";
import type { Service } from "@/lib/db/schema";
import { groupServices } from "@/lib/services";

type NicheLite = { id: string; label: string; examples: string[] };
type Row = { key: string; kind: SourceKind; state: "loading" | ImportReport["status"]; text: string };
type Change = { field: ScalarKey; label: string; kind: "added" | "kept"; value: string; mine?: string };
type ScalarKey = "name" | "city" | "address" | "phone" | "whatsapp" | "telegram" | "hours" | "siteUrl" | "orgUrl" | "description" | "review" | "legalInfo" | "offer";

const MAX_LINKS = 5;
const MAX_SERVICES = 40;
/** Сколько фото можно выбрать из найденных за раз */
const PHOTO_PICK = 20;
const SHOW_SERVICES = 6;

const STEPS = [
  { title: "Ссылки", short: "Ссылки" },
  { title: "О бизнесе", short: "О вас" },
  { title: "Услуги и цены", short: "Услуги" },
  { title: "Фото", short: "Фото" },
  { title: "Контакты и юр. данные", short: "Контакты" },
] as const;

const LABEL: Record<ScalarKey, string> = {
  name: "название", city: "город", address: "адрес", phone: "телефон", whatsapp: "WhatsApp", telegram: "Telegram", hours: "часы работы",
  siteUrl: "сайт", orgUrl: "Яндекс Карты", description: "описание", review: "отзыв", legalInfo: "юр. данные", offer: "предложение для новых клиентов",
};
const MAXLEN: Record<ScalarKey, number> = { name: 80, city: 60, address: 200, phone: 40, whatsapp: 60, telegram: 60, hours: 80, siteUrl: 300, orgUrl: 500, description: 1500, review: 300, legalInfo: 200, offer: 80 };

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

const REQUIRED_TEXT: Record<Draft["missing"][number], string> = { name: "название", niche: "сферу", city: "город", contact: "телефон или мессенджер", services: "хотя бы одну услугу" };
const REQUIRED_STEP: Record<Draft["missing"][number], number> = { name: 1, niche: 1, city: 1, services: 2, contact: 4 };

function missingOf(f: BusinessInput): Draft["missing"] {
  const m: Draft["missing"] = [];
  if (!f.name.trim()) m.push("name");
  if (!f.niche) m.push("niche");
  if (f.city.trim().length < 2) m.push("city");
  if (!f.phone.trim() && !f.whatsapp.trim() && !f.telegram.trim()) m.push("contact");
  if (!f.services.some((s) => s.name.trim())) m.push("services");
  return m;
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]/g, "");

/**
 * Черновик → анкета. Только дописываем пустое: правки владельца не трогаем. Что отличается — возвращаем
 * списком («оставили ваше, на сайте: …»), чтобы можно было заменить одной кнопкой.
 */
function mergeDraft(f: BusinessInput, d: Draft, photosRoom: number): { next: BusinessInput; changes: Change[]; summary: string[] } {
  const next: BusinessInput = { ...f };
  const changes: Change[] = [];
  const summary: string[] = [];
  const scalars: ScalarKey[] = ["name", "city", "address", "hours", "phone", "whatsapp", "telegram", "siteUrl", "orgUrl", "description", "review", "legalInfo", "offer"];
  for (const k of scalars) {
    const v = ((d[k as keyof Draft] as string | null | undefined) ?? "").trim().slice(0, MAXLEN[k]);
    if (!v) continue;
    const cur = (f[k] ?? "").trim();
    if (!cur) {
      next[k] = v;
      changes.push({ field: k, label: LABEL[k], kind: "added", value: v });
    } else if (norm(cur) !== norm(v)) changes.push({ field: k, label: LABEL[k], kind: "kept", value: v, mine: cur });
  }
  if (!f.niche && d.niche) next.niche = d.niche;
  // Услуги: новые добавляем в конец, у совпавших по названию дописываем цену, раздел, примечание
  const have = new Map(f.services.filter((s) => s.name.trim()).map((s, i) => [norm(s.name), i]));
  const list: Service[] = f.services.filter((s) => s.name.trim()).map((s) => ({ ...s }));
  let added = 0, filled = 0;
  for (const s of d.services) {
    const i = have.get(norm(s.name));
    if (i === undefined) {
      if (list.length >= MAX_SERVICES) continue;
      list.push({ name: s.name.slice(0, 80), price: (s.price ?? "").slice(0, 40), ...(s.category ? { category: s.category.slice(0, 40) } : {}), ...(s.note ? { note: s.note.slice(0, 120) } : {}) });
      added++;
    } else {
      const x = list[i];
      if ((!x.price && s.price) || (!x.category && s.category) || (!x.note && s.note)) filled++;
      list[i] = { ...x, price: x.price || s.price || "", category: x.category || s.category, note: x.note || s.note };
    }
  }
  next.services = list;
  if (added) summary.push(`${added} ${plural(added, "услугу", "услуги", "услуг")}`);
  if (filled) summary.push(`цены и разделы к ${filled} ${plural(filled, "услуге", "услугам", "услугам")}`);
  if (!f.advantages.filter(Boolean).length && d.advantages.length) {
    next.advantages = d.advantages.slice(0, 5).map((a) => a.slice(0, 100));
    summary.push(`${next.advantages.length} ${plural(next.advantages.length, "преимущество", "преимущества", "преимуществ")}`);
  }
  if (d.photos.length && photosRoom > 0) summary.push(`${d.photos.length} фото`);
  return { next, changes, summary };
}

/** Взвешенная полнота анкеты: что даёт рекламе больше всего, весит больше */
function completeness(f: BusinessInput, photoCount: number) {
  const priced = f.services.filter((s) => s.name.trim() && s.price?.trim()).length;
  const adv = f.advantages.filter((a) => a.trim()).length;
  const items = [
    { label: "название", w: 8, v: f.name.trim() ? 1 : 0, step: 1 },
    { label: "сфера", w: 8, v: f.niche ? 1 : 0, step: 1 },
    { label: "город", w: 8, v: f.city.trim().length >= 2 ? 1 : 0, step: 1 },
    { label: "адрес", w: 8, v: f.address.trim() ? 1 : 0, step: 1 },
    { label: "часы работы", w: 6, v: f.hours.trim() ? 1 : 0, step: 1 },
    { label: "преимущества", w: 8, v: Math.min(1, adv / 2), step: 1 },
    { label: "отзыв клиента", w: 5, v: f.review.trim() ? 1 : 0, step: 1 },
    { label: "3 услуги с ценами", w: 14, v: Math.min(1, priced / 3), step: 2 },
    { label: "предложение для новых", w: 5, v: f.offer.trim() ? 1 : 0, step: 2 },
    { label: "3 фото", w: 8, v: Math.min(1, photoCount / 3), step: 3 },
    { label: "телефон или мессенджер", w: 10, v: f.phone.trim() || f.whatsapp.trim() || f.telegram.trim() ? 1 : 0, step: 4 },
    { label: "Яндекс Карты", w: 6, v: f.orgUrl.trim() ? 1 : 0, step: 4 },
    { label: "юр. данные", w: 6, v: f.legalInfo.trim() ? 1 : 0, step: 4 },
  ];
  const total = items.reduce((s, x) => s + x.w, 0);
  const pct = Math.round((items.reduce((s, x) => s + x.w * x.v, 0) / total) * 100);
  return { pct, todo: items.filter((x) => x.v < 1) };
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

type Saved = { v: 1; f: BusinessInput; links: string[]; step: number; max?: number; draft: Draft | null; photos: string[]; sources: Partial<Record<DraftField, string>>; at: number };
const storageKey = (k: string) => `pz:onboarding:${k}`;
function readSaved(k: string): Saved | null {
  try {
    const raw = window.localStorage.getItem(storageKey(k));
    const s = raw ? (JSON.parse(raw) as Saved) : null;
    return s && s.v === 1 && s.f ? s : null;
  } catch {
    return null;
  }
}

const LAST = STEPS.length - 1;

export function BusinessOnboarding({
  initial, niches, next, saveLabel, nicheLock, editing, draftKey, savedPhotos, photoMax, otherProjects,
}: {
  initial: BusinessInput; niches: NicheLite[]; next: string; saveLabel: string; nicheLock: "launched" | "plan" | null; editing: boolean;
  /** Ключ черновика в браузере: пользователь + проект («new» для нового) */
  draftKey: string;
  /** Уже сохранённые фото владельца (id) */
  savedPhotos: string[];
  photoMax: number;
  otherProjects: number;
}) {
  // Шаги идут строго по порядку: вперёд — только «Дальше», назад — «Назад» или по пройденному шагу.
  // У сохранённого проекта все шаги уже пройдены — открываем «О бизнесе», остальные доступны.
  const [step, setStep] = useState(editing ? 1 : 0);
  const [max, setMax] = useState(editing ? LAST : 0);
  const [f, setF] = useState<BusinessInput>(initial);
  const [links, setLinks] = useState<string[]>(() => {
    const pre = [initial.siteUrl, initial.orgUrl].filter(Boolean);
    return pre.length ? [...pre] : [""];
  });
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sources, setSources] = useState<Partial<Record<DraftField, string>>>({});
  const [photos, setPhotos] = useState<string[]>([]);
  const [changes, setChanges] = useState<{ list: Change[]; summary: string[] } | null>(null);
  /** Только что заполнили по ссылке — на шаге «О бизнесе» показываем, что подтянули */
  const [imported, setImported] = useState<string[] | null>(null);
  /** Шаги, где уже нажимали «Дальше» с пустыми обязательными полями — там показываем ошибки */
  const [tried, setTried] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const toast = useToast();
  const router = useRouter();
  const top = useRef<HTMLDivElement>(null);
  const ready = useRef(false);
  const pristine = useRef(JSON.stringify(initial));

  const photoRoom = Math.max(0, Math.min(PHOTO_PICK, photoMax - savedPhotos.length));

  // Черновик из браузера + ссылки вида /app/start#org, #hours — сразу на нужный шаг
  useEffect(() => {
    const s = readSaved(draftKey);
    if (s && JSON.stringify(s.f) !== pristine.current) {
      const st = Math.max(0, Math.min(LAST, s.step ?? 0));
      setF(s.f);
      setLinks(s.links?.length ? s.links : [""]);
      setStep(st);
      setMax((m) => Math.max(m, st, Math.min(LAST, s.max ?? 0)));
      setDraft(s.draft ?? null);
      setPhotos(s.photos ?? []);
      setSources(s.sources ?? {});
      setRestored(true);
    }
    const h = window.location.hash;
    if (editing && (h === "#org" || h === "#legal")) setStep(4);
    else if (editing && h === "#hours") setStep(1);
    ready.current = true;
  }, [draftKey, editing]);

  // Автосохранение черновика (только если что-то поменялось)
  useEffect(() => {
    if (!ready.current) return;
    const t = setTimeout(() => {
      try {
        const dirty = JSON.stringify(f) !== pristine.current || draft;
        if (!dirty) return;
        const data: Saved = { v: 1, f, links, step, max, draft, photos, sources, at: Date.now() };
        window.localStorage.setItem(storageKey(draftKey), JSON.stringify(data));
      } catch {
        /* приватный режим или переполнение — без черновика */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [f, links, step, max, draft, photos, sources, draftKey]);

  const clearSaved = () => {
    try {
      window.localStorage.removeItem(storageKey(draftKey));
    } catch {
      /* нет доступа */
    }
  };

  const scrollTop = () => requestAnimationFrame(() => top.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  /** Перейти на шаг: назад — всегда, вперёд — только на уже пройденный */
  const go = (s: number, opts?: { unlock?: boolean }) => {
    const to = Math.max(0, Math.min(LAST, s));
    if (!opts?.unlock && to > max) return;
    if (opts?.unlock) setMax((m) => Math.max(m, to));
    setStep(to);
    setSaveError(null);
    scrollTop();
  };
  const scrollToError = () =>
    requestAnimationFrame(() => setTimeout(() => document.querySelector("[data-missing='true']")?.scrollIntoView({ behavior: "smooth", block: "center" }), 60));

  const photoCount = savedPhotos.length + photos.length;
  const comp = useMemo(() => completeness(f, photoCount), [f, photoCount]);
  const miss = useMemo(() => missingOf(f), [f]);
  const stepMissing = [0, 1, 2, 3, 4].map((i) => miss.filter((m) => REQUIRED_STEP[m] === i));
  const tips = comp.todo.filter((t) => t.step === step && !(stepMissing[step].length && ["название", "сфера", "город", "телефон или мессенджер"].includes(t.label))).map((t) => t.label);

  /** «Дальше»: сначала проверяем обязательные поля текущего шага */
  function next_() {
    if (stepMissing[step].length) {
      setTried((t) => new Set(t).add(step));
      scrollToError();
      return;
    }
    setImported(null);
    go(step + 1, { unlock: true });
  }

  async function autofill() {
    const urls = links.map((l) => l.trim()).filter(Boolean);
    if (!urls.length) {
      setImportError("Вставьте ссылку на сайт или карточку в картах — или пропустите этот шаг и заполните вручную.");
      return;
    }
    setRunning(true);
    setImportError(null);
    setRows([]);
    setChanges(null);
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
        setImportError("По этим ссылкам ничего не нашли. Проверьте адрес или нажмите «Пропустить — заполню вручную».");
        setRunning(false);
        return;
      }
      const hadData = Boolean(f.name.trim() || f.services.some((s) => s.name.trim()));
      const m = mergeDraft(f, d, photoRoom);
      setDraft(d);
      setSources((s) => ({ ...d.sources, ...Object.fromEntries(Object.entries(s).filter(([k]) => m.changes.some((c) => c.field === k && c.kind === "kept"))) }));
      setPhotos((cur) => (cur.length ? cur.filter((p) => d.photos.includes(p)) : d.photos.slice(0, photoRoom)));
      setF(m.next);
      setRunning(false);
      // Первое чтение без расхождений — сразу на шаг 2; повторное — показываем здесь, что изменилось
      if (!hadData && !m.changes.some((c) => c.kind === "kept")) {
        setImported([...m.changes.filter((c) => c.kind === "added").map((c) => c.label), ...m.summary]);
        await new Promise((r) => setTimeout(r, 500));
        go(1, { unlock: true });
      } else {
        setChanges({ list: m.changes, summary: m.summary });
      }
    } catch (e) {
      setImportError((e as Error).message);
      setRunning(false);
    }
  }

  async function save() {
    const m = missingOf(f);
    if (m.length) {
      const s = REQUIRED_STEP[m[0]];
      setTried((t) => new Set(t).add(s));
      go(s, { unlock: true });
      scrollToError();
      return;
    }
    setBusy("Сохраняем…");
    setSaveError(null);
    try {
      await api("POST", "/api/business", businessPayload(f));
      if (draft?.photoToken && photos.length) {
        setBusy(`Сохраняем фото (${photos.length})…`);
        const r = await api<{ saved: number }>("POST", "/api/business/import/photos", { token: draft.photoToken, urls: photos }).catch(() => ({ saved: 0 }));
        if (r.saved) toast(`Добавили ${r.saved} фото — их можно поменять в разделе «Реклама»`);
      }
      clearSaved();
      router.push(next);
      router.refresh();
    } catch (err) {
      setSaveError((err as Error).message);
      setBusy(null);
    }
  }

  const set = <K extends keyof BusinessInput>(k: K, v: BusinessInput[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setSources((s) => (s[k as DraftField] ? { ...s, [k]: undefined } : s));
    setSaveError(null);
  };

  const showErr = tried.has(step);
  const errCount = showErr ? stepMissing[step].length : 0;

  return (
    <div ref={top} className="grid grid-cols-[minmax(0,1fr)] gap-4 scroll-mt-6">
      <ProgressHeader step={step} max={max} go={(s) => go(s)} pct={comp.pct} missing={stepMissing.map((x) => x.length > 0)} locked={running || Boolean(busy)} />

      {restored ? (
        <div className="card px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <RotateCcw size={15} className="text-muted" />
          <span className="flex-1 min-w-0">Восстановили несохранённый черновик.</span>
          <button
            type="button"
            className="font-semibold underline underline-offset-4"
            onClick={() => {
              clearSaved();
              setF(initial);
              setDraft(null);
              setPhotos([]);
              setSources({});
              setChanges(null);
              setImported(null);
              setTried(new Set());
              setRestored(false);
              setMax(editing ? LAST : 0);
              setStep(editing ? 1 : 0);
              scrollTop();
            }}
          >
            Начать заново
          </button>
        </div>
      ) : null}

      {step === 0 ? (
        <LinkStep links={links} setLinks={(v) => { setLinks(v); setImportError(null); }} rows={rows} running={running} onRun={autofill} revisit={max > 0} changes={changes} otherProjects={otherProjects} editing={editing}
          error={importError}
          onReplace={(c) => {
            setF((x) => ({ ...x, [c.field]: c.value }));
            setChanges((ch) => (ch ? { ...ch, list: ch.list.map((y) => (y === c ? { ...y, kind: "added" as const } : y)) } : ch));
          }}
          onSkip={() => { setChanges(null); go(1, { unlock: true }); }}
        />
      ) : (
        <>
          {step === 1 && imported ? (
            <div className="card px-4 sm:px-6 py-3.5 flex items-start gap-2.5 text-sm bg-good-soft border-good/30" aria-live="polite">
              <Check size={17} className="text-good mt-0.5 shrink-0" />
              <p className="leading-relaxed">
                <span className="font-semibold">Заполнили по ссылке{imported.length ? `: ${imported.slice(0, 6).join(", ")}${imported.length > 6 ? " и другое" : ""}` : ""}.</span>{" "}
                Осталось проверить — шаг за шагом.
              </p>
            </div>
          ) : null}
          {step === 1 ? (
            <AboutStep f={f} set={set} niches={niches} nicheLock={nicheLock} initialNiche={initial.niche} draft={draft} sources={sources} miss={miss} showErr={showErr} tips={tips} />
          ) : step === 2 ? (
            <ServicesStep f={f} set={set} niches={niches} sources={sources} miss={miss} showErr={showErr} tips={tips} />
          ) : step === 3 ? (
            <PhotosStep draft={draft} photos={photos} setPhotos={setPhotos} room={photoRoom} saved={savedPhotos} photoMax={photoMax} sources={sources} onLinks={() => go(0)} editing={editing} tips={tips} />
          ) : (
            <ContactsStep f={f} set={set} sources={sources} miss={miss} showErr={showErr} tips={tips} />
          )}

          <div className="grid gap-3">
            {errCount ? (
              <p className="flex items-start gap-2 text-sm font-semibold text-bad" role="alert">
                <CircleAlert size={16} className="mt-0.5 shrink-0" />
                Чтобы идти дальше, заполните: {stepMissing[step].map((x) => REQUIRED_TEXT[x]).join(", ")}.
              </p>
            ) : null}
            {saveError ? (
              <p className="flex items-start gap-2 text-sm font-semibold text-bad" role="alert">
                <CircleAlert size={16} className="mt-0.5 shrink-0" />
                <span className="[overflow-wrap:anywhere]">Не сохранили. {saveError}</span>
              </p>
            ) : null}
            <div className="flex items-center gap-3">
              <button type="button" className={`btn btn-ghost h-12 px-4 ${step === LAST ? "max-sm:px-3.5" : ""}`} onClick={() => go(step - 1)} disabled={Boolean(busy)} aria-label="Назад">
                <ArrowLeft size={18} /> <span className={step === LAST ? "max-sm:hidden" : ""}>Назад</span>
              </button>
              <div className="flex-1" />
              {step < LAST ? (
                <button type="button" className="btn btn-primary h-12 px-6 text-base max-sm:flex-1" onClick={next_} disabled={Boolean(busy)}>
                  Дальше <ArrowRight size={18} />
                </button>
              ) : (
                <button type="button" className="btn btn-primary h-12 px-5 text-base max-sm:flex-1 max-sm:px-3 max-sm:text-[15px]" onClick={save} disabled={Boolean(busy)}>
                  {busy ? <Loader2 size={18} className="spin shrink-0" /> : <Check size={18} className="shrink-0" />}
                  {busy ?? saveLabel}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Прогресс и шаги ─────────────────────────────────────────────────

function ProgressHeader({ step, max, go, pct, missing, locked }: {
  step: number; max: number; go: (s: number) => void; pct: number; missing: boolean[]; locked: boolean;
}) {
  return (
    <section className="card p-4 sm:p-5 grid gap-3.5" aria-label="Шаги анкеты">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-extrabold text-lg leading-tight">
          <span className="text-muted font-semibold text-base">Шаг {step + 1} из {STEPS.length}</span>
          <span className="max-sm:block sm:before:content-['·'] sm:before:mx-2 sm:before:text-faint">{STEPS[step].title}</span>
        </p>
        <p className="text-sm text-muted whitespace-nowrap">Заполнено на <span className="font-semibold text-ink">{pct}%</span></p>
      </div>
      <div className="h-1.5 rounded-full bg-line overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Заполненность анкеты">
        <div className="h-full rounded-full bg-mark transition-[width] duration-500" style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
      <ol className="grid grid-cols-5 gap-1">
        {STEPS.map((s, i) => {
          const cur = i === step;
          const reached = i <= max;
          const ok = reached && !cur && !missing[i] && i !== max;
          const warn = reached && !cur && missing[i] && i < max;
          return (
            <li key={s.title} className="min-w-0">
              <button
                type="button"
                onClick={() => go(i)}
                disabled={!reached || cur || locked}
                aria-current={cur ? "step" : undefined}
                title={reached ? s.title : "Сначала заполните предыдущие шаги"}
                className={`w-full grid justify-items-center gap-1.5 rounded-lg px-1 py-1.5 transition-colors ${reached && !cur ? "hover:bg-paper cursor-pointer" : "cursor-default"} disabled:opacity-100`}
              >
                <span className="relative w-full grid place-items-center">
                  {i > 0 ? <span className={`absolute left-[calc(-50%+1.1rem)] right-[calc(50%+1.1rem)] top-1/2 h-0.5 -translate-y-1/2 rounded ${i <= max ? "bg-ink/70" : "bg-line"}`} aria-hidden /> : null}
                  <span className={`relative grid place-items-center size-7 rounded-full text-sm font-bold ${cur ? "bg-ink text-white ring-4 ring-ink/10" : ok ? "bg-good text-white" : warn ? "bg-mark text-ink" : reached ? "bg-white text-ink border-2 border-ink/70" : "bg-paper text-faint border border-line"}`}>
                    {ok ? <Check size={15} strokeWidth={3} /> : i + 1}
                  </span>
                </span>
                <span className={`text-[11px] sm:text-sm font-semibold leading-tight text-center truncate max-w-full ${cur ? "text-ink" : reached ? "text-ink-2" : "text-faint"}`}>
                  <span className="lg:hidden">{s.short}</span>
                  <span className="max-lg:hidden">{s.title}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ─── Шаг 1: ссылки ───────────────────────────────────────────────────

function LinkStep({ links, setLinks, rows, running, onRun, revisit, editing, changes, onReplace, onSkip, otherProjects, error }: {
  links: string[]; setLinks: React.Dispatch<React.SetStateAction<string[]>>; rows: Row[]; running: boolean; onRun: () => void; revisit: boolean; editing: boolean;
  changes: { list: Change[]; summary: string[] } | null; onReplace: (c: Change) => void; onSkip: () => void; otherProjects: number; error: string | null;
}) {
  const setAt = (i: number, v: string) => setLinks((l) => l.map((x, j) => (j === i ? v : x)));
  const done = rows.filter((r) => r.state !== "loading").length;
  const added = changes?.list.filter((c) => c.kind === "added") ?? [];
  const kept = changes?.list.filter((c) => c.kind === "kept") ?? [];
  return (
    <section className="card overflow-hidden">
      <div className="p-5 sm:p-8 grid grid-cols-[minmax(0,1fr)] gap-5">
        <div className="grid gap-1.5">
          <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight">{revisit ? "Ссылки на ваш бизнес" : "Есть сайт или карточка на картах?"}</h2>
          <p className="text-muted leading-relaxed max-w-xl">
            {revisit
              ? "Добавьте или поменяйте ссылку и прочитайте ещё раз. То, что вы уже заполнили, не затрём — только допишем пустое и покажем, что отличается."
              : "Вставьте ссылку — сами заполним адрес, часы, телефон, услуги с ценами и фото, вам останется проверить. Нет ссылки — пропустите шаг и заполните вручную."}
          </p>
        </div>

        <form
          className="grid grid-cols-[minmax(0,1fr)] gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!running) onRun();
          }}
        >
          <label htmlFor="link-0" className="label mb-0">Сайт, Яндекс Карты, 2ГИС, Taplink, VK или YCLIENTS</label>
          {links.map((v, i) => {
            const kind = guessKind(v);
            return (
              <div key={i} className="relative">
                <Link2 size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-faint pointer-events-none" aria-hidden />
                <input
                  id={`link-${i}`}
                  className={`field h-14 text-base sm:text-lg pl-11 pr-28 ${error && i === 0 && !v.trim() ? "border-bad" : ""}`}
                  value={v}
                  onChange={(e) => setAt(i, e.target.value)}
                  onPaste={(e) => {
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
                  aria-invalid={error && i === 0 ? true : undefined}
                  aria-describedby={error && i === 0 ? "link-error" : undefined}
                  autoFocus={i === 0 && !revisit && !v}
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
              Например: {EXAMPLES.slice(0, 3).map((x, i) => (
                <span key={x}>
                  <code className="font-sans text-muted">{x}</code>
                  {i < 2 ? ", " : ""}
                </span>
              ))}
            </p>
          </div>

          {error ? (
            <p id="link-error" className="flex items-start gap-2 text-sm font-semibold text-bad" role="alert">
              <CircleAlert size={16} className="mt-0.5 shrink-0" /> {error}
            </p>
          ) : null}

          {rows.length ? <Progress rows={rows} running={running} done={done} /> : null}

          {changes ? (
            <div className="rounded-xl border border-line p-4 grid gap-3" aria-live="polite">
              <p className="font-semibold">
                {added.length || changes.summary.length
                  ? `Добавили: ${[...added.map((c) => c.label), ...changes.summary].join(", ")}.`
                  : "Нового не нашли — всё уже в анкете."}
              </p>
              {kept.length ? (
                <div className="grid gap-2">
                  <p className="text-sm text-muted">Оставили ваше — на сайте или в картах указано иначе:</p>
                  <ul className="grid gap-2">
                    {kept.map((c) => (
                      <li key={c.field} className="grid sm:grid-cols-[minmax(0,1fr)_auto] gap-2 items-center rounded-lg bg-paper px-3 py-2.5 text-sm">
                        <span className="min-w-0 [overflow-wrap:anywhere]">
                          <span className="font-semibold">{c.label.charAt(0).toUpperCase() + c.label.slice(1)}:</span> у вас «{c.mine}», найдено «{c.value.length > 90 ? `${c.value.slice(0, 90)}…` : c.value}»
                        </span>
                        <button type="button" className="btn btn-ghost btn-sm justify-self-start" onClick={() => onReplace(c)}>Заменить</button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Одно главное действие: прочитать ссылку. Пропуск — второстепенная ссылка-кнопка */}
          <div className="grid sm:flex sm:items-center gap-3 sm:gap-5 pt-1">
            {changes ? (
              <>
                <button type="button" className="btn btn-primary h-12 px-6 text-base" onClick={onSkip}>
                  Дальше <ArrowRight size={18} />
                </button>
                <button className="btn btn-ghost h-12 px-5" disabled={running}>
                  <RotateCcw size={16} /> Прочитать ещё раз
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-primary h-12 px-6 text-base" disabled={running}>
                  {running ? <Loader2 size={18} className="spin" /> : null}
                  {running ? "Читаем…" : revisit ? "Прочитать ещё раз" : "Заполнить по ссылке"}
                </button>
                <button type="button" className="h-11 text-[15px] font-semibold text-muted hover:text-ink underline underline-offset-4 disabled:opacity-50" onClick={onSkip} disabled={running}>
                  {revisit ? "Дальше без повторного чтения" : "Пропустить — заполню вручную"}
                </button>
              </>
            )}
          </div>
        </form>
      </div>
      <div className="border-t border-line bg-paper/60 px-5 sm:px-8 py-3.5 text-sm text-muted leading-relaxed">
        Берём только то, что опубликовано на ваших страницах, — ничего не придумываем.
        {editing || otherProjects ? " Это другой бизнес? Заведите его отдельно: «Новый проект» в переключателе проектов." : ""}
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

// ─── Общие кусочки ───────────────────────────────────────────────────

function SourceChip({ label }: { label?: string }) {
  if (!label) return null;
  const warn = /провер/.test(label);
  return <span className={`pill ${warn ? "bg-warn-soft text-warn" : "bg-good-soft text-good"} font-medium`}>{label}</span>;
}

/** Показывать ли ошибки обязательных полей: только после попытки нажать «Дальше» на этом шаге */
const ShowErr = createContext(false);

/** Строка карточки: подпись + чип источника слева, значение справа (на телефоне — друг под другом) */
function Field({ label, htmlFor, chip, missing, missingText, hint, id, children }: { label: string; htmlFor?: string; chip?: string; missing?: boolean; missingText?: string; hint?: string; id?: string; children: React.ReactNode }) {
  const showErr = useContext(ShowErr);
  const error = missing && showErr;
  return (
    <div id={id} data-missing={error ? "true" : undefined} className={`grid gap-1.5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4 py-3.5 px-4 sm:px-6 scroll-mt-24 ${error ? "bg-bad-soft/60" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:block sm:pt-2.5">
        <label htmlFor={htmlFor} className="text-sm font-semibold">{label}</label>
        {missing && !error ? (
          <span className="pill bg-paper text-muted border border-line sm:mt-1.5 sm:flex sm:w-fit">обязательно</span>
        ) : chip && !missing ? (
          <span className="sm:mt-1.5 sm:flex"><SourceChip label={chip} /></span>
        ) : null}
      </div>
      <div className="min-w-0">
        {children}
        {error ? (
          <p className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold text-bad" role="alert">
            <CircleAlert size={15} className="shrink-0" /> {missingText ?? "Заполните это поле"}
          </p>
        ) : null}
        {hint ? <p className="hint mt-1.5">{hint}</p> : null}
      </div>
    </div>
  );
}

function StepCard({ title, text, tips, showErr = false, children }: { title: string; text?: string; tips?: string[]; showErr?: boolean; children: React.ReactNode }) {
  return (
    <section className="card overflow-hidden">
      <header className="p-5 sm:px-6 sm:pt-6 sm:pb-5 border-b border-line">
        <h2 className="text-xl font-extrabold tracking-tight">{title}</h2>
        {text ? <p className="text-muted mt-1 leading-relaxed">{text}</p> : null}
        {tips?.length ? <p className="text-sm text-ink-2 mt-2 leading-snug"><span className="font-semibold">Для сильных объявлений добавьте:</span> {tips.join(", ")} — необязательно.</p> : null}
      </header>
      <ShowErr.Provider value={showErr}>
        <div className="divide-y divide-line">{children}</div>
      </ShowErr.Provider>
    </section>
  );
}

type SetF = <K extends keyof BusinessInput>(k: K, v: BusinessInput[K]) => void;

// ─── Шаг 2: о бизнесе ────────────────────────────────────────────────

function AboutStep({ f, set, niches, nicheLock, initialNiche, draft, sources, miss, showErr, tips }: {
  f: BusinessInput; set: SetF; niches: NicheLite[]; nicheLock: "launched" | "plan" | null; initialNiche: string; draft: Draft | null; sources: Partial<Record<DraftField, string>>; miss: Draft["missing"]; showErr: boolean; tips: string[];
}) {
  const found = draft?.advantagesFound ?? [];
  const advList = f.advantages.filter((a) => a.trim());
  const notes = draft?.reports.filter((r) => r.status !== "ok" && r.message) ?? [];
  const addresses = draft?.addresses ?? [];
  return (
    <StepCard title="О бизнесе" showErr={showErr} tips={tips} text={draft ? "Проверьте, что нашли, и поправьте, если что-то не так. Зелёная метка — откуда взяли." : "Главное о вас — из этого робот пишет объявления. Обязательны название, сфера и город."}>
      {notes.length ? (
        <ul className="grid gap-1.5 px-4 sm:px-6 py-3">
          {notes.map((n) => (
            <li key={n.url} className="flex items-start gap-2 text-sm text-warn leading-snug">
              <TriangleAlert size={15} className="mt-0.5 shrink-0" />
              <span><span className="font-semibold">{KIND_LABEL[n.kind]}:</span> {n.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <Field label="Название" htmlFor="r-name" chip={sources.name} missing={miss.includes("name")} missingText="Укажите название">
        <input id="r-name" className="field" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Студия «Лак»" maxLength={80} />
      </Field>

      <Field label="Чем занимаетесь" htmlFor="r-niche" chip={sources.niche} missing={miss.includes("niche")} missingText="Выберите сферу">
        <select id="r-niche" className="field pr-8" value={f.niche} onChange={(e) => set("niche", e.target.value)} disabled={nicheLock === "launched"}>
          <option value="" disabled>Выберите…</option>
          {niches.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
        </select>
        {nicheLock === "launched" ? <p className="hint mt-1.5">Сферу нельзя сменить, пока реклама запущена.</p> : nicheLock === "plan" && f.niche !== initialNiche ? <p className="mt-1.5 text-sm text-warn">План объявлений подготовим заново под новую сферу.</p> : null}
      </Field>

      <Field label="Город и адрес" htmlFor="r-city" chip={sources.address ?? sources.city} missing={miss.includes("city")} missingText="Укажите город">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <input id="r-city" className="field" value={f.city} onChange={(e) => set("city", e.target.value)} placeholder="Город" maxLength={60} aria-label="Город" />
          <input className="field" value={f.address} onChange={(e) => set("address", e.target.value)} placeholder="Улица, дом" maxLength={200} aria-label="Адрес" />
        </div>
        {addresses.length > 1 ? (
          <div className="mt-2.5 grid gap-1.5">
            <p className="text-sm text-muted">Нашли {addresses.length} {plural(addresses.length, "адрес", "адреса", "адресов")} — выберите основной (для другого филиала заведите отдельный проект):</p>
            <div className="flex flex-wrap gap-1.5">
              {addresses.map((a) => {
                const on = f.address.trim() === a.address;
                return (
                  <button key={a.address} type="button" className="chip text-sm" aria-pressed={on} onClick={() => { set("address", a.address); if (a.city) set("city", a.city); }}>
                    {a.address}{a.city && a.city !== f.city ? `, ${a.city}` : ""}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </Field>

      <Field label="Часы работы" htmlFor="r-hours" chip={sources.hours} id="hours" hint="Покажем под объявлением. Формат: «Ежедневно 10:00–21:00» или «Пн–Пт 10–20, Сб 11–18».">
        <input id="r-hours" className="field" value={f.hours} onChange={(e) => set("hours", e.target.value)} placeholder="Ежедневно 10:00–21:00" maxLength={80} />
      </Field>

      <Field label="Почему выбирают вас" htmlFor="r-adv" chip={sources.advantages} hint="Каждое с новой строки, до 8. Только правда — объявления строятся на этих фактах.">
        {found.length ? (
          <div className="mb-2.5 grid gap-1.5">
            <p className="text-sm text-muted">Нашли {found.length} {plural(found.length, "факт", "факта", "фактов")} — отметьте, что взять:</p>
            <div className="flex flex-wrap gap-1.5">
              {found.map((a) => {
                const on = advList.some((x) => x.trim().toLowerCase() === a.toLowerCase());
                return (
                  <button
                    key={a}
                    type="button"
                    className="chip text-sm text-left h-auto py-1.5 whitespace-normal"
                    aria-pressed={on}
                    onClick={() => set("advantages", on ? advList.filter((x) => x.trim().toLowerCase() !== a.toLowerCase()) : [...advList, a].slice(0, 8))}
                  >
                    {on ? <Check size={13} className="inline -mt-0.5 mr-1" /> : <Plus size={13} className="inline -mt-0.5 mr-1" />}{a}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        <textarea id="r-adv" className="field" rows={Math.min(6, Math.max(3, f.advantages.length + 1))} value={f.advantages.join("\n")} onChange={(e) => set("advantages", e.target.value.split("\n").slice(0, 8).map((x) => x.slice(0, 100)))} placeholder={"Покрытие держится 3–4 недели\nСтерилизация в автоклаве, крафт-пакеты при вас\nПарковка у входа"} />
      </Field>

      <Field label="О вас" htmlFor="r-desc" chip={sources.description}>
        <textarea id="r-desc" className="field" rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={1500} placeholder="Работаем с 2019 года, 4 мастера, открыты до 22:00" />
      </Field>

      {draft?.rating ? (
        <Field label="Рейтинг" chip={sources.rating}>
          <p className="sm:pt-2.5 flex items-center gap-1.5 font-semibold">
            <Star size={16} className="fill-mark text-[#d9a400]" /> {draft.rating.value.toFixed(1).replace(".", ",")}
            {draft.rating.count ? <span className="font-normal text-muted">· {draft.rating.count} {plural(draft.rating.count, "оценка", "оценки", "оценок")}</span> : null}
          </p>
        </Field>
      ) : null}

      <Field label="Отзыв клиента" htmlFor="r-review" chip={sources.review} hint="Настоящий отзыв — сделаем из него рекламную картинку.">
        <textarea id="r-review" className="field" rows={2} value={f.review} onChange={(e) => set("review", e.target.value)} maxLength={300} placeholder="Хожу к Алине второй год — маникюр ни разу не скололся раньше чем через три недели." />
      </Field>
    </StepCard>
  );
}

// ─── Шаг 3: услуги и цены по разделам ────────────────────────────────

function ServicesStep({ f, set, niches, sources, miss, showErr, tips }: { f: BusinessInput; set: SetF; niches: NicheLite[]; sources: Partial<Record<DraftField, string>>; miss: Draft["missing"]; showErr: boolean; tips: string[] }) {
  const niche = niches.find((n) => n.id === f.niche);
  const services = f.services.length ? f.services : [{ name: "", price: "" }];
  const groups = groupServices(services);
  const cats = groups.map((g) => g.category).filter(Boolean);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const update = (i: number, patch: Partial<Service>) => set("services", services.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const remove = (i: number) => set("services", services.filter((_, j) => j !== i));
  const addTo = (category: string) => {
    if (services.length >= MAX_SERVICES) return;
    // Новую услугу — в конец своего раздела
    const last = Math.max(-1, ...services.map((s, j) => ((s.category ?? "") === category ? j : -1)));
    const item: Service = { name: "", price: "", ...(category ? { category } : {}) };
    set("services", last < 0 ? [...services, item] : [...services.slice(0, last + 1), item, ...services.slice(last + 1)]);
    setOpen((o) => new Set(o).add(category));
  };
  const rename = (from: string, to: string) => set("services", services.map((s) => ((s.category ?? "") === from ? { ...s, category: to.slice(0, 40) || undefined } : s)));
  const priced = services.filter((s) => s.name.trim() && s.price?.trim()).length;

  return (
    <StepCard title="Услуги и цены" showErr={showErr} tips={tips} text={`${services.filter((s) => s.name.trim()).length} из ${MAX_SERVICES} услуг, ${priced} с ценами. Разделы прайса — как на вашем сайте: по ним робот сделает отдельные группы объявлений.`}>
      <Field label="Прайс" chip={sources.services} missing={miss.includes("services")} missingText="Добавьте хотя бы одну услугу">
        <div className="grid gap-4">
          {groups.map((g, gi) => {
            const showAll = open.has(g.category) || g.items.length <= SHOW_SERVICES + 2;
            return (
              <div key={gi} className={cats.length ? "rounded-xl border border-line p-3 sm:p-4 grid gap-2" : "grid gap-2"}>
                {cats.length ? (
                  <div className="flex items-center gap-2">
                    <input className="field font-semibold h-10 max-w-xs" value={g.category} placeholder="Без раздела" aria-label="Раздел прайса" maxLength={40} onChange={(e) => rename(g.category, e.target.value)} />
                    <span className="text-sm text-muted whitespace-nowrap">{g.items.length} {plural(g.items.length, "услуга", "услуги", "услуг")}</span>
                  </div>
                ) : null}
                {g.items.map(({ s, i }, k) => (showAll || k < SHOW_SERVICES ? (
                  <div key={i} className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_10rem_auto] gap-2 max-sm:pb-2.5 max-sm:border-b max-sm:border-line max-sm:last-of-type:border-0">
                    <input className="field max-sm:col-span-3" aria-label={`Услуга ${i + 1}`} maxLength={80} value={s.name} placeholder={niche?.examples[i % (niche?.examples.length || 1)] ?? "Услуга"} onChange={(e) => update(i, { name: e.target.value })} />
                    <input className="field" aria-label={`Цена услуги ${i + 1}`} maxLength={40} value={s.price ?? ""} placeholder="1 900 ₽" onChange={(e) => update(i, { price: e.target.value })} />
                    {cats.length ? (
                      <select className="field pr-7 sm:hidden" aria-label="Раздел" value={s.category ?? ""} onChange={(e) => update(i, { category: e.target.value || undefined })}>
                        {cats.map((c) => <option key={c} value={c}>{c}</option>)}
                        <option value="">Без раздела</option>
                      </select>
                    ) : null}
                    <button type="button" className={`btn btn-ghost px-2.5 ${cats.length ? "max-sm:col-start-3" : ""}`} aria-label={`Удалить услугу ${i + 1}`} onClick={() => remove(i)} disabled={services.length === 1 && !s.name}>
                      <Trash2 size={16} />
                    </button>
                    {s.note !== undefined && s.note !== "" ? (
                      <input className="field h-9 text-sm text-muted col-span-3 sm:col-span-2" aria-label={`Примечание к услуге ${i + 1}`} maxLength={120} value={s.note} onChange={(e) => update(i, { note: e.target.value })} />
                    ) : null}
                  </div>
                ) : null))}
                <div className="flex flex-wrap gap-x-4 gap-y-2 items-center">
                  {!showAll ? (
                    <button type="button" className="text-sm font-semibold underline underline-offset-4" onClick={() => setOpen((o) => new Set(o).add(g.category))}>
                      Ещё {g.items.length - SHOW_SERVICES} {plural(g.items.length - SHOW_SERVICES, "услуга", "услуги", "услуг")}
                    </button>
                  ) : null}
                  {services.length < MAX_SERVICES ? (
                    <button type="button" className="inline-flex items-center gap-1.5 text-sm font-semibold hover:underline underline-offset-4" onClick={() => addTo(g.category)}>
                      <Plus size={15} /> {g.category ? `Услуга в «${g.category}»` : "Добавить услугу"}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
          {services.length < MAX_SERVICES ? (
            <button type="button" className="btn btn-ghost btn-sm justify-self-start" onClick={() => addTo("Новый раздел")}>
              <Plus size={16} /> Новый раздел прайса
            </button>
          ) : null}
        </div>
      </Field>
      <Field label="Предложение для новых клиентов" htmlFor="r-offer" chip={sources.offer} hint="Необязательно, но такие объявления кликают чаще.">
        <input id="r-offer" className="field" value={f.offer} onChange={(e) => set("offer", e.target.value)} placeholder="−20% на первый визит" maxLength={80} />
      </Field>
    </StepCard>
  );
}

// ─── Шаг 4: фото ─────────────────────────────────────────────────────

function PhotosStep({ draft, photos, setPhotos, room, saved, photoMax, sources, onLinks, editing, tips }: {
  draft: Draft | null; photos: string[]; setPhotos: React.Dispatch<React.SetStateAction<string[]>>; room: number; saved: string[]; photoMax: number;
  sources: Partial<Record<DraftField, string>>; onLinks: () => void; editing: boolean; tips: string[];
}) {
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const found = (draft?.photos ?? []).filter((p) => !broken.has(p));
  return (
    <StepCard title="Фото" tips={tips} text="Настоящие фото салона и работ — для объявлений с картинками. Шаг необязательный: фото можно добавить и позже.">
      {saved.length ? (
        <Field label="Уже загружены">
          <div className="grid grid-cols-5 sm:grid-cols-8 gap-1.5">
            {saved.slice(0, 16).map((id) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={id} src={`/api/images/${id}`} alt="" className="aspect-square w-full object-cover rounded-md bg-line" loading="lazy" />
            ))}
          </div>
          <p className="hint mt-1.5">{saved.length} из {photoMax}. Загрузить свои или удалить — в разделе «Реклама».</p>
        </Field>
      ) : null}
      <Field label={draft ? `Нашли ${draft.photos.length} фото` : "С сайта"} chip={sources.photos}>
        {found.length ? (
          <div className="grid gap-2.5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
              <span className="font-semibold">Выбрано {photos.length} из {room}</span>
              <button type="button" className="underline underline-offset-4" onClick={() => setPhotos(found.slice(0, room))}>Выбрать первые {Math.min(room, found.length)}</button>
              {photos.length ? <button type="button" className="underline underline-offset-4" onClick={() => setPhotos([])}>Снять все</button> : null}
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {found.map((p) => {
                const on = photos.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={on}
                    aria-label={on ? "Не брать это фото" : "Взять это фото"}
                    onClick={() => setPhotos((list) => (on ? list.filter((x) => x !== p) : list.length < room ? [...list, p] : list))}
                    className={`relative aspect-square rounded-lg overflow-hidden border-2 transition ${on ? "border-ink" : "border-transparent opacity-55 hover:opacity-90"}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full object-cover bg-line" onError={() => setBroken((b) => new Set(b).add(p))} />
                    {on ? <span className="absolute top-1 right-1 grid place-items-center size-5 rounded-full bg-ink text-white"><Check size={13} /></span> : null}
                  </button>
                );
              })}
            </div>
            {room === 0 ? <p className="text-sm text-warn">Галерея заполнена ({photoMax} фото) — удалите старые в разделе «Реклама», чтобы добавить новые.</p> : null}
          </div>
        ) : draft?.photos.length ? (
          <p className="text-sm text-muted inline-flex items-center gap-1.5 sm:pt-2.5"><ImageOff size={15} /> Превью не загрузились — фото всё равно попробуем скачать при сохранении.</p>
        ) : (
          <div className="grid gap-2 sm:pt-1.5">
            <p className="text-sm text-muted">Фото берём с сайта и из карточек на картах.</p>
            <button type="button" className="btn btn-ghost btn-sm justify-self-start" onClick={onLinks}><Link2 size={15} /> Добавить ссылку</button>
            {!editing ? <p className="hint">Свои фото можно загрузить после сохранения — в разделе «Реклама».</p> : null}
          </div>
        )}
      </Field>
    </StepCard>
  );
}

// ─── Шаг 5: контакты и юр. данные ────────────────────────────────────

function ContactsStep({ f, set, sources, miss, showErr, tips }: { f: BusinessInput; set: SetF; sources: Partial<Record<DraftField, string>>; miss: Draft["missing"]; showErr: boolean; tips: string[] }) {
  return (
    <StepCard title="Контакты и юр. данные" showErr={showErr} tips={tips} text="Куда писать и звонить клиентам, и данные для маркировки рекламы. Обязателен телефон или мессенджер.">
      <Field label="Телефон и мессенджеры" htmlFor="r-phone" chip={sources.phone ?? sources.whatsapp ?? sources.telegram} missing={miss.includes("contact")} missingText="Укажите телефон, WhatsApp или Telegram">
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="grid gap-1">
            <span className="text-xs text-muted">Телефон</span>
            <input id="r-phone" className="field" value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+7 900 000-00-00" inputMode="tel" maxLength={40} />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-muted">WhatsApp</span>
            <input className="field" value={f.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} placeholder="+7 900 000-00-00" maxLength={60} />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-muted">Telegram</span>
            <input className="field" value={f.telegram} onChange={(e) => set("telegram", e.target.value)} placeholder="@lak_studio" maxLength={60} />
          </label>
        </div>
      </Field>
      <Field label="Сайт" htmlFor="r-site" chip={sources.siteUrl} hint="Нет сайта — не страшно: сделаем страницу записи с вашими услугами и кнопками связи.">
        <input id="r-site" className="field" value={f.siteUrl} onChange={(e) => set("siteUrl", e.target.value)} placeholder="lak-studio.ru или Taplink" maxLength={300} inputMode="url" />
      </Field>
      <Field label="Яндекс Карты" htmlFor="r-org" chip={sources.orgUrl} id="org" hint="Карточка → «Поделиться» → «Скопировать ссылку». С ней реклама показывается на Картах, а звонки из объявлений считаются.">
        <input id="r-org" className="field" value={f.orgUrl} onChange={(e) => set("orgUrl", e.target.value)} placeholder="yandex.ru/maps/org/lak/1234567890" maxLength={500} inputMode="url" />
      </Field>
      <Field label="Юр. данные" htmlFor="r-legal" chip={sources.legalInfo} id="legal" hint="ИП или ООО, ФИО или название и ИНН — для маркировки рекламы (ЕРИР). VK без них не пропускает объявления.">
        <input id="r-legal" className="field" value={f.legalInfo} onChange={(e) => set("legalInfo", e.target.value)} placeholder="ИП Иванова А. С., ИНН 165012345678" maxLength={200} />
        {/^ИП,\s*ИНН/.test(f.legalInfo.trim()) ? <p className="mt-1.5 text-sm text-warn">Допишите ФИО после «ИП» — так, как в выписке.</p> : null}
      </Field>
      <Field label="Кто ваши клиенты" htmlFor="r-aud">
        <input id="r-aud" className="field" value={f.audience} onChange={(e) => set("audience", e.target.value)} placeholder="Девушки 25–40, работают в центре" maxLength={300} />
      </Field>
      <Field label="Сколько записываются" hint="Из 10 обратившихся — нужно, чтобы считать стоимость клиента.">
        <div className="flex items-center gap-4 sm:pt-2">
          <input type="range" min={1} max={10} step={1} value={Math.round(f.leadToClientRate * 10)} onChange={(e) => set("leadToClientRate", Number(e.target.value) / 10)} className="flex-1 accent-[#1d2045]" aria-label="Сколько из 10 обратившихся записываются" />
          <span className="w-28 text-right font-semibold">{Math.round(f.leadToClientRate * 10)} из 10</span>
        </div>
      </Field>
    </StepCard>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

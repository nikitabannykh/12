"use client";

/**
 * Этап 1 «Данные о бизнесе» — одна страница, без пошагового мастера.
 *  - Сверху блок ссылок: «Заполнить по ссылке» или «Заполнить вручную». Пока не выбрано — видно только его.
 *  - Потом ниже открываются разделы: Основное, Услуги и цены, Фото, Контакты и юр. данные. Метки источника у полей,
 *    ошибки — прямо у поля (после того как поле потрогали или нажали «Сохранить»).
 *  - Блок ссылок остаётся сверху свёрнутым («Данные из: … · Изменить ссылки»): можно добавить ссылку и прочитать
 *    заново. Повторное чтение не трогает то, что владелец уже заполнил, — только дописывает пустое и показывает,
 *    что отличается («на сайте другое — заменить?»).
 *  - «Заполнено на N%» и чего не хватает — ссылками на поля. Внизу одна кнопка «Сохранить и перейти к запуску»;
 *    пока обязательное не заполнено, она неактивна и рядом написано, чего не хватает.
 *  - Черновик сохраняется в браузере (localStorage) отдельно для каждого проекта — перезагрузка ничего не теряет.
 *  - Та же страница открывается из «Настройки → Изменить описание».
 */
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, CircleAlert, ImageOff, ImagePlus, Link2, Loader2, PenLine, Plus, RotateCcw, Star, Trash2, TriangleAlert, X } from "lucide-react";
import { api, resizeToJpeg, useToast } from "./client";
import { businessPayload, type BusinessInput } from "./BusinessForm";
import type { Draft, DraftField, ImportEvent, ImportReport, SourceKind } from "@/lib/importer/types";
import { SOURCE_NAME } from "@/lib/importer/types";
import type { Service } from "@/lib/db/schema";
import { groupServices } from "@/lib/services";
import { cleanLinks, linkKey, linkKind, normalizeLink, shortLink, LINK_LABEL, MAX_SOURCE_LINKS, type LinkKind, type SourceLink } from "@/lib/links";

type NicheLite = { id: string; label: string; examples: string[] };
type Row = { key: string; kind: SourceKind; state: "loading" | ImportReport["status"]; text: string };
type Change = { field: ScalarKey; label: string; kind: "added" | "kept"; value: string; mine?: string };
type ScalarKey = "name" | "city" | "address" | "phone" | "whatsapp" | "telegram" | "hours" | "siteUrl" | "orgUrl" | "description" | "review" | "legalInfo" | "offer";

/** Сколько ссылок можно держать в блоке (сохраняются все); прочитать за раз можно первые READ_LINKS */
const MAX_LINKS = MAX_SOURCE_LINKS;
const READ_LINKS = 5;
const MAX_SERVICES = 40;
/** Сколько фото можно выбрать из найденных за раз */
const PHOTO_PICK = 20;
const SHOW_SERVICES = 6;

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
/** Куда вести по ссылке «не хватает: …» — id блока поля на странице */
const REQUIRED_ANCHOR: Record<Draft["missing"][number], string> = { name: "f-name", niche: "f-niche", city: "f-city", services: "f-services", contact: "f-contact" };
type Req = Draft["missing"][number];

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

/**
 * По ссылке нашёлся другой бизнес (другое название или другой сайт) — значит, владелец вставил новую ссылку
 * вместо старой. Тогда дописывать «пустое» нельзя: останутся адрес, сфера и услуги прежнего бизнеса.
 */
function isOtherBusiness(f: BusinessInput, d: Draft): boolean {
  const hadData = Boolean(f.name.trim() || f.services.some((s) => s.name.trim()));
  if (!hadData) return false;
  const a = norm(f.name), b = norm(d.name ?? "");
  if (a && b && !a.includes(b) && !b.includes(a)) return true;
  // Другая сфера (определилась по ссылке) или ни одной общей услуги — тоже другой бизнес
  if (d.niche && f.niche && d.niche !== f.niche) return true;
  const mine = new Set(f.services.map((s) => norm(s.name)).filter(Boolean));
  const found = d.services.map((s) => norm(s.name)).filter(Boolean);
  if (mine.size >= 2 && found.length >= 2 && !found.some((x) => mine.has(x))) return true;
  const h1 = f.siteUrl ? hostOf(f.siteUrl).toLowerCase() : "", h2 = d.siteUrl ? hostOf(d.siteUrl).toLowerCase() : "";
  return Boolean(h1 && h2 && h1 !== h2);
}

/** Другой бизнес: всё, что относилось к прежнему (адрес, сфера, услуги, преимущества, отзыв), заменяем найденным */
function replaceDraft(f: BusinessInput, d: Draft, nicheLocked: boolean): { next: BusinessInput; changes: Change[]; summary: string[] } {
  const next: BusinessInput = { ...f };
  const changes: Change[] = [];
  const scalars: ScalarKey[] = ["name", "city", "address", "hours", "phone", "whatsapp", "telegram", "siteUrl", "orgUrl", "description", "review", "legalInfo", "offer"];
  for (const k of scalars) {
    const v = ((d[k as keyof Draft] as string | null | undefined) ?? "").trim().slice(0, MAXLEN[k]);
    next[k] = v;
    if (v) changes.push({ field: k, label: LABEL[k], kind: "added", value: v });
  }
  if (!nicheLocked) next.niche = d.niche ?? "";
  next.services = d.services.slice(0, MAX_SERVICES).map((s) => ({ name: s.name.slice(0, 80), price: (s.price ?? "").slice(0, 40), ...(s.category ? { category: s.category.slice(0, 40) } : {}), ...(s.note ? { note: s.note.slice(0, 120) } : {}) }));
  next.advantages = d.advantages.slice(0, 5).map((a) => a.slice(0, 100));
  const summary: string[] = [];
  if (next.services.length) summary.push(`${next.services.length} ${plural(next.services.length, "услугу", "услуги", "услуг")}`);
  if (next.advantages.length) summary.push(`${next.advantages.length} ${plural(next.advantages.length, "преимущество", "преимущества", "преимуществ")}`);
  if (d.photos.length) summary.push(`${d.photos.length} фото`);
  return { next, changes, summary };
}

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
    { label: "название", w: 8, v: f.name.trim() ? 1 : 0, anchor: "f-name", req: true },
    { label: "сфера", w: 8, v: f.niche ? 1 : 0, anchor: "f-niche", req: true },
    { label: "город", w: 8, v: f.city.trim().length >= 2 ? 1 : 0, anchor: "f-city", req: true },
    { label: "адрес", w: 8, v: f.address.trim() ? 1 : 0, anchor: "f-city" },
    { label: "часы работы", w: 6, v: f.hours.trim() ? 1 : 0, anchor: "hours" },
    { label: "преимущества", w: 8, v: Math.min(1, adv / 2), anchor: "f-adv" },
    { label: "отзыв клиента", w: 5, v: f.review.trim() ? 1 : 0, anchor: "f-review" },
    { label: "3 услуги с ценами", w: 14, v: Math.min(1, priced / 3), anchor: "f-services" },
    { label: "предложение для новых", w: 5, v: f.offer.trim() ? 1 : 0, anchor: "f-offer" },
    { label: "3 фото", w: 8, v: Math.min(1, photoCount / 3), anchor: "f-photos" },
    { label: "телефон или мессенджер", w: 10, v: f.phone.trim() || f.whatsapp.trim() || f.telegram.trim() ? 1 : 0, anchor: "f-contact", req: true },
    { label: "Яндекс Карты", w: 6, v: f.orgUrl.trim() ? 1 : 0, anchor: "org" },
    { label: "юр. данные", w: 6, v: f.legalInfo.trim() ? 1 : 0, anchor: "legal" },
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

type Saved = { v: 1; f: BusinessInput; links: string[]; started?: boolean; /** старый мастер по шагам */ step?: number; draft: Draft | null; photos: string[]; sources: Partial<Record<DraftField, string>>; at: number };
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

function hostOf(url: string) {
  const s = url.trim().replace(/^[a-z]+:\/\//i, "").replace(/^www\./i, "");
  return s.split(/[/?#]/)[0] || s;
}

/** Поля анкеты, которые дублируют ссылку из блока ссылок */
type LinkField = "siteUrl" | "orgUrl" | "dgisUrl";
const LINK_FIELDS: [LinkField, LinkKind][] = [["siteUrl", "site"], ["orgUrl", "yandex"], ["dgisUrl", "dgis"]];
const keyOf = (raw: string) => {
  const u = normalizeLink(raw);
  return u ? linkKey(u) : raw.trim().toLowerCase();
};
/** Готовая ссылка нужной площадки (а не набираемый текст) */
const completeOf = (list: string[], kind: LinkKind) => list.find((l) => {
  const u = normalizeLink(l);
  return u && linkKind(u) === kind && (kind === "site" || new URL(u).pathname.length > 1);
}) ?? "";

/** Поле анкеты поменялось → та же ссылка в блоке ссылок: заменить, убрать или добавить */
function linksWithField(links: string[], old: string, next: string): string[] {
  const i = old.trim() ? links.findIndex((l) => l.trim() && keyOf(l) === keyOf(old)) : -1;
  if (i >= 0) {
    const out = next.trim() ? links.map((l, j) => (j === i ? next : l)) : links.filter((_, j) => j !== i);
    return out.length ? out : [""];
  }
  if (!next.trim() || links.some((l) => l.trim() && keyOf(l) === keyOf(next))) return links;
  const filled = links.filter((l) => l.trim());
  return filled.length >= MAX_LINKS ? links : [...filled, next];
}

/** Блок ссылок поменялся → поля «Сайт», «Яндекс Карты», «2ГИС»: правка той же ссылки, удаление, первая новая */
function fieldsFromLinks(f: BusinessInput, old: string[], next: string[]): Partial<BusinessInput> {
  const out: Partial<BusinessInput> = {};
  for (const [field, kind] of LINK_FIELDS) {
    const cur = (f[field] ?? "").trim();
    if (cur) {
      const i = old.findIndex((l) => l.trim() && keyOf(l) === keyOf(cur));
      if (i < 0) continue; // поле заполнено отдельно — не трогаем
      if (next.length === old.length) {
        if (next[i] !== old[i]) {
          const u = normalizeLink(next[i]);
          out[field] = u && linkKind(u) === kind ? next[i] : completeOf(next, kind);
        }
      } else if (!next.some((l) => l.trim() && keyOf(l) === keyOf(cur))) out[field] = completeOf(next, kind);
    } else {
      const v = completeOf(next, kind);
      if (v) out[field] = v;
    }
  }
  return out;
}

/** Все ссылки анкеты для сохранения и показа: поля + блок ссылок, без повторов */
const allLinksOf = (f: BusinessInput, links: string[]): SourceLink[] => cleanLinks([f.siteUrl, f.orgUrl, f.dgisUrl ?? "", ...links]);

/** Проскроллить к полю и поставить в него курсор */
function jumpTo(anchor: string) {
  const el = document.getElementById(anchor);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  const input = el.querySelector<HTMLElement>("input:not([type=range]):not(:disabled), select:not(:disabled), textarea");
  setTimeout(() => input?.focus({ preventScroll: true }), 350);
}

export function BusinessOnboarding({
  initial, initialLinks = [], niches, next, saveLabel, nicheLock, editing, draftKey, savedPhotos, photoMax, otherProjects,
}: {
  initial: BusinessInput;
  /** Сохранённые ссылки на бизнес (source_links + сайт и Яндекс Карты) */
  initialLinks?: string[]; niches: NicheLite[]; next: string; saveLabel: string; nicheLock: "launched" | "plan" | null; editing: boolean;
  /** Ключ черновика в браузере: пользователь + проект («new» для нового) */
  draftKey: string;
  /** Уже сохранённые фото владельца (id) */
  savedPhotos: string[];
  photoMax: number;
  otherProjects: number;
}) {
  /** Выбрали «по ссылке» или «вручную» — тогда под ссылками открываются разделы анкеты */
  const [started, setStarted] = useState(editing);
  /** Блок ссылок развёрнут (после того как анкета уже открыта) */
  const [linkOpen, setLinkOpen] = useState(false);
  const [f, setF] = useState<BusinessInput>(initial);
  const startLinks = () => {
    const pre = cleanLinks([...initialLinks, initial.siteUrl, initial.orgUrl, initial.dgisUrl ?? ""]).map((l) => l.url);
    return pre.length ? pre : [""];
  };
  const [links, setLinksRaw] = useState<string[]>(startLinks);
  /** Блок ссылок поменялся — подтягиваем поля «Сайт», «Яндекс Карты», «2ГИС» */
  const setLinks = (v: string[] | ((l: string[]) => string[])) => {
    const nextLinks = typeof v === "function" ? v(links) : v;
    const patch = fieldsFromLinks(f, links, nextLinks);
    setLinksRaw(nextLinks);
    if (Object.keys(patch).length) setF((x) => ({ ...x, ...patch }));
  };
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sources, setSources] = useState<Partial<Record<DraftField, string>>>({});
  const [photos, setPhotos] = useState<string[]>([]);
  const [changes, setChanges] = useState<{ list: Change[]; summary: string[] } | null>(null);
  /** Только что заполнили по ссылке — показываем, что подтянули */
  const [imported, setImported] = useState<string[] | null>(null);
  /** Обязательные поля, которые уже трогали, — у них показываем ошибку сразу */
  const [touched, setTouched] = useState<Set<Req>>(new Set());
  /** Нажимали «Сохранить» — показываем все ошибки */
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const toast = useToast();
  const router = useRouter();
  const top = useRef<HTMLDivElement>(null);
  const ready = useRef(false);
  const pristine = useRef(JSON.stringify(initial));

  // Уже сохранённые фото проекта: владелец может удалить их здесь же; при замене данных другим бизнесом —
  // фото прежнего бизнеса не показываем и удаляем при сохранении
  const [removed, setRemoved] = useState<string[]>([]);
  const [dropSaved, setDropSaved] = useState(false);
  const keptPhotos = dropSaved ? [] : savedPhotos.filter((id) => !removed.includes(id));
  const photoRoom = Math.max(0, Math.min(PHOTO_PICK, photoMax - keptPhotos.length));

  // Черновик из браузера + ссылки вида /app/start#org, #hours — сразу к нужному полю
  useEffect(() => {
    const s = readSaved(draftKey);
    if (s && (JSON.stringify(s.f) !== pristine.current || s.draft)) {
      setF(s.f);
      setLinksRaw(s.links?.length ? s.links : [""]);
      setStarted((v) => v || Boolean(s.started ?? ((s.step ?? 0) > 0 || s.draft)));
      setDraft(s.draft ?? null);
      setPhotos(s.photos ?? []);
      setSources(s.sources ?? {});
      setRestored(true);
    }
    const h = window.location.hash.slice(1);
    if (editing && ["org", "dgis", "legal", "hours", "f-adv"].includes(h)) setTimeout(() => jumpTo(h), 300);
    // «Настройки → Ссылки на бизнес → Изменить» — сразу раскрытый блок ссылок
    if (h === "links") {
      setLinkOpen(true);
      setTimeout(() => document.getElementById("link-0")?.focus(), 300);
    }
    ready.current = true;
  }, [draftKey, editing]);

  // Автосохранение черновика (только если что-то поменялось)
  useEffect(() => {
    if (!ready.current) return;
    const t = setTimeout(() => {
      try {
        const dirty = JSON.stringify(f) !== pristine.current || draft;
        if (!dirty) return;
        const data: Saved = { v: 1, f, links, started, draft, photos, sources, at: Date.now() };
        window.localStorage.setItem(storageKey(draftKey), JSON.stringify(data));
      } catch {
        /* приватный режим или переполнение — без черновика */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [f, links, started, draft, photos, sources, draftKey]);

  const clearSaved = () => {
    try {
      window.localStorage.removeItem(storageKey(draftKey));
    } catch {
      /* нет доступа */
    }
  };

  const scrollTop = () => requestAnimationFrame(() => top.current?.scrollIntoView({ behavior: "smooth", block: "start" }));

  const photoCount = keptPhotos.length + photos.length;
  const comp = useMemo(() => completeness(f, photoCount), [f, photoCount]);
  const miss = useMemo(() => missingOf(f), [f]);
  const touch = useCallback((k: Req) => setTouched((t) => (t.has(k) ? t : new Set(t).add(k))), []);
  const val = useMemo(() => ({ miss, shown: (k: Req) => tried || touched.has(k), touch }), [miss, tried, touched, touch]);

  /** Перейти к полю из списка «не хватает» — и сразу подсветить, если оно обязательное */
  const goField = (anchor: string) => {
    const req = (Object.keys(REQUIRED_ANCHOR) as Req[]).find((k) => REQUIRED_ANCHOR[k] === anchor && miss.includes(k));
    if (req) touch(req);
    jumpTo(anchor);
  };

  function openForm(how: "manual" | "import") {
    setStarted(true);
    setLinkOpen(false);
    setImportError(null);
    if (how === "manual") requestAnimationFrame(() => setTimeout(() => jumpTo("f-name"), 50));
  }

  async function autofill() {
    const urls = [...new Set(links.map((l) => l.trim()).filter(Boolean))].slice(0, READ_LINKS);
    if (!urls.length) {
      setImportError("Вставьте ссылку на сайт или карточку в картах — или нажмите «Заполнить вручную».");
      return;
    }
    setRunning(true);
    setImportError(null);
    setRows([]);
    setChanges(null);
    setImported(null);
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
        setImportError("По этим ссылкам ничего не нашли. Проверьте адрес или нажмите «Заполнить вручную».");
        setRunning(false);
        return;
      }
      const hadData = Boolean(f.name.trim() || f.services.some((s) => s.name.trim()));
      const other = isOtherBusiness(f, d);
      const m = other ? replaceDraft(f, d, nicheLock === "launched") : mergeDraft(f, d, photoRoom);
      setDraft(d);
      setSources((s) => (other ? { ...d.sources } : { ...d.sources, ...Object.fromEntries(Object.entries(s).filter(([k]) => m.changes.some((c) => c.field === k && c.kind === "kept"))) }));
      setPhotos((cur) => (other ? d.photos.slice(0, Math.min(PHOTO_PICK, photoMax)) : !cur.length ? d.photos.slice(0, photoRoom) : cur.filter((p) => d.photos.includes(p))));
      setF(m.next);
      setRunning(false);
      setStarted(true);
      if (other) {
        setDropSaved(true);
        toast(`По ссылке другой бизнес — «${d.name ?? "без названия"}». Заменили данные прежнего: адрес, сферу, услуги и фото.`);
        if (!d.niche && nicheLock !== "launched") setTried(true);
      }
      // Первое чтение без расхождений — сворачиваем ссылки и показываем, что заполнили; повторное — что изменилось
      if ((other || !hadData) && !m.changes.some((c) => c.kind === "kept")) {
        setImported([...m.changes.filter((c) => c.kind === "added").map((c) => c.label), ...m.summary]);
        setLinkOpen(false);
        setRows([]);
      } else {
        setChanges({ list: m.changes, summary: m.summary });
        setLinkOpen(true);
      }
    } catch (e) {
      setImportError((e as Error).message);
      setRunning(false);
    }
  }

  async function save() {
    if (miss.length) {
      setTried(true);
      goField(REQUIRED_ANCHOR[miss[0]]);
      return;
    }
    setBusy("Сохраняем…");
    setSaveError(null);
    try {
      const saved = await api<{ warning?: string }>("POST", "/api/business", businessPayload(f, allLinksOf(f, links).map((l) => l.url)));
      // Сайт не открылся — реклама пока поведёт на страницу записи
      if (saved?.warning) toast(saved.warning, "error");
      // Фото прежнего бизнеса (после замены данных) и удалённые владельцем — убираем
      const drop = dropSaved ? savedPhotos : removed;
      for (const id of drop) await api("DELETE", `/api/photos/${id}`).catch(() => null);
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
    // Сайт, Яндекс Карты и 2ГИС — те же ссылки, что в блоке ссылок: правим их и там
    if (k === "siteUrl" || k === "orgUrl" || k === "dgisUrl") setLinksRaw((l) => linksWithField(l, String(f[k] ?? ""), String(v ?? "")));
    setF((x) => ({ ...x, [k]: v }));
    setSources((s) => (s[k as DraftField] ? { ...s, [k]: undefined } : s));
    setSaveError(null);
  };

  const reset = () => {
    clearSaved();
    setF(initial);
    setLinksRaw(startLinks());
    setDraft(null);
    setPhotos([]);
    setSources({});
    setChanges(null);
    setImported(null);
    setRows([]);
    setTouched(new Set());
    setTried(false);
    setRestored(false);
    setStarted(editing);
    setLinkOpen(false);
    scrollTop();
  };

  const linkMode = !started ? "intro" : linkOpen || running ? "open" : "collapsed";
  const secMissing = (keys: Req[]) => miss.filter((m) => keys.includes(m)).map((m) => REQUIRED_TEXT[m]);

  return (
    <div ref={top} className="grid grid-cols-[minmax(0,1fr)] gap-4 scroll-mt-6">
      {restored ? (
        <div className="card px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <RotateCcw size={15} className="text-muted" />
          <span className="flex-1 min-w-0">Восстановили несохранённый черновик.</span>
          <button type="button" className="font-semibold underline underline-offset-4" onClick={reset}>Начать заново</button>
        </div>
      ) : null}

      <LinkBlock
        mode={linkMode}
        links={links}
        all={allLinksOf(f, links)}
        setLinks={(v) => { setLinks(v); setImportError(null); }}
        rows={rows}
        running={running}
        onRun={autofill}
        draft={draft}
        changes={changes}
        otherProjects={otherProjects}
        editing={editing}
        error={importError}
        onReplace={(c) => {
          setF((x) => ({ ...x, [c.field]: c.value }));
          setSources((s) => ({ ...s, [c.field]: draft?.sources[c.field as DraftField] }));
          setChanges((ch) => (ch ? { ...ch, list: ch.list.map((y) => (y === c ? { ...y, kind: "added" as const } : y)) } : ch));
        }}
        onReplaceAll={() => {
          if (!draft) return;
          const m = replaceDraft(f, draft, nicheLock === "launched");
          setDropSaved(true);
          setF(m.next);
          setSources({ ...draft.sources });
          setPhotos(draft.photos.slice(0, Math.min(PHOTO_PICK, photoMax)));
          setChanges({ list: m.changes, summary: m.summary });
          toast("Заменили анкету данными по ссылке: адрес, сферу, услуги и фото прежнего бизнеса убрали");
          if (!draft.niche && nicheLock !== "launched") setTried(true);
        }}
        onManual={() => openForm("manual")}
        onOpen={() => { setLinkOpen(true); setImported(null); }}
        onClose={() => { setLinkOpen(false); setChanges(null); setRows([]); setImportError(null); }}
      />

      {started ? (
        <>
          {imported ? (
            <div className="card px-4 sm:px-6 py-3.5 flex items-start gap-2.5 text-sm bg-good-soft border-good/30" aria-live="polite">
              <Check size={17} className="text-good mt-0.5 shrink-0" />
              <p className="leading-relaxed">
                <span className="font-semibold">Заполнили по ссылке{imported.length ? `: ${imported.slice(0, 6).join(", ")}${imported.length > 6 ? " и другое" : ""}` : ""}.</span>{" "}
                Проверьте разделы ниже и допишите, чего не хватает.
              </p>
            </div>
          ) : null}

          <Completeness pct={comp.pct} miss={miss} todo={comp.todo.filter((t) => !t.req && !(t.anchor === "f-services" && miss.includes("services")))} go={goField} />

          <Val.Provider value={val}>
            <AboutSection f={f} set={set} niches={niches} nicheLock={nicheLock} initialNiche={initial.niche} draft={draft} sources={sources} need={secMissing(["name", "niche", "city"])} />
            <ServicesSection f={f} set={set} niches={niches} sources={sources} need={secMissing(["services"])} />
            <PhotosSection draft={draft} photos={photos} setPhotos={setPhotos} room={photoRoom} saved={keptPhotos} dropped={dropSaved && savedPhotos.length > 0} onRemove={(id) => setRemoved((r) => [...r, id])} photoMax={photoMax} sources={sources} onLinks={() => { setLinkOpen(true); scrollTop(); }} editing={editing} />
            <ContactsSection f={f} set={set} sources={sources} need={secMissing(["contact"])} />
          </Val.Provider>

          {/* Одна главная кнопка этапа — прилипает к низу экрана, пока анкета длиннее экрана */}
          <div className="sticky bottom-[3.375rem] md:bottom-0 z-30 -mx-4 px-4 sm:mx-0 sm:px-0 pt-4 pb-2 md:pb-4 bg-linear-to-t from-paper from-65% to-paper/0">
            <div className="card shadow-lg px-4 py-3 sm:px-5 grid gap-2.5 sm:flex sm:items-center sm:gap-4">
              <div className={`min-w-0 flex-1 text-sm leading-snug ${!saveError && !miss.length ? "max-sm:hidden" : ""}`}>
                {saveError ? (
                  <p className="flex items-start gap-2 font-semibold text-bad" role="alert">
                    <CircleAlert size={16} className="mt-0.5 shrink-0" />
                    <span className="[overflow-wrap:anywhere]">Не сохранили. {saveError}</span>
                  </p>
                ) : miss.length ? (
                  <p className="text-ink-2">
                    <span className="font-semibold">Чтобы перейти дальше, заполните:</span>{" "}
                    {miss.map((m, i) => (
                      <span key={m}>
                        <a href={`#${REQUIRED_ANCHOR[m]}`} className="underline underline-offset-4 decoration-bad/60 font-semibold text-bad" onClick={(e) => { e.preventDefault(); goField(REQUIRED_ANCHOR[m]); }}>{REQUIRED_TEXT[m]}</a>
                        {i < miss.length - 1 ? ", " : ""}
                      </span>
                    ))}
                  </p>
                ) : (
                  <p className="max-sm:hidden flex items-center gap-2 text-ink-2"><Check size={16} className="text-good shrink-0" /> <span>Всё нужное заполнено{comp.pct < 100 ? ` — анкета на ${comp.pct}%` : ""}.</span></p>
                )}
              </div>
              <button type="button" className="btn btn-primary h-12 px-6 text-base shrink-0" onClick={save} disabled={Boolean(busy) || miss.length > 0} aria-disabled={miss.length > 0}>
                {busy ? <Loader2 size={18} className="spin shrink-0" /> : <Check size={18} className="shrink-0" />}
                {busy ?? saveLabel}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ─── Полнота анкеты ──────────────────────────────────────────────────

function Completeness({ pct, miss, todo, go }: { pct: number; miss: Req[]; todo: { label: string; anchor: string }[]; go: (anchor: string) => void }) {
  const [more, setMore] = useState(false);
  const extra = todo.slice(0, more ? todo.length : 5);
  const link = (label: string, anchor: string, bad = false) => (
    <a key={label} href={`#${anchor}`} onClick={(e) => { e.preventDefault(); go(anchor); }}
      className={`inline-flex items-center h-7 px-2.5 rounded-full text-[13px] font-semibold border ${bad ? "border-bad/40 bg-bad-soft text-bad" : "border-line bg-white text-ink-2 hover:border-ink"}`}>
      {bad ? null : <Plus size={13} className="mr-1" />}{label}
    </a>
  );
  return (
    <section className="card p-4 sm:px-6 sm:py-5 grid gap-3" aria-label="Заполненность анкеты">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-bold">Заполнено на {pct}%</p>
        {miss.length ? <p className="text-sm text-bad font-semibold whitespace-nowrap">обязательно: {miss.length}</p> : <p className="text-sm text-good font-semibold inline-flex items-center gap-1"><Check size={15} /> обязательное есть</p>}
      </div>
      <div className="h-1.5 rounded-full bg-line overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Заполненность анкеты">
        <div className="h-full rounded-full bg-mark transition-[width] duration-500" style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
      {miss.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm text-muted mr-1">Не хватает:</span>
          {miss.map((m) => link(REQUIRED_TEXT[m], REQUIRED_ANCHOR[m], true))}
        </div>
      ) : null}
      {todo.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm text-muted mr-1">Для сильных объявлений:</span>
          {extra.map((t) => link(t.label, t.anchor))}
          {todo.length > 5 && !more ? <button type="button" className="text-sm font-semibold text-muted underline underline-offset-4" onClick={() => setMore(true)}>ещё {todo.length - 5}</button> : null}
        </div>
      ) : null}
    </section>
  );
}

// ─── Ссылки ──────────────────────────────────────────────────────────

function LinkBlock({ mode, links, all, setLinks, rows, running, onRun, draft, editing, changes, onReplace, onReplaceAll, onManual, onOpen, onClose, otherProjects, error }: {
  mode: "intro" | "open" | "collapsed";
  links: string[]; all: SourceLink[]; setLinks: (v: string[] | ((l: string[]) => string[])) => void; rows: Row[]; running: boolean; onRun: () => void; draft: Draft | null; editing: boolean;
  changes: { list: Change[]; summary: string[] } | null; onReplace: (c: Change) => void; onReplaceAll: () => void; onManual: () => void; onOpen: () => void; onClose: () => void; otherProjects: number; error: string | null;
}) {
  const setAt = (i: number, v: string) => setLinks((l) => l.map((x, j) => (j === i ? v : x)));
  const done = rows.filter((r) => r.state !== "loading").length;
  const added = changes?.list.filter((c) => c.kind === "added") ?? [];
  const kept = changes?.list.filter((c) => c.kind === "kept") ?? [];
  const intro = mode === "intro";

  if (mode === "collapsed") {
    const found = [...new Set((draft?.reports ?? []).filter((r) => r.status === "ok" || r.status === "partial").map((r) => (r.kind === "site" ? hostOf(r.url) : KIND_LABEL[r.kind])))];
    return (
      <section className="card px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-3 gap-y-1.5" aria-label="Ссылки на бизнес">
        <span className="grid place-items-center size-8 rounded-full bg-paper shrink-0">{found.length || all.length ? <Link2 size={16} /> : <PenLine size={16} />}</span>
        <div className="min-w-0 flex-1 text-[15px] leading-snug">
          {all.length ? (
            <>
              <span className="text-muted mr-1.5">Ссылки:</span>
              <span className="inline-flex flex-wrap gap-1.5 align-middle">
                {all.map((l) => (
                  <a key={l.url} href={l.url} target="_blank" rel="noreferrer" title={l.url}
                    className="inline-flex items-center gap-1 max-w-full rounded-full border border-line bg-white px-2.5 h-7 text-[13px] hover:border-ink">
                    <span className="font-semibold whitespace-nowrap">{LINK_LABEL[l.kind]}</span>
                    {l.kind === "site" || l.kind === "other" ? <span className="text-muted truncate">{shortLink(l.url, 28)}</span> : null}
                  </a>
                ))}
              </span>
              {found.length ? <span className="block text-sm text-muted mt-1">Данные прочитали из: {found.join(", ")}</span> : null}
            </>
          ) : found.length ? <><span className="text-muted">Данные из:</span> <span className="font-semibold [overflow-wrap:anywhere]">{found.join(", ")}</span></>
            : <span className="text-muted">Заполняете вручную. Есть сайт или карточка на картах — подставим данные сами.</span>}
        </div>
        <button type="button" className="text-sm font-semibold underline underline-offset-4 whitespace-nowrap hover:text-ink text-ink-2" onClick={onOpen}>
          {found.length || all.length ? "Изменить ссылки" : "Заполнить по ссылке"}
        </button>
      </section>
    );
  }

  return (
    <section className="card overflow-hidden" aria-label="Ссылки на бизнес">
      <div className={`grid grid-cols-[minmax(0,1fr)] gap-5 ${intro ? "p-5 sm:p-8" : "p-5 sm:p-6"}`}>
        <div className="flex items-start gap-3">
          <div className="grid gap-1.5 flex-1 min-w-0">
            <h2 className={`${intro ? "text-xl sm:text-2xl" : "text-lg sm:text-xl"} font-extrabold tracking-tight`}>{intro ? "Есть сайт или карточка на картах?" : "Ссылки на ваш бизнес"}</h2>
            <p className="text-muted leading-relaxed max-w-xl">
              {intro
                ? "Вставьте ссылку — сами заполним адрес, часы, телефон, услуги с ценами и фото, вам останется проверить. Нет ссылки — заполните вручную."
                : "Добавьте или поменяйте ссылку и прочитайте ещё раз. То, что вы уже заполнили, не затрём — только допишем пустое и покажем, что отличается."}
            </p>
          </div>
          {!intro && !running ? (
            <button type="button" className="p-2 -m-1 rounded-md text-muted hover:text-ink hover:bg-paper" aria-label="Свернуть" onClick={onClose}><ChevronDown size={20} className="rotate-180" /></button>
          ) : null}
        </div>

        <form
          className="grid grid-cols-[minmax(0,1fr)] gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!running) onRun();
          }}
        >
          <label htmlFor="link-0" className="label mb-0">Сайт, Яндекс Карты, 2ГИС, DIKIDI, Taplink, VK или YCLIENTS — все ссылки сохраним в настройках</label>
          {links.map((v, i) => {
            const kind = guessKind(v);
            return (
              <div key={i} className="relative">
                <Link2 size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-faint pointer-events-none" aria-hidden />
                <input
                  id={`link-${i}`}
                  className={`field ${intro ? "h-14 text-base sm:text-lg" : "h-12"} pl-11 pr-28 ${error && i === 0 && !v.trim() ? "border-bad" : ""}`}
                  value={v}
                  onChange={(e) => setAt(i, e.target.value)}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData("text");
                    const parts = text.split(/[\s,;]+/).filter((p) => /\.[a-zа-я]{2,}/i.test(p));
                    if (parts.length > 1) {
                      e.preventDefault();
                      setLinks([...links.slice(0, i), ...parts, ...links.slice(i + 1)].filter((x, j, a) => x || j === a.length - 1).slice(0, MAX_LINKS));
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
                  autoFocus={i === 0 && intro && !v}
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  {kind ? <span className="pill bg-info-soft text-ink-2 max-w-[6.5rem] truncate">{KIND_LABEL[kind]}</span> : null}
                  {links.length > 1 && !running ? (
                    <button type="button" aria-label="Убрать ссылку" onClick={() => setLinks(links.filter((_, j) => j !== i))} className="p-1.5 rounded-md text-muted hover:text-ink hover:bg-paper">
                      <X size={16} />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {links.length < MAX_LINKS && !running ? (
              <button type="button" className="inline-flex items-center gap-1.5 text-sm font-semibold hover:underline underline-offset-4" onClick={() => setLinks([...links, ""])}>
                <Plus size={16} /> ещё ссылка
              </button>
            ) : null}
            {intro ? (
              <p className="text-sm text-faint [overflow-wrap:anywhere]">
                Например: {EXAMPLES.slice(0, 3).map((x, i) => (
                  <span key={x}>
                    <code className="font-sans text-muted">{x}</code>
                    {i < 2 ? ", " : ""}
                  </span>
                ))}
              </p>
            ) : null}
          </div>

          {links.filter((l) => l.trim()).length > READ_LINKS ? <p className="hint">Прочитаем первые {READ_LINKS} ссылок, сохраним все.</p> : null}

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
              {draft ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1 border-t border-line">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={onReplaceAll}>Заменить всё данными по ссылке</button>
                  <span className="text-xs text-muted">если это другой бизнес: прежние адрес, сфера, услуги и фото уберём</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {intro ? (
            // Два равноправных пути: по ссылке (главный) или вручную
            <div className="grid sm:flex sm:items-center gap-3 pt-1">
              <button className="btn btn-primary h-12 px-6 text-base" disabled={running}>
                {running ? <Loader2 size={18} className="spin" /> : <Link2 size={18} />}
                {running ? "Читаем…" : "Заполнить по ссылке"}
              </button>
              <button type="button" className="btn btn-ghost h-12 px-5 text-base" onClick={onManual} disabled={running}>
                <PenLine size={17} /> Заполнить вручную
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button className="btn btn-ghost h-11 px-5" disabled={running}>
                {running ? <Loader2 size={16} className="spin" /> : <RotateCcw size={16} />}
                {running ? "Читаем…" : changes ? "Прочитать ещё раз" : "Прочитать ссылки"}
              </button>
              {!running ? (
                <button type="button" className="h-11 px-2 text-[15px] font-semibold text-muted hover:text-ink underline underline-offset-4" onClick={onClose}>
                  {changes ? "Готово" : "Отмена"}
                </button>
              ) : null}
            </div>
          )}
        </form>
      </div>
      {intro ? (
        <div className="border-t border-line bg-paper/60 px-5 sm:px-8 py-3.5 text-sm text-muted leading-relaxed">
          Берём только то, что опубликовано на ваших страницах, — ничего не придумываем.
          {editing || otherProjects ? " Это другой бизнес? Заведите его отдельно: «Новый проект» в переключателе проектов." : ""}
        </div>
      ) : null}
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

/** Проверка обязательных полей: чего не хватает и где уже пора показывать ошибку */
const Val = createContext<{ miss: Req[]; shown: (k: Req) => boolean; touch: (k: Req) => void }>({ miss: [], shown: () => false, touch: () => {} });

/**
 * Строка раздела: подпись + чип источника слева, значение справа (на телефоне — друг под другом).
 * req — обязательное поле: ошибка у поля появляется, когда из него ушли пустым или нажали «Сохранить».
 */
function Field({ label, htmlFor, chip, req, missingText, hint, id, children }: { label: string; htmlFor?: string; chip?: string; req?: Req; missingText?: string; hint?: string; id?: string; children: React.ReactNode }) {
  const v = useContext(Val);
  const missing = req ? v.miss.includes(req) : false;
  const error = missing && req ? v.shown(req) : false;
  return (
    <div id={id} data-missing={error ? "true" : undefined} onBlurCapture={req ? () => v.touch(req) : undefined}
      className={`grid gap-1.5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4 py-3.5 px-4 sm:px-6 scroll-mt-28 transition-colors ${error ? "bg-bad-soft/60" : ""}`}>
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

/** Раздел анкеты. need — чего не хватает из обязательного (null — раздел необязательный) */
function SectionCard({ id, title, text, need, children }: { id: string; title: string; text?: string; need: string[] | null; children: React.ReactNode }) {
  return (
    <section id={id} className="card overflow-hidden scroll-mt-6" aria-labelledby={`${id}-h`}>
      <header className="p-5 sm:px-6 sm:pt-6 sm:pb-5 border-b border-line">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h2 id={`${id}-h`} className="text-xl font-extrabold tracking-tight">{title}</h2>
          {need === null ? (
            <span className="text-sm text-muted">Необязательно</span>
          ) : need.length ? (
            <span className="text-sm font-semibold text-bad">Нужно: {need.join(", ")}</span>
          ) : (
            <span className="text-sm font-semibold text-good inline-flex items-center gap-1"><Check size={15} /> Готово</span>
          )}
        </div>
        {text ? <p className="text-muted mt-1 leading-relaxed">{text}</p> : null}
      </header>
      <div className="divide-y divide-line">{children}</div>
    </section>
  );
}

type SetF = <K extends keyof BusinessInput>(k: K, v: BusinessInput[K]) => void;

// ─── Основное ────────────────────────────────────────────────────────

function AboutSection({ f, set, niches, nicheLock, initialNiche, draft, sources, need }: {
  f: BusinessInput; set: SetF; niches: NicheLite[]; nicheLock: "launched" | "plan" | null; initialNiche: string; draft: Draft | null; sources: Partial<Record<DraftField, string>>; need: string[];
}) {
  const found = draft?.advantagesFound ?? [];
  const advList = f.advantages.filter((a) => a.trim());
  const notes = draft?.reports.filter((r) => r.status !== "ok" && r.message) ?? [];
  const addresses = draft?.addresses ?? [];
  return (
    <SectionCard id="sec-about" title="Основное" need={need} text={draft ? "Проверьте, что нашли, и поправьте, если что-то не так. Зелёная метка — откуда взяли." : "Главное о вас — из этого робот пишет объявления. Обязательны название, сфера и город."}>
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
      <Field label="Название" htmlFor="r-name" chip={sources.name} req="name" id="f-name" missingText="Укажите название">
        <input id="r-name" className="field" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Студия «Лак»" maxLength={80} />
      </Field>

      <Field label="Чем занимаетесь" htmlFor="r-niche" chip={sources.niche} req="niche" id="f-niche" missingText="Выберите сферу">
        <select id="r-niche" className="field pr-8" value={f.niche} onChange={(e) => set("niche", e.target.value)} disabled={nicheLock === "launched"}>
          <option value="" disabled>Выберите…</option>
          {niches.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
        </select>
        {nicheLock === "launched" ? <p className="hint mt-1.5">Сферу нельзя сменить, пока реклама запущена.</p> : nicheLock === "plan" && f.niche !== initialNiche ? <p className="mt-1.5 text-sm text-warn">План объявлений подготовим заново под новую сферу.</p> : null}
      </Field>

      <Field label="Город и адрес" htmlFor="r-city" chip={sources.address ?? sources.city} req="city" id="f-city" missingText="Укажите город">
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

      <Field label="Почему выбирают вас" htmlFor="r-adv" chip={sources.advantages} id="f-adv" hint="Каждое с новой строки, до 8. Только правда — объявления строятся на этих фактах.">
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

      <Field label="Отзыв клиента" htmlFor="r-review" chip={sources.review} id="f-review" hint="Настоящий отзыв — сделаем из него рекламную картинку.">
        <textarea id="r-review" className="field" rows={2} value={f.review} onChange={(e) => set("review", e.target.value)} maxLength={300} placeholder="Хожу к Алине второй год — маникюр ни разу не скололся раньше чем через три недели." />
      </Field>
    </SectionCard>
  );
}

// ─── Услуги и цены по разделам прайса ────────────────────────────────

function ServicesSection({ f, set, niches, sources, need }: { f: BusinessInput; set: SetF; niches: NicheLite[]; sources: Partial<Record<DraftField, string>>; need: string[] }) {
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
    <SectionCard id="sec-services" title="Услуги и цены" need={need} text={`${services.filter((s) => s.name.trim()).length} из ${MAX_SERVICES} услуг, ${priced} с ценами. Разделы прайса — как на вашем сайте: по ним робот сделает отдельные группы объявлений.`}>
      <Field label="Прайс" chip={sources.services} req="services" id="f-services" missingText="Добавьте хотя бы одну услугу">
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
      <Field label="Предложение для новых клиентов" htmlFor="r-offer" chip={sources.offer} id="f-offer" hint="Необязательно, но такие объявления кликают чаще.">
        <input id="r-offer" className="field" value={f.offer} onChange={(e) => set("offer", e.target.value)} placeholder="−20% на первый визит" maxLength={80} />
      </Field>
    </SectionCard>
  );
}

// ─── Фото ────────────────────────────────────────────────────────────

function PhotosSection({ draft, photos, setPhotos, room, saved, dropped, onRemove, photoMax, sources, onLinks, editing }: {
  draft: Draft | null; photos: string[]; setPhotos: React.Dispatch<React.SetStateAction<string[]>>; room: number; saved: string[]; dropped: boolean; onRemove: (id: string) => void; photoMax: number;
  sources: Partial<Record<DraftField, string>>; onLinks: () => void; editing: boolean;
}) {
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const found = (draft?.photos ?? []).filter((p) => !broken.has(p));
  const toast = useToast();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [mine, setMine] = useState<string[]>([]);
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, 6)) {
        const r = await api<{ id?: string }>("POST", "/api/photos", { dataUrl: await resizeToJpeg(file) });
        if (r?.id) setMine((m) => [...m, r.id!]);
      }
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  const shown = [...saved, ...mine.filter((id) => !saved.includes(id))];
  return (
    <SectionCard id="sec-photos" title="Фото" need={null} text="Отметьте свои фото салона и работ — можно добавить и позже.">
      <div className="rounded-xl bg-paper p-3.5 text-sm text-ink-2 leading-relaxed">
        <span className="font-semibold text-ink">Картинки для объявлений будут двух видов.</span> Ваши фото — и кадры, которые робот
        сгенерирует под каждую услугу. Объявления с ними покажем по очереди, сравним, после каких чаще записываются,
        и оставим лучшие. Своих фото нет — не страшно, реклама запустится со сгенерированными.
      </div>
      {dropped ? <p className="text-sm text-muted">Фото прежнего бизнеса уберём при сохранении.</p> : null}
      {editing || shown.length ? <Field label="Ваши фото">
        <div className="grid grid-cols-5 sm:grid-cols-8 gap-1.5">
          {shown.slice(0, 16).map((id) => (
            <div key={id} className="relative group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/images/${id}`} alt="" className="aspect-square w-full object-cover rounded-md bg-line" loading="lazy" />
              <button type="button" aria-label="Убрать фото" title="Убрать фото" className="absolute right-1 top-1 bg-white/95 shadow-sm rounded-md p-1.5 text-ink hover:text-bad"
                onClick={() => { setMine((m) => m.filter((x) => x !== id)); onRemove(id); api("DELETE", `/api/photos/${id}`).catch((e) => toast((e as Error).message, "error")); }}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {/* Загрузить можно, когда проект уже сохранён; у нового — фото со ссылки выше */}
          {editing ? (
            <button type="button" className="aspect-square rounded-md border-2 border-dashed border-line-2 grid place-items-center text-muted hover:border-ink hover:text-ink" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 size={18} className="spin" /> : <span className="flex flex-col items-center gap-0.5 text-[11px] font-semibold"><ImagePlus size={18} />Загрузить</span>}
            </button>
          ) : null}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png" multiple hidden onChange={(e) => upload(e.target.files)} />
        </div>
        <p className="hint mt-1.5">{editing ? `Работы крупным планом, интерьер, мастер за работой. До ${photoMax} фото.` : "Свои фото можно будет загрузить после сохранения анкеты."}</p>
      </Field> : null}
      <Field label={draft ? `Нашли ${draft.photos.length} фото` : "С сайта"} chip={sources.photos} id="f-photos">
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
    </SectionCard>
  );
}

// ─── Контакты и юр. данные ───────────────────────────────────────────

function ContactsSection({ f, set, sources, need }: { f: BusinessInput; set: SetF; sources: Partial<Record<DraftField, string>>; need: string[] }) {
  return (
    <SectionCard id="sec-contacts" title="Контакты и юр. данные" need={need} text="Куда писать и звонить клиентам, и данные для маркировки рекламы. Обязателен телефон или мессенджер.">
      <Field label="Телефон и мессенджеры" htmlFor="r-phone" chip={sources.phone ?? sources.whatsapp ?? sources.telegram} req="contact" id="f-contact" missingText="Укажите телефон, WhatsApp или Telegram">
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
      <Field label="2ГИС" htmlFor="r-dgis" id="dgis" hint="Карточка в 2ГИС → «Поделиться» → «Скопировать ссылку». Покажем её в настройках; реклама в Директе всё равно привязывается к Яндекс Картам.">
        <input id="r-dgis" className="field" value={f.dgisUrl ?? ""} onChange={(e) => set("dgisUrl", e.target.value)} placeholder="2gis.ru/kazan/firm/70000001234567890" maxLength={500} inputMode="url" />
        {f.dgisUrl?.trim() && normalizeLink(f.dgisUrl) && linkKind(normalizeLink(f.dgisUrl)!) !== "dgis" ? <p className="mt-1.5 text-sm text-warn">Это не похоже на ссылку 2ГИС — проверьте адрес.</p> : null}
      </Field>
      <Field label="Юр. данные" htmlFor="r-legal" chip={sources.legalInfo} id="legal" hint="ИП или ООО, ФИО или название и ИНН — для маркировки рекламы (ЕРИР). VK без них не пропускает объявления.">
        <input id="r-legal" className="field" value={f.legalInfo} onChange={(e) => set("legalInfo", e.target.value)} placeholder="ИП Иванова А. С., ИНН 165012345680" maxLength={200} />
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
    </SectionCard>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

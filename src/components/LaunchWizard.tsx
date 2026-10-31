"use client";

/**
 * Этап 2 «Запуск рекламы» — разделы одной страницы: Кабинеты → Бюджет → Объявления → Запуск.
 * Без своей нумерации (номера этапов — в StageBar сверху). Главное действие одно и всегда внизу:
 * «Подготовить объявления», пока их нет, потом «Запустить рекламу».
 */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ImagePlus, Loader2, Rocket, Search, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { api, Modal, useToast, resizeToJpeg } from "./client";
import { VkConnect } from "./VkConnect";
import { VkPixelSetup } from "./VkPixelSetup";
import { PlanManager } from "./PlanManager";
import { ShowSettingsEditor } from "./ShowSettingsEditor";
import { MedicalLicenseGuide } from "./MedicalLicenseGuide";
import { LandingEditor } from "./LandingEditor";
import { landingFor, type LandingSettings } from "@/lib/engine/landing";
import type { ShowSettings } from "@/lib/engine/show";
import type { ExtrasBiz } from "@/lib/engine/extras";
import { allocate, forecastWithDemand, MAX_MONTHLY, minMonthlyFor, recommendedBudget, type Range } from "@/lib/engine/budget";
import { LAYER_ITEM } from "@/lib/niches";
import type { DemandView } from "@/lib/engine/demand";
import type { LaunchPlan, PlanAd, PublishStep } from "@/lib/engine/launch";
import type { Channel } from "@/lib/platforms/types";
import { CHANNEL_INFO, formatOf, isRetarget, RETARGET_MIN_AUDIENCE, type AdFormat } from "@/lib/channels";
import { TypeBadge } from "./CampaignNav";
import { LIMITS } from "@/lib/ai/limits";

const CH: Record<Channel, { name: string; hint: string }> = {
  search: { name: "Поиск Яндекса", hint: "Тем, кто прямо сейчас ищет услугу" },
  network: { name: "Сайты и приложения (РСЯ)", hint: "Картинки тем, кто недавно интересовался" },
  vk: { name: "ВКонтакте и Одноклассники", hint: "Лента соцсетей, люди рядом с вами" },
  retarget_yandex: { name: "Ретаргетинг в Яндексе", hint: "Возвращаем тех, кто был на сайте и не записался" },
  retarget_vk: { name: "Ретаргетинг ВКонтакте", hint: "Напоминаем в ленте тем, кто уже заходил" },
};
const RETARGET_NOTE = `Включится сам, когда наберётся ${RETARGET_MIN_AUDIENCE} человек, которые были на сайте, но не записались. До этого его доля работает в остальных каналах`;
const PLATFORM: Record<string, string> = { yandex: "Яндекс Директ", vk: "VK Реклама", demo: "Демо-кабинет" };
const rub = (n: number) => new Intl.NumberFormat("ru-RU").format(Math.round(n)) + " ₽";
function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
/** Объявление уйдёт на площадку: включено и с непустыми заголовком и текстом (как publishable на сервере) */
const publishable = (a: PlanAd) => a.enabled && Boolean(a.title?.trim()) && Boolean(a.text?.trim());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmt = (n: number) => new Intl.NumberFormat("ru-RU").format(Math.round(n));
/** Спрос округляем до двух значащих цифр: точнее Wordstat всё равно не скажет */
const round2 = (n: number) => (n >= 10_000 ? Math.round(n / 1000) * 1000 : n >= 1000 ? Math.round(n / 100) * 100 : n >= 100 ? Math.round(n / 10) * 10 : Math.round(n));
const approx = (n: number) => fmt(round2(n));
const span = (r: Range) => (r[0] === r[1] ? fmt(r[0]) : `${fmt(r[0])}–${fmt(r[1])}`);
const pct = (r: Range) => `${Math.round(r[0] * 100)}–${Math.round(r[1] * 100)}%`;
type Progress = PublishStep["progress"];

function progressOf(plan: LaunchPlan | null): Progress | null {
  const l = plan?.launch;
  if (!plan || !l) return null;
  const wanted = plan.channels.filter((c) => c.enabled && c.groups.some((g) => g.ads.some(publishable)));
  const channels = wanted.map((c) => ({ channel: c.channel, state: l.done.includes(c.channel) ? ("done" as const) : l.failed.includes(c.channel) ? ("failed" as const) : ("pending" as const) }));
  return { total: channels.length, finished: channels.filter((c) => c.state !== "pending").length, channels };
}

type Props = {
  business: { name: string; niche: string; monthlyBudget: number; siteUrl: string | null; medical?: boolean };
  host: string;
  accounts: { id: string; platform: string; login: string; status: string; statusNote: string | null }[];
  flags: { yandex: boolean; vk: boolean; demo: boolean; ai: boolean };
  plan: LaunchPlan | null;
  photos: { id: string; kind: string }[];
  callouts: string[];
  biz: ExtrasBiz;
  href: string;
  logo?: string | null;
  /** Радиус показа во ВКонтакте вокруг адреса, км (если адрес найден на карте) */
  vkRadiusKm?: number | null;
  /** Настройки показа: регион, пол и возраст, расписание */
  legalInfo?: string | null;
  landing: { initial: LandingSettings; siteUrl: string | null; pageUrl: string; siteCode?: "ok" | "missing" | "unknown" | null };
  show: { initial: ShowSettings; city: string; address: string | null; autoTime: string | null; autoRadiusKm: number | null };
};

/** Раздел этапа: заголовок, справа — состояние («Готово», «Необязательно», «Сначала подключите кабинет») */
function Section({ id, title, done, active, note, children, aside }: { id: string; title: string; done: boolean; active: boolean; note?: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section id={id} className={`card p-5 sm:p-7 scroll-mt-6 ${active ? "" : "opacity-60"}`} aria-disabled={!active} aria-labelledby={`${id}-h`}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 id={`${id}-h`} className="text-xl font-extrabold tracking-tight">{title}</h2>
        <div className="flex items-center gap-3">
          {aside}
          {done ? <span className="text-sm font-semibold text-good inline-flex items-center gap-1"><Check size={15} /> Готово</span> : note ? <span className="text-sm text-muted">{note}</span> : null}
        </div>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Семантика поиска от движка (GET /api/launch/semantics) — если эндпоинта нет, блок просто не показываем.
 *  layer — подпись слоя: «Услуги», «Проблемы клиентов», «Смежные запросы», «Аудитории» */
type Semantics = { name: string; keywords: string[]; layer?: string; demand?: number }[];
function parseSemantics(data: unknown): Semantics | null {
  const raw = (data && typeof data === "object" && "groups" in data ? (data as { groups: unknown }).groups : data) as unknown;
  if (!Array.isArray(raw)) return null;
  const out: Semantics = [];
  for (const g of raw) {
    if (!g || typeof g !== "object") continue;
    const o = g as Record<string, unknown>;
    const name = String(o.name ?? o.title ?? o.group ?? "").trim();
    const kw = (Array.isArray(o.keywords) ? o.keywords : Array.isArray(o.phrases) ? o.phrases : []).map((k) => (typeof k === "string" ? k : String((k as { phrase?: string; text?: string })?.phrase ?? (k as { text?: string })?.text ?? ""))).filter(Boolean);
    const layer = typeof o.layerLabel === "string" ? o.layerLabel : undefined;
    const demand = typeof o.demand === "number" ? o.demand : undefined;
    if (name || kw.length) out.push({ name: name || "Без названия", keywords: kw, ...(layer ? { layer } : {}), ...(demand !== undefined ? { demand } : {}) });
  }
  return out.length ? out : null;
}

export function LaunchWizard(p: Props) {
  const router = useRouter();
  const toast = useToast();
  const [plan, setPlan] = useState<LaunchPlan | null>(p.plan);
  const [budget, setBudget] = useState(p.business.monthlyBudget);
  const [waitingLock, setWaitingLock] = useState(false);
  const autoResumed = useRef(false);
  const [savedBudget, setSavedBudget] = useState(p.business.monthlyBudget);
  const [phase, setPhase] = useState<null | "copy" | "images" | "publish">(null);
  // Почему не получился запуск — показываем у кнопки, пока владелец не запустит снова (всплывашка исчезает, и причину не успеть прочитать)
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [imgProgress, setImgProgress] = useState<{ ready: number; total: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  /** Фото поменялись после подготовки объявлений — предлагаем перерисовать картинки (тексты и правки остаются) */
  const [photosChanged, setPhotosChanged] = useState(false);
  const [edit, setEdit] = useState<{ ad: PlanAd; channel: Channel } | null>(null);
  /** Новое объявление «написать самому»: та же форма, что и правка */
  const [newAd, setNewAd] = useState<{ groupId: string; channel: Channel } | null>(null);
  const [rewriteFor, setRewriteFor] = useState<Channel | null>(null);
  const [progress, setProgress] = useState<Progress | null>(() => progressOf(p.plan));
  const fileRef = useRef<HTMLInputElement>(null);
  const [semantics, setSemantics] = useState<Semantics | null>(null);
  /** Спрос по Wordstat (POST /api/launch/demand): сбор идёт на сервере порциями, мастер его подталкивает */
  const [demand, setDemand] = useState<DemandView | null>(null);

  const real = p.accounts.filter((a) => a.platform !== "demo");
  const usable = real.length ? real.filter((a) => a.status === "ok") : p.accounts;
  const channels: Channel[] = useMemo(() => {
    const out: Channel[] = [];
    const ya = usable.some((a) => a.platform === "yandex" || a.platform === "demo");
    const vk = usable.some((a) => a.platform === "vk" || a.platform === "demo");
    if (ya) out.push("search", "network");
    if (vk) out.push("vk");
    if (ya) out.push("retarget_yandex");
    if (vk) out.push("retarget_vk");
    return out;
  }, [usable]);
  // Если в плане канал выключил владелец, его доля уходит оставшимся — показываем ту же раскладку, что получит запуск.
  // Каналы, выключенные из-за бюджета, участвуют: при другом бюджете они вернутся (как rebalancePlan на сервере)
  const planChannels = plan?.channels.filter((c) => c.enabled || c.disabledReason === "budget").map((c) => c.channel) ?? [];
  const runChannels: Channel[] = planChannels.length ? planChannels : channels.length ? channels : ["search"];
  const alloc = allocate(budget, runChannels);
  const minBudget = minMonthlyFor(channels.length ? channels : ["search"]);
  const hasAccounts = usable.length > 0;
  const demandReady = demand?.status === "done" && demand.summary ? demand.summary.total : null;
  const medical = demand?.medical ?? p.business.medical;
  const fc = forecastWithDemand({ monthly: budget, niche: p.business.niche, medical, regionIds: demand?.regionIds, allocation: alloc.allocation, demand: demandReady });
  // Рекомендованный бюджет по спросу — не зависит от того, что сейчас в поле: доля поиска берётся из раскладки
  // тех же каналов при рекомендуемой сумме (при малом бюджете часть каналов отключается — уточняем до схождения)
  const rec = (() => {
    if (demandReady === null || !demandReady) return null;
    if (!runChannels.includes("search")) return null;
    const shareAt = (m: number) => allocate(m, runChannels).allocation.find((x) => x.channel === "search")?.share ?? 1;
    const base = { demand: demandReady, niche: p.business.niche, medical, regionIds: demand?.regionIds, minMonthly: minBudget };
    let r = recommendedBudget({ ...base, searchShare: shareAt(MAX_MONTHLY) });
    for (let i = 0; i < 4; i++) {
      const next = recommendedBudget({ ...base, searchShare: shareAt(r.monthly) });
      if (next.monthly === r.monthly) break;
      const up = next.monthly > r.monthly;
      r = next;
      // Колебание (каналы то отключаются, то возвращаются) — останавливаемся на сумме побольше: поиску её точно хватит
      if (up) break;
    }
    return { ...r, share: shareAt(r.monthly) };
  })();
  const [allGroups, setAllGroups] = useState(false);
  // Группы спроса: сначала услуги и аудитории (они в итоге), потом смежные и проблемы
  const LAYER_ORDER = ["service", "audience", "adjacent", "problem"];
  // counted — группа входит в итог (у старых сводок поля нет: тогда как раньше — услуги и аудитории)
  const counted = (g: { layer: string; counted?: boolean }) => g.counted ?? (g.layer === "service" || g.layer === "audience");
  const demandGroups = demand?.summary ? [...demand.summary.groups].sort((a, b) => Number(!counted(a)) - Number(!counted(b)) || LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer)) : [];
  const countedSum = demandGroups.filter(counted).reduce((n, g) => n + (g.demand ?? 0), 0);

  // Сбор спроса: каждый POST продвигает его (до ~40 с), пока не готово. Не блокирует страницу; кабинет поменялся — заново
  const accKey = usable.map((a) => `${a.id}:${a.status}`).join(",");
  useEffect(() => {
    if (!accKey) return;
    let off = false;
    (async () => {
      let last: DemandView | null = null;
      for (let i = 0; i < 8 && !off; i++) {
        try {
          const r = await fetch("/api/launch/demand", { method: "POST" });
          if (!r.ok) break;
          last = (await r.json()) as DemandView;
          if (off) return;
          setDemand(last);
          if (last.status !== "running") return;
          await sleep(1500);
        } catch {
          break;
        }
      }
      // Не досчитали за отведённые попытки — показываем грубую оценку; досчитаем при следующем заходе
      if (!off && last?.status === "running") setDemand({ ...last, status: "unavailable", note: "Wordstat отвечает долго — спрос досчитаем при следующем открытии страницы." });
    })();
    return () => { off = true; };
  }, [accKey]);

  async function saveBudget(raw: number) {
    // Поле и ползунок: не меньше минимума площадки и не больше потолка (сервер больше не примет)
    if (!Number.isFinite(raw) || raw <= 0) {
      setBudget(savedBudget);
      toast("Введите сумму числом, например 30000", "error");
      return;
    }
    let v = Math.round(raw);
    if (v > MAX_MONTHLY) {
      v = MAX_MONTHLY;
      toast(`Максимальный бюджет — ${rub(MAX_MONTHLY)} в месяц`, "error");
    } else if (v < minBudget) v = minBudget;
    setBudget(v);
    if (v === savedBudget) return;
    try {
      await api("PATCH", "/api/budget", { monthly: v });
      setSavedBudget(v);
      // Бюджет поменялся — объявления и правки остаются, сервер только пересчитывает недельные лимиты каналов
      if (plan) {
        const r = await api<{ plan: LaunchPlan | null }>("GET", "/api/launch/plan").catch(() => null);
        if (r?.plan) setPlan(r.plan);
      }
    } catch (e) {
      setBudget(savedBudget);
      toast((e as Error).message, "error");
    }
  }

  async function drawImages() {
    setPhase("images");
    // Объявления показываем сразу после текстов, картинки появляются порциями
    for (let i = 0; i < 40; i++) {
      const b = await api<{ plan: LaunchPlan; done?: boolean; ready?: number; total?: number }>("POST", "/api/launch/images");
      setPlan(b.plan);
      if (typeof b.ready === "number" && typeof b.total === "number") setImgProgress({ ready: b.ready, total: b.total });
      if (b.done !== false) break;
    }
    setImgProgress(null);
  }

  /** Перерисовать картинки с новыми фото: сервер сбрасывает только картинки, тексты и правки остаются */
  async function redrawImages() {
    try {
      setPhotosChanged(false);
      const r = await api<{ plan: LaunchPlan }>("PATCH", "/api/launch/plan", { redrawImages: true });
      setPlan(r.plan);
      await drawImages();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setPhase(null);
    }
  }

  async function prepare() {
    try {
      setPhase("copy");
      const a = await api<{ plan: LaunchPlan }>("POST", "/api/launch/copy");
      setPlan(a.plan);
      await drawImages();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setPhase(null);
    }
  }

  // Страницу закрыли, пока рисовались картинки, — продолжаем с того же места
  useEffect(() => {
    if (p.plan?.stage !== "images") return;
    drawImages().catch((e) => toast((e as Error).message, "error")).finally(() => setPhase(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function patchPlan(body: Record<string, unknown>): Promise<boolean> {
    try {
      const r = await api<{ plan: LaunchPlan }>("PATCH", "/api/launch/plan", body);
      setPlan(r.plan);
      return true;
    } catch (e) {
      toast((e as Error).message, "error");
      return false;
    }
  }

  /**
   * Запуск идёт по одному каналу за запрос (лимит времени функции на сервере). Повторяем, пока сервер не ответит done.
   * Запуск возобновляемый: обрыв сети, таймаут или «занято» (вторая вкладка, двойной клик) не создают дублей — просто ждём и продолжаем.
   */
  async function launch() {
    if (phase === "publish") return;
    autoResumed.current = true;
    setPhase("publish");
    setLaunchError(null);
    const deadline = Date.now() + 8 * 60_000;
    let retries = 0;
    try {
      for (;;) {
        let status = 0;
        let data: Partial<PublishStep> & { error?: string; already?: boolean } = {};
        try {
          const res = await fetch("/api/launch/publish", { method: "POST" });
          status = res.status;
          data = await res.json().catch(() => ({}));
        } catch {
          status = 0; // сеть
        }
        if (status === 200) {
          retries = 0;
          if (data.progress) setProgress(data.progress);
          if (!data.done) {
            if (Date.now() > deadline) throw new Error("Запуск занял дольше 8 минут. Обновите страницу — запуск продолжится сам, уже созданные кампании не задублируются.");
            // Все каналы созданы, но кампания не включилась — площадке нужно время, повторяем не сразу
            await sleep(data.progress && data.progress.finished >= data.progress.total ? 3000 : 500);
            continue;
          }
          const w = data.warnings ?? [];
          if (w.length) toast(`Запустили. Обратите внимание:\n${w.slice(0, 3).join("\n")}`);
          else toast("Реклама запущена и отправлена на модерацию");
          router.push("/app");
          router.refresh();
          return;
        }
        if (status === 409) {
          // Предыдущий шаг запуска ещё выполняется (или оборвался и держит блокировку до 75 с) — это не ошибка, ждём сами
          setWaitingLock(true);
          if (Date.now() > deadline) throw new Error("Запуск занял дольше 8 минут. Обновите страницу — запуск продолжится сам, уже созданные кампании не задублируются.");
          await sleep(5000);
          continue;
        }
        setWaitingLock(false);
        if (status === 0 || status >= 500) {
          if (++retries > 10 || Date.now() > deadline) throw new Error(data.error || "Сервер долго не отвечает. Обновите страницу — запуск продолжится сам, уже созданные кампании не задублируются.");
          await sleep(2500);
          continue;
        }
        throw new Error(data.error || `Ошибка ${status}`);
      }
    } catch (e) {
      setWaitingLock(false);
      toast("Запустить не получилось — причина внизу, у кнопки запуска", "error");
      setLaunchError((e as Error).message);
      setPhase(null);
      try {
        const r = await api<{ plan: LaunchPlan | null }>("GET", "/api/launch/plan");
        setPlan(r.plan);
        setProgress(progressOf(r.plan));
      } catch {
        /* оставим как есть */
      }
    }
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files).slice(0, 6)) {
        const dataUrl = await resizeToJpeg(f);
        await api("POST", "/api/photos", { dataUrl });
      }
      // Объявления и правки не трогаем: фото появятся в ленте, а картинки объявлений можно перерисовать кнопкой
      router.refresh();
      if (plan?.stage === "ready") setPhotosChanged(true);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const ready = plan?.stage === "ready";
  const enabledAds = plan?.channels.filter((c) => c.enabled).flatMap((c) => c.groups.flatMap((g) => g.ads.filter(publishable))).length ?? 0;
  const enabledChannels = plan?.channels.filter((c) => c.enabled && c.groups.some((g) => g.ads.some(publishable))).length ?? 0;
  const resuming = Boolean(plan?.launch);
  // Запуск прервался (закрыли вкладку, оборвалась сеть) — продолжаем сами при открытии страницы, без повторного нажатия.
  // Только если до этого не было ошибки: с ошибкой (нет денег, данные рекламодателя) повтор ничего не даст
  useEffect(() => {
    if (resuming && !autoResumed.current && !launchError && plan?.stage === "ready" && !(plan.launch?.failed.length)) {
      autoResumed.current = true;
      void launch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resuming]);
  const preparing = phase === "copy" || phase === "images";

  // Запросы по группам — когда объявления готовы. Нет эндпоинта (404) или ошибка — молча без блока
  const planKey = ready ? plan?.createdAt ?? "" : "";
  useEffect(() => {
    if (!planKey) return;
    let off = false;
    fetch("/api/launch/semantics", { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!off) setSemantics(d ? parseSemantics(d) : null); })
      .catch(() => { if (!off) setSemantics(null); });
    return () => { off = true; };
  }, [planKey]);
  const semKw = semantics?.reduce((n, g) => n + g.keywords.length, 0) ?? 0;

  // Одно главное действие этапа — внизу
  const action = !hasAccounts
    ? { label: "Подготовить объявления", icon: <Sparkles size={18} />, run: prepare, disabled: true, cls: "btn-primary", note: `Сначала подключите рекламный кабинет — Яндекс Директ или VK${p.flags.demo ? " (или демо)" : ""}.` }
    : !ready || preparing
      ? { label: phase === "copy" ? "Пишем тексты и подбираем запросы…" : phase === "images" ? "Готовим картинки…" : "Подготовить объявления", icon: preparing ? <Loader2 size={18} className="spin" /> : <Sparkles size={18} />, run: prepare, disabled: preparing, cls: "btn-primary", note: preparing ? "Обычно это занимает до минуты." : "Робот напишет объявления и подберёт запросы — до минуты. Перед запуском вы всё увидите и сможете поправить." }
      : { label: phase === "publish" ? "Создаём кампании…" : resuming ? "Продолжить запуск" : "Запустить рекламу", icon: phase === "publish" ? <Loader2 size={18} className="spin" /> : <Rocket size={18} />, run: launch, disabled: phase === "publish" || !enabledAds, cls: "btn-mark", note: enabledAds ? `${enabledAds} ${plural(enabledAds, "объявление", "объявления", "объявлений")} в ${enabledChannels} ${plural(enabledChannels, "канале", "каналах", "каналах")} ${plural(enabledAds, "уйдёт", "уйдут", "уйдут")} на модерацию.` : "Включите хотя бы одно объявление." };

  const photoStrip = (
    <div className="grid gap-2">
      <p className="text-sm text-muted leading-relaxed"><span className="font-semibold text-ink">Фото для объявлений с картинками</span> (необязательно). Лучше всего — настоящие: работа крупным планом, интерьер, мастер за работой. {p.flags.ai ? "Нет фото — сгенерируем по вашей нише." : ""}</p>
      <div className="flex flex-wrap gap-2.5">
          {p.photos.map((ph) => (
            <div key={ph.id} className="relative w-20 h-20 rounded-xl overflow-hidden border border-line group">
              <img src={`/api/images/${ph.id}`} alt="" className="w-full h-full object-cover" />
              {ph.kind === "generated" ? <span className="absolute left-1 bottom-1 pill bg-white/90 text-[10px]">ИИ</span> : null}
              <button className="absolute right-1 top-1 bg-white/90 rounded-md p-1 opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label="Удалить фото"
                onClick={async () => { try { await api("DELETE", `/api/photos/${ph.id}`); if (plan?.stage === "ready") setPhotosChanged(true); router.refresh(); } catch (e) { toast((e as Error).message, "error"); } }}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button className="w-20 h-20 rounded-xl border-2 border-dashed border-line-2 grid place-items-center text-muted hover:border-ink hover:text-ink" onClick={() => fileRef.current?.click()} disabled={uploading || !hasAccounts}>
            {uploading ? <Loader2 className="spin" /> : <span className="flex flex-col items-center gap-1 text-xs font-semibold"><ImagePlus size={22} />Добавить</span>}
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png" multiple hidden onChange={(e) => upload(e.target.files)} />
      </div>
      {photosChanged && ready && !phase ? (
        <div className="rounded-xl bg-info-soft p-3 text-sm flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0">Фото изменились. Картинки объявлений можно перерисовать с новыми фото — тексты и ваши правки останутся.</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={redrawImages}><ImagePlus size={15} /> Обновить картинки</button>
        </div>
      ) : null}
    </div>

  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <Section id="accounts" title="Кабинеты" done={hasAccounts} active>
        <p className="text-muted leading-relaxed">Реклама будет идти с ваших кабинетов — деньги на них вы пополняете сами, мы только управляем. Доступ можно отозвать в любой момент.</p>
        <div className="mt-4 grid grid-cols-[minmax(0,1fr)] sm:grid-cols-2 gap-3">
          {[
            { platform: "yandex", name: "Яндекс Директ", desc: "Поиск Яндекса, Карты, Дзен и тысячи сайтов", href: "/api/connect/yandex/start?back=/app/launch", on: p.flags.yandex },
            { platform: "vk", name: "VK Реклама", desc: "ВКонтакте, Одноклассники, Дзен", href: "/api/connect/vk/start?back=/app/launch", on: p.flags.vk },
          ].map((x) => {
            const acc = p.accounts.find((a) => a.platform === x.platform);
            return (
              <div key={x.platform} className="rounded-xl border border-line p-4 flex flex-col gap-3 min-w-0 [&_.btn]:max-w-full [&_.btn]:h-auto [&_.btn]:min-h-9 [&_.btn]:py-1.5 [&_.btn]:whitespace-normal [&_.btn]:text-left">
                <div>
                  <div className="font-bold">{x.name}</div>
                  <div className="text-sm text-muted">{x.desc}</div>
                </div>
                {acc ? (
                  <div className="grid gap-2">
                    <div className={`text-sm ${acc.status === "ok" ? "text-good" : "text-bad"}`}>
                      {acc.status === "ok" ? <><Check size={14} className="inline -mt-0.5" /> Подключён: {acc.login}</> : <>Ошибка: {acc.statusNote}</>}
                    </div>
                    {x.platform === "vk" && acc.status === "ok" ? <VkPixelSetup /> : null}
                  </div>
                ) : x.platform === "vk" ? (
                  <VkConnect oauth={x.on} back="/app/launch" compact />
                ) : x.on ? (
                  <a className="btn btn-primary btn-sm self-start" href={x.href}>Подключить</a>
                ) : (
                  <div className="text-sm text-faint">Скоро — подключение Яндекс Директа готовится</div>
                )}
              </div>
            );
          })}
        </div>
        {p.flags.demo && !real.length ? (
          <div className="mt-3 rounded-xl bg-info-soft p-4 flex flex-wrap items-center gap-3 justify-between">
            <div className="text-sm leading-relaxed max-w-lg">
              <b>Нет кабинета под рукой?</b> Подключите демо-кабинет: всё работает по-настоящему, но показы и обращения моделируются, а деньги не тратятся.
            </div>
            {p.accounts.some((a) => a.platform === "demo") ? (
              <span className="text-sm text-good font-semibold"><Check size={14} className="inline -mt-0.5" /> Демо-кабинет подключён</span>
            ) : (
              <button className="btn btn-mark btn-sm" onClick={async () => { await api("POST", "/api/connect/demo"); router.refresh(); }}>Подключить демо</button>
            )}
          </div>
        ) : null}
        {real.some((a) => a.platform === "yandex") ? (
          <p className="hint mt-3">Маркировка: если вы рекламируете свой бизнес со своего кабинета, Яндекс маркирует рекламу сам. Один раз заполните данные рекламодателя в кабинете Директа (раздел «Маркировка рекламы»).</p>
        ) : null}
      </Section>

      <Section id="demand" title="Спрос и запросы" done={demand?.status === "done"} active={hasAccounts} note={hasAccounts ? undefined : "После кабинета"}>
        {!hasAccounts ? (
          <p className="text-muted leading-relaxed text-sm">Подключите кабинет — соберём по Wordstat, сколько людей ищут ваши услуги в вашем городе, и только потом посчитаем бюджет и прогноз.</p>
        ) : !demand || demand.status === "running" ? (
          <div className="grid gap-2" aria-live="polite">
            <p className="font-semibold inline-flex items-center gap-2"><Loader2 size={16} className="spin shrink-0" /> Собираем запросы и спрос по Wordstat…</p>
            {demand?.progress.total ? (
              <div className="max-w-md">
                <div className="h-1.5 rounded-full bg-line overflow-hidden"><div className="h-full bg-ink rounded-full transition-all" style={{ width: `${Math.round((demand.progress.done / Math.max(demand.progress.total, 1)) * 100)}%` }} /></div>
                <div className="text-xs text-muted mt-1">{demand.progress.done} из {demand.progress.total} {plural(demand.progress.total, "фразы", "фраз", "фраз")} · отчёты Яндекса готовятся до минуты</div>
              </div>
            ) : null}
            <p className="text-sm text-muted leading-relaxed max-w-2xl">Сначала узнаём, сколько людей ищут ваши услуги и какими словами, — по этим данным считаем бюджет и прогноз ниже.</p>
          </div>
        ) : demand.status === "done" && demand.summary ? (
          <div className="grid gap-4" aria-live="polite">
            <div>
              <div className="text-sm text-ink-2">Спрос {demand.cityIn}</div>
              <div className="mt-0.5"><span className="text-3xl font-extrabold">~{approx(demand.summary.total)}</span> <span className="font-semibold">{plural(round2(demand.summary.total), "запрос", "запроса", "запросов")} в месяц</span></div>
              <p className="text-xs text-ink-2 mt-1 leading-relaxed max-w-2xl">
                {demand.source === "demo" ? <><b className="font-semibold">Демо-данные</b> — с кабинетом Директа здесь будет Wordstat.</> : <><b className="font-semibold text-good">Данные Wordstat</b> за прошлый месяц.</>}{" "}
                В итоге — только запросы об услугах и вашем специалисте, без «фото», «обучения» и других нецелевых; запросы о проблемах и похожих услугах показаны отдельно и в итог не входят.
                {countedSum > demand.summary.total * 1.05 ? " Итог — без пересечений: общий запрос уже включает свои уточнения, поэтому итог меньше суммы групп." : ""}
              </p>
              {demand.note ? <p className="text-xs text-muted mt-1">{demand.note}</p> : null}
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {(allGroups ? demandGroups : demandGroups.slice(0, 6)).map((g, i) => (
                <li key={i} className="rounded-xl border border-line p-3 min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="font-semibold min-w-0 [overflow-wrap:anywhere]">{g.name}</div>
                    <div className="text-sm font-semibold whitespace-nowrap">{g.demand === null ? <span className="text-faint font-normal">нет данных</span> : `~${approx(g.demand)} в мес.`}</div>
                  </div>
                  {g.layer !== "service" ? <div className="text-xs text-muted">{g.layer === "adjacent" && counted(g) ? "Ищут специалиста" : LAYER_ITEM[g.layer]}{counted(g) ? "" : " · не входит в итог"}</div> : null}
                  {g.top.length ? (
                    <ul className="mt-1.5 grid gap-0.5 text-xs text-ink-2">
                      {g.top.map((t) => (
                        <li key={t.phrase} className="flex justify-between gap-3"><span className={`min-w-0 truncate ${t.phrase.trim().split(/\s+/).length === 1 ? "text-faint line-through decoration-faint" : ""}`} title={t.phrase.trim().split(/\s+/).length === 1 ? "Слишком общий запрос: ищут фото и идеи, а не запись. Покупаем только при охвате «Широко»" : undefined}>{t.phrase}</span><span className="whitespace-nowrap text-muted">{fmt(t.shows)}</span></li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">Зачёркнуты слишком общие запросы («ногти», «маникюр»): по ним в основном ищут фото и идеи. Они показывают спрос, но покупать их робот не будет, если охват поиска не «Широко» (настройка в «Где, кому и когда показывать»).</p>
            {demand.summary.groups.length > 6 ? (
              <button type="button" className="btn btn-ghost btn-sm justify-self-start" onClick={() => setAllGroups(!allGroups)}>{allGroups ? "Свернуть" : `Показать все группы (${demand.summary.groups.length})`}</button>
            ) : null}
          </div>
        ) : (
          <div className="rounded-xl bg-warn-soft text-warn p-3 text-sm flex gap-2" aria-live="polite">
            <TriangleAlert size={16} className="shrink-0 mt-0.5" />
            <div className="grid gap-1">
              <b>Спрос по Wordstat получить не удалось.</b>
              <span>{demand.note ?? "Wordstat не вернул данных."}</span>
              <span className="text-ink-2">Запросы подберём по вашим услугам, а прогноз в бюджете ниже — грубая оценка по нише.</span>
            </div>
          </div>
        )}
      </Section>

      <Section id="budget" title="Бюджет в месяц" done={false} active={hasAccounts} note={hasAccounts ? undefined : "После кабинета"}>
        <div className="grid lg:grid-cols-[minmax(0,1fr)_20rem] gap-6">
          <div>
            <div className="flex items-end gap-3">
              <input
                type="number" inputMode="numeric" className="field w-44 text-2xl font-extrabold h-14" aria-label="Бюджет в месяц, рублей"
                min={minBudget} max={MAX_MONTHLY} step={1000} value={budget || ""} disabled={!hasAccounts}
                onChange={(e) => setBudget(Number(e.target.value))}
                onBlur={(e) => saveBudget(Number(e.target.value))}
              />
              <span className="pb-3 text-muted font-semibold">₽ в месяц</span>
            </div>
            <input
              type="range" min={Math.floor(minBudget / 1000) * 1000} max={100000} step={1000} value={Math.min(budget, 100000)} disabled={!hasAccounts}
              onChange={(e) => setBudget(Math.max(minBudget, Number(e.target.value)))} onMouseUp={(e) => saveBudget(Number((e.target as HTMLInputElement).value))} onTouchEnd={(e) => saveBudget(Number((e.target as HTMLInputElement).value))}
              onKeyUp={(e) => saveBudget(Number((e.target as HTMLInputElement).value))}
              className="w-full mt-4 accent-[#1d2045]" aria-label="Бюджет"
            />
            <div className="mt-4 grid gap-2">
              {alloc.allocation.map((a) => (
                <div key={a.channel} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[14rem_minmax(0,1fr)_6rem] items-center gap-x-3 gap-y-1 text-sm">
                  <div className="min-w-0">
                    <div className="font-semibold flex flex-wrap items-center gap-1.5">{CH[a.channel].name} <TypeBadge type={CHANNEL_INFO[a.channel].type} /></div>
                    <div className="text-muted text-xs">{CH[a.channel].hint}</div>
                  </div>
                  <div className="col-span-2 sm:col-span-1 sm:col-start-2 row-start-2 sm:row-start-1 h-2.5 rounded-full bg-paper overflow-hidden"><div className={`h-full ${isRetarget(a.channel) ? "bg-good/70" : "bg-ink"}`} style={{ width: `${a.share * 100}%` }} /></div>
                  <div className="text-right font-semibold whitespace-nowrap row-start-1 col-start-2 sm:col-start-3">{rub(a.weekly)}/нед</div>
                  {isRetarget(a.channel) ? <div className="col-span-2 sm:col-span-3 text-xs text-good">{RETARGET_NOTE}.</div> : null}
                </div>
              ))}
              {alloc.dropped.map((d) => (
                <div key={d} className="text-sm text-warn">«{CH[d].name}» — {isRetarget(d) ? "на минимум площадки не хватает бюджета, ретаргетинг добавится при бюджете побольше." : "при таком бюджете на нём не набрать данных для обучения — деньги разойдутся впустую. Начнём без него, добавим, когда бюджет вырастет."}</div>
              ))}
            </div>
          </div>
          <div className="rounded-xl bg-mark-soft p-4 self-start grid gap-3 min-w-0" aria-live="polite">
            {hasAccounts && (!demand || demand.status === "running") ? (
              <div className="text-sm text-ink-2 flex items-center gap-2 pb-3 border-b border-ink/10">
                <Loader2 size={14} className="spin shrink-0" />
                <span>Ждём спрос по Wordstat — пока грубая оценка</span>
              </div>
            ) : demandReady !== null && demand ? (
              <div className="pb-3 border-b border-ink/10 grid gap-2">
                <div className="text-sm text-ink-2">
                  Спрос {demand.cityIn}: <b className="text-ink">~{approx(demandReady)}</b> {plural(round2(demandReady), "запрос", "запроса", "запросов")} в месяц{" "}
                  <span className="text-xs">({demand.source === "demo" ? "демо-данные" : "Wordstat"})</span>
                </div>
                {rec && Math.abs(rec.monthly - budget) / Math.max(budget, 1) > 0.1 ? (
                  <div className="rounded-lg bg-white/70 p-3 grid gap-2">
                    <div className="text-sm leading-snug">
                      Чтобы забрать почти весь спрос на поиске, хватит <b className="whitespace-nowrap">~{fmt(rec.monthly)} ₽</b> в месяц{rec.monthly < budget ? " — сейчас поиску выделено больше, чем он потратит" : ""}.
                    </div>
                    <div className="text-xs text-ink-2 leading-relaxed">Спрос даст ~{span(rec.reachable)} {plural(rec.reachable[1], "клик", "клика", "кликов")}, в среднем ~{fmt(rec.clicks)} по ~{fmt(rec.cpc)} ₽ ≈ {approx(rec.search)} ₽ на поиск — его доля {Math.round(rec.share * 100)}% бюджета. Оценка.</div>
                    <button type="button" className="btn btn-primary btn-sm justify-self-start" onClick={() => saveBudget(rec.monthly)} disabled={!hasAccounts}>Поставить {fmt(rec.monthly)} ₽</button>
                  </div>
                ) : rec ? (
                  <div className="text-xs text-good font-semibold">Бюджет подходит под спрос: поиск заберёт почти весь спрос.</div>
                ) : null}
              </div>
            ) : null}
            <div>
              <div className="text-sm text-ink-2">Ожидаем за месяц</div>
              <div className="text-3xl font-extrabold mt-1">{fc.leads[1] < 1 ? "меньше 1" : span(fc.leads)}</div>
              <div className="font-semibold">{plural(fc.leads[1], "обращение", "обращения", "обращений")}</div>
              {fc.kind === "demand" ? (
                <>
                  <ul className="text-xs text-ink-2 mt-2 grid gap-1 leading-relaxed">
                    <li>Поиск: ~{span(fc.search.clicks)} {plural(fc.search.clicks[1], "клик", "клика", "кликов")} → {span(fc.search.leads)} {plural(fc.search.leads[1], "обращение", "обращения", "обращений")}</li>
                    {fc.other ? <li>{fc.other.channels.some((c) => c === "vk" || c === "retarget_vk") ? "РСЯ и ВКонтакте" : "РСЯ"}: {span(fc.other.leads)} — оценка по нише ({fmt(fc.other.cpl[0])}–{fmt(fc.other.cpl[1])} ₽ за обращение)</li> : null}
                  </ul>
                  <p className="text-xs text-ink-2 mt-2 leading-relaxed">При цене клика ~{fmt(fc.search.cpc[0])}–{fmt(fc.search.cpc[1])} ₽ и записи у {pct(fc.search.conv)} посетителей — оценка, уточнится после запуска по данным аукциона.</p>
                  <p className="text-xs font-semibold text-ink mt-2 leading-relaxed">
                    {fc.search.limit === "demand"
                      ? `Бюджет поиска выбирается не весь: спроса больше нет — уйдёт ~${fmt(fc.search.spend[0])}–${fmt(fc.search.spend[1])} ₽ из ${fmt(fc.search.budget)} ₽.`
                      : fc.search.limit === "budget"
                        ? "Спроса больше, чем позволяет бюджет: с бюджетом побольше поиск приведёт больше клиентов."
                        : "Бюджет поиска примерно совпадает со спросом."}
                  </p>
                </>
              ) : (
                <p className="text-xs text-ink-2 mt-2 leading-relaxed">
                  <b className="font-semibold">Грубая оценка по нише</b>, без данных о спросе: обращение обычно стоит {rub(fc.cpl[0])}–{rub(fc.cpl[1])}. Первые 1–2 недели дороже — робот учится, потом цена снижается.
                  {demand?.note && demand.status !== "running" ? <span className="block text-muted mt-1">{demand.note}</span> : null}
                </p>
              )}
            </div>
          </div>
        </div>
        <p className="hint mt-4">Бюджет — жёсткая граница: робот следит за расходами каждый день и не выйдет за неё. Пополнять кабинеты нужно самим, примерно на эту сумму в месяц. Все суммы — с НДС: в кабинете Директа недельные лимиты показываются без НДС, поэтому там они на 22% меньше.</p>
      </Section>

      <Section id="show" title="Где, кому и когда показывать" done={false} active={hasAccounts} note={hasAccounts ? "Можно оставить как есть" : "После кабинета"}>
        <ShowSettingsEditor monthlyBudget={budget} initial={p.show.initial} city={p.show.city} address={p.show.address} autoTime={p.show.autoTime} autoRadiusKm={p.show.autoRadiusKm} live={false} />
      </Section>

      <Section id="landing" title="Куда ведёт реклама" done={false} active={hasAccounts} note={hasAccounts ? "Можно оставить как есть" : "После кабинета"}>
        {p.landing.siteUrl && (p.landing.initial as { siteBad?: string }).siteBad === p.landing.siteUrl ? (
          <p className="mb-3 rounded-xl bg-warn-soft text-warn p-3 text-sm flex gap-2"><TriangleAlert size={16} className="shrink-0 mt-0.5" /><span>Сайт {p.landing.siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")} не открылся, когда мы его проверяли, — поэтому реклама ведёт на страницу записи. Проверьте адрес в разделе <a href="/app/start" className="underline">«О бизнесе»</a>.</span></p>
        ) : null}
        <LandingEditor initial={p.landing.initial} siteUrl={p.landing.siteUrl} pageUrl={p.landing.pageUrl} channels={channels} live={false} hasYandex={usable.some((a) => a.platform === "yandex")} />
      </Section>

      <Section id="ads" title="Объявления" done={ready && !preparing} active={hasAccounts} note={hasAccounts ? undefined : "После кабинета"}
        aside={ready && !preparing ? <button className="btn btn-ghost btn-sm" onClick={prepare} disabled={!!phase}><Sparkles size={15} /> Написать заново</button> : null}>
        {photoStrip}
        {phase === "images" && plan ? (
          <div className="mt-5 rounded-xl bg-paper px-4 py-3 text-sm flex items-center gap-3">
            <Loader2 size={16} className="spin shrink-0" />
            <div className="flex-1">
              <div className="font-semibold">Тексты готовы — рисуем картинки{imgProgress ? `: ${Math.round((imgProgress.ready / Math.max(imgProgress.total, 1)) * 100)}%` : "…"}</div>
              {imgProgress ? <div className="mt-1.5 h-1.5 rounded-full bg-line overflow-hidden"><div className="h-full bg-ink rounded-full transition-all" style={{ width: `${Math.round((imgProgress.ready / Math.max(imgProgress.total, 1)) * 100)}%` }} /></div> : null}
              <div className="text-muted text-xs mt-1">Объявления уже можно смотреть и править ниже — картинки появятся сами.</div>
            </div>
          </div>
        ) : null}
        {(!ready || preparing) && !(phase === "images" && plan) ? (
          <div className="mt-5 rounded-xl border-2 border-dashed border-line p-5 grid gap-1.5 justify-items-start">
            {preparing ? <p className="font-semibold inline-flex items-center gap-2"><Loader2 size={16} className="spin" /> {phase === "copy" ? "Пишем тексты и подбираем запросы…" : "Готовим картинки…"}</p> : <p className="font-semibold">Здесь появятся объявления</p>}
            <p className="text-muted leading-relaxed text-sm max-w-xl">Робот напишет объявления для каждого канала, подберёт поисковые запросы и минус-слова, сделает картинки. Каждое объявление проверяет свою идею — какая сработает лучше, покажет статистика.{!preparing && hasAccounts ? " Нажмите «Подготовить объявления» внизу." : ""}</p>
          </div>
        ) : plan ? (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 mt-5">
            {semantics ? (
              <details className="rounded-xl bg-paper px-4 py-3 text-sm">
                <summary className="cursor-pointer font-semibold inline-flex items-center gap-2"><Search size={15} /> Поиск: {semantics.length} {plural(semantics.length, "группа", "группы", "групп")}, {semKw} {plural(semKw, "запрос", "запроса", "запросов")}</summary>
                <ul className="mt-3 grid gap-2.5">
                  {semantics.map((g, gi) => (
                    <li key={gi}>
                      {g.layer && (gi === 0 || semantics[gi - 1].layer !== g.layer) ? (
                        <div className={`text-xs uppercase tracking-wide text-faint font-semibold ${gi ? "mt-2" : ""}`}>
                          {g.layer} · {semantics.filter((x) => x.layer === g.layer).length} {plural(semantics.filter((x) => x.layer === g.layer).length, "группа", "группы", "групп")}, {semantics.filter((x) => x.layer === g.layer).reduce((n, x) => n + x.keywords.length, 0)} {plural(semantics.filter((x) => x.layer === g.layer).reduce((n, x) => n + x.keywords.length, 0), "запрос", "запроса", "запросов")}
                        </div>
                      ) : null}
                      <div className="font-semibold">{g.name} <span className="font-normal text-muted">· {g.keywords.length}{typeof g.demand === "number" ? ` · ~${approx(g.demand)} в мес.` : ""}</span></div>
                      <div className="text-muted leading-relaxed [overflow-wrap:anywhere]">{g.keywords.join(", ")}</div>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {plan.warnings.some((w) => w.startsWith("Медицинские услуги")) ? <MedicalLicenseGuide service={p.biz.services?.[0]?.name} legalInfo={p.legalInfo} address={p.biz.address ? `${p.biz.city}, ${p.biz.address}` : null} /> : null}
            {plan.warnings.filter((w) => !w.startsWith("Медицинские услуги")).length ? (
              <div className="rounded-xl bg-warn-soft text-warn p-3 text-sm flex gap-2"><TriangleAlert size={16} className="shrink-0 mt-0.5" /><div>{plan.warnings.filter((w) => !w.startsWith("Медицинские услуги")).map((w) => <div key={w}>{w}</div>)}</div></div>
            ) : null}
            <PlanManager plan={plan} names={CH} platformNames={PLATFORM} biz={p.biz} host={p.host} href={p.href} logo={p.logo} businessName={p.business.name} vkRadiusKm={p.vkRadiusKm ?? null}
              onPatch={patchPlan} onEdit={(ad, channel) => setEdit({ ad, channel })}
              onRewrite={(channel) => setRewriteFor(channel)}
              onUndoRewrite={async (channel) => {
                try {
                  const r = await api<{ plan: LaunchPlan }>("POST", "/api/launch/plan/rewrite", { channel, undo: true });
                  setPlan(r.plan);
                  toast("Вернули прежние тексты");
                } catch (e) {
                  toast((e as Error).message, "error");
                }
              }}
              onAddAd={async (groupId) => {
                try {
                  const r = await api<{ plan: LaunchPlan; ad: PlanAd }>("POST", "/api/launch/plan/ad", { groupId });
                  setPlan(r.plan);
                  toast(r.ad.enabled ? "Робот добавил новое объявление" : "Добавили выключенным: в группе Директа работают 3 объявления — выключите одно, чтобы включить новое");
                } catch (e) {
                  toast((e as Error).message, "error");
                }
              }}
              onNewAd={(groupId, channel) => setNewAd({ groupId, channel })} />
          </div>
        ) : null}
      </Section>

      <Section id="launch" title="Запуск" done={false} active={ready && !preparing} note={ready ? undefined : "После объявлений"}>
        <ul className="grid gap-2 text-[0.95rem]">
          {enabledAds ? (
            <li className="flex gap-2"><Check size={18} className="text-good shrink-0 mt-0.5" /> {enabledAds} {plural(enabledAds, "объявление", "объявления", "объявлений")} в {enabledChannels} {plural(enabledChannels, "канале", "каналах", "каналах")} {plural(enabledAds, "уйдёт", "уйдут", "уйдут")} на модерацию — обычно это занимает несколько часов.</li>
          ) : (
            <li className="flex gap-2 text-muted"><span className="w-[18px] h-[18px] rounded-full border border-line-2 shrink-0 mt-0.5" /> Объявления уйдут на модерацию сразу после запуска — обычно это занимает несколько часов.</li>
          )}
          {plan?.channels.some((c) => c.enabled && isRetarget(c.channel)) ? (
            <li className="flex gap-2"><Check size={18} className="text-good shrink-0 mt-0.5" /> Ретаргетинг создадим сразу, но показы он начнёт сам — когда наберётся {RETARGET_MIN_AUDIENCE} человек, которые были на сайте и не записались. До этого деньги на него не тратятся.</li>
          ) : null}
          <li className="flex gap-2"><Check size={18} className="text-good shrink-0 mt-0.5" /> Первые 3 дня робот только наблюдает и копит статистику. Потом начнёт отключать слабое и тестировать новое.</li>
          <li className="flex gap-2"><Check size={18} className="text-good shrink-0 mt-0.5" />
            {(() => {
              const l = landingFor({ siteUrl: p.landing.siteUrl, publicKey: "x", landing: p.landing.initial }, null);
              if (l.kind === "page" && (p.landing.initial as { noCode?: boolean }).noCode)
                return <span>Объявления будут вести на вашу страницу записи — обращения с неё считаются автоматически. На сайт не ведём, потому что на нём пока нет кода Самохода: без него не видно заявок. Поставите код — переключите рекламу на сайт в «Настройках».</span>;
              if (l.kind === "page") return <span>Объявления будут вести на вашу страницу записи — обращения с неё считаются автоматически.</span>;
              if (l.kind === "site")
                return p.landing.siteCode === "ok" ? (
                  <span>Объявления будут вести на ваш сайт. Код Самохода на нём стоит — обращения с сайта будут считаться.</span>
                ) : (
                  <span className="block rounded-xl bg-warn-soft text-ink p-3">
                    <b className="text-warn">Код на сайте не установлен — обращений видно не будет.</b> Мы увидим клики и визиты, но не заявки и звонки с сайта: цену клиента не посчитаем, а робот будет улучшать рекламу только по визитам. Лучше пока вести рекламу на страницу записи (выше, «Куда ведёт реклама») — там обращения считаются сами — или сначала поставить код.
                    <a href="/app/settings?tab=site#site" className="block mt-1.5 font-semibold underline underline-offset-2">Инструкция и код для сайта →</a>
                  </span>
                );
              return <span>Объявления будут вести на {l.label}. Заявки там мы не видим — считаем переходы, а записи отмечайте раз в неделю в «Статистике».</span>;
            })()}
          </li>
        </ul>
        {resuming && phase !== "publish" ? (
          <div className="mt-4 rounded-xl bg-warn-soft text-warn p-3 text-sm flex gap-2" role="status">
            <TriangleAlert size={16} className="shrink-0 mt-0.5" />
            <div>Запуск прервался на середине — продолжаем сами. Уже созданные кампании не задублируются, недосозданные пересоздадим.</div>
          </div>
        ) : null}
        {progress && (phase === "publish" || resuming) ? (
          <ul className="mt-4 grid gap-1.5 text-sm" aria-live="polite">
            {progress.channels.map((c, i) => {
              const current = phase === "publish" && c.state === "pending" && progress.channels.findIndex((x) => x.state === "pending") === i;
              return (
                <li key={c.channel} className="flex items-center gap-2">
                  {c.state === "done" ? <Check size={16} className="text-good" /> : c.state === "failed" ? <TriangleAlert size={16} className="text-bad" /> : current ? <Loader2 size={16} className="spin" /> : <span className="w-4 h-4 rounded-full border border-line-2 inline-block" />}
                  <span className={c.state === "pending" && !current ? "text-muted" : ""}>{CH[c.channel].name}</span>
                  <span className="text-muted">{c.state === "done" ? "— создана" : c.state === "failed" ? "— не получилось" : current ? "— создаём…" : "— в очереди"}</span>
                </li>
              );
            })}
          </ul>
        ) : null}
        {waitingLock && phase === "publish" ? <p className="hint mt-2 flex items-center gap-1.5"><Loader2 size={14} className="spin" /> Предыдущий шаг запуска ещё выполняется — ждём его и продолжаем сами, нажимать ничего не нужно.</p> : null}
        {phase === "publish" && !progress ? <p className="hint mt-2">Создаём кампании по очереди, это может занять пару минут. Показы включим все разом, когда создадим всё, — до этого деньги не тратятся. Если закроете страницу, робот доведёт запуск сам.</p> : null}
      </Section>

      {/* Одна главная кнопка этапа — прилипает к низу экрана */}
      <div className="sticky bottom-[3.375rem] md:bottom-0 z-30 -mx-4 px-4 sm:mx-0 sm:px-0 pt-4 pb-2 md:pb-4 bg-linear-to-t from-paper from-65% to-paper/0">
        {launchError ? <LaunchErrorBox text={launchError} onClose={() => setLaunchError(null)} /> : null}
        <div className="card shadow-lg px-4 py-3 sm:px-5 grid gap-2.5 sm:flex sm:items-center sm:gap-4">
          <p className="min-w-0 flex-1 text-sm text-ink-2 leading-snug">{action.note}</p>
          <button className={`btn ${action.cls} h-12 px-6 text-base shrink-0`} onClick={action.run} disabled={action.disabled}>
            {action.icon}
            {action.label}
          </button>
        </div>
      </div>

      <EditAdModal edit={edit} onClose={() => setEdit(null)} onSave={async (v) => {
        // Ошибку (например, «слишком длинно») показывает сама форма — не всплывашкой
        const r = await api<{ plan: LaunchPlan }>("PATCH", "/api/launch/plan", { adId: edit!.ad.id, ...v });
        setPlan(r.plan);
        setEdit(null);
      }} />
      <EditAdModal title="Новое объявление" edit={newAd ? { ad: { title: "", title2: "", text: "" }, channel: newAd.channel } : null} onClose={() => setNewAd(null)}
        onSave={async (v) => {
          const r = await api<{ plan: LaunchPlan; ad: PlanAd }>("POST", "/api/launch/plan/ad", { groupId: newAd!.groupId, ...v });
          setPlan(r.plan);
          setNewAd(null);
          toast(r.ad.enabled ? "Объявление добавлено" : "Добавили выключенным: в группе Директа работают 3 объявления — выключите одно, чтобы включить новое");
        }} />
      <RewriteModal channel={rewriteFor} name={rewriteFor ? CH[rewriteFor].name : ""} ads={plan?.channels.find((c) => c.channel === rewriteFor)?.groups.flatMap((g) => g.ads) ?? []}
        onClose={() => setRewriteFor(null)} onPlan={setPlan} />
    </div>
  );
}

/** Те же лимиты, что проверяет сервер (validateAdText) */
const LIM: Record<AdFormat, { title: number; title2: number; text: number }> = LIMITS;

const WISHES = ["Живее и проще", "Понятнее, что за услуга", "Больше про результат для клиента", "Упор на цену", "Короче", "Без канцелярита"];

/** «Переписать тексты» канала по пожеланию: идёт порциями, показываем прогресс; вернуть прежние — в списке объявлений */
/** Текст объявления — владельца: написал сам или поправил (метка edited ставится сервером при правке) */
const ownText = (a: PlanAd) => a.angle === "custom" || Boolean((a as PlanAd & { edited?: boolean }).edited);

function RewriteModal({ channel, name, ads, onClose, onPlan }: { channel: Channel | null; name: string; ads: PlanAd[]; onClose: () => void; onPlan: (p: LaunchPlan) => void }) {
  const [wish, setWish] = useState("");
  /** «Ваши правки тоже переписать?» — по умолчанию нет */
  const [withOwn, setWithOwn] = useState(false);
  const on = ads.filter((a) => a.enabled);
  const own = on.filter(ownText).length;
  const off = ads.length - on.length;
  const count = withOwn ? on.length : on.length - own;
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const toast = useToast();
  async function run() {
    if (!channel) return;
    setBusy({ done: 0, total: count });
    try {
      let start = true;
      for (let i = 0; i < 20; i++) {
        const r = await api<{ plan: LaunchPlan; done: boolean; progress: { done: number; total: number }; changed: number; failed: number; ai: boolean }>("POST", "/api/launch/plan/rewrite", { channel, wish, start, includeEdited: withOwn });
        start = false;
        onPlan(r.plan);
        setBusy(r.progress);
        if (r.done) {
          if (!r.ai && wish.trim()) toast("Генерация текстов не подключена — подобрали другие проверенные формулировки, но пожелание учесть не смогли. Точечно поправить можно карандашом", "error");
          else toast(r.failed ? `Переписали ${r.progress.total - r.failed} из ${r.progress.total}. Остальные оставили как были — новый вариант не прошёл проверку фактов` : `Переписали ${r.progress.total} ${plural(r.progress.total, "объявление", "объявления", "объявлений")}`);
          setWish("");
          setWithOwn(false);
          onClose();
          return;
        }
      }
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }
  return (
    <Modal open={!!channel} onClose={() => { if (!busy) onClose(); }} title={`Переписать тексты — ${name}`}>
      <div className="grid gap-4">
        <p className="text-sm text-muted">
          Робот перепишет {count} {plural(count, "включённое объявление", "включённых объявления", "включённых объявлений")} канала. Картинки, аудитории и идея каждого объявления останутся. Не понравится — верните прежние тексты одной кнопкой.
          {off ? ` Выключенные (${off}) не трогаем.` : ""}
        </p>
        {own ? (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={withOwn} onChange={(e) => setWithOwn(e.target.checked)} disabled={!!busy} />
            <span>Ваши правки тоже переписать? <span className="text-muted">{own} {plural(own, "объявление написали или поправили вы", "объявления написали или поправили вы", "объявлений написали или поправили вы")} — без галочки оставим как есть.</span></span>
          </label>
        ) : null}
        <div>
          <label className="label" htmlFor="wish">Что изменить?</label>
          <textarea id="wish" className="field" rows={3} maxLength={300} placeholder="Например: проще, больше про боль в спине и шее, упомянуть приём для детей" value={wish} onChange={(e) => setWish(e.target.value)} disabled={!!busy} />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {WISHES.map((w) => (
              <button key={w} type="button" disabled={!!busy} className="pill px-3 py-1 border border-line text-sm hover:border-ink"
                onClick={() => setWish((x) => (x.trim() ? `${x.trim().replace(/[.,;]$/, "")}, ${w.toLowerCase()}` : w))}>{w}</button>
            ))}
          </div>
        </div>
        {busy ? (
          <div className="grid gap-1.5" role="status">
            <div className="text-sm text-muted">Переписываем… {busy.done} из {busy.total}</div>
            <div className="h-1.5 rounded-full bg-paper overflow-hidden"><div className="h-full bg-ink transition-all" style={{ width: `${busy.total ? Math.max(5, (busy.done / busy.total) * 100) : 5}%` }} /></div>
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose} disabled={!!busy}>Отмена</button>
          <button className="btn btn-primary" onClick={run} disabled={!!busy || !count}>{busy ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />} Переписать</button>
        </div>
      </div>
    </Modal>
  );
}

export function EditAdModal({ edit, onClose, onSave, title = "Текст объявления" }: { edit: { ad: { title: string; title2?: string | null; text: string }; channel: Channel } | null; onClose: () => void; onSave: (v: { title: string; title2: string; text: string }) => Promise<void>; title?: string }) {
  const [v, setV] = useState({ title: "", title2: "", text: "" });
  const [busy, setBusy] = useState(false);
  /** Ошибка сохранения — в самой форме (а не всплывашкой, которая висит и после удачного сохранения) */
  const [err, setErr] = useState<string | null>(null);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const key = edit ? `${(edit.ad as { id?: string }).id ?? ""}|${edit.ad.title}|${edit.ad.text}` : null;
  // Закрыли без сохранения — при следующем открытии показываем текст объявления, а не брошенный черновик
  if (!edit && lastKey !== null) setLastKey(null);
  if (edit && key !== lastKey) {
    setLastKey(key);
    setErr(null);
    setV({ title: edit.ad.title, title2: edit.ad.title2 ?? "", text: edit.ad.text });
  }
  const change = (next: typeof v) => {
    setV(next);
    setErr(null);
  };
  const L = edit ? LIM[formatOf(edit.channel)] : LIM.search;
  const counter = (s: string, max: number) => <span className={`text-xs ${s.length > max ? "text-bad" : "text-faint"}`}>{s.length}/{max}</span>;
  return (
    <Modal open={!!edit} onClose={onClose} title={title}>
      <div className="grid gap-4">
        <div>
          <div className="flex justify-between"><label className="label" htmlFor="t1">Заголовок</label>{counter(v.title, L.title)}</div>
          <input id="t1" className="field" value={v.title} onChange={(e) => change({ ...v, title: e.target.value })} />
        </div>
        {edit?.channel === "search" ? (
          <div>
            <div className="flex justify-between"><label className="label" htmlFor="t2">Второй заголовок</label>{counter(v.title2, L.title2)}</div>
            <input id="t2" className="field" value={v.title2} onChange={(e) => change({ ...v, title2: e.target.value })} />
          </div>
        ) : null}
        <div>
          <div className="flex justify-between"><label className="label" htmlFor="tx">Текст</label>{counter(v.text, L.text)}</div>
          <textarea id="tx" className="field" rows={3} value={v.text} onChange={(e) => change({ ...v, text: e.target.value })} />
        </div>
        <p className="hint">Площадки не пропускают «лучший», «№1», капслок и обещания, которые нельзя проверить.</p>
        {err ? <p role="alert" className="rounded-lg bg-bad-soft text-bad px-3 py-2 text-sm">{err}</p> : null}
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn btn-primary" disabled={busy || !v.title.trim() || !v.text.trim() || v.title.length > L.title || v.text.length > L.text || v.title2.length > L.title2}
            onClick={async () => { setBusy(true); setErr(null); try { await onSave(v); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }}>
            {busy ? <Loader2 size={16} className="spin" /> : null}Сохранить
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Причина неудачного запуска и что сделать: самые частые случаи узнаём по тексту ошибки площадки */
function LaunchErrorBox({ text, onClose }: { text: string; onClose: () => void }) {
  const t = text.toLowerCase();
  const hints: { test: boolean; title: string; body: React.ReactNode }[] = [
    {
      test: /рекламодател|маркир|о рекламе|ерир|ord|advertiser/.test(t),
      title: "Заполните данные рекламодателя в Директе",
      body: <>По закону «О рекламе» Директ не отправляет объявления на модерацию, пока в кабинете не указаны данные рекламодателя. Откройте <a className="underline" href="https://direct.yandex.ru/" target="_blank" rel="noreferrer">кабинет Директа</a> → красная надпись «укажите данные для соблюдения закона „О рекламе“» под логином → заполните и сохраните. Потом нажмите «Запустить рекламу» ещё раз.</>,
    },
    {
      test: /лицензи/.test(t),
      title: "Нужна медицинская лицензия",
      body: <>Загрузите копию лицензии в кабинете площадки (подробности — в блоке про медицинские услуги выше) и запустите ещё раз.</>,
    },
    {
      test: /оферт|услови|не подключ|513/.test(t),
      title: "Примите условия Директа",
      body: <>Откройте <a className="underline" href="https://direct.yandex.ru/" target="_blank" rel="noreferrer">direct.yandex.ru</a>, нажмите «Начать» и примите условия. Потом запустите ещё раз.</>,
    },
  ].filter((h) => h.test);
  return (
    <div role="alert" className="card mb-2 px-4 py-3 sm:px-5 border-bad/30 bg-bad-soft text-sm leading-relaxed">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-bad">Реклама не запустилась</div>
          {hints.map((h) => (
            <div key={h.title} className="mt-1.5"><b>{h.title}.</b> {h.body}</div>
          ))}
          <details className="mt-1.5" open={!hints.length}>
            <summary className="cursor-pointer text-ink-2">Ответ площадки</summary>
            <div className="mt-1 whitespace-pre-line break-words text-ink-2">{text}</div>
          </details>
          <div className="mt-1.5 text-ink-2">Созданные черновики кампаний не задублируются: при следующем запуске сервис уберёт их и создаст заново.</div>
        </div>
        <button type="button" onClick={onClose} className="text-ink-2 hover:text-ink shrink-0" aria-label="Скрыть">✕</button>
      </div>
    </div>
  );
}

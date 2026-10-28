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
import { allocate, forecast, minMonthlyFor } from "@/lib/engine/budget";
import type { LaunchPlan, PlanAd, PublishStep } from "@/lib/engine/launch";
import type { Channel } from "@/lib/platforms/types";
import { CHANNEL_INFO, formatOf, isRetarget, RETARGET_MIN_AUDIENCE, type AdFormat } from "@/lib/channels";
import { TypeBadge } from "./CampaignNav";

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
type Progress = PublishStep["progress"];

function progressOf(plan: LaunchPlan | null): Progress | null {
  const l = plan?.launch;
  if (!plan || !l) return null;
  const wanted = plan.channels.filter((c) => c.enabled && c.groups.some((g) => g.ads.some(publishable)));
  const channels = wanted.map((c) => ({ channel: c.channel, state: l.done.includes(c.channel) ? ("done" as const) : l.failed.includes(c.channel) ? ("failed" as const) : ("pending" as const) }));
  return { total: channels.length, finished: channels.filter((c) => c.state !== "pending").length, channels };
}

type Props = {
  business: { name: string; niche: string; monthlyBudget: number; siteUrl: string | null };
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
  landing: { initial: LandingSettings; siteUrl: string | null; pageUrl: string };
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
type Semantics = { name: string; keywords: string[]; layer?: string }[];
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
    if (name || kw.length) out.push({ name: name || "Без названия", keywords: kw, ...(layer ? { layer } : {}) });
  }
  return out.length ? out : null;
}

export function LaunchWizard(p: Props) {
  const router = useRouter();
  const toast = useToast();
  const [plan, setPlan] = useState<LaunchPlan | null>(p.plan);
  const [budget, setBudget] = useState(p.business.monthlyBudget);
  const [savedBudget, setSavedBudget] = useState(p.business.monthlyBudget);
  const [phase, setPhase] = useState<null | "copy" | "images" | "publish">(null);
  const [imgProgress, setImgProgress] = useState<{ ready: number; total: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [edit, setEdit] = useState<{ ad: PlanAd; channel: Channel } | null>(null);
  /** Новое объявление «написать самому»: та же форма, что и правка */
  const [newAd, setNewAd] = useState<{ groupId: string; channel: Channel } | null>(null);
  const [rewriteFor, setRewriteFor] = useState<Channel | null>(null);
  const [progress, setProgress] = useState<Progress | null>(() => progressOf(p.plan));
  const fileRef = useRef<HTMLInputElement>(null);
  const [semantics, setSemantics] = useState<Semantics | null>(null);

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
  // Если в плане канал выключен, его доля уходит оставшимся — показываем ту же раскладку, что получит запуск
  const planChannels = plan?.channels.filter((c) => c.enabled).map((c) => c.channel) ?? [];
  const alloc = allocate(budget, planChannels.length && budget === savedBudget ? planChannels : channels.length ? channels : ["search"]);
  const fc = forecast(budget, p.business.niche);
  const minBudget = minMonthlyFor(channels.length ? channels : ["search"]);
  const hasAccounts = usable.length > 0;

  async function saveBudget(v: number) {
    setBudget(v);
    try {
      await api("PATCH", "/api/budget", { monthly: v });
      setSavedBudget(v);
      if (plan) setPlan(null); // бюджет поменялся — объявления и каналы пересоберём
    } catch (e) {
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
    setPhase("publish");
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
          if (!data.done) continue;
          const w = data.warnings ?? [];
          if (w.length) toast(`Запустили. Обратите внимание:\n${w.slice(0, 3).join("\n")}`);
          else toast("Реклама запущена и отправлена на модерацию");
          router.push("/app");
          router.refresh();
          return;
        }
        if (status === 409 || status === 0 || status >= 500) {
          if (++retries > 10 || Date.now() > deadline) throw new Error(data.error || "Сервер долго не отвечает. Обновите страницу и нажмите «Продолжить запуск» — уже созданные кампании не задублируются.");
          await sleep(status === 409 ? 4000 : 2500);
          continue;
        }
        throw new Error(data.error || `Ошибка ${status}`);
      }
    } catch (e) {
      toast((e as Error).message, "error");
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
      router.refresh();
      setPlan(null);
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
    ? { label: "Подготовить объявления", icon: <Sparkles size={18} />, run: prepare, disabled: true, cls: "btn-primary", note: "Сначала подключите рекламный кабинет — Яндекс Директ, VK или демо." }
    : !ready || preparing
      ? { label: phase === "copy" ? "Пишем тексты и подбираем запросы…" : phase === "images" ? "Готовим картинки…" : "Подготовить объявления", icon: preparing ? <Loader2 size={18} className="spin" /> : <Sparkles size={18} />, run: prepare, disabled: preparing, cls: "btn-primary", note: preparing ? "Обычно это занимает до минуты." : "Робот напишет объявления и подберёт запросы — до минуты. Перед запуском вы всё увидите и сможете поправить." }
      : { label: phase === "publish" ? "Создаём кампании…" : resuming ? "Продолжить запуск" : "Запустить рекламу", icon: phase === "publish" ? <Loader2 size={18} className="spin" /> : <Rocket size={18} />, run: launch, disabled: phase === "publish" || !enabledAds, cls: "btn-mark", note: enabledAds ? `${enabledAds} ${plural(enabledAds, "объявление", "объявления", "объявлений")} в ${enabledChannels} ${plural(enabledChannels, "канале", "каналах", "каналах")} уйдут на модерацию.` : "Включите хотя бы одно объявление." };

  const photoStrip = (
    <div className="grid gap-2">
      <p className="text-sm text-muted leading-relaxed"><span className="font-semibold text-ink">Фото для объявлений с картинками</span> (необязательно). Лучше всего — настоящие: работа крупным планом, интерьер, мастер за работой. {p.flags.ai ? "Нет фото — сгенерируем по вашей нише." : ""}</p>
      <div className="flex flex-wrap gap-2.5">
          {p.photos.map((ph) => (
            <div key={ph.id} className="relative w-20 h-20 rounded-xl overflow-hidden border border-line group">
              <img src={`/api/images/${ph.id}`} alt="" className="w-full h-full object-cover" />
              {ph.kind === "generated" ? <span className="absolute left-1 bottom-1 pill bg-white/90 text-[10px]">ИИ</span> : null}
              <button className="absolute right-1 top-1 bg-white/90 rounded-md p-1 opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label="Удалить фото"
                onClick={async () => { try { await api("DELETE", `/api/photos/${ph.id}`); setPlan(null); router.refresh(); } catch (e) { toast((e as Error).message, "error"); } }}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button className="w-20 h-20 rounded-xl border-2 border-dashed border-line-2 grid place-items-center text-muted hover:border-ink hover:text-ink" onClick={() => fileRef.current?.click()} disabled={uploading || !hasAccounts}>
            {uploading ? <Loader2 className="spin" /> : <span className="flex flex-col items-center gap-1 text-xs font-semibold"><ImagePlus size={22} />Добавить</span>}
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png" multiple hidden onChange={(e) => upload(e.target.files)} />
      </div>
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
              <div key={x.platform} className="rounded-xl border border-line p-4 flex flex-col gap-3">
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

      <Section id="budget" title="Бюджет в месяц" done={false} active={hasAccounts} note={hasAccounts ? undefined : "После кабинета"}>
        <div className="grid lg:grid-cols-[1fr_17rem] gap-6">
          <div>
            <div className="flex items-end gap-3">
              <input
                type="number" inputMode="numeric" className="field w-44 text-2xl font-extrabold h-14" aria-label="Бюджет в месяц, рублей"
                min={minBudget} step={1000} value={budget} disabled={!hasAccounts}
                onChange={(e) => setBudget(Number(e.target.value))}
                onBlur={(e) => saveBudget(Math.max(minBudget, Number(e.target.value) || minBudget))}
              />
              <span className="pb-3 text-muted font-semibold">₽ в месяц</span>
            </div>
            <input
              type="range" min={Math.min(minBudget, 3000)} max={100000} step={1000} value={Math.min(budget, 100000)} disabled={!hasAccounts}
              onChange={(e) => setBudget(Number(e.target.value))} onMouseUp={(e) => saveBudget(Number((e.target as HTMLInputElement).value))} onTouchEnd={(e) => saveBudget(Number((e.target as HTMLInputElement).value))}
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
                <div key={d} className="text-sm text-warn">«{CH[d].name}» — {isRetarget(d) ? "на минимум площадки не хватает бюджета, ретаргетинг добавится при бюджете побольше." : "не хватает бюджета, начнём без этого канала."}</div>
              ))}
            </div>
          </div>
          <div className="rounded-xl bg-mark-soft p-4 self-start">
            <div className="text-sm text-ink-2">Ожидаем за месяц</div>
            <div className="text-3xl font-extrabold mt-1">{fc.min}–{fc.max}</div>
            <div className="font-semibold">обращений</div>
            <p className="text-xs text-ink-2 mt-2 leading-relaxed">Оценка по нише: обращение обычно стоит {rub(fc.cplLo)}–{rub(fc.cplHi)}. Первые 1–2 недели дороже — робот учится, потом цена снижается.</p>
          </div>
        </div>
        <p className="hint mt-4">Бюджет — жёсткая граница: робот следит за расходами каждый день и не выйдет за неё. Пополнять кабинеты нужно самим, примерно на эту сумму в месяц.</p>
      </Section>

      <Section id="show" title="Где, кому и когда показывать" done={false} active={hasAccounts} note={hasAccounts ? "Можно оставить как есть" : "После кабинета"}>
        <ShowSettingsEditor initial={p.show.initial} city={p.show.city} address={p.show.address} autoTime={p.show.autoTime} autoRadiusKm={p.show.autoRadiusKm} live={false} />
      </Section>

      <Section id="landing" title="Куда ведёт реклама" done={false} active={hasAccounts} note={hasAccounts ? "Можно оставить как есть" : "После кабинета"}>
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
                      <div className="font-semibold">{g.name} <span className="font-normal text-muted">· {g.keywords.length}</span></div>
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
          <li className="flex gap-2"><Check size={18} className="text-good shrink-0 mt-0.5" /> {enabledAds} {plural(enabledAds, "объявление", "объявления", "объявлений")} в {enabledChannels} {plural(enabledChannels, "канале", "каналах", "каналах")} {enabledAds === 1 ? "уйдёт" : "уйдут"} на модерацию — обычно это занимает несколько часов.</li>
          {plan?.channels.some((c) => c.enabled && isRetarget(c.channel)) ? (
            <li className="flex gap-2"><Check size={18} className="text-good shrink-0 mt-0.5" /> Ретаргетинг создадим сразу, но показы он начнёт сам — когда наберётся {RETARGET_MIN_AUDIENCE} человек, которые были на сайте и не записались. До этого деньги на него не тратятся.</li>
          ) : null}
          <li className="flex gap-2"><Check size={18} className="text-good shrink-0 mt-0.5" /> Первые 3 дня робот только наблюдает и копит статистику. Потом начнёт отключать слабое и тестировать новое.</li>
          <li className="flex gap-2"><Check size={18} className="text-good shrink-0 mt-0.5" />
            {(() => {
              const l = landingFor({ siteUrl: p.landing.siteUrl, publicKey: "x", landing: p.landing.initial }, null);
              if (l.kind === "page") return <span>Объявления будут вести на вашу страницу записи — обращения с неё считаются автоматически.</span>;
              if (l.kind === "site") return <span>Объявления будут вести на ваш сайт. Чтобы считать обращения, вставьте код счётчика на сайт — он появится в «Настройках» сразу после запуска.</span>;
              return <span>Объявления будут вести на {l.label}. Заявки там мы не видим — считаем переходы, а записи отмечайте раз в неделю в «Статистике».</span>;
            })()}
          </li>
        </ul>
        {resuming && phase !== "publish" ? (
          <div className="mt-4 rounded-xl bg-warn-soft text-warn p-3 text-sm flex gap-2" role="status">
            <TriangleAlert size={16} className="shrink-0 mt-0.5" />
            <div>Запуск прервался на середине. Нажмите «Продолжить запуск» — уже созданные кампании не задублируются, недосозданные пересоздадим.</div>
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
        ) : phase === "publish" ? <p className="hint mt-2">Создаём кампании по очереди, это может занять пару минут. Показы включим все разом, когда создадим всё, — до этого деньги не тратятся. Если закроете страницу, робот доведёт запуск сам.</p> : null}
      </Section>

      {/* Одна главная кнопка этапа — прилипает к низу экрана */}
      <div className="sticky bottom-[3.375rem] md:bottom-0 z-30 -mx-4 px-4 sm:mx-0 sm:px-0 pt-4 pb-2 md:pb-4 bg-linear-to-t from-paper from-65% to-paper/0">
        <div className="card shadow-lg px-4 py-3 sm:px-5 grid gap-2.5 sm:flex sm:items-center sm:gap-4">
          <p className="min-w-0 flex-1 text-sm text-ink-2 leading-snug">{action.note}</p>
          <button className={`btn ${action.cls} h-12 px-6 text-base shrink-0`} onClick={action.run} disabled={action.disabled}>
            {action.icon}
            {action.label}
          </button>
        </div>
      </div>

      <EditAdModal edit={edit} onClose={() => setEdit(null)} onSave={async (v) => { if (await patchPlan({ adId: edit!.ad.id, ...v })) setEdit(null); }} />
      <EditAdModal title="Новое объявление" edit={newAd ? { ad: { title: "", title2: "", text: "" }, channel: newAd.channel } : null} onClose={() => setNewAd(null)}
        onSave={async (v) => {
          try {
            const r = await api<{ plan: LaunchPlan; ad: PlanAd }>("POST", "/api/launch/plan/ad", { groupId: newAd!.groupId, ...v });
            setPlan(r.plan);
            setNewAd(null);
            toast(r.ad.enabled ? "Объявление добавлено" : "Добавили выключенным: в группе Директа работают 3 объявления — выключите одно, чтобы включить новое");
          } catch (e) {
            toast((e as Error).message, "error");
          }
        }} />
      <RewriteModal channel={rewriteFor} name={rewriteFor ? CH[rewriteFor].name : ""} count={plan?.channels.find((c) => c.channel === rewriteFor)?.groups.reduce((n, g) => n + g.ads.length, 0) ?? 0}
        onClose={() => setRewriteFor(null)} onPlan={setPlan} />
    </div>
  );
}

const LIM: Record<AdFormat, { title: number; title2: number; text: number }> = { search: { title: 56, title2: 30, text: 81 }, network: { title: 40, title2: 30, text: 81 }, vk: { title: 40, title2: 30, text: 90 } };

const WISHES = ["Живее и проще", "Понятнее, что за услуга", "Больше про результат для клиента", "Упор на цену", "Короче", "Без канцелярита"];

/** «Переписать тексты» канала по пожеланию: идёт порциями, показываем прогресс; вернуть прежние — в списке объявлений */
function RewriteModal({ channel, name, count, onClose, onPlan }: { channel: Channel | null; name: string; count: number; onClose: () => void; onPlan: (p: LaunchPlan) => void }) {
  const [wish, setWish] = useState("");
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const toast = useToast();
  async function run() {
    if (!channel) return;
    setBusy({ done: 0, total: count });
    try {
      let start = true;
      for (let i = 0; i < 20; i++) {
        const r = await api<{ plan: LaunchPlan; done: boolean; progress: { done: number; total: number }; changed: number; failed: number; ai: boolean }>("POST", "/api/launch/plan/rewrite", { channel, wish, start });
        start = false;
        onPlan(r.plan);
        setBusy(r.progress);
        if (r.done) {
          if (!r.ai && wish.trim()) toast("Генерация текстов не подключена — подобрали другие проверенные формулировки, но пожелание учесть не смогли. Точечно поправить можно карандашом", "error");
          else toast(r.failed ? `Переписали ${r.progress.total - r.failed} из ${r.progress.total}. Остальные оставили как были — новый вариант не прошёл проверку фактов` : `Переписали ${r.progress.total} ${plural(r.progress.total, "объявление", "объявления", "объявлений")}`);
          setWish("");
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
        <p className="text-sm text-muted">Робот перепишет все {count} {plural(count, "объявление", "объявления", "объявлений")} канала. Картинки, аудитории и идея каждого объявления останутся. Не понравится — верните прежние тексты одной кнопкой.</p>
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
  const [lastKey, setLastKey] = useState<string | null>(null);
  const key = edit ? `${(edit.ad as { id?: string }).id ?? ""}|${edit.ad.title}|${edit.ad.text}` : null;
  // Закрыли без сохранения — при следующем открытии показываем текст объявления, а не брошенный черновик
  if (!edit && lastKey !== null) setLastKey(null);
  if (edit && key !== lastKey) {
    setLastKey(key);
    setV({ title: edit.ad.title, title2: edit.ad.title2 ?? "", text: edit.ad.text });
  }
  const L = edit ? LIM[formatOf(edit.channel)] : LIM.search;
  const counter = (s: string, max: number) => <span className={`text-xs ${s.length > max ? "text-bad" : "text-faint"}`}>{s.length}/{max}</span>;
  return (
    <Modal open={!!edit} onClose={onClose} title={title}>
      <div className="grid gap-4">
        <div>
          <div className="flex justify-between"><label className="label" htmlFor="t1">Заголовок</label>{counter(v.title, L.title)}</div>
          <input id="t1" className="field" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
        </div>
        {edit?.channel === "search" ? (
          <div>
            <div className="flex justify-between"><label className="label" htmlFor="t2">Второй заголовок</label>{counter(v.title2, L.title2)}</div>
            <input id="t2" className="field" value={v.title2} onChange={(e) => setV({ ...v, title2: e.target.value })} />
          </div>
        ) : null}
        <div>
          <div className="flex justify-between"><label className="label" htmlFor="tx">Текст</label>{counter(v.text, L.text)}</div>
          <textarea id="tx" className="field" rows={3} value={v.text} onChange={(e) => setV({ ...v, text: e.target.value })} />
        </div>
        <p className="hint">Площадки не пропускают «лучший», «№1», капслок и обещания, которые нельзя проверить.</p>
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn btn-primary" disabled={busy || !v.title.trim() || !v.text.trim() || v.title.length > L.title || v.text.length > L.text || v.title2.length > L.title2}
            onClick={async () => { setBusy(true); try { await onSave(v); } finally { setBusy(false); } }}>
            {busy ? <Loader2 size={16} className="spin" /> : null}Сохранить
          </button>
        </div>
      </div>
    </Modal>
  );
}

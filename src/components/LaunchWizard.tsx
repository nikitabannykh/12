"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Check, ImagePlus, Loader2, Pencil, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { api, Modal, Toggle, useToast, resizeToJpeg } from "./client";
import { SearchAdPreview, ImageAdPreview, ResponsiveAssets } from "./AdPreview";
import { adExtras, responsiveAssets, withPlanCallouts, type ExtrasBiz } from "@/lib/engine/extras";
import { allocate, forecast, minMonthlyFor } from "@/lib/engine/budget";
import type { LaunchPlan, PlanAd, PublishStep } from "@/lib/engine/launch";
import type { Channel } from "@/lib/platforms/types";
import { CHANNEL_INFO, formatOf, isRetarget, RETARGET_MIN_AUDIENCE, TYPE_INFO, type AdFormat } from "@/lib/channels";
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
};

function Step({ n, title, done, active, children, aside }: { n: number; title: string; done: boolean; active: boolean; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className={`card p-5 sm:p-7 ${active ? "" : "opacity-60"}`} aria-disabled={!active}>
      <div className="flex items-start gap-4">
        <span className={`shrink-0 w-9 h-9 rounded-full grid place-items-center font-extrabold ${done ? "bg-good text-white" : "bg-mark"}`}>{done ? <Check size={18} /> : n}</span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-bold leading-9">{title}</h2>
            {aside}
          </div>
          <div className="mt-3">{children}</div>
        </div>
      </div>
    </section>
  );
}

export function LaunchWizard(p: Props) {
  const router = useRouter();
  const toast = useToast();
  const [plan, setPlan] = useState<LaunchPlan | null>(p.plan);
  const [budget, setBudget] = useState(p.business.monthlyBudget);
  const [savedBudget, setSavedBudget] = useState(p.business.monthlyBudget);
  const [phase, setPhase] = useState<null | "copy" | "images" | "publish">(null);
  const [uploading, setUploading] = useState(false);
  const [edit, setEdit] = useState<{ ad: PlanAd; channel: Channel } | null>(null);
  const [progress, setProgress] = useState<Progress | null>(() => progressOf(p.plan));
  const fileRef = useRef<HTMLInputElement>(null);

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

  async function prepare() {
    try {
      setPhase("copy");
      const a = await api<{ plan: LaunchPlan }>("POST", "/api/launch/copy");
      setPlan(a.plan);
      setPhase("images");
      const b = await api<{ plan: LaunchPlan }>("POST", "/api/launch/images");
      setPlan(b.plan);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setPhase(null);
    }
  }

  async function patchPlan(body: Record<string, unknown>) {
    try {
      const r = await api<{ plan: LaunchPlan }>("PATCH", "/api/launch/plan", body);
      setPlan(r.plan);
    } catch (e) {
      toast((e as Error).message, "error");
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

  return (
    <div className="grid gap-5">
      {/* 1. Кабинеты */}
      <Step n={1} title="Подключите рекламные кабинеты" done={hasAccounts} active>
        <p className="text-muted leading-relaxed">Реклама будет идти с ваших кабинетов — деньги на них вы пополняете сами, мы только управляем. Доступ можно отозвать в любой момент.</p>
        <div className="mt-4 grid sm:grid-cols-2 gap-3">
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
                  <div className={`text-sm ${acc.status === "ok" ? "text-good" : "text-bad"}`}>
                    {acc.status === "ok" ? <><Check size={14} className="inline -mt-0.5" /> Подключён: {acc.login}</> : <>Ошибка: {acc.statusNote}</>}
                  </div>
                ) : x.on ? (
                  <a className="btn btn-primary btn-sm self-start" href={x.href}>Подключить</a>
                ) : (
                  <div className="text-sm text-faint">Не настроено на сервере</div>
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
      </Step>

      {/* 2. Бюджет */}
      <Step n={2} title="Сколько тратить в месяц" done={hasAccounts && savedBudget === budget} active={hasAccounts}>
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
      </Step>

      {/* 3. Фото */}
      <Step n={3} title="Фотографии для рекламы" done={p.photos.length > 0} active={hasAccounts}
        aside={<span className="text-sm text-muted">Необязательно</span>}>
        <p className="text-muted leading-relaxed">Лучше всего работают настоящие фото: готовая работа крупным планом, интерьер, мастер за работой. Можно с телефона. {p.flags.ai ? "Если фото нет, сгенерируем реалистичные картинки по вашей нише." : ""}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {p.photos.map((ph) => (
            <div key={ph.id} className="relative w-24 h-24 rounded-xl overflow-hidden border border-line group">
              <img src={`/api/images/${ph.id}`} alt="" className="w-full h-full object-cover" />
              {ph.kind === "generated" ? <span className="absolute left-1 bottom-1 pill bg-white/90 text-[10px]">ИИ</span> : null}
              <button className="absolute right-1 top-1 bg-white/90 rounded-md p-1 opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label="Удалить фото"
                onClick={async () => { try { await api("DELETE", `/api/photos/${ph.id}`); setPlan(null); router.refresh(); } catch (e) { toast((e as Error).message, "error"); } }}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button className="w-24 h-24 rounded-xl border-2 border-dashed border-line-2 grid place-items-center text-muted hover:border-ink hover:text-ink" onClick={() => fileRef.current?.click()} disabled={uploading || !hasAccounts}>
            {uploading ? <Loader2 className="spin" /> : <span className="flex flex-col items-center gap-1 text-xs font-semibold"><ImagePlus size={22} />Добавить</span>}
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png" multiple hidden onChange={(e) => upload(e.target.files)} />
        </div>
      </Step>

      {/* 4. Объявления */}
      <Step n={4} title="Объявления" done={ready} active={hasAccounts}
        aside={ready ? <button className="btn btn-ghost btn-sm" onClick={prepare} disabled={!!phase}><Sparkles size={15} /> Написать заново</button> : null}>
        {!plan || phase === "copy" || phase === "images" ? (
          <div>
            <p className="text-muted leading-relaxed">Робот напишет объявления для каждого канала, подберёт поисковые запросы и минус-слова, сделает картинки. Каждое объявление проверяет свою идею — какая сработает лучше, покажет статистика.</p>
            <button className="btn btn-primary mt-4" onClick={prepare} disabled={!!phase || !hasAccounts}>
              {phase ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
              {phase === "copy" ? "Пишем тексты и подбираем запросы…" : phase === "images" ? "Готовим картинки…" : "Подготовить объявления"}
            </button>
            {phase ? <p className="hint mt-2">Обычно это занимает до минуты.</p> : null}
          </div>
        ) : (
          <div className="grid gap-6">
            {plan.warnings.length ? (
              <div className="rounded-xl bg-warn-soft text-warn p-3 text-sm flex gap-2"><TriangleAlert size={16} className="shrink-0 mt-0.5" /><div>{plan.warnings.map((w) => <div key={w}>{w}</div>)}</div></div>
            ) : null}
            {plan.channels.map((ch) => (
              <div key={ch.channel}>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                  <div>
                    <div className="font-bold text-lg flex flex-wrap items-center gap-2">{CH[ch.channel].name} <TypeBadge type={CHANNEL_INFO[ch.channel].type} /></div>
                    <div className="text-sm text-muted">{PLATFORM[ch.platform]} · {rub(ch.weekly)} в неделю · {TYPE_INFO[CHANNEL_INFO[ch.channel].type].label} — {TYPE_INFO[CHANNEL_INFO[ch.channel].type].purpose}</div>
                    {isRetarget(ch.channel) ? <div className="text-sm text-good mt-1">{RETARGET_NOTE}.</div> : null}
                  </div>
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    {ch.enabled ? "Включён" : "Выключен"}
                    <Toggle checked={ch.enabled} label={`Канал ${CH[ch.channel].name}`} onChange={(v) => patchPlan({ channel: ch.channel, channelEnabled: v })} />
                  </label>
                </div>
                {ch.enabled ? ch.groups.map((g) => (
                  <div key={g.id} className="mt-4">
                    <div className="font-semibold">{g.name}</div>
                    <div className="text-sm text-muted">{g.audience}</div>
                    {formatOf(ch.channel) !== "vk" && g.ads.filter((a) => a.enabled).length > 3 ? (
                      <div className="text-sm text-warn mt-1">В группе Директа может работать не больше 3 объявлений — оставьте включёнными три, остальные не отправим.</div>
                    ) : null}
                    {g.keywords.length && ch.channel === "search" ? (
                      <details className="mt-1 text-sm">
                        <summary className="cursor-pointer text-ink-2 font-medium">Запросы: {g.keywords.slice(0, 3).join(", ")}{g.keywords.length > 3 ? ` и ещё ${g.keywords.length - 3}` : ""}</summary>
                        <div className="mt-1 text-muted leading-relaxed">{g.keywords.join(", ")}</div>
                      </details>
                    ) : null}
                    <div className={`mt-3 grid gap-3 ${ch.channel === "search" ? "md:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
                      {g.ads.map((ad) => (
                        <div key={ad.id} className={`relative min-w-0 ${ad.enabled ? "" : "opacity-45"}`}>
                          {ch.channel === "search" ? (
                            <SearchAdPreview title={ad.title} title2={ad.title2} text={ad.text} host={p.host} image={ad.imageId ? `/api/images/${ad.imageId}` : null} extras={withPlanCallouts(adExtras(p.biz, { channel: "search", href: p.href, service: g.name, text: ad.text }), plan?.callouts ?? p.callouts)} />
                          ) : (
                            <ImageAdPreview channel={formatOf(ch.channel) === "vk" ? "vk" : "network"} title={ad.title} text={ad.text} host={formatOf(ch.channel) === "vk" ? p.business.name : p.host} image={ad.imageId ? `/api/images/${ad.imageId}` : null} extras={adExtras(p.biz, { channel: formatOf(ch.channel), href: p.href, text: ad.text })} logo={p.logo} />
                          )}
                          {formatOf(ch.channel) !== "vk" && ch.platform !== "vk" ? (() => {
                            const ra = responsiveAssets(p.biz, ad, { service: ch.channel === "search" ? g.name : null });
                            return <ResponsiveAssets titles={ra.titles} texts={ra.texts} className="mt-1.5" />;
                          })() : null}
                          <div className="mt-1.5 flex items-center justify-between gap-2 text-xs">
                            <span className="text-muted">Идея: {ANGLE[ad.angle] ?? ad.angle}</span>
                            <span className="flex items-center gap-1">
                              <button className="p-1.5 rounded-md hover:bg-paper" aria-label="Изменить текст" onClick={() => setEdit({ ad, channel: ch.channel })}><Pencil size={14} /></button>
                              <Toggle checked={ad.enabled} label="Объявление включено" onChange={(v) => patchPlan({ adId: ad.id, enabled: v })} />
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )) : null}
              </div>
            ))}
            {plan.negatives.length ? (
              <details className="text-sm">
                <summary className="cursor-pointer font-semibold">Минус-слова: не показываем рекламу по {plan.negatives.length} {plural(plan.negatives.length, "нецелевому запросу", "нецелевым запросам", "нецелевым запросам")}</summary>
                <p className="text-muted mt-2 leading-relaxed">{plan.negatives.join(", ")}</p>
              </details>
            ) : null}
          </div>
        )}
      </Step>

      {/* 5. Запуск */}
      <Step n={5} title="Запуск" done={false} active={ready}>
        <ul className="grid gap-2 text-[0.95rem]">
          <li className="flex gap-2"><Check size={18} className="text-good shrink-0 mt-0.5" /> {enabledAds} {plural(enabledAds, "объявление", "объявления", "объявлений")} в {enabledChannels} {plural(enabledChannels, "канале", "каналах", "каналах")} {enabledAds === 1 ? "уйдёт" : "уйдут"} на модерацию — обычно это занимает несколько часов.</li>
          {plan?.channels.some((c) => c.enabled && isRetarget(c.channel)) ? (
            <li className="flex gap-2"><Check size={18} className="text-good shrink-0 mt-0.5" /> Ретаргетинг создадим сразу, но показы он начнёт сам — когда наберётся {RETARGET_MIN_AUDIENCE} человек, которые были на сайте и не записались. До этого деньги на него не тратятся.</li>
          ) : null}
          <li className="flex gap-2"><Check size={18} className="text-good shrink-0 mt-0.5" /> Первые 3 дня робот только наблюдает и копит статистику. Потом начнёт отключать слабое и тестировать новое.</li>
          <li className="flex gap-2"><Check size={18} className="text-good shrink-0 mt-0.5" />
            {p.business.siteUrl ? <span>Чтобы считать обращения, вставьте код счётчика на сайт — он появится в «Настройках» сразу после запуска.</span> : <span>Объявления будут вести на вашу страницу записи — обращения с неё считаются автоматически.</span>}
          </li>
        </ul>
        {resuming && phase !== "publish" ? (
          <div className="mt-4 rounded-xl bg-warn-soft text-warn p-3 text-sm flex gap-2" role="status">
            <TriangleAlert size={16} className="shrink-0 mt-0.5" />
            <div>Запуск прервался на середине. Нажмите «Продолжить запуск» — уже созданные кампании не задублируются, недосозданные пересоздадим.</div>
          </div>
        ) : null}
        <button className="btn btn-mark h-12 px-7 mt-5 text-base" onClick={launch} disabled={!ready || phase === "publish" || !enabledAds}>
          {phase === "publish" ? <Loader2 size={18} className="spin" /> : null}
          {phase === "publish" ? "Создаём кампании…" : resuming ? "Продолжить запуск" : "Запустить рекламу"}
        </button>
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
      </Step>

      <EditAdModal edit={edit} onClose={() => setEdit(null)} onSave={async (v) => { await patchPlan({ adId: edit!.ad.id, ...v }); setEdit(null); }} />
    </div>
  );
}

const ANGLE: Record<string, string> = { price: "цена", offer: "предложение новым клиентам", proof: "доверие", convenience: "удобство", result: "результат", emotion: "эмоция" };
const LIM: Record<AdFormat, { title: number; title2: number; text: number }> = { search: { title: 56, title2: 30, text: 81 }, network: { title: 40, title2: 30, text: 81 }, vk: { title: 40, title2: 30, text: 90 } };

export function EditAdModal({ edit, onClose, onSave }: { edit: { ad: { title: string; title2?: string | null; text: string }; channel: Channel } | null; onClose: () => void; onSave: (v: { title: string; title2: string; text: string }) => Promise<void> }) {
  const [v, setV] = useState({ title: "", title2: "", text: "" });
  const [busy, setBusy] = useState(false);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const key = edit ? edit.ad.title + edit.ad.text : null;
  if (edit && key !== lastKey) {
    setLastKey(key);
    setV({ title: edit.ad.title, title2: edit.ad.title2 ?? "", text: edit.ad.text });
  }
  const L = edit ? LIM[formatOf(edit.channel)] : LIM.search;
  const counter = (s: string, max: number) => <span className={`text-xs ${s.length > max ? "text-bad" : "text-faint"}`}>{s.length}/{max}</span>;
  return (
    <Modal open={!!edit} onClose={onClose} title="Текст объявления">
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
          <button className="btn btn-primary" disabled={busy || v.title.length > L.title || v.text.length > L.text || v.title2.length > L.title2}
            onClick={async () => { setBusy(true); try { await onSave(v); } finally { setBusy(false); } }}>
            {busy ? <Loader2 size={16} className="spin" /> : null}Сохранить
          </button>
        </div>
      </div>
    </Modal>
  );
}

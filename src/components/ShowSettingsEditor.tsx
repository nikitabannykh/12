"use client";
/**
 * «Где, кому и когда показывать»: регион, пол и возраст, расписание.
 * Пустое = решает робот (город из анкеты, аудитории ниши, часы работы). Для идущей рекламы меняем сразу в кабинетах.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Loader2, MapPin, Plus, Target, Users, X } from "lucide-react";
import { api, useToast } from "./client";
import { AGE_MAX, AGE_MIN, DAY_SHORT, DEFAULT_EXAMPLE, RADIUS_STEPS, REACH_INFO, reachText, recommendedReach, sanitizeShow, showSummary, type Reach, type ReachExample, type ShowSettings } from "@/lib/engine/show";

const Seg = <T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; label: string; disabled?: boolean; title?: string }[]; onChange: (v: T) => void; label: string }) => (
  <div role="radiogroup" aria-label={label} className="inline-flex w-fit max-w-full flex-wrap rounded-lg border border-line overflow-hidden text-sm">
    {options.map((o) => (
      <button key={o.v} type="button" role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)} disabled={o.disabled} title={o.title}
        className={`px-3 h-9 border-r border-line last:border-r-0 ${value === o.v ? "bg-ink text-white" : "bg-white hover:bg-paper"} disabled:text-faint disabled:bg-white disabled:cursor-not-allowed`}>{o.label}</button>
    ))}
  </div>
);

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

export function ShowSettingsEditor({ initial, city, address, autoTime, live, autoRadiusKm, monthlyBudget, onReach, example, mode = "full" }: {
  initial: ShowSettings;
  city: string;
  address: string | null;
  /** Время показа по часам работы (если часы указаны) */
  autoTime: string | null;
  /** Реклама уже идёт — изменения сразу уходят в кабинеты */
  live: boolean;
  /** Радиус ВКонтакте вокруг адреса; null — координаты адреса не определили, ВКонтакте показывает по всему городу */
  autoRadiusKm: number | null;
  /** Бюджет в месяц — от него зависит совет по охвату поиска */
  monthlyBudget?: number;
  /** Охват выбран (ещё до сохранения) — мастер запуска сразу пересчитывает спрос */
  onReach?: (r: Reach) => void;
  /** Примеры из этого бизнеса для подсказок: общий запрос («суши») и фраза («доставка суши») */
  example?: ReachExample;
  /**
   * full — всё сразу (настройки); reach — только охват, сохраняется сразу при выборе (мастер запуска, над спросом);
   * details — всё, кроме охвата, свёрнуто в сводку «Где / Кому / Когда» с кнопкой «Настроить»
   */
  mode?: "full" | "reach" | "details";
}) {
  const hasGeo = autoRadiusKm != null;
  const [s, setS] = useState<ShowSettings>(() => sanitizeShow(initial));
  const [saved, setSaved] = useState(() => JSON.stringify(sanitizeShow(initial)));
  const [region, setRegion] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();
  const dirty = JSON.stringify(sanitizeShow(s)) !== saved;
  const set = (patch: Partial<ShowSettings>) => setS((x) => ({ ...x, ...patch }));
  const ageAuto = s.ageFrom == null && s.ageTo == null;
  const sum = showSummary(sanitizeShow(s), { city, address, hasGeo }, autoTime);

  function addRegion() {
    const v = region.trim();
    if (!v) return;
    const list = [...new Set([...(s.extraRegions ?? []), v])].slice(0, 10);
    set({ extraRegions: list });
    setRegion("");
  }

  async function save() {
    setBusy(true);
    try {
      // В мастере охват живёт в своём блоке и сохраняется сразу — здесь его не трогаем
      const r = await api<{ settings: ShowSettings; updated: number; warnings: string[] }>("PUT", "/api/show", sanitizeShow(mode === "details" ? { ...s, reach: sanitizeShow(initial).reach } : s));
      setS(r.settings);
      setSaved(JSON.stringify(r.settings));
      if (r.warnings.length) toast(`Сохранили. Обратите внимание:\n${r.warnings.slice(0, 3).join("\n")}`, "error");
      else toast(live ? `Сохранили и обновили ${r.updated} ${r.updated === 1 ? "кампанию" : "кампании"} в кабинетах` : "Сохранили — применим при запуске");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const rec = recommendedReach(monthlyBudget ?? 30000);
  const reach: Reach = s.reach ?? rec;
  const [open, setOpen] = useState(mode !== "details");

  /** Охват в мастере запуска сохраняем сразу: от него зависят спрос и прогноз прямо над и под ним */
  async function pickReach(v: Reach) {
    set({ reach: v });
    onReach?.(v);
    if (mode !== "reach") return;
    try {
      const r = await api<{ settings: ShowSettings }>("PUT", "/api/show", sanitizeShow({ ...sanitizeShow(initial), reach: v }));
      setSaved(JSON.stringify(r.settings));
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const reachBlock = (
      <div className="grid gap-2.5">
        <div className="font-semibold flex items-center gap-2"><Target size={16} /> Охват поиска</div>
        <Seg label="Охват поиска" value={reach} onChange={(v) => { void pickReach(v); }}
          options={(["precise", "balanced", "wide"] as Reach[]).map((v) => ({ v, label: `${REACH_INFO[v].label}${v === rec ? " · советуем" : ""}` }))} />
        <p className="text-sm text-muted leading-relaxed max-w-2xl">{reachText(reach, example)}</p>
        {reach === "wide" && rec !== "wide" ? (
          <p className="text-sm text-warn leading-relaxed max-w-2xl">При бюджете {monthlyBudget ? `${new Intl.NumberFormat("ru-RU").format(monthlyBudget)} ₽ в месяц` : "как у вас"} общие запросы вроде «{(example ?? DEFAULT_EXAMPLE).word}» съедят деньги за несколько дней: по ним ищут фото и идеи, а не запись. Советуем «{REACH_INFO[rec].label}».</p>
        ) : null}
        {live ? <p className="text-xs text-faint">Для идущей рекламы: лишние фразы ставим на паузу в Директе, а не удаляем — охват можно вернуть.</p> : null}
      </div>
  );
  if (mode === "reach") return reachBlock;

  const summaryBox = (
      <div className="rounded-xl bg-paper px-4 py-3 text-sm grid gap-0.5">
        <div><span className="text-muted">Где:</span> {sum.where}</div>
        <div><span className="text-muted">Кому:</span> {sum.who}</div>
        <div><span className="text-muted">Когда:</span> {sum.when}</div>
      </div>
  );
  if (!open) {
    return (
      <div className="grid gap-3">
        {summaryBox}
        <div><button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>Настроить, где, кому и когда показывать</button></div>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      {/* Охват поиска: насколько широко покупать запросы — главный рычаг, чтобы не сливать бюджет на общие слова */}
      {mode === "full" ? reachBlock : null}

      {/* Где */}
      <div className="grid gap-2.5">
        <div className="font-semibold flex items-center gap-2"><MapPin size={16} /> Где показывать</div>
        <Seg label="Регион" value={s.geoMode ?? "auto"} onChange={(v) => set({ geoMode: v, radiusKm: v === "radius" ? s.radiusKm ?? autoRadiusKm ?? 3 : s.radiusKm })}
          options={[{ v: "auto", label: "Как советует робот" }, { v: "city", label: "Весь город" }, { v: "radius", label: "Рядом с адресом", disabled: !hasGeo, title: hasGeo ? undefined : "Не определили координаты адреса" }]} />
        <p className="text-sm text-muted leading-relaxed max-w-2xl">
          {!hasGeo && s.geoMode !== "city"
            ? <>И в Яндексе, и во ВКонтакте — весь город ({city}): координаты {address ? `адреса «${address}»` : "адреса"} не определили, поэтому показ «рядом с адресом» недоступен. Уточните адрес в разделе «О бизнесе».</>
            : (s.geoMode ?? "auto") === "auto"
            ? <>Яндекс — весь город ({city}). ВКонтакте — люди, которые живут или работают в {String(autoRadiusKm).replace(".", ",")} км от {address || "вашего адреса"}.</>
            : s.geoMode === "city" ? <>И в Яндексе, и во ВКонтакте — весь город ({city}).</>
            : <>ВКонтакте — в радиусе от {address || "адреса"}. Яндекс Директ не умеет показывать в радиусе через API, там — весь город ({city}).</>}
        </p>
        {s.geoMode === "radius" && hasGeo ? (
          <label className="flex items-center gap-2 text-sm">Радиус
            <select className="field h-9 w-28" value={s.radiusKm ?? 3} onChange={(e) => set({ radiusKm: Number(e.target.value) })}>
              {RADIUS_STEPS.map((k) => <option key={k} value={k}>{String(k).replace(".", ",")} км</option>)}
            </select>
          </label>
        ) : null}
        <div className="grid gap-1.5">
          <div className="text-sm text-ink-2">Ещё города или области <span className="text-faint">(необязательно)</span></div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(s.extraRegions ?? []).map((r) => (
              <span key={r} className="pill bg-paper border border-line pl-3 pr-1 py-1 inline-flex items-center gap-1 text-sm">{r}
                <button type="button" className="p-0.5 rounded hover:bg-line" aria-label={`Убрать ${r}`} onClick={() => set({ extraRegions: (s.extraRegions ?? []).filter((x) => x !== r) })}><X size={13} /></button>
              </span>
            ))}
            <span className="flex w-full sm:w-auto min-w-0 items-center gap-1">
              <input className="field h-9 min-w-0 flex-1 sm:flex-none sm:w-56 text-sm" placeholder="Например, Верхняя Пышма" value={region} onChange={(e) => setRegion(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRegion(); } }} />
              <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={addRegion} disabled={!region.trim()}><Plus size={14} /> Добавить</button>
            </span>
          </div>
          {s.extraRegions?.length ? <p className="hint">С дополнительными городами ВКонтакте показывает по городам целиком, а не в радиусе.</p> : null}
        </div>
      </div>

      {/* Кому */}
      <div className="grid gap-2.5">
        <div className="font-semibold flex items-center gap-2"><Users size={16} /> Кому показывать</div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-sm text-muted w-16">Пол</span>
          <Seg label="Пол" value={(s.sex ?? "auto") as "auto" | "any" | "female" | "male"} onChange={(v) => set({ sex: v === "auto" ? null : v })}
            options={[{ v: "auto", label: "Как в аудиториях" }, { v: "any", label: "Все" }, { v: "female", label: "Женщины" }, { v: "male", label: "Мужчины" }]} />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-sm text-muted w-16">Возраст</span>
          <Seg label="Возраст" value={ageAuto ? "auto" : "set"} onChange={(v) => set(v === "auto" ? { ageFrom: null, ageTo: null } : { ageFrom: s.ageFrom ?? 25, ageTo: s.ageTo ?? 55 })}
            options={[{ v: "auto", label: "Как в аудиториях" }, { v: "set", label: "Задать" }]} />
          {!ageAuto ? (
            <span className="inline-flex items-center gap-2 text-sm">от
              <select className="field h-9 w-20" value={s.ageFrom ?? AGE_MIN} onChange={(e) => set({ ageFrom: Number(e.target.value) })}>
                {Array.from({ length: AGE_MAX - AGE_MIN + 1 }, (_, i) => AGE_MIN + i).map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              до
              <select className="field h-9 w-20" value={s.ageTo ?? AGE_MAX} onChange={(e) => set({ ageTo: Number(e.target.value) })}>
                {Array.from({ length: AGE_MAX - AGE_MIN + 1 }, (_, i) => AGE_MIN + i).map((a) => <option key={a} value={a}>{a === AGE_MAX ? `${a}+` : a}</option>)}
              </select>
              лет
            </span>
          ) : null}
        </div>
        <p className="text-sm text-muted leading-relaxed max-w-2xl">
          «Как в аудиториях» — робот берёт пол и возраст из аудиторий вашей ниши (они видны у каждой группы). В Яндексе пол и возраст задаются корректировками ставок: тем, кто не подходит, реклама не показывается.
        </p>
      </div>

      {/* Когда */}
      <div className="grid gap-2.5">
        <div className="font-semibold flex items-center gap-2"><Clock size={16} /> Когда показывать</div>
        <Seg label="Расписание" value={s.scheduleMode ?? "hours"} onChange={(v) => set({ scheduleMode: v, ...(v === "custom" && !s.days ? { days: [0, 1, 2, 3, 4, 5, 6], hourFrom: 9, hourTo: 21 } : {}) })}
          options={[{ v: "hours", label: "По часам работы" }, { v: "always", label: "Круглосуточно" }, { v: "custom", label: "Своё расписание" }]} />
        {s.scheduleMode === "custom" ? (
          <div className="grid gap-2">
            <div className="flex flex-wrap gap-1.5">
              {DAY_SHORT.map((d, i) => {
                const on = (s.days ?? []).includes(i);
                return (
                  <button key={d} type="button" aria-pressed={on} onClick={() => set({ days: on ? (s.days ?? []).filter((x) => x !== i) : [...(s.days ?? []), i].sort() })}
                    className={`w-11 h-9 rounded-lg border text-sm font-semibold ${on ? "bg-ink text-white border-ink" : "bg-white border-line hover:border-ink"} ${i >= 5 ? "" : ""}`}>{d}</button>
                );
              })}
            </div>
            <span className="inline-flex flex-wrap items-center gap-2 text-sm">с
              <select className="field h-9 w-24" value={s.hourFrom ?? 9} onChange={(e) => set({ hourFrom: Number(e.target.value) })}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hh(h)}</option>)}
              </select>
              до
              <select className="field h-9 w-24" value={s.hourTo ?? 21} onChange={(e) => set({ hourTo: Number(e.target.value) })}>
                {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => <option key={h} value={h}>{h === 24 ? "24:00" : hh(h)}</option>)}
              </select>
              <span className="text-faint">по местному времени</span>
            </span>
          </div>
        ) : null}
        <p className="text-sm text-muted leading-relaxed max-w-2xl">
          {s.scheduleMode === "always" ? "Реклама идёт круглые сутки. Ночные обращения дешевле, но на звонок никто не ответит — запись только через форму."
            : s.scheduleMode === "custom" ? (sum.warning ? <span className="text-warn">{sum.warning}</span> : "Директ требует не меньше 40 часов показа в будни — если выбрать меньше, в Директе часы в будни расширим, а ВКонтакте покажет как выбрано.")
            : autoTime ?? "Часы работы не указаны — реклама идёт круглосуточно. Укажите часы в разделе «О бизнесе» или задайте своё расписание."}
        </p>
      </div>

      {summaryBox}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary" disabled={!dirty || busy} onClick={save}>{busy ? <Loader2 size={16} className="spin" /> : null} Сохранить</button>
        {dirty ? <button type="button" className="btn btn-ghost" onClick={() => setS(JSON.parse(saved))}>Отменить</button> : null}
        {mode === "details" && !dirty ? <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Свернуть</button> : null}
        <span className="text-sm text-muted">{live ? "Изменения сразу уйдут в рекламные кабинеты — кампании не перезапускаются, статистика сохранится." : "Применим при запуске рекламы."}</span>
      </div>
    </div>
  );
}

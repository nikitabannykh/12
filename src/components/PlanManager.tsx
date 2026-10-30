"use client";
/**
 * Объявления перед запуском — в удобном для управления виде:
 *  - «Кому покажем»: где, когда, кто и по каким запросам — по всем каналам сразу;
 *  - каналы вкладками (а не одной лентой на 60 объявлений);
 *  - группы свёрнуты: видно, на кого группа и сколько объявлений включено; разворачиваются по клику;
 *  - объявления списком (компактно) или карточками (как увидит человек), поиск и фильтр.
 */
import { useMemo, useState } from "react";
import { ChevronDown, Clock, LayoutGrid, List, Loader2, MapPin, Pencil, Plus, RotateCcw, Search, Sparkles, Users, X } from "lucide-react";
import type { AdExtras } from "@/lib/engine/extras";
import { Toggle } from "./client";
import { SearchAdPreview, ImageAdPreview, ResponsiveAssets } from "./AdPreview";
import { TypeBadge } from "./CampaignNav";
import { adExtras, responsiveAssets, timeTargeting, withPlanCallouts, type ExtrasBiz } from "@/lib/engine/extras";
import type { LaunchPlan, PlanAd, PlanChannel, PlanGroup } from "@/lib/engine/launch";
import type { Channel } from "@/lib/platforms/types";
import { CHANNEL_INFO, formatOf, isRetarget, TYPE_INFO } from "@/lib/channels";
import { LAYER_ITEM, LAYER_LABEL, LAYERS, type Layer } from "@/lib/niches";
import { showOf, showSummary, type ShowSettings } from "@/lib/engine/show";

type Names = Record<Channel, { name: string; hint: string }>;
const ANGLE: Record<string, string> = { custom: "своё", price: "цена", offer: "предложение новым", proof: "доверие", convenience: "удобство", result: "результат", emotion: "эмоция" };
/** Подпись идеи: текст, поправленный владельцем, — уже его, а не исходный подход робота */
const angleOf = (ad: PlanAd) => ((ad as PlanAd & { edited?: boolean }).edited ? "ваша правка" : ANGLE[ad.angle] ?? ad.angle);
const rub = (n: number) => new Intl.NumberFormat("ru-RU").format(Math.round(n)) + " ₽";
function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

function whoOf(g: Pick<PlanGroup, "ageFrom" | "ageTo" | "sex">) {
  const sex = g.sex === "female" ? "женщины" : g.sex === "male" ? "мужчины" : "все";
  const age = g.ageFrom || g.ageTo ? `${g.ageFrom ?? 18}–${g.ageTo ?? 65} лет` : "любой возраст";
  return `${sex[0].toUpperCase()}${sex.slice(1)}, ${age}`;
}

function geoText(ch: Channel, city: string, vkRadiusKm: number | null, address: string | null, sh: ShowSettings = {}) {
  const extra = sh.extraRegions?.length ? ` + ${sh.extraRegions.join(", ")}` : "";
  if (extra && !isRetarget(ch)) return `${city}${extra}`;
  // Координаты адреса не определили — ВКонтакте показывает по всему городу (как в showSummary)
  if (ch === "vk" && vkRadiusKm == null) return `${city} целиком`;
  if (ch === "vk" && sh.geoMode === "radius" && sh.radiusKm) return `Живут или работают в ${String(sh.radiusKm).replace(".", ",")} км от ${address ? address : "вас"}`;
  if (ch === "vk" && sh.geoMode !== "city" && vkRadiusKm) return `Живут или работают в ${vkRadiusKm} км от ${address ? address : "вас"}`;
  if (isRetarget(ch)) return `${city} — только те, кто уже был на сайте`;
  return `${city} и пригороды`;
}

export function PlanManager(p: {
  plan: LaunchPlan;
  names: Names;
  platformNames: Record<string, string>;
  biz: ExtrasBiz;
  host: string;
  href: string;
  logo?: string | null;
  businessName: string;
  vkRadiusKm: number | null;
  onPatch: (body: Record<string, unknown>) => Promise<unknown>;
  onEdit: (ad: PlanAd, channel: Channel) => void;
  onRewrite: (channel: Channel) => void;
  onUndoRewrite: (channel: Channel) => Promise<void>;
  onAddAd: (groupId: string) => Promise<void>;
  onNewAd: (groupId: string, channel: Channel) => void;
}) {
  const { plan } = p;
  const [tab, setTab] = useState<Channel>(plan.channels[0]?.channel ?? "search");
  const [view, setView] = useState<"list" | "cards">("list");
  const [filter, setFilter] = useState<"all" | "on" | "off">("all");
  const [layer, setLayer] = useState<Layer | "all">("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const ch = plan.channels.find((c) => c.channel === tab) ?? plan.channels[0];
  const tt = timeTargeting(p.biz);
  const sh = showOf(p.biz);
  const who = (g: Pick<PlanGroup, "ageFrom" | "ageTo" | "sex">) => whoOf({ ageFrom: sh.ageFrom ?? g.ageFrom, ageTo: sh.ageTo ?? g.ageTo, sex: sh.sex ?? g.sex });

  const count = (c: PlanChannel) => {
    const ads = c.groups.flatMap((g) => g.ads);
    return { on: ads.filter((a) => a.enabled).length, all: ads.length, groups: c.groups.length };
  };

  const groups = useMemo(() => {
    if (!ch) return [];
    const needle = q.trim().toLowerCase();
    return ch.groups
      .filter((g) => layer === "all" || (g.layer ?? "service") === layer)
      .map((g) => {
        const nameHit = needle && (g.name.toLowerCase().includes(needle) || g.keywords.some((k) => k.toLowerCase().includes(needle)));
        const ads = g.ads.filter((a) =>
          (filter === "all" || (filter === "on" ? a.enabled : !a.enabled)) &&
          (!needle || nameHit || `${a.title} ${a.title2 ?? ""} ${a.text}`.toLowerCase().includes(needle)));
        return { g, ads };
      })
      .filter((x) => x.ads.length || (!q && filter === "all"));
  }, [ch, q, filter, layer]);

  if (!ch) return null;
  const layersHere = LAYERS.filter((l) => ch.groups.some((g) => (g.layer ?? "service") === l));
  const allOpen = groups.length > 0 && groups.every(({ g }) => open[g.id]);
  const searching = Boolean(q.trim()) || filter !== "all";

  // Сводка аудиторий по каналам
  const audience = plan.channels.filter((c) => c.enabled).map((c) => {
    const kw = c.groups.reduce((n, g) => n + g.keywords.length, 0);
    const whos = [...new Set(c.groups.map(who))];
    const interests = [...new Set(c.groups.map((g) => g.audience).filter(Boolean))];
    return { c, kw, whos, interests, auto: c.groups.some((g) => g.autotargeting) };
  });

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      {/* Кому покажем */}
      <details className="rounded-xl border border-line bg-white" open>
        <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-3">
          <span className="font-bold inline-flex items-center gap-2"><Users size={16} /> Кому покажем рекламу <a href="#show" className="text-sm font-medium text-ink-2 underline underline-offset-2" onClick={(e) => e.stopPropagation()}>изменить</a></span>
          <ChevronDown size={16} className="text-muted" />
        </summary>
        <div className="px-4 pb-4 grid gap-3">
          <div className="grid sm:grid-cols-2 gap-2 text-sm">
            <div className="flex gap-2"><MapPin size={15} className="mt-0.5 shrink-0 text-muted" /><span><b>Где:</b> {showSummary(sh, { ...p.biz, hasGeo: p.vkRadiusKm != null }, null).where}</span></div>
            <div className="flex gap-2"><Clock size={15} className="mt-0.5 shrink-0 text-muted" /><span><b>Когда:</b> {tt ? tt.note : sh.scheduleMode === "always" ? "круглосуточно" : "круглосуточно — часы работы не указаны"}</span></div>
          </div>
          <div className="grid md:grid-cols-2 gap-2">
            {audience.map(({ c, kw, whos, interests, auto }) => (
              <button key={c.channel} type="button" onClick={() => setTab(c.channel)}
                className={`text-left rounded-lg border px-3 py-2.5 text-sm grid gap-1 hover:border-ink ${tab === c.channel ? "border-ink" : "border-line"}`}>
                <span className="font-semibold flex flex-wrap items-center gap-2">{p.names[c.channel].name} <TypeBadge type={CHANNEL_INFO[c.channel].type} /></span>
                <span className="text-ink-2"><b className="font-medium">Где:</b> {geoText(c.channel, p.biz.city, p.vkRadiusKm, p.biz.address, sh)}</span>
                {c.channel === "search" ? (
                  <span className="text-ink-2"><b className="font-medium">Кто:</b> ищут в Яндексе — {kw} {plural(kw, "запрос", "запроса", "запросов")} в {c.groups.length} {plural(c.groups.length, "группе", "группах", "группах")}{auto ? ", плюс автотаргетинг: Яндекс сам добавит похожие запросы" : ""}</span>
                ) : isRetarget(c.channel) ? (
                  <span className="text-ink-2"><b className="font-medium">Кто:</b> {interests[0] ?? "заходили на сайт и не записались"}</span>
                ) : (
                  <>
                    <span className="text-ink-2"><b className="font-medium">Кто:</b> {whos.join("; ")}</span>
                    {interests.length ? <span className="text-muted">Интересы: {interests.slice(0, 4).join(" · ")}{interests.length > 4 ? ` и ещё ${interests.length - 4}` : ""}</span> : null}
                  </>
                )}
              </button>
            ))}
          </div>
          {plan.negatives.length ? (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">Не показываем по {plan.negatives.length} {plural(plan.negatives.length, "нецелевому запросу", "нецелевым запросам", "нецелевым запросам")} (минус-слова)</summary>
              <p className="text-muted mt-1.5 leading-relaxed [overflow-wrap:anywhere]">{plan.negatives.join(", ")}</p>
            </details>
          ) : null}
        </div>
      </details>

      {/* Каналы вкладками */}
      <div className="-mx-1 overflow-x-auto">
        <div role="tablist" className="flex gap-1.5 px-1 min-w-max">
          {plan.channels.map((c) => {
            const n = count(c);
            const on = c.channel === tab;
            return (
              <button key={c.channel} role="tab" aria-selected={on} onClick={() => { setTab(c.channel); setLayer("all"); }}
                className={`rounded-xl px-3.5 py-2 text-sm text-left border ${on ? "bg-ink text-white border-ink" : "bg-white border-line hover:border-ink"} ${c.enabled ? "" : "opacity-60"}`}>
                <div className="font-semibold whitespace-nowrap">{p.names[c.channel].name}</div>
                <div className={`text-xs ${on ? "text-white/75" : "text-muted"}`}>{c.enabled ? `${n.on} из ${n.all} объявл. · ${n.groups} ${plural(n.groups, "группа", "группы", "групп")}` : "выключен"}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-line bg-white">
        <div className="px-4 py-3 border-b border-line flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm text-muted">{p.platformNames[ch.platform] ?? ch.platform} · {rub(ch.weekly)} в неделю · {TYPE_INFO[CHANNEL_INFO[ch.channel].type].label} — {TYPE_INFO[CHANNEL_INFO[ch.channel].type].purpose}</div>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold">
            {ch.enabled ? "Канал включён" : "Канал выключен"}
            <Toggle checked={ch.enabled} label={`Канал ${p.names[ch.channel].name}`} onChange={(v) => p.onPatch({ channel: ch.channel, channelEnabled: v })} />
          </label>
        </div>

        {ch.enabled ? (
          <>
            {/* Панель управления */}
            <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-b border-line">
              <div className="relative flex-1 min-w-[12rem]">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                <input className="field h-9 pl-9 pr-8 text-sm" placeholder="Найти по тексту или запросу" value={q} onChange={(e) => setQ(e.target.value)} />
                {q ? <button className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-faint" aria-label="Очистить" onClick={() => setQ("")}><X size={14} /></button> : null}
              </div>
              <div className="flex rounded-lg border border-line overflow-hidden text-sm">
                {(["all", "on", "off"] as const).map((f) => (
                  <button key={f} className={`px-2.5 h-9 ${filter === f ? "bg-ink text-white" : "hover:bg-paper"}`} onClick={() => setFilter(f)}>{f === "all" ? "Все" : f === "on" ? "Включённые" : "Выключенные"}</button>
                ))}
              </div>
              <div className="flex rounded-lg border border-line overflow-hidden">
                <button className={`px-2.5 h-9 ${view === "list" ? "bg-ink text-white" : "hover:bg-paper"}`} aria-label="Списком" title="Списком" onClick={() => setView("list")}><List size={16} /></button>
                <button className={`px-2.5 h-9 ${view === "cards" ? "bg-ink text-white" : "hover:bg-paper"}`} aria-label="Как увидят люди" title="Как увидят люди" onClick={() => setView("cards")}><LayoutGrid size={16} /></button>
              </div>
            </div>
            {ch.channel === "search" && layersHere.length > 1 ? (
              <div className="px-4 pt-3 flex flex-wrap gap-1.5 text-sm">
                {(["all", ...layersHere] as const).map((l) => {
                  const n = l === "all" ? ch.groups.length : ch.groups.filter((g) => (g.layer ?? "service") === l).length;
                  return (
                    <button key={l} className={`pill px-3 py-1 border ${layer === l ? "bg-ink text-white border-ink" : "border-line hover:border-ink"}`} onClick={() => setLayer(l)}>
                      {l === "all" ? "Все группы" : LAYER_LABEL[l]} · {n}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <div className="px-4 pt-3 flex flex-wrap items-center gap-2">
              <button className="btn btn-ghost btn-sm" onClick={() => p.onRewrite(ch.channel)}><Sparkles size={14} /> Переписать тексты</button>
              {plan.rewrite?.channel === ch.channel && Object.keys(plan.rewrite.undo).length ? (
                <button className="btn btn-ghost btn-sm" disabled={undoing} onClick={async () => { setUndoing(true); try { await p.onUndoRewrite(ch.channel); } finally { setUndoing(false); } }}>
                  {undoing ? <Loader2 size={14} className="spin" /> : <RotateCcw size={14} />} Вернуть прежние тексты
                </button>
              ) : null}
            </div>
            <div className="px-4 pt-3 flex items-center justify-between text-sm text-muted">
              <span>{groups.length} {plural(groups.length, "группа", "группы", "групп")}{searching ? " по фильтру" : ""}</span>
              <button className="font-medium text-ink-2 hover:text-ink" onClick={() => setOpen(allOpen ? {} : Object.fromEntries(groups.map(({ g }) => [g.id, true])))}>{allOpen ? "Свернуть все" : "Развернуть все"}</button>
            </div>

            <ul className="p-2 sm:p-3 grid grid-cols-[minmax(0,1fr)] gap-2">
              {groups.map(({ g, ads }) => {
                const isOpen = open[g.id] || (searching && Boolean(q.trim()));
                const on = g.ads.filter((a) => a.enabled).length;
                const direct = formatOf(ch.channel) !== "vk" && ch.platform !== "vk";
                return (
                  <li key={g.id} className="rounded-xl border border-line">
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <button className="flex-1 min-w-0 text-left flex items-center gap-2.5" onClick={() => setOpen({ ...open, [g.id]: !open[g.id] })} aria-expanded={!!isOpen}>
                        <ChevronDown size={16} className={`shrink-0 text-muted transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                        <span className="min-w-0 flex-1">
                          <span className="font-semibold flex flex-wrap items-center gap-x-2">
                            {g.name}
                            {ch.channel === "search" && g.layer && g.layer !== "service" ? <span className="pill bg-paper text-xs text-muted">{LAYER_ITEM[g.layer]}</span> : null}
                          </span>
                          <span className="block text-xs text-muted truncate">
                            {ch.channel === "search" ? `${g.keywords.length} ${plural(g.keywords.length, "запрос", "запроса", "запросов")}${typeof g.demand === "number" ? ` · спрос ~${new Intl.NumberFormat("ru-RU").format(g.demand)} в мес.` : ""}: ${g.keywords.slice(0, 3).join(", ")}${g.keywords.length > 3 ? "…" : ""}` : `${who(g)}${g.audience ? ` · ${g.audience}` : ""}`}
                          </span>
                        </span>
                      </button>
                      <span className={`text-xs whitespace-nowrap ${direct && on > 3 ? "text-warn font-semibold" : "text-muted"}`}>{on} из {g.ads.length}</span>
                      <Toggle checked={on > 0} label={`Группа ${g.name}`} onChange={(v) => p.onPatch({ groupId: g.id, groupEnabled: v })} />
                    </div>
                    {isOpen ? (
                      <div className="border-t border-line px-3 py-3 grid grid-cols-[minmax(0,1fr)] gap-3">
                        <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
                          {ch.channel === "search" ? (
                            <>
                              <div className="sm:col-span-2"><span className="text-muted">Запросы:</span> <span className="[overflow-wrap:anywhere]">{g.keywords.join(", ")}</span></div>
                              {g.negatives?.length ? <div className="sm:col-span-2 text-muted [overflow-wrap:anywhere]">Минус-слова группы: {g.negatives.join(", ")}</div> : null}
                              {g.services?.length ? <div className="sm:col-span-2 text-muted">Ведёт на услуги: {g.services.join(", ")}</div> : null}
                            </>
                          ) : (
                            <>
                              <div><span className="text-muted">Кто:</span> {who(g)}</div>
                              <div><span className="text-muted">Где:</span> {geoText(ch.channel, p.biz.city, p.vkRadiusKm, p.biz.address, sh)}</div>
                              {g.audience ? <div className="sm:col-span-2"><span className="text-muted">Аудитория:</span> {g.audience}</div> : null}
                              {g.autotargeting ? <div className="sm:col-span-2 text-muted">Площадка дополнительно подберёт похожих людей сама.</div> : null}
                            </>
                          )}
                          {direct && on > 3 ? <div className="sm:col-span-2 text-warn">В группе Директа работает не больше 3 объявлений — оставьте включёнными три.</div> : null}
                        </div>
                        <GroupExtras g={g} ch={ch.channel} biz={p.biz} host={p.host} href={p.href} logo={p.logo} businessName={p.businessName} planCallouts={plan.callouts} preview={view === "list"} />
                        {view === "list" ? (
                          <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-line rounded-lg border border-line">
                            {ads.map((ad) => (
                              <li key={ad.id} className={`flex items-center gap-3 px-2.5 py-2 ${ad.enabled ? "" : "opacity-50"}`}>
                                {ad.imageId ? <img src={`/api/images/${ad.imageId}`} alt="" className="w-12 h-12 rounded-md object-cover bg-paper shrink-0" loading="lazy" /> : ch.channel === "search" ? null : <span className="w-12 h-12 rounded-md bg-paper shrink-0" />}
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-semibold truncate">{ad.title}{ad.title2 ? <span className="font-normal text-ink-2"> — {ad.title2}</span> : null}</div>
                                  <div className="text-xs text-muted line-clamp-2">{ad.text}</div>
                                </div>
                                <span className="hidden sm:inline text-xs text-faint whitespace-nowrap">{angleOf(ad)}</span>
                                <button className="p-1.5 rounded-md hover:bg-paper shrink-0" aria-label="Изменить текст" onClick={() => p.onEdit(ad, ch.channel)}><Pencil size={14} /></button>
                                <Toggle checked={ad.enabled} label="Объявление включено" onChange={(v) => p.onPatch({ adId: ad.id, enabled: v })} />
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className={`grid gap-3 ${ch.channel === "search" ? "md:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
                            {ads.map((ad) => (
                              <div key={ad.id} className={`min-w-0 ${ad.enabled ? "" : "opacity-45"}`}>
                                {ch.channel === "search" ? (
                                  <SearchAdPreview title={ad.title} title2={ad.title2} text={ad.text} host={p.host} image={ad.imageId ? `/api/images/${ad.imageId}` : null} extras={withPlanCallouts(adExtras(p.biz, { channel: "search", href: p.href, service: g.service ?? g.name, text: ad.text }), plan.callouts)} />
                                ) : (
                                  <ImageAdPreview channel={formatOf(ch.channel) === "vk" ? "vk" : "network"} title={ad.title} text={ad.text} host={formatOf(ch.channel) === "vk" ? p.businessName : p.host} image={ad.imageId ? `/api/images/${ad.imageId}` : null} extras={adExtras(p.biz, { channel: formatOf(ch.channel), href: p.href, text: ad.text })} logo={p.logo} />
                                )}
                                {direct ? (() => {
                                  const ra = responsiveAssets(p.biz, ad, { service: ch.channel === "search" ? g.service ?? g.name : null, services: ch.channel === "search" ? g.services : null });
                                  return <ResponsiveAssets titles={ra.titles} texts={ra.texts} className="mt-1.5" />;
                                })() : null}
                                <div className="mt-1.5 flex items-center justify-between gap-2 text-xs">
                                  <span className="text-muted">Идея: {angleOf(ad)}</span>
                                  <span className="flex items-center gap-1">
                                    <button className="p-1.5 rounded-md hover:bg-paper" aria-label="Изменить текст" onClick={() => p.onEdit(ad, ch.channel)}><Pencil size={14} /></button>
                                    <Toggle checked={ad.enabled} label="Объявление включено" onChange={(v) => p.onPatch({ adId: ad.id, enabled: v })} />
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          <button className="btn btn-ghost btn-sm" disabled={!!adding} onClick={async () => { setAdding(g.id); try { await p.onAddAd(g.id); } finally { setAdding(null); } }}>
                            {adding === g.id ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} Ещё вариант от робота
                          </button>
                          <button className="btn btn-ghost btn-sm" disabled={!!adding} onClick={() => p.onNewAd(g.id, ch.channel)}><Plus size={14} /> Написать своё</button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
              {!groups.length ? <li className="text-sm text-muted px-2 py-4">Ничего не нашлось — измените поиск или фильтр.</li> : null}
            </ul>
          </>
        ) : (
          <p className="px-4 py-5 text-sm text-muted">Канал выключен — его бюджет перешёл в остальные. Включите переключателем справа, чтобы посмотреть объявления.</p>
        )}
      </div>
    </div>
  );
}

/**
 * Что прикрепится к объявлениям группы и как они будут выглядеть: быстрые ссылки с описаниями, уточнения, цена,
 * адрес и часы (из профиля организации), картинка; для VK — длинный текст и «о компании». Те же данные, что уходят
 * на площадку при запуске (adExtras + уточнения плана), поэтому владелец видит, какие факты анкеты робот использует.
 */
function GroupExtras({ g, ch, biz, host, href, logo, businessName, planCallouts, preview }: {
  g: PlanGroup; ch: Channel; biz: ExtrasBiz; host: string; href: string; logo?: string | null; businessName: string; planCallouts: string[]; preview: boolean;
}) {
  const fmt = formatOf(ch);
  const search = ch === "search";
  const vk = fmt === "vk";
  const ad = g.ads.find((a) => a.enabled) ?? g.ads[0];
  const ex: AdExtras = withPlanCallouts(adExtras(biz, { channel: fmt, href, service: search ? g.service ?? g.name : null, text: ad?.text }), planCallouts);
  if (!ad) return null;
  const image = g.ads.find((a) => a.enabled && a.imageId)?.imageId ?? null;
  const noAdv = !(biz.advantages ?? []).some((x) => x.trim());
  const contacts = [biz.address, biz.hours, biz.phone].map((x) => (x ?? "").trim()).filter(Boolean);
  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="grid gap-1 sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:gap-3">
      <div className="text-faint">{label}</div>
      <div className="min-w-0 text-ink-2">{children}</div>
    </div>
  );
  const sum = vk
    ? "длинный текст и «о компании»"
    : [`${ex.sitelinks.length} ${plural(ex.sitelinks.length, "быстрая ссылка", "быстрые ссылки", "быстрых ссылок")}`, `${ex.callouts.length} ${plural(ex.callouts.length, "уточнение", "уточнения", "уточнений")}`, ex.price ? "цена" : null, ex.org ? "адрес и часы" : null].filter(Boolean).join(", ");
  return (
    <details className="group/ex min-w-0 rounded-lg border border-line bg-paper/40" open={preview}>
      <summary className="cursor-pointer list-none px-3 py-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
        <ChevronDown size={14} className="shrink-0 text-muted transition-transform -rotate-90 group-open/ex:rotate-0" />
        <span className="font-semibold">Как объявление выглядит {vk ? "в VK" : "в Яндексе"}</span>
        <span className="text-muted min-w-0 truncate">· {sum}</span>
      </summary>
      <div className="px-3 pb-3 grid gap-3 text-[13px]">
        {preview ? (
          <div className="min-w-0 max-w-xl">
            {search ? (
              <SearchAdPreview title={ad.title} title2={ad.title2} text={ad.text} host={host} image={ad.imageId ? `/api/images/${ad.imageId}` : null} extras={ex} />
            ) : (
              <ImageAdPreview channel={vk ? "vk" : "network"} title={ad.title} text={ad.text} host={vk ? businessName : host} image={image ? `/api/images/${image}` : null} extras={ex} logo={logo} />
            )}
            <div className="mt-1 text-xs text-faint">Первое включённое объявление группы. Площадка сама решает, сколько расширений показать.</div>
          </div>
        ) : null}
        <div className="grid gap-2.5">
          {vk ? (
            <>
              <Row label="Длинный текст">{ex.longText || "—"}</Row>
              <Row label="О компании">{ex.about || "—"}</Row>
            </>
          ) : (
            <>
              <Row label="Быстрые ссылки">
                {ex.sitelinks.length ? (
                  <ul className="grid gap-1.5 sm:grid-cols-2 sm:gap-x-4">
                    {ex.sitelinks.map((x) => (
                      <li key={x.title} className="min-w-0">
                        <span className="font-medium text-[#2a3eb1]">{x.title}</span>
                        {x.description ? <span className="block text-muted [overflow-wrap:anywhere]">{x.description}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : "—"}
              </Row>
              <Row label="Уточнения">
                <span className="flex flex-wrap gap-1.5">{ex.callouts.length ? ex.callouts.map((c) => <span key={c} className="pill bg-white border border-line px-2 py-0.5 text-ink-2">{c}</span>) : "—"}</span>
              </Row>
              {ex.price ? <Row label="Цена">{ex.price.label}{search && g.service ? ` — ${g.service}` : " — минимальная по прайсу"}</Row> : null}
              <Row label="Адрес и часы">
                {ex.org ? (
                  <>Из профиля в Яндекс Бизнесе{contacts.length ? <span className="text-muted">: {contacts.join(" · ")}</span> : null}</>
                ) : (
                  <span>
                    Не покажем: Директ берёт адрес, телефон и часы только из профиля организации.{" "}
                    <a href="/app/start#org" className="font-medium text-ink underline underline-offset-2">Привяжите Яндекс Карты</a>
                    {contacts.length ? <span className="block text-muted">В анкете: {contacts.join(" · ")}</span> : null}
                  </span>
                )}
              </Row>
            </>
          )}
          {!search ? (
            <Row label="Картинка">
              {image ? <img src={`/api/images/${image}`} alt="" className="w-20 h-12 rounded object-cover bg-paper" loading="lazy" /> : "робот подберёт или сгенерирует на следующем шаге"}
            </Row>
          ) : null}
        </div>
        {noAdv && !vk ? (
          <p className="rounded-md bg-white border border-line px-2.5 py-2 text-ink-2">
            Добавьте преимущества в <a href="/app/start#f-adv" className="font-medium text-ink underline underline-offset-2">«Данные о бизнесе»</a>, чтобы робот показал их в уточнениях и быстрой ссылке «Почему мы» — сейчас под объявлением только факты из прайса и часов работы.
          </p>
        ) : null}
      </div>
    </details>
  );
}

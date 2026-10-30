import { isLaunched } from "@/lib/util";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { FlaskConical, Trophy, Lightbulb, Image as ImageIcon, Eye, ChevronDown, GraduationCap, ExternalLink, MapPin, Users, ChevronRight, Clock } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { accountsFor, channelsFor, getBusinessForUser, landingUrl } from "@/lib/engine/launch";
import { adStats, reportNow, report, campaignStates, LEARNING_DAYS } from "@/lib/engine/report";
import { getDb, schema } from "@/lib/db";
import { LiveToggle } from "@/components/client";
import { AdActions, AddChannelButton, BudgetInline } from "@/components/AdsControls";
import { OwnerPhotos } from "@/components/OwnerPhotos";
import { MAX_PHOTOS } from "@/lib/engine/images";
import { SearchAdPreview, ImageAdPreview, ResponsiveAssets } from "@/components/AdPreview";
import { SerpScheme, AuctionTable } from "@/components/Serp";
import { ceilingOf } from "@/lib/engine/ops";
import { CHANNEL_HINT, CHANNEL_NAME, PLATFORM_NAME } from "@/lib/platforms";
import { DIRECT_VAT, netOfVat } from "@/lib/platforms/yandex";
import { MAX_MONTHLY, MIN_WEEKLY, allocate } from "@/lib/engine/budget";
import { ANGLES, LAYERS, LAYER_ITEM, LAYER_LABEL, type Layer } from "@/lib/niches";
import { LAYOUT_NAME, type Layout } from "@/lib/creative/render";
import { adExtras, claimProblems, responsiveAssets, timeTargeting, withPlanCallouts } from "@/lib/engine/extras";
import { isMedical } from "@/lib/niches";
import { MedicalLicenseGuide } from "@/components/MedicalLicenseGuide";
import { ageText, sexText, showOf } from "@/lib/engine/show";
import { landingFor } from "@/lib/engine/landing";
import { vkRadiusFor } from "@/lib/platforms/vk-formats";
import { displayKeyword } from "@/lib/engine/semantics";
import { placeName, scoreGroup, liftBy, addS, zeroS, ctrOf, VERDICT, type S, type AdScore } from "@/lib/engine/insights";
import Link from "next/link";
import { PauseAll } from "@/components/PauseAll";
import { pausedSince } from "@/lib/util";
import { Fragment } from "react";
import { addDays, appUrl, hostOf, isoDay, num, pl, plural, rub } from "@/lib/util";
import type { Channel } from "@/lib/platforms/types";
import { CHANNELS, CHANNEL_INFO, TYPE_INFO, FAMILY_NAME, adsHref, cabinetUrl, familyOf, formatOf, isRetarget, typeOf, type CampaignType, type Family } from "@/lib/channels";
import { audiencesFor } from "@/lib/engine/retarget";
import { CampaignFilters, PlatformMark, TypeBadge, Purpose, AudienceBar } from "@/components/CampaignNav";

const STATUS: Record<string, { text: string; cls: string }> = {
  moderation: { text: "На модерации", cls: "bg-info-soft text-ink-2" },
  paused: { text: "Остановлено", cls: "bg-paper text-muted" },
  rejected: { text: "Отклонено", cls: "bg-bad-soft text-bad" },
};

const pct = (x: number) => `${(x * 100).toFixed(x < 0.01 ? 2 : 1).replace(".", ",")}%`;
const liftText = (index: number) => {
  const d = Math.round((index - 1) * 100);
  return d >= 0 ? `+${d}%` : `${d}%`;
};
const SHORT: Record<string, string> = Object.fromEntries(Object.entries(CHANNEL_INFO).map(([k, v]) => [k, v.short]));
const FAMILIES: Family[] = ["yandex", "vk"];
const TYPES: CampaignType[] = ["search", "network", "feed", "retarget", "maps"];
const DAYS = 14;
/** Оценка без данных не должна выглядеть как «Лучшее» */
function shown(sc: AdScore): AdScore {
  if (sc.verdict === "off" || sc.verdict === "learning") return sc;
  if (!sc.s.impressions || ((sc.verdict === "leader" || sc.verdict === "good") && !sc.s.clicks && !sc.s.conversions)) {
    return { ...sc, rank: null, verdict: "learning", rel: 0, why: sc.s.impressions ? `${pl(sc.s.impressions, "показ", "показа", "показов")}, кликов пока нет — копим данные` : "Показов пока не было — копим данные" };
  }
  return sc;
}

export default async function AdsPage({ searchParams }: { searchParams: Promise<{ p?: string; t?: string }> }) {
  const sp = await searchParams;
  const fp: Family | null = FAMILIES.includes(sp.p as Family) ? (sp.p as Family) : null;
  const ft: CampaignType | null = TYPES.includes(sp.t as CampaignType) ? (sp.t as CampaignType) : null;
  const filtered = Boolean(fp || ft);
  const user = await requireUser();
  const b = await getBusinessForUser(user.id);
  if (!b) redirect("/app/start");
  if (!isLaunched(b.status)) redirect("/app/launch");
  const db = await getDb();
  const camps = await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, b.id), inArray(schema.campaigns.status, ["active", "paused"])));
  const ids = camps.map((c) => c.id);
  const groups = ids.length ? await db.select().from(schema.adGroups).where(inArray(schema.adGroups.campaignId, ids)) : [];
  const ads = ids.length ? await db.select().from(schema.ads).where(inArray(schema.ads.campaignId, ids)) : [];
  const exps = await db.select().from(schema.experiments).where(eq(schema.experiments.businessId, b.id));
  const imgIds = [...new Set(ads.map((a) => a.imageId).filter(Boolean) as string[])];
  const imgs = imgIds.length ? await db.select({ id: schema.images.id, layout: schema.images.layout }).from(schema.images).where(inArray(schema.images.id, imgIds)) : [];
  const layoutOf = new Map(imgs.map((i) => [i.id, i.layout as Layout | null]));
  const now = await reportNow(b);
  const stats = await adStats(b.id, isoDay(addDays(now, -(DAYS - 1))));
  const [rr, states] = await Promise.all([report(b, DAYS), campaignStates(b, camps, now)]);
  const st = (id: string): S => stats.get(id) ?? zeroS();
  const landing = landingUrl(b);
  const host = hostOf(landing);
  const planCallouts = ((b.launchPlan as { callouts?: string[] } | null)?.callouts) ?? [];
  const [logoRow] = await db.select({ id: schema.images.id }).from(schema.images).where(and(eq(schema.images.businessId, b.id), eq(schema.images.layout, "logo")));
  const logoId = logoRow?.id ?? null;
  const running = exps.filter((e) => e.status === "running");
  // В тесте картинок заголовки одинаковые — различаем варианты по макету картинки
  const imgNote = (imageId?: string | null) => { const l = imageId ? layoutOf.get(imageId) : null; return l ? `картинка: ${LAYOUT_NAME[l] ?? l}` : "другая картинка"; };
  camps.sort((a, b) => CHANNELS.indexOf(a.channel as Channel) - CHANNELS.indexOf(b.channel as Channel));
  const chOf = new Map(camps.map((c) => [c.id, c.channel as Channel]));
  const visible = ads.filter((a) => a.status !== "archived" && a.status !== "error");

  // ─── Оценки объявлений внутри каждой группы ───
  const scores = new Map<string, AdScore>();
  for (const g of groups) {
    const rows = visible.filter((a) => a.adGroupId === g.id).map((a) => ({ id: a.id, s: st(a.id), live: a.status === "active" && g.status === "active" }));
    for (const sc of scoreGroup(rows, chOf.get(g.campaignId) ?? "search")) scores.set(sc.id, shown(sc));
  }

  // ─── Место в выдаче (поиск) ───
  const tvOf = (ids: string[]) => {
    let w = 0, n = 0;
    for (const id of ids) { const x = stats.get(id); if (x?.tvImpressions) { w += x.tvWeighted; n += x.tvImpressions; } }
    return n ? w / n : null;
  };
  const groupTiers = (camp: (typeof camps)[number], groupId: string) =>
    ((((camp.meta as any)?.auction?.groups ?? []) as { groupId: string; tiers: { trafficVolume: number; bid: number; price: number }[] }[]).find((x) => x.groupId === groupId)?.tiers) ?? [];

  // ─── Каналы ───
  const chRows = camps.map((c) => {
    const s = ads.filter((a) => a.campaignId === c.id).reduce((acc, a) => addS(acc, st(a.id)), zeroS());
    // Итоги канала — как в «Статистике» за те же дни: с заявками, которых нет в статистике площадки
    const t = camps.filter((x) => x.channel === c.channel).length === 1 ? rr.byChannel[c.channel] : undefined;
    const tot = t ? { ...s, cost: t.cost, clicks: t.clicks, impressions: t.impressions, conversions: t.leads } : s;
    const clients = t ? t.clients : null;
    return { c, ch: c.channel as Channel, s: tot, cpl: tot.conversions ? tot.cost / tot.conversions : null, clients, estimated: t?.clientsEstimated ?? true, cac: clients ? tot.cost / clients : null };
  });
  const totalConv = chRows.reduce((x, r) => x + r.s.conversions, 0);
  const withLeads = chRows.filter((r) => r.cpl !== null && r.s.conversions >= 2).sort((a, b) => a.cpl! - b.cpl!);
  const bestCh = withLeads[0];

  // ─── Идеи и картинки: во сколько раз кликают лучше среднего по своей группе ───
  const all = ads.map((a) => ({ a, s: st(a.id) }));
  const angleLift = liftBy(all.map(({ a, s }) => ({ key: a.angle, groupId: a.adGroupId, s })));
  const layoutLift = liftBy(all.filter(({ a }) => a.imageId).map(({ a, s }) => ({ key: layoutOf.get(a.imageId!) ?? null, groupId: a.adGroupId, s })));
  const bestAngle = angleLift.find((x) => x.ads >= 1 && x.impressions >= 300 && x.index > 1.05);
  const worstAngle = [...angleLift].reverse().find((x) => x.impressions >= 300 && x.index < 0.9);
  const bestLayout = layoutLift.length >= 2 && layoutLift[0].index > 1.05 ? layoutLift[0] : null;

  // Лучшее объявление: лидер группы с наибольшим отрывом от следующего
  const leaders = visible.filter((a) => scores.get(a.id)?.verdict === "leader");
  const cpl = (id: string) => { const s = st(id); return s.conversions >= 2 ? s.cost / s.conversions : Infinity; };
  const bestAd = leaders.sort((x, y) => cpl(x.id) - cpl(y.id) || ctrOf(st(y.id)) - ctrOf(st(x.id)))[0];
  const weakCount = visible.filter((a) => scores.get(a.id)?.verdict === "weak").length;

  // ─── Свои фото владельца: где уже стоят (объявления с картинкой из этого фото) ───
  const ownPhotos = await db.select({ id: schema.images.id }).from(schema.images).where(and(eq(schema.images.businessId, b.id), eq(schema.images.kind, "photo"))).orderBy(schema.images.createdAt);
  const fromPhoto = ownPhotos.length
    ? await db.select({ id: schema.images.id, prompt: schema.images.prompt }).from(schema.images).where(and(eq(schema.images.businessId, b.id), eq(schema.images.kind, "creative"), inArray(schema.images.prompt, ownPhotos.map((p) => p.id))))
    : [];
  const photoOfCreative = new Map(fromPhoto.map((r) => [r.id, r.prompt!]));
  const photoUses = new Map<string, number>();
  for (const a of visible) {
    const pid = a.imageId ? photoOfCreative.get(a.imageId) : undefined;
    if (pid) photoUses.set(pid, (photoUses.get(pid) ?? 0) + 1);
  }
  const hasImageChannels = camps.some((c) => c.channel !== "search");

  // ─── Типы кампаний и фильтры ───
  const audiences = await audiencesFor(b, camps, now);
  const accRows = camps.length ? await db.select({ id: schema.adAccounts.id, login: schema.adAccounts.login, platform: schema.adAccounts.platform }).from(schema.adAccounts).where(inArray(schema.adAccounts.id, [...new Set(camps.map((c) => c.accountId))])) : [];
  const loginOf = new Map(accRows.map((a) => [a.id, a.login]));
  const searchCamp = camps.find((c) => c.channel === "search");
  // «Карты» — не отдельная кампания: места показа поисковой ЕПК при привязанной организации
  const mapsItem = searchCamp ? { on: Boolean(b.orgId), camp: searchCamp } : null;
  type Item = { key: string; family: Family; type: CampaignType; camp: (typeof camps)[number] | null };
  const items: Item[] = [
    ...camps.map((c) => ({ key: c.id, family: familyOf(c.channel), type: typeOf(c.channel), camp: c })),
    ...(mapsItem ? [{ key: "maps", family: "yandex" as Family, type: "maps" as CampaignType, camp: null }] : []),
  ];
  const famCount = { all: items.length, yandex: items.filter((i) => i.family === "yandex").length, vk: items.filter((i) => i.family === "vk").length };
  const inFam = items.filter((i) => !fp || i.family === fp);
  const typeCount: { all: number } & Partial<Record<CampaignType, number>> = { all: inFam.length };
  for (const i of inFam) typeCount[i.type] = (typeCount[i.type] ?? 0) + 1;
  const shownItems = inFam.filter((i) => !ft || i.type === ft);
  const shownIds = new Set(shownItems.map((i) => i.key));
  const shownCamps = camps.filter((c) => shownIds.has(c.id));

  // ─── Каналы, которые подключены, но ещё не запущены ───
  const allCamps = await db.select({ channel: schema.campaigns.channel, status: schema.campaigns.status }).from(schema.campaigns).where(eq(schema.campaigns.businessId, b.id));
  const launched = [...new Set(allCamps.filter((c) => ["active", "paused", "creating"].includes(c.status)).map((c) => c.channel as Channel))];
  const fits = (monthly: number, chs: Channel[]) => allocate(monthly, chs).dropped.length === 0;
  const addable = channelsFor(await accountsFor(user.id))
    .map((x) => x.channel)
    .filter((ch) => !launched.includes(ch))
    .map((ch) => {
      const chs = [...launched, ch];
      const ok = fits(b.monthlyBudget, chs);
      let need = 0;
      if (!ok) for (let m = Math.ceil(b.monthlyBudget / 500) * 500; m <= MAX_MONTHLY; m += 500) if (fits(m, chs)) { need = m; break; }
      const weekly = allocate(b.monthlyBudget, chs).allocation.find((a) => a.channel === ch)?.weekly ?? MIN_WEEKLY[ch];
      return { ch, ok, need, weekly };
    });

  const anchorOf = (key: string) => (key === "maps" ? "maps" : `c-${key}`);
  const filterName = [fp ? FAMILY_NAME[fp] : null, ft ? TYPE_INFO[ft].label.toLowerCase() : null].filter(Boolean).join(" · ");

  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Реклама</h1>
          <p className="text-muted mt-1 max-w-2xl">Все кампании по площадкам и типам. Цифры за последние {pl(DAYS, "день", "дня", "дней")}. Можно менять всё вручную: робот учтёт ваши решения.</p>
        </div>
        {b.status === "active" ? <PauseAll paused={false} compact /> : null}
      </div>
      {b.status === "paused" ? <PauseAll paused since={pausedSince(b.updatedAt)} /> : null}

      <CampaignFilters p={fp} t={ft} families={famCount} types={typeCount} />

      {/* ─── Кампании: обзор ─── */}
      <section className="card p-4 sm:p-6" aria-labelledby="camps-title">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="camps-title" className="text-lg font-bold">Кампании{filterName ? <span className="text-muted font-semibold"> · {filterName}</span> : null}</h2>
          {filtered ? <Link href="/app/ads" scroll={false} className="text-sm font-semibold underline underline-offset-2 text-ink-2">Показать все</Link> : null}
        </div>
        {shownItems.length ? (
          <>
            {/* Телефон: строки-карточки */}
            <ul className="mt-3 grid gap-2 md:hidden">
              {shownItems.map((it) => {
                const r = it.camp ? chRows.find((x) => x.c.id === it.camp!.id) : null;
                return (
                  <li key={it.key}>
                    <a href={`#${anchorOf(it.key)}`} className="block rounded-xl border border-line p-3.5 hover:border-ink-2 active:bg-paper">
                      <div className="flex items-start gap-2.5">
                        <PlatformMark family={it.family} size={22} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold leading-tight">{it.camp ? SHORT[it.camp.channel] : "Яндекс Карты"}</span>
                            <TypeBadge type={it.type} />
                          </div>
                          <div className="text-xs text-muted mt-0.5">{TYPE_INFO[it.type].purpose}</div>
                        </div>
                        <ChevronRight size={18} className="text-faint shrink-0 mt-0.5" aria-hidden />
                      </div>
                      <div className="mt-2.5"><ItemStatus it={it} /></div>
                      {r ? (
                        <dl className="mt-2.5 grid grid-cols-3 gap-2 text-sm">
                          <div><dt className="text-xs text-muted">Потрачено</dt><dd className="font-semibold tabular-nums">{rub(r.s.cost)}</dd></div>
                          <div><dt className="text-xs text-muted">Обращения</dt><dd className="font-semibold tabular-nums">{num(r.s.conversions)}</dd></div>
                          <div><dt className="text-xs text-muted">Обращение</dt><dd className="font-semibold tabular-nums">{r.cpl !== null ? rub(r.cpl) : "—"}</dd></div>
                        </dl>
                      ) : <p className="mt-2 text-xs text-muted">Без отдельного бюджета — часть кампании «Поиск»</p>}
                    </a>
                  </li>
                );
              })}
            </ul>
            {/* Компьютер: таблица */}
            <div className="mt-3 hidden md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-faint">
                    <th className="font-medium py-2 pr-2">Кампания</th>
                    <th className="font-medium py-2 px-2">Статус</th>
                    <th className="font-medium py-2 px-2 text-right">Потрачено</th>
                    <th className="font-medium py-2 px-2 text-right">Обращения</th>
                    <th className="font-medium py-2 px-2 text-right">Обращение</th>
                    <th className="font-medium py-2 pl-2 text-right">Клиент</th>
                  </tr>
                </thead>
                <tbody>
                  {shownItems.map((it) => {
                    const r = it.camp ? chRows.find((x) => x.c.id === it.camp!.id) : null;
                    const best = r && bestCh && r.c.id === bestCh.c.id && withLeads.length > 1;
                    return (
                      <tr key={it.key} className="border-t border-line align-middle group/row">
                        <td className="py-2.5 pr-2">
                          <a href={`#${anchorOf(it.key)}`} className="flex items-start gap-2.5 min-w-0 rounded-lg -m-1 p-1 hover:bg-paper">
                            <span className="mt-0.5"><PlatformMark family={it.family} size={20} /></span>
                            <span className="min-w-0">
                              <span className="flex flex-wrap items-center gap-1.5">
                                <span className="font-semibold group-hover/row:underline underline-offset-2">{it.camp ? SHORT[it.camp.channel] : "Яндекс Карты"}</span>
                                <TypeBadge type={it.type} />
                                {best ? <span className="pill bg-good text-white">дешевле всех</span> : null}
                              </span>
                              <span className="block text-xs text-muted mt-0.5">{TYPE_INFO[it.type].purpose}</span>
                            </span>
                          </a>
                        </td>
                        <td className="py-2.5 px-2 w-[11rem]"><ItemStatus it={it} /></td>
                        <td className="py-2.5 px-2 text-right tabular-nums whitespace-nowrap">{r ? rub(r.s.cost) : "—"}</td>
                        <td className="py-2.5 px-2 text-right tabular-nums">{r ? num(r.s.conversions) : "—"}</td>
                        <td className="py-2.5 px-2 text-right tabular-nums whitespace-nowrap">{r?.cpl != null ? rub(r.cpl) : "—"}</td>
                        <td className="py-2.5 pl-2 text-right tabular-nums font-semibold whitespace-nowrap">{r?.cac != null ? `${r.estimated ? "≈ " : ""}${rub(r.cac)}` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="hint mt-3">Нажмите на кампанию, чтобы перейти к её объявлениям. «Клиент» — сколько стоил один клиент{chRows.some((r) => r.estimated) ? " (≈ — оценка, пока вы не отметили клиентов за неделю в «Статистике»)" : ""}. Раз в неделю робот переносит до четверти бюджета туда, где обращение дешевле.</p>
          </>
        ) : (
          <p className="text-muted mt-3">
            {fp && !famCount[fp] ? <>Кабинет {FAMILY_NAME[fp]} не подключён или кампаний в нём пока нет. </> : <>Таких кампаний пока нет. </>}
            <Link href="/app/ads" scroll={false} className="font-semibold underline">Показать все</Link>
          </p>
        )}
      </section>

      {!filtered ? (
        <>
      {/* ─── Главное ─── */}
      <section className="card p-5 sm:p-7">
        <h2 className="text-lg font-bold">Что работает лучше</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile icon={<Trophy size={16} />} label="Лучший канал">
            {bestCh ? (
              <>
                <b>{SHORT[bestCh.ch]}</b>
                <span className="text-muted"> — обращение по {rub(bestCh.cpl!)}{withLeads[1] && withLeads[1].cpl! / bestCh.cpl! >= 1.1 ? `, это в ${(withLeads[1].cpl! / bestCh.cpl!).toFixed(1).replace(".", ",")} раза дешевле, чем ${SHORT[withLeads[1].ch]}` : ""}</span>
              </>
            ) : <span className="text-muted">Пока мало обращений, чтобы сравнить каналы</span>}
          </Tile>
          <Tile icon={<Trophy size={16} />} label="Лучшее объявление">
            {bestAd ? (
              <>
                <b>«{bestAd.title}»</b>
                <span className="text-muted"> — {SHORT[chOf.get(bestAd.campaignId)!]}. {scores.get(bestAd.id)!.why}</span>
              </>
            ) : <span className="text-muted">Копим показы — нужно ещё несколько дней</span>}
          </Tile>
          <Tile icon={<Lightbulb size={16} />} label="Лучшая идея в текстах">
            {bestAngle ? (
              <>
                <b>{ANGLES[bestAngle.key]?.name ?? bestAngle.key}</b>
                <span className="text-muted"> — кликают на {liftText(bestAngle.index).replace("+", "")} чаще среднего{worstAngle && worstAngle.key !== bestAngle.key ? `. Хуже всего — «${ANGLES[worstAngle.key]?.name}» (${liftText(worstAngle.index)})` : ""}</span>
              </>
            ) : <span className="text-muted">Явного победителя среди идей пока нет</span>}
          </Tile>
          <Tile icon={<ImageIcon size={16} />} label="Лучшая картинка">
            {bestLayout ? (
              <>
                <b>{LAYOUT_NAME[bestLayout.key] ?? bestLayout.key}</b>
                <span className="text-muted"> — кликают на {liftText(bestLayout.index).replace("+", "")} чаще среднего</span>
              </>
            ) : <span className="text-muted">Сравниваем макеты картинок</span>}
          </Tile>
        </div>
        <p className="text-sm text-muted mt-4 leading-relaxed">
          Как робот этим пользуется: новые объявления чаще пишет с удачными идеями, но иногда пробует новые — вдруг они ещё лучше.
          Если идея выиграла в одной группе, её проверяют и в других. Слабые объявления выключаются, когда разница уже точно не случайна
          {weakCount ? ` — сейчас ${pl(weakCount, "такое объявление", "таких объявления", "таких объявлений")}` : ""}.
        </p>
      </section>

      {/* ─── Добавить канал ─── */}
      {addable.length ? (
        <section className="card p-5 sm:p-7">
          <h2 className="text-lg font-bold">Можно добавить</h2>
          <p className="text-sm text-muted mt-1 max-w-2xl">Эти каналы подключены, но реклама в них ещё не запущена. Больше каналов — больше людей увидят рекламу, а робот сравнит, где клиенты дешевле.</p>
          <ul className="mt-4 grid gap-3">
            {addable.map((x) => (
              <li key={x.ch} className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold">{CHANNEL_NAME[x.ch]}</div>
                  <div className="text-sm text-muted">{CHANNEL_HINT[x.ch]}</div>
                </div>
                {x.ok ? (
                  <AddChannelButton channel={x.ch} name={SHORT[x.ch]} weekly={x.weekly} />
                ) : (
                  <p className="text-sm text-muted max-w-sm">
                    {x.need ? <>Нужен бюджет от {rub(x.need)} в месяц, сейчас {rub(b.monthlyBudget)}. </> : <>Не хватает бюджета. </>}
                    <Link href="/app/settings#budget" className="font-semibold text-ink-2 underline">Изменить бюджет</Link>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ─── Идут проверки ─── */}
      {running.length ? (
        <section className="card p-5 sm:p-7">
          <h2 className="text-lg font-bold flex items-center gap-2"><FlaskConical size={18} /> Сейчас проверяем</h2>
          <p className="text-sm text-muted mt-1">Новый вариант показывается наравне со старым. Когда разница станет надёжной, робот оставит лучший — обычно через 1–2 недели.</p>
          <ul className="mt-3 grid gap-4">
            {running.slice(0, 3).map((e) => {
              const v = ads.find((a) => a.id === e.variantId);
              const c = ads.find((a) => a.id === e.controlId);
              const sv = st(e.variantId), sc = st(e.controlId);
              const cv = ctrOf(sv), cc = ctrOf(sc);
              const enough = sv.impressions >= 100 && sc.impressions >= 100;
              const lead = enough ? (cv > cc ? "new" : "old") : null;
              return (
                <li key={e.id} className="text-[0.95rem] leading-relaxed">
                  <div>Проверяем, {e.hypothesis.replace(/\.$/, "")}</div>
                  <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                    <Duel label="Было" title={c?.title} note={e.kind === "creative" ? imgNote(c?.imageId) : undefined} s={sc} ahead={lead === "old"} />
                    <Duel label={e.kind === "creative" ? "Новая картинка" : "Новый вариант"} title={v?.title} note={e.kind === "creative" ? imgNote(v?.imageId) : undefined} s={sv} ahead={lead === "new"} />
                  </div>
                </li>
              );
            })}
          </ul>
          {running.length > 3 ? (
            <details className="mt-3 group/more">
              <summary className="cursor-pointer text-sm font-semibold text-ink-2 list-none">Ещё {pl(running.length - 3, "проверка", "проверки", "проверок")} <ChevronDown size={14} className="inline transition group-open/more:rotate-180" /></summary>
              <ul className="mt-3 grid gap-4">
                {running.slice(3).map((e) => {
                  const v = ads.find((a) => a.id === e.variantId);
                  const c = ads.find((a) => a.id === e.controlId);
                  const sv = st(e.variantId), sc = st(e.controlId);
                  const enough = sv.impressions >= 100 && sc.impressions >= 100;
                  const lead = enough ? (ctrOf(sv) > ctrOf(sc) ? "new" : "old") : null;
                  return (
                    <li key={e.id} className="text-[0.95rem] leading-relaxed">
                      <div>Проверяем, {e.hypothesis.replace(/\.$/, "")}</div>
                      <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                        <Duel label="Было" title={c?.title} note={e.kind === "creative" ? imgNote(c?.imageId) : undefined} s={sc} ahead={lead === "old"} />
                        <Duel label={e.kind === "creative" ? "Новая картинка" : "Новый вариант"} title={v?.title} note={e.kind === "creative" ? imgNote(v?.imageId) : undefined} s={sv} ahead={lead === "new"} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}

      {/* ─── Свои фото ─── */}
      <section id="photos" className="card p-5 sm:p-7 scroll-mt-20">
        <h2 className="text-lg font-bold flex items-center gap-2"><ImageIcon size={18} /> Ваши фото</h2>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          {ownPhotos.length
            ? "Робот ставит ваши фото в объявления вместо нарисованных картинок и сравнивает: оставит то, что приводит больше людей."
            : "Сейчас в объявлениях нарисованные или сгенерированные картинки. Настоящие фото — готовая работа крупным планом, зал, мастер за работой — обычно кликают чаще. Можно с телефона."}
          {hasImageChannels ? " Новые фото робот ставит при следующих проверках, по одному в каждую аудиторию. Если там как раз проверяется текст, фото подождёт его итога." : " Картинки показываются в РСЯ и ВКонтакте — когда подключите их, фото пойдут в рекламу."}
        </p>
        <div className="mt-4">
          <OwnerPhotos photos={ownPhotos.map((p) => ({ id: p.id, uses: photoUses.get(p.id) ?? 0 }))} max={MAX_PHOTOS} />
        </div>
      </section>

        </>
      ) : null}

      {/* ─── Кампании подробно ─── */}
      {shownCamps.map((camp) => {
        const ch = camp.channel as Channel;
        // Группы, перенесённые роботом в новые (в Директе кончилось место для объявлений), не показываем
        const cg = groups.filter((g) => g.campaignId === camp.id && g.status !== "archived");
        // Директ: объявления комбинаторные — Яндекс собирает показ из нескольких заголовков и текстов
        const combinatorial = formatOf(ch) !== "vk" && camp.platform !== "vk";
        const fmt = formatOf(ch);
        const row = chRows.find((r) => r.c.id === camp.id)!;
        const aud = audiences.get(camp.id);
        const waiting = isRetarget(ch) && camp.status === "paused" && aud && aud.state !== "on";
        // Канал выключен целиком — его группы и объявления не показываются, даже если сами по себе включены
        const campOff = camp.status !== "active" && !waiting;
        const cab = cabinetUrl(camp.platform, camp.externalId, loginOf.get(camp.accountId));
        // Лимит, который ретаргетинг получит при включении: доля от текущего бюджета вместе с работающими каналами
        const planned = waiting ? allocate(b.monthlyBudget, [...new Set(camps.filter((x) => x.status === "active").map((x) => x.channel as Channel)), ch]) : null;
        const plannedWeekly = planned?.allocation.find((x) => x.channel === ch)?.weekly ?? camp.weeklyBudget;
        const plannedShort = Boolean(planned?.dropped.includes(ch));
        const groupStats = cg.map((g) => ({ g, s: ads.filter((a) => a.adGroupId === g.id).reduce((acc, a) => addS(acc, st(a.id)), zeroS()) }));
        // Поиск: группы по слоям семантики — услуги, проблемы клиентов, смежные запросы, аудитории
        const layerOf = (g: (typeof cg)[number]) => (ch === "search" ? (((g.targeting ?? {}) as { layer?: Layer }).layer ?? "service") : "service") as Layer;
        const layered = ch === "search" && new Set(cg.map(layerOf)).size > 1;
        const layerSum = (l: Layer) => {
          const gs = cg.filter((g) => layerOf(g) === l);
          return { groups: gs.length, keywords: gs.reduce((n, g) => n + new Set((g.keywords ?? []).map(displayKeyword)).size, 0), on: gs.filter((g) => g.status === "active").length };
        };
        return (
          <section key={camp.id} id={`c-${camp.id}`} className="card overflow-hidden scroll-mt-28">
            <div className="p-5 sm:p-7 border-b border-line">
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <PlatformMark family={familyOf(ch)} label />
                  <TypeBadge type={typeOf(ch)} />
                </div>
                <label className="flex items-center gap-2 text-sm font-semibold shrink-0">
                  {waiting ? (aud!.state === "off" ? "Не включать" : "Включится сам") : camp.status === "active" ? "Включён" : "Выключен"}
                  {waiting ? (
                    <LiveToggle url={`/api/campaigns/${camp.id}`} on={aud!.state !== "off"} label="Включить ретаргетинг сам, когда наберётся аудитория" confirmOff="Не включать ретаргетинг, даже когда наберётся аудитория? Вернуть можно здесь же." />
                  ) : (
                    <LiveToggle url={`/api/campaigns/${camp.id}`} on={camp.status === "active"} label={`Канал ${CHANNEL_NAME[ch]}`} confirmOff="Остановить показы в этом канале? Настройки и статистика сохранятся." />
                  )}
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2">
                <h2 className="text-xl font-bold">{CHANNEL_NAME[ch]}</h2>
                {waiting ? (
                  aud!.state === "off" ? <span className="pill bg-paper text-muted">автозапуск выключен</span> : <span className="pill bg-good-soft text-good"><Users size={13} /> копим аудиторию</span>
                ) : <CampaignPill s={states.get(camp.id)} ch={ch} />}
              </div>
              <p className="text-sm text-muted mt-0.5"><Purpose type={typeOf(ch)} /></p>

              {(() => {
                // Все причины, по которым кампания не показывается, — сразу, а не только первая (деньги И лицензия)
                const st = states.get(camp.id);
                const note = st?.note ?? "Площадка сейчас не показывает кампанию.";
                const platformOff = st?.stopped === "platform";
                const money = platformOff && /средств|пополн/i.test(note);
                const campAds = ads.filter((x) => x.campaignId === camp.id && x.status !== "archived");
                const docs = campAds.filter((x) => x.status === "active" && /документ/i.test(x.statusNote ?? "")).length;
                const everShown = campAds.some((x) => (scores.get(x.id)?.s.impressions ?? 0) > 0) || row.s.cost > 0;
                // Медицина в Директе: пока показов не было ни разу, лицензия могла ещё не пройти проверку — напоминаем,
                // даже если Директ не отдал это через API
                const licenseUnknown = !docs && camp.platform === "yandex" && isMedical(b) && !everShown && camp.status === "active";
                const issues: { title: string; text: React.ReactNode; action?: React.ReactNode; tone: "bad" | "warn" }[] = [];
                if (money) issues.push({ tone: "bad", title: "На балансе нет денег", text: `Пополните кабинет ${PLATFORM_NAME[camp.platform] ?? ""} — показы начнутся сами.`, action: <a className="btn btn-primary btn-sm" href={camp.platform === "vk" ? "https://ads.vk.ru/hq/budget/transactions" : "https://direct.yandex.ru/"} target="_blank" rel="noreferrer">Пополнить</a> });
                else if (platformOff) issues.push({ tone: "bad", title: "Площадка не показывает рекламу", text: note });
                if (docs) issues.push({ tone: "bad", title: "Директ ждёт лицензию", text: `Показы запрещены, пока Директ не проверит медицинскую лицензию (${pl(docs, "объявление", "объявления", "объявлений")}). В кабинете Директа: объявление → «Отправить документы».`, action: <a className="btn btn-ghost btn-sm bg-white" href="https://yandex.ru/support/tooltips-direct/moderation-warning-data-forms.html" target="_blank" rel="noreferrer">Как отправить</a> });
                else if (licenseUnknown) issues.push({ tone: "warn", title: "Лицензия: проверьте в Директе", text: "Медицинскую рекламу Директ показывает только после проверки лицензии. Если вы её ещё не отправляли или проверка не закончилась — показов не будет даже с деньгами на счёте.", action: <a className="btn btn-ghost btn-sm bg-white" href="https://yandex.ru/support/tooltips-direct/moderation-warning-data-forms.html" target="_blank" rel="noreferrer">Как отправить</a> });
                if (!issues.length) return null;
                const bad = issues.some((x) => x.tone === "bad");
                return (
                  <div className={`mt-3 rounded-xl border px-4 py-3 grid gap-3 ${bad ? "border-bad/25 bg-bad-soft" : "border-warn/25 bg-warn-soft"}`}>
                    <div className={`text-sm font-semibold ${bad ? "text-bad" : "text-warn"}`}>{bad ? (issues.length > 1 ? `Реклама стоит — причин: ${issues.length}` : "Реклама стоит") : "Проверьте перед запуском показов"}</div>
                    {issues.map((x, i) => (
                      <div key={i} className="flex flex-wrap items-center gap-3">
                        <div className="flex-1 min-w-[14rem] text-sm">
                          <div className="font-semibold">{issues.length > 1 ? `${i + 1}. ` : ""}{x.title}</div>
                          <div className="text-ink-2">{x.text}</div>
                        </div>
                        {x.action ?? null}
                      </div>
                    ))}
                  </div>
                );
              })()}

              {waiting ? (
                <div className="mt-3 rounded-xl bg-good-soft/50 border border-good/15 p-4">
                  <AudienceBar size={aud!.size} need={aud!.need} />
                  <p className="text-sm text-ink-2 mt-2.5 leading-relaxed max-w-2xl">
                    Копим тех, кто был на {b.siteUrl ? "сайте" : "странице записи"} за 30 дней и не записался. {aud!.state === "off" ? "Автозапуск выключен — робот кампанию не включит." : <>От {aud!.need} человек робот включит кампанию сам{plannedShort ? <>, если хватит бюджета ({rub(MIN_WEEKLY[ch])} в неделю)</> : <> — около {rub(plannedWeekly)} в неделю</>}. До этого деньги не тратятся.</>}
                  </p>
                  {aud!.note ? <p className="text-sm text-warn mt-1.5">{aud!.note}{/бюджет/.test(aud!.note) ? <> · <Link href="/app/settings#budget" className="underline font-semibold">Изменить бюджет</Link></> : null}</p> : null}
                </div>
              ) : null}

              {/* Цифры */}
              <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                <div className="rounded-xl bg-paper px-3.5 py-3">
                  <div className="text-xs text-muted">{waiting ? "Лимит после включения" : "Лимит"}</div>
                  <div className="mt-0.5">{waiting ? <span className="font-semibold">{plannedShort ? "не хватает бюджета" : `≈ ${rub(plannedWeekly)} в неделю`}</span> : <BudgetInline campaignId={camp.id} weekly={camp.weeklyBudget} min={MIN_WEEKLY[ch]} />}</div>
                  {!waiting && camp.platform === "yandex" && DIRECT_VAT > 0 ? (
                    <div className="text-[11.5px] text-muted mt-1 leading-snug" title="Бюджет в сервисе — с НДС, как списывается с вашего счёта. Директ показывает лимит стратегии без НДС.">
                      с НДС · в Директе {rub(netOfVat(camp.weeklyBudget))} без НДС
                    </div>
                  ) : null}
                </div>
                <div className="rounded-xl bg-paper px-3.5 py-3">
                  <div className="text-xs text-muted">Потрачено</div>
                  <div className="mt-0.5 font-semibold">{rub(row.s.cost)}</div>
                </div>
                <div className="rounded-xl bg-paper px-3.5 py-3">
                  <div className="text-xs text-muted">Обращения</div>
                  <div className="mt-0.5 font-semibold">{num(row.s.conversions)}{row.cpl !== null ? <span className="font-normal text-muted"> · по {rub(row.cpl)}</span> : null}</div>
                  {row.cac !== null ? <div className="text-xs text-muted">клиент {row.estimated ? "≈ " : ""}{rub(row.cac)}</div> : null}
                </div>
                <div className="rounded-xl bg-paper px-3.5 py-3">
                  <div className="text-xs text-muted">Оптимизация</div>
                  <div className="mt-0.5 font-semibold text-sm">{camp.strategy === "conversions" ? "по записям" : "по переходам"}</div>
                </div>
              </div>

              {/* Настройки показа — коротко, одна ссылка на изменение */}
              {(() => {
                const sh = showOf(b);
                const l = landingFor(b, ch, appUrl());
                const extra = sh.extraRegions?.length ? ` + ${sh.extraRegions.join(", ")}` : "";
                const where = ch === "vk" && b.geo && sh.geoMode !== "city" && !extra
                  ? `${String(sh.geoMode === "radius" && sh.radiusKm ? sh.radiusKm : Math.round(vkRadiusFor(b.city) / 100) / 10).replace(".", ",")} км от ${b.address ?? "вас"}`
                  : `${b.city}${extra}`;
                const ages = cg.map((g) => (g.targeting ?? {}) as { ageFrom?: number; ageTo?: number; sex?: string });
                const lo = Math.min(...ages.map((t) => t.ageFrom ?? 18)), hi = Math.max(...ages.map((t) => t.ageTo ?? 65));
                const sexes = new Set(ages.map((t) => t.sex ?? "any"));
                const sexWord = sexes.size === 1 && sexes.has("female") ? "Женщины" : sexes.size === 1 && sexes.has("male") ? "Мужчины" : "Все";
                const who = ch === "search"
                  ? `ищут в Яндексе: ${pl(cg.reduce((n, g) => n + new Set((g.keywords ?? []).map(displayKeyword)).size, 0), "запрос", "запроса", "запросов")}`
                  : isRetarget(ch) ? `были на ${b.siteUrl ? "сайте" : "странице записи"}, не записались`
                  : `${sexWord}, ${lo}–${hi} лет · ${pl(cg.length, "аудитория", "аудитории", "аудиторий")}`;
                const tt = timeTargeting(b);
                const when = tt ? tt.note.replace(/^Реклама показывается /, "").replace(/\s*\(.*?\)/, "").replace(/,?\s*ночью — нет\.?$/, "").replace(/\.$/, "") : "круглосуточно";
                const Row = ({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) => (
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span className="mt-0.5 text-faint shrink-0">{icon}</span>
                    <div className="min-w-0"><div className="text-xs text-muted">{label}</div><div className="text-sm text-ink truncate">{children}</div></div>
                  </div>
                );
                return (
                  <div className="mt-3 rounded-xl border border-line px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-faint">Показ</div>
                      <Link href="/app/settings#show" className="text-sm font-semibold text-ink-2 hover:text-ink underline underline-offset-2">Изменить</Link>
                    </div>
                    <div className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-2.5">
                      <Row icon={<Users size={15} />} label="Кому">{who}</Row>
                      <Row icon={<MapPin size={15} />} label="Где">{where}</Row>
                      <Row icon={<Clock size={15} />} label="Когда">{when}</Row>
                      <Row icon={<ExternalLink size={15} />} label="Ведёт на"><a href={l.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">{l.kind === "page" ? "страница записи" : l.kind === "site" ? "сайт" : l.label}</a></Row>
                    </div>
                  </div>
                );
              })()}

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                {camp.platform === "demo" ? (
                  <span>Демо-кабинет{camp.externalId ? ` · кампания № ${camp.externalId}` : ""}</span>
                ) : cab ? (
                  <a href={cab} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-ink-2 hover:text-ink">{PLATFORM_NAME[camp.platform]} · кампания № {camp.externalId} <ExternalLink size={12} /></a>
                ) : <span>{PLATFORM_NAME[camp.platform]}</span>}
              </div>
              {camp.negativeKeywords?.length && fmt !== "vk" ? (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-ink-2 font-medium">Не показываем по {num(camp.negativeKeywords.length)} {plural(camp.negativeKeywords.length, "нецелевому слову", "нецелевым словам", "нецелевым словам")}</summary>
                  <p className="text-muted mt-1.5 leading-relaxed">{camp.negativeKeywords.join(", ")}</p>
                </details>
              ) : null}
              {ch === "search" ? (() => {
                const tv = tvOf(ads.filter((a) => a.campaignId === camp.id).map((a) => a.id));
                const ceiling = ceilingOf(camp);
                if (tv === null) return <p className="hint mt-3">Место среди объявлений появится после первых показов.</p>;
                return (
                  <div className="mt-4 rounded-xl bg-paper p-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                    <div><span className="text-muted">Место среди объявлений: </span><b>{placeName(tv)}</b> <span className="text-faint">(видят {Math.round(tv)}% из возможных)</span></div>
                    <div><span className="text-muted">Средняя цена клика: </span><b>{row.s.clicks ? rub(row.s.cost / row.s.clicks) : "—"}</b></div>
                    <div><span className="text-muted">Максимальная цена клика: </span><b>{ceiling ? rub(ceiling) : "нет — Директ решает сам"}</b></div>
                  </div>
                );
              })() : null}
            </div>

            {ch !== "search" && groupStats.length > 1 ? (() => {
              // A/B аудиторий: те же объявления, разные люди. Сравниваем по обращениям на рубль, пока их мало — по кликабельности
              const sc = scoreGroup(groupStats.map(({ g, s: gs }) => ({ id: g.id, s: gs, live: g.status === "active" && !campOff })), ch);
              const byId = new Map(sc.map((x) => [x.id, x]));
              const rows = [...groupStats].sort((a, b) => rankKey(byId.get(a.g.id)) - rankKey(byId.get(b.g.id)));
              return (
                <div className="px-5 sm:px-7 py-4 border-b border-line bg-paper/40">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="font-semibold flex items-center gap-2"><FlaskConical size={16} /> Сравнение аудиторий (A/B-тест)</div>
                    <div className="text-xs text-muted">за {pl(DAYS, "день", "дня", "дней")}</div>
                  </div>
                  <div className="mt-2.5 overflow-x-auto">
                    <table className="w-full text-sm min-w-[36rem]">
                      <thead><tr className="text-left text-xs text-muted"><th className="font-medium py-1.5 pr-3">Аудитория</th><th className="font-medium pr-3 text-right">Показы</th><th className="font-medium pr-3 text-right">Кликают</th><th className="font-medium pr-3 text-right">Обращения</th><th className="font-medium pr-3 text-right">Обращение</th><th className="font-medium text-right">Итог</th></tr></thead>
                      <tbody>
                        {rows.map(({ g, s: gs }) => {
                          const x = byId.get(g.id);
                          const V = VERDICT[x?.verdict ?? "learning"];
                          return (
                            <tr key={g.id} className="border-t border-line">
                              <td className="py-2 pr-3"><div className="font-medium">{g.name}</div><div className="text-xs text-muted">{g.audience}</div></td>
                              <td className="pr-3 text-right tabular-nums">{num(gs.impressions)}</td>
                              <td className="pr-3 text-right tabular-nums">{gs.impressions ? pct(ctrOf(gs)) : "—"}</td>
                              <td className="pr-3 text-right tabular-nums">{num(gs.conversions)}</td>
                              <td className="pr-3 text-right tabular-nums">{gs.conversions ? rub(gs.cost / gs.conversions) : "—"}</td>
                              <td className="text-right"><span className={`pill ${V.cls}`} title={x?.why}>{V.label}</span></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-muted mt-2 leading-relaxed max-w-3xl">Во всех аудиториях одни и те же объявления — различаются только люди, поэтому видно, какая аудитория приводит обращения дешевле. Робот отключает аудиторию, когда у лучшей набралось от 3 обращений, а у этой обращение вдвое дороже (или их нет при сопоставимых тратах) и разница не случайна. Деньги отключённой переходят лучшим.</p>
                </div>
              );
            })() : null}
            {campOff ? (
              <div className="px-5 sm:px-7 py-3 bg-paper border-b border-line text-sm text-ink-2 flex items-center gap-2">
                <span className="pill bg-line text-muted">Не показываются</span>
                Канал выключен — все его группы и объявления неактивны. Включите канал переключателем вверху, и они вернутся в том же виде.
              </div>
            ) : null}
            {groupStats
              .sort((x, y) => LAYERS.indexOf(layerOf(x.g)) - LAYERS.indexOf(layerOf(y.g)) || (y.g.status === "active" ? 1 : 0) - (x.g.status === "active" ? 1 : 0) || y.s.conversions - x.s.conversions || ctrOf(y.s) - ctrOf(x.s))
              .map(({ g, s: gs }, gi, arr) => {
                const layer = layerOf(g);
                const head = layered && (gi === 0 || layerOf(arr[gi - 1].g) !== layer) ? layerSum(layer) : null;
                const item = ch === "search" ? LAYER_ITEM[layer] : "Аудитория";
                const gAds = visible
                  .filter((a) => a.adGroupId === g.id)
                  .sort((x, y) => rankKey(scores.get(x.id)) - rankKey(scores.get(y.id)));
                const hidden = ads.filter((a) => a.adGroupId === g.id && (a.status === "archived" || a.status === "error")).length;
                const gTv = ch === "search" ? tvOf(ads.filter((a) => a.adGroupId === g.id).map((a) => a.id)) : null;
                return (
                  <Fragment key={g.id}>
                  {head ? (
                    <div className="px-5 sm:px-7 py-2.5 bg-paper border-b border-line flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <div className="font-semibold">{LAYER_LABEL[layer]}</div>
                      <div className="text-sm text-muted">{pl(head.groups, "группа", "группы", "групп")} · {pl(head.keywords, "запрос", "запроса", "запросов")}{head.on < head.groups ? ` · включено ${head.on}` : ""}</div>
                    </div>
                  ) : null}
                  <div className={`relative border-b border-line last:border-b-0 ${g.status !== "active" || campOff ? "bg-paper/60" : ""} ${campOff ? "opacity-60" : ""}`}>
                  <details className="group/g" open={cg.length === 1}>
                    <summary className="list-none cursor-pointer px-5 sm:px-7 py-4 pr-24 flex items-start gap-2.5 hover:bg-paper/50">
                      <ChevronRight size={18} className="shrink-0 mt-0.5 text-muted transition group-open/g:rotate-90" />
                      <div className="min-w-0 flex-1">
                        <div className="font-bold break-words">{ch !== "search" && /:|«/.test(g.name) ? g.name : `${item}: ${g.name}`}</div>
                        <div className="text-sm text-muted">
                          {pl(gAds.length, "объявление", "объявления", "объявлений")} · {rub(gs.cost)}, {pl(gs.conversions, "обращение", "обращения", "обращений")}{gs.conversions ? ` по ${rub(gs.cost / gs.conversions)}` : ""}{ch === "search" && gTv !== null ? ` · ${placeName(gTv)}` : ""}
                        </div>
                        <div className="text-xs text-faint mt-0.5 truncate">
                          {ch === "search" ? `${pl(new Set((g.keywords ?? []).map(displayKeyword)).size, "запрос", "запроса", "запросов")}: ${[...new Set((g.keywords ?? []).map(displayKeyword))].slice(0, 3).join(", ")}…` : [(() => { const t = (g.targeting ?? {}) as { ageFrom?: number; ageTo?: number; sex?: string }; const sx = t.sex === "female" ? "женщины" : t.sex === "male" ? "мужчины" : "все"; return t.ageFrom || t.ageTo ? `${sx}, ${t.ageFrom ?? 18}–${t.ageTo ?? 65} лет` : sx === "все" ? "" : sx; })(), showOf(b).ageFrom != null || showOf(b).ageTo != null || showOf(b).sex ? null : g.audience].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                    </summary>
                    <div className="px-5 sm:px-7 pb-5 sm:pb-7">
                    <div className="grid items-start gap-3 grid-cols-1">
                      <div className="min-w-0">
                        {ch !== "search" ? (
                          <div className="text-sm grid gap-0.5">
                            <div><span className="text-muted">Кто:</span> {(() => { const t = (g.targeting ?? {}) as { ageFrom?: number; ageTo?: number; sex?: string }; const sx = t.sex === "female" ? "женщины" : t.sex === "male" ? "мужчины" : "все"; return t.ageFrom || t.ageTo ? `${sx}, ${t.ageFrom ?? 18}–${t.ageTo ?? 65} лет` : sx === "все" ? "" : sx; })() || "все"}{g.audience ? ` · ${g.audience}` : ""}</div>
                            <div><span className="text-muted">Где:</span> {isRetarget(ch) ? "только те, кто уже был на сайте" : b.city}</div>
                          </div>
                        ) : null}
                        {g.keywords?.length && ch === "search" ? (() => {
                          const kws = [...new Set(g.keywords.map(displayKeyword))];
                          const neg = ((g.targeting ?? {}) as { negatives?: string[] }).negatives ?? [];
                          return (
                            <details className="mt-1.5 text-sm group/kw">
                              <summary className="cursor-pointer list-none inline-flex items-start gap-1.5 text-ink-2 font-medium">
                                <span>{pl(kws.length, "запрос", "запроса", "запросов")}</span>
                                <span className="text-faint font-normal truncate max-w-[16rem] sm:max-w-md">{kws.slice(0, 3).join(", ")}{kws.length > 3 ? "…" : ""}</span>
                                <ChevronDown size={14} className="shrink-0 mt-0.5 transition group-open/kw:rotate-180" />
                              </summary>
                              <p className="mt-1.5 text-muted leading-relaxed break-words">{kws.join(", ")}</p>
                              {neg.length ? (
                                <p className="mt-1.5 text-faint leading-relaxed break-words">
                                  <span className="text-ink-2">Не показываем по словам</span> (их ищут в соседних группах): {neg.join(", ")}
                                </p>
                              ) : null}
                            </details>
                          );
                        })() : null}
                        {ch === "search" && gTv !== null ? (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            <span className="pill bg-mark-soft text-ink">≈ {placeName(gTv)}</span>
                            {gs.clicks ? <span className="pill bg-paper text-ink-2">средний клик {rub(gs.cost / gs.clicks)}</span> : null}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {ch === "search" && gTv !== null && gAds[0] ? (
                      <details className="mt-3 group/serp">
                        <summary className="cursor-pointer list-none text-sm font-semibold text-ink-2 inline-flex items-start gap-1.5"><Eye size={15} className="shrink-0 mt-0.5" /> <span>Как это выглядит в выдаче и сколько стоит каждое место</span> <ChevronDown size={14} className="shrink-0 mt-0.5 transition group-open/serp:rotate-180" /></summary>
                        <div className="mt-3 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_20rem] gap-4 items-start">
                          <SerpScheme
                            query={g.keywords?.[0] ? displayKeyword(g.keywords[0]) : g.name.toLowerCase()}
                            tv={gTv}
                            tiers={groupTiers(camp, g.id)}
                            yourCpc={gs.clicks ? gs.cost / gs.clicks : null}
                            ad={<SearchAdPreview title={gAds[0].title} title2={gAds[0].title2} text={gAds[0].text} host={host} image={gAds[0].imageId ? `/api/images/${gAds[0].imageId}` : null} full={false} extras={withPlanCallouts(adExtras(b, { channel: ch, href: landing, service: g.name, text: gAds[0].text }), planCallouts)} />}
                          />
                          <div className="rounded-xl border border-line p-4">
                            <div className="font-semibold">Цена клика за место</div>
                            <p className="text-xs text-muted mt-0.5 mb-3">Медиана по фразам этой услуги, по данным аукциона Директа</p>
                            {groupTiers(camp, g.id).length ? <AuctionTable tiers={groupTiers(camp, g.id)} tv={gTv} ceiling={ceilingOf(camp)} /> : <p className="text-sm text-muted">Аукцион обновится при следующей проверке.</p>}
                          </div>
                        </div>
                      </details>
                    ) : null}

                    <ol className="mt-4 grid gap-2">
                      {gAds.map((ad) => {
                        const sc = scores.get(ad.id)!;
                        const s = sc.s;
                        const inTest = running.some((e) => e.controlId === ad.id || e.variantId === ad.id);
                        const V = VERDICT[sc.verdict];
                        const blocked = ad.status === "active" && /^Не показывается/.test(ad.statusNote ?? "");
                        // Коротко, в чём дело: сначала лицензия, потом деньги на счёте, потом пояснение площадки
                        const campNote = states.get(camp.id)?.note ?? "";
                        const blockedWhy = !blocked ? "" : /документ|лиценз/i.test(ad.statusNote ?? "") ? "Нужна лицензия — отправьте её в Директе"
                          : /средств|пополн/i.test(campNote) ? "Нет денег на счёте Директа"
                          : /сайт недоступен/i.test(ad.statusNote ?? "") ? "Сайт недоступен — Директ остановил показы"
                          : /причина в статусе|кампания остановлена/i.test(ad.statusNote ?? "") ? (campNote ? campNote.replace(/^Не показывается:\s*/, "") : "Кампания остановлена в Директе")
                          : (ad.statusNote ?? "").replace(/^Не показывается:\s*/, "");
                        const special = waiting && ad.status === "moderation" ? { text: "Ждёт включения", cls: "bg-paper text-muted" } : campOff && ad.status !== "archived" ? { text: "Не показывается — канал выключен", cls: "bg-paper text-muted" } : blocked ? { text: /документ/i.test(ad.statusNote ?? "") ? "Нужны документы" : "Не показывается", cls: "bg-bad-soft text-bad" } : STATUS[ad.status];
                        const layout = ad.imageId ? layoutOf.get(ad.imageId) : null;
                        return (
                          <li key={ad.id} className={`rounded-xl border ${sc.verdict === "leader" ? "border-good/40 bg-good-soft/40" : "border-line"} ${ad.status === "paused" ? "opacity-60" : ""}`}>
                            <details className="group" open={ad.status === "rejected"}>
                              <summary className="list-none cursor-pointer p-3 sm:p-4 grid grid-cols-[2rem_1fr] sm:grid-cols-[2rem_1fr_15rem] gap-x-3 gap-y-2 items-center">
                                <div className={`w-8 h-8 rounded-full grid place-items-center text-sm font-extrabold ${sc.verdict === "leader" ? "bg-good text-white" : sc.rank ? "bg-paper text-ink-2" : "bg-paper text-faint"}`}>
                                  {sc.rank ?? "·"}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="font-semibold line-clamp-2 sm:line-clamp-1">{ad.title}</span>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                    {special ? <span className={`pill ${special.cls}`}>{special.text}</span> : <span className={`pill ${V.cls}`}>{V.label}</span>}
                                    {inTest ? <span className="pill bg-mark-soft text-ink">Проверяется</span> : null}
                                    <span className="pill bg-paper text-muted max-w-full truncate">Идея: {ANGLES[ad.angle]?.name ?? ad.angle}</span>
                                    {layout && ch !== "search" ? <span className="pill bg-paper text-muted">Картинка: {LAYOUT_NAME[layout] ?? layout}</span> : null}
                                    {ch === "search" && tvOf([ad.id]) !== null ? <span className="pill bg-paper text-muted">Место: {placeName(tvOf([ad.id])!).replace(" над результатами", "")}</span> : null}
                                  </div>
                                  <p className="text-sm text-muted mt-1.5 leading-snug">
                                    {ad.status === "rejected" ? <span className="text-bad">{cleanNote(ad.statusNote) ?? "Модерация не пропустила объявление — что делать, ниже"}</span> : blocked ? <span className="text-bad">{blockedWhy.replace(/\.$/, "")}. <a href={`#c-${camp.id}`} className="underline">Подробнее</a></span> : sc.why}
                                  </p>
                                </div>
                                <div className="col-start-2 sm:col-start-3 sm:row-start-1 grid gap-1.5">
                                  {sc.rank ? (
                                    <div className="h-2 rounded-full bg-paper overflow-hidden" title="Насколько хорошо по сравнению с лучшим в группе">
                                      <div className={`h-full rounded-full ${sc.verdict === "leader" || sc.verdict === "good" ? "bg-good" : sc.verdict === "weak" ? "bg-bad" : "bg-ink-2"}`} style={{ width: `${Math.max(6, Math.round(sc.rel * 100))}%` }} />
                                    </div>
                                  ) : null}
                                  <div className="grid grid-cols-3 gap-1 text-xs text-center">
                                    <div><div className="text-faint">Клики</div><div className="font-semibold tabular-nums">{num(s.clicks)}</div></div>
                                    <div><div className="text-faint">Кликают</div><div className="font-semibold tabular-nums">{s.impressions ? pct(ctrOf(s)) : "—"}</div></div>
                                    <div><div className="text-faint">Обращения</div><div className="font-semibold tabular-nums">{num(s.conversions)}</div></div>
                                  </div>
                                  <div className="flex items-center justify-end gap-1 text-xs text-ink-2 font-medium">
                                    <Eye size={13} /> Как выглядит <ChevronDown size={13} className="transition group-open:rotate-180" />
                                  </div>
                                </div>
                              </summary>
                              <div className="px-3 pb-4 sm:px-4 sm:pl-[3.75rem] grid grid-cols-1 gap-3 min-w-0">
                                {ad.status === "rejected" ? (
                                  <RejectHelp
                                    note={cleanNote(ad.statusNote)}
                                    problems={claimProblems(`${ad.title}. ${ad.title2 ?? ""}. ${ad.text}`, isMedical(b))}
                                    medical={isMedical(b)}
                                    platform={camp.platform}
                                    adLink={camp.platform === "vk" && camp.externalId && g.externalId && ad.externalId ? `https://ads.vk.ru/hq/dashboard/plans/${camp.externalId}/groups/${g.externalId}/ads/${ad.externalId}` : cabinetUrl(camp.platform, camp.externalId, loginOf.get(camp.accountId))}
                                  />
                                ) : null}
                                <div className={`min-w-0 ${ch === "search" ? "max-w-xl" : "max-w-sm"}`}>
                                  {ch === "search" ? (
                                    <SearchAdPreview title={ad.title} title2={ad.title2} text={ad.text} host={host} image={ad.imageId ? `/api/images/${ad.imageId}` : null} extras={withPlanCallouts(adExtras(b, { channel: ch, href: landing, service: g.name, text: ad.text }), planCallouts)} />
                                  ) : (
                                    <ImageAdPreview channel={fmt === "vk" ? "vk" : "network"} title={ad.title} text={ad.text} host={fmt === "vk" ? b.name : host} image={ad.imageId ? `/api/images/${ad.imageId}` : null} extras={adExtras(b, { channel: fmt, href: landing, text: ad.text })} logo={logoId ? `/api/images/${logoId}` : null} />
                                  )}
                                </div>
                                {combinatorial ? (() => {
                                  const gt = (g.targeting ?? {}) as { service?: string; services?: string[] };
                                  const ra = responsiveAssets(b, ad, { service: ch === "search" ? gt.service ?? g.name : null, services: ch === "search" ? gt.services : null });
                                  return <ResponsiveAssets titles={ra.titles} texts={ra.texts} className={ch === "search" ? "max-w-xl" : "max-w-sm"} />;
                                })() : null}
                                <div className="text-xs text-muted">{pl(s.impressions, "показ", "показа", "показов")} · потрачено {rub(s.cost)}{s.conversions ? ` · обращение по ${rub(s.cost / s.conversions)}` : ""}</div>
                                <AdActions ad={{ id: ad.id, title: ad.title, title2: ad.title2, text: ad.text, status: ad.status }} channel={fmt} canTest={!inTest && camp.status === "active" && !running.some((e) => gAds.some((x) => x.id === e.controlId || x.id === e.variantId))} />
                              </div>
                            </details>
                          </li>
                        );
                      })}
                    </ol>
                    {hidden ? <p className="hint mt-3">Ещё {pl(hidden, "объявление", "объявления", "объявлений")} — {hidden === 1 ? "заменено более удачным вариантом или не принято" : "заменены более удачными вариантами или не приняты"} площадкой. Подробности — в «Истории».</p> : null}
                    </div>
                  </details>
                  {cg.length > 1 ? (
                    <label className="absolute right-5 sm:right-7 top-4 flex items-center gap-2 text-sm font-semibold">
                      {campOff ? (
                        <span className="pointer-events-none opacity-50" title="Канал выключен" inert><LiveToggle key="off" url={`/api/groups/${g.id}`} on={false} label={`${item} ${g.name}: канал выключен`} /></span>
                      ) : <LiveToggle url={`/api/groups/${g.id}`} on={g.status === "active"} label={`${item} ${g.name}`} />}
                    </label>
                  ) : null}
                  </div>
                  </Fragment>
                );
              })}
          </section>
        );
      })}

      {/* ─── Яндекс Карты: не кампания, а места показа поиска ─── */}
      {mapsItem && shownIds.has("maps") ? (
        <section id="maps" className="card p-5 sm:p-7 scroll-mt-28">
          <div className="flex flex-wrap items-center gap-2">
            <PlatformMark family="yandex" label />
            <TypeBadge type="maps" />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2">
            <h2 className="text-xl font-bold flex items-center gap-2"><MapPin size={20} /> Яндекс Карты</h2>
            {mapsItem.on ? <span className="pill bg-good-soft text-good">подключено</span> : <span className="pill bg-warn-soft text-warn">привяжите организацию</span>}
          </div>
          <p className="text-sm text-muted mt-1 max-w-2xl"><Purpose type="maps" />.</p>
          {mapsItem.on ? (
            <p className="text-[0.95rem] mt-3 leading-relaxed max-w-2xl">
              Объявления кампании <a href={`#c-${mapsItem.camp.id}`} className="font-semibold underline underline-offset-2">«Поиск»</a> показываются и на Яндекс Картах, и в списке организаций — рядом с вашей точкой, с адресом, часами работы и рейтингом.
              Отдельного бюджета и отдельной кампании нет: это места показа поиска, расход и обращения входят в «Поиск».
              {b.orgUrl ? <> <a href={b.orgUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-ink-2 underline underline-offset-2">Ваша организация на Картах <ExternalLink size={13} /></a></> : null}
            </p>
          ) : (
            <div className="mt-3 rounded-xl bg-warn-soft/60 p-4 text-[0.95rem] leading-relaxed max-w-2xl">
              Чтобы реклама показывалась на Яндекс Картах, нужна организация в Яндекс Бизнесе. Добавьте ссылку на неё — робот привяжет профиль к поиску, и объявления появятся на Картах рядом с вашей точкой, без отдельного бюджета.
              <div className="mt-3"><Link href="/app/start#org" className="btn btn-primary btn-sm">Привязать организацию</Link></div>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );

  function ItemStatus({ it }: { it: Item }) {
    if (!it.camp) return mapsItem?.on ? <span className="pill bg-good-soft text-good">подключено</span> : <span className="pill bg-warn-soft text-warn">привяжите организацию</span>;
    const c = it.camp;
    const a = audiences.get(c.id);
    if (isRetarget(c.channel) && c.status === "paused" && a && a.state !== "on") {
      return a.state === "off" ? <span className="pill bg-paper text-muted">автозапуск выключен</span> : <AudienceBar size={a.size} need={a.need} compact />;
    }
    return <CampaignPill s={states.get(c.id)} ch={c.channel} short />;
  }
}

function rankKey(sc?: AdScore) {
  if (!sc) return 999;
  if (sc.rank) return sc.rank;
  return sc.verdict === "learning" ? 100 : 200;
}

function Tile({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-paper p-4">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-faint">{icon}{label}</div>
      <div className="mt-2 text-[0.95rem] leading-snug">{children}</div>
    </div>
  );
}

function Duel({ label, title, note, s, ahead }: { label: string; title?: string; note?: string; s: S; ahead: boolean }) {
  return (
    <div className={`min-w-0 rounded-lg p-3 ${ahead ? "bg-good-soft" : "bg-paper"}`}>
      <div className="text-xs text-faint flex justify-between"><span>{label}</span>{ahead ? <span className="text-good font-semibold">пока впереди</span> : null}</div>
      <div className="font-medium truncate">«{title ?? "—"}»</div>
      {note ? <div className="text-xs text-ink-2 truncate">{note}</div> : null}
      <div className="text-xs text-muted mt-0.5">{s.impressions ? `${pl(s.clicks, "клик", "клика", "кликов")} из ${pl(s.impressions, "показа", "показов", "показов")} · ${pct(ctrOf(s))}` : "копим показы"}</div>
    </div>
  );
}

function CampaignPill({ s, ch, short = false }: { s?: { stopped: string | null; learningLeft: number; note?: string | null }; ch: string; short?: boolean }) {
  if (s?.stopped === "guard") return <span className="pill bg-bad-soft text-bad">{short ? "Стоит: бюджет" : "Стоит: кончился бюджет месяца"}</span>;
  if (s?.stopped === "error") return <span className="pill bg-bad-soft text-bad">Ошибка площадки</span>;
  if (s?.stopped === "platform") return <span className="pill bg-bad-soft text-bad" title={s.note ?? undefined}>{/средств|пополн/i.test(s.note ?? "") ? (short ? "Нет денег" : "Не показывается") : /модерац/i.test(s.note ?? "") ? "На модерации" : "Не показывается"}</span>;
  if (s?.stopped === "audience") return <span className="pill bg-good-soft text-good">Копим аудиторию</span>;
  if (s?.stopped === "robot") return <span className="pill bg-paper text-muted">{short ? "Пауза — робот" : "На паузе — остановил робот"}</span>;
  if (s?.stopped) return <span className="pill bg-paper text-muted">{short ? "Пауза — вы" : "На паузе — вы остановили"}</span>;
  if (s && s.learningLeft > 0)
    return (
      <span className="pill bg-info-soft text-ink-2" title={`Обучение после запуска длится до ${pl(LEARNING_DAYS[ch] ?? 14, "дня", "дней", "дней")}, после изменения бюджета — до 7. В это время робот не меняет стратегию, ставки и лимит кампании; объявления и аудитории проверяет как обычно`}>
        <GraduationCap size={13} /> {short ? `обучается, ${pl(s.learningLeft, "день", "дня", "дней")}` : `обучается ещё ${pl(s.learningLeft, "день", "дня", "дней")}`}
      </span>
    );
  return <span className="pill bg-good-soft text-good">Идёт</span>;
}

/** Причина отклонения без мусора вроде «[object Object]» */
function cleanNote(n: string | null | undefined): string | null {
  const t = (n ?? "").replace(/\[object Object\];?\s*/g, "").trim();
  return t || null;
}

/** Отклонённое объявление: почему и что делать — по шагам */
function RejectHelp({ note, problems, medical, platform, adLink }: { note: string | null; problems: string[]; medical: boolean; platform: string; adLink: string | null }) {
  const where = platform === "vk" ? "VK Рекламы" : "Яндекс Директа";
  return (
    <div className="rounded-xl border border-bad/30 bg-bad-soft/50 p-4 text-sm text-ink-2 grid gap-3 max-w-2xl">
      <div className="font-bold text-ink">Модерация не пропустила объявление. Что делать</div>
      <ol className="list-decimal pl-5 grid gap-2 leading-relaxed">
        <li>
          {note ? <>Причина от площадки: <b className="text-bad">{note}</b>.</> : <>Площадка не передала причину текстом — она видна в кабинете {where} у этого объявления.</>}
          {adLink ? <> <a href={adLink} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2 inline-flex items-center gap-1">Открыть объявление в кабинете<ExternalLink size={12} /></a></> : null}
        </li>
        {problems.length ? (
          <li>Мы проверили текст и нашли, что могло помешать: <b>{problems.join(", ")}</b>. Нажмите «Текст» ниже и уберите это из заголовка и текста.</li>
        ) : null}
        {medical ? (
          <li>Для медицинских услуг {platform === "vk" ? "VK" : "Директ"} просит лицензию. Если в причине упомянуты документы — загрузите лицензию в кабинете у объявления (кнопка загрузки документов появится там же). Какой документ нужен — <a href="#license-help" className="font-semibold underline underline-offset-2">ниже</a>.</li>
        ) : null}
        <li>Или ничего не делайте: при следующей проверке (раз в день) робот сам перепишет объявление без спорных мест и отправит на модерацию заново.</li>
      </ol>
      {medical ? <details id="license-help"><summary className="cursor-pointer font-semibold text-ink">Какая лицензия нужна и куда её загрузить</summary><div className="mt-3"><MedicalLicenseGuide /></div></details> : null}
    </div>
  );
}

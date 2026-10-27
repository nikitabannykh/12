import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { FlaskConical, Trophy, Lightbulb, Image as ImageIcon, Eye, ChevronDown, GraduationCap } from "lucide-react";
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
import { MAX_MONTHLY, MIN_WEEKLY, allocate } from "@/lib/engine/budget";
import { ANGLES } from "@/lib/niches";
import { LAYOUT_NAME, type Layout } from "@/lib/creative/render";
import { adExtras, responsiveAssets, withPlanCallouts } from "@/lib/engine/extras";
import { placeName, scoreGroup, liftBy, addS, zeroS, ctrOf, VERDICT, type S, type AdScore } from "@/lib/engine/insights";
import Link from "next/link";
import { addDays, hostOf, isoDay, num, pl, plural, rub } from "@/lib/util";
import type { Channel } from "@/lib/platforms/types";

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
const SHORT: Record<string, string> = { search: "Поиск", network: "Сайты и приложения", vk: "ВКонтакте" };
const DAYS = 14;
/** Оценка без данных не должна выглядеть как «Лучшее» */
function shown(sc: AdScore): AdScore {
  if (sc.verdict === "off" || sc.verdict === "learning") return sc;
  if (!sc.s.impressions || ((sc.verdict === "leader" || sc.verdict === "good") && !sc.s.clicks && !sc.s.conversions)) {
    return { ...sc, rank: null, verdict: "learning", rel: 0, why: sc.s.impressions ? `${pl(sc.s.impressions, "показ", "показа", "показов")}, кликов пока нет — копим данные` : "Показов пока не было — копим данные" };
  }
  return sc;
}

export default async function AdsPage() {
  const user = await requireUser();
  const b = await getBusinessForUser(user.id);
  if (!b) redirect("/app/start");
  if (b.status !== "active") redirect("/app/launch");
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
  const order: Channel[] = ["search", "network", "vk"];
  camps.sort((a, b) => order.indexOf(a.channel as Channel) - order.indexOf(b.channel as Channel));
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

  return (
    <div className="grid grid-cols-1 gap-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Реклама</h1>
        <p className="text-muted mt-1 max-w-2xl">Что приносит клиентов, а что нет. Цифры за последние {pl(DAYS, "день", "дня", "дней")} — так у сравнений больше данных. Можно менять всё вручную: робот учтёт ваши решения.</p>
      </div>

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
          {weakCount ? ` — сейчас таких ${weakCount}` : ""}.
        </p>
      </section>

      {/* ─── Каналы рядом ─── */}
      {chRows.length > 1 ? (
        <section className="card p-5 sm:p-7">
          <h2 className="text-lg font-bold">Каналы рядом</h2>
          {/* Телефон: карточки вместо таблицы с прокруткой */}
          <ul className="mt-3 grid gap-3 sm:hidden">
            {chRows.map((r) => {
              const share = totalConv ? r.s.conversions / totalConv : 0;
              const best = bestCh && r.c.id === bestCh.c.id && withLeads.length > 1;
              const ratio = bestCh && r.cpl !== null && !best ? r.cpl / bestCh.cpl! : 0;
              const st8 = states.get(r.c.id);
              return (
                <li key={r.c.id} className="rounded-xl border border-line p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold">{SHORT[r.ch]}</div>
                      {st8?.stopped ? <span className="pill bg-paper text-muted mt-1">пауза</span> : best ? <span className="pill bg-good text-white mt-1">дешевле всех</span> : ratio >= 1.6 ? <span className="pill bg-warn-soft text-warn mt-1">в {ratio.toFixed(1).replace(".", ",")} раза дороже</span> : null}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-extrabold tabular-nums">{r.cac !== null ? `${r.estimated ? "≈ " : ""}${rub(r.cac)}` : "—"}</div>
                      <div className="text-xs text-muted">клиент</div>
                    </div>
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                    <div><dt className="text-xs text-muted">Потрачено</dt><dd className="font-semibold tabular-nums">{rub(r.s.cost)}</dd></div>
                    <div><dt className="text-xs text-muted">Обращения</dt><dd className="font-semibold tabular-nums">{num(r.s.conversions)}</dd></div>
                    <div><dt className="text-xs text-muted">Обращение</dt><dd className="font-semibold tabular-nums">{r.cpl !== null ? rub(r.cpl) : "—"}</dd></div>
                  </dl>
                  {totalConv ? (
                    <div className="mt-3 flex items-center gap-2 text-xs text-muted">
                      <div className="h-1.5 flex-1 rounded-full bg-paper overflow-hidden"><div className={`h-full rounded-full ${best ? "bg-good" : "bg-ink-2"}`} style={{ width: `${Math.round(share * 100)}%` }} /></div>
                      <span className="tabular-nums">{Math.round(share * 100)}% обращений</span>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="mt-3 overflow-x-auto hidden sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-faint">
                  <th className="font-medium py-2 pr-2">Канал</th>
                  <th className="font-medium py-2 px-1 text-right">Потрачено</th>
                  <th className="font-medium py-2 px-1 text-right">Обращения</th>
                  <th className="font-medium py-2 px-1 text-right hidden sm:table-cell">Цена обращения</th>
                  <th className="font-medium py-2 pl-1 text-right">Клиент</th>
                  <th className="font-medium py-2 pl-3 w-[24%] hidden md:table-cell">Доля обращений</th>
                </tr>
              </thead>
              <tbody>
                {chRows.map((r) => {
                  const share = totalConv ? r.s.conversions / totalConv : 0;
                  const best = bestCh && r.c.id === bestCh.c.id && withLeads.length > 1;
                  const ratio = bestCh && r.cpl !== null && !best ? r.cpl / bestCh.cpl! : 0;
                  const st8 = states.get(r.c.id);
                  return (
                    <tr key={r.c.id} className="border-t border-line align-top">
                      <td className="py-2.5 pr-2 font-semibold">
                        <div>{SHORT[r.ch]}</div>
                        {st8?.stopped ? <span className="pill bg-paper text-muted mt-1">пауза</span> : best ? <span className="pill bg-good text-white mt-1 whitespace-normal">дешевле всех</span> : ratio >= 1.6 ? <span className="pill bg-warn-soft text-warn mt-1 whitespace-normal">в {ratio.toFixed(1).replace(".", ",")} раза дороже</span> : null}
                      </td>
                      <td className="py-2.5 px-1 text-right tabular-nums whitespace-nowrap">{rub(r.s.cost)}</td>
                      <td className="py-2.5 px-1 text-right tabular-nums">{num(r.s.conversions)}</td>
                      <td className="py-2.5 px-1 text-right tabular-nums hidden sm:table-cell">{r.cpl !== null ? rub(r.cpl) : "—"}</td>
                      <td className="py-2.5 pl-1 text-right tabular-nums font-semibold whitespace-nowrap">{r.cac !== null ? `${r.estimated ? "≈ " : ""}${rub(r.cac)}` : "—"}</td>
                      <td className="py-2.5 pl-3 hidden md:table-cell">
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 rounded-full bg-paper overflow-hidden"><div className={`h-full rounded-full ${best ? "bg-good" : "bg-ink-2"}`} style={{ width: `${Math.round(share * 100)}%` }} /></div>
                          <span className="tabular-nums text-muted w-9 text-right">{Math.round(share * 100)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="hint mt-3">«Клиент» — сколько стоил один клиент из этого канала{chRows.some((r) => r.estimated) ? " (≈ — оценка, пока вы не отметили клиентов за неделю в «Статистике»)" : ""}. Раз в неделю робот переносит до четверти бюджета из дорогого канала в тот, где обращение дешевле.</p>
        </section>
      ) : null}

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

      {/* ─── Каналы подробно ─── */}
      {camps.map((camp) => {
        const ch = camp.channel as Channel;
        // Группы, перенесённые роботом в новые (в Директе кончилось место для объявлений), не показываем
        const cg = groups.filter((g) => g.campaignId === camp.id && g.status !== "archived");
        // Директ: объявления комбинаторные — Яндекс собирает показ из нескольких заголовков и текстов
        const combinatorial = (ch === "search" || ch === "network") && camp.platform !== "vk";
        const row = chRows.find((r) => r.c.id === camp.id)!;
        const groupStats = cg.map((g) => ({ g, s: ads.filter((a) => a.adGroupId === g.id).reduce((acc, a) => addS(acc, st(a.id)), zeroS()) }));
        return (
          <section key={camp.id} className="card overflow-hidden">
            <div className="p-5 sm:p-7 border-b border-line">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <h2 className="text-xl font-bold">{CHANNEL_NAME[ch]}</h2>
                    <CampaignPill s={states.get(camp.id)} ch={ch} />
                  </div>
                  <p className="text-sm text-muted mt-1">{CHANNEL_HINT[ch]}. {PLATFORM_NAME[camp.platform]}.</p>
                </div>
                <label className="flex items-center gap-2 text-sm font-semibold shrink-0">
                  {camp.status === "active" ? "Включён" : "Выключен"}
                  <LiveToggle url={`/api/campaigns/${camp.id}`} on={camp.status === "active"} label={`Канал ${CHANNEL_NAME[ch]}`} confirmOff="Остановить показы в этом канале? Настройки и статистика сохранятся." />
                </label>
              </div>
              {(states.get(camp.id)?.learningLeft ?? 0) > 0 ? (
                <p className="mt-3 text-sm text-ink-2 rounded-xl bg-info-soft px-4 py-3 leading-relaxed">
                  После запуска или крупных изменений площадка заново подбирает аудиторию — в это время цифры скачут, и это нормально. Робот не меняет стратегию, бюджет и цену клика ещё {pl(states.get(camp.id)!.learningLeft, "день", "дня", "дней")}, чтобы не сбить обучение.
                </p>
              ) : null}
              <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                <div><div className="text-muted">Лимит</div><BudgetInline campaignId={camp.id} weekly={camp.weeklyBudget} min={MIN_WEEKLY[ch]} /></div>
                <div><div className="text-muted">Как тратится</div><div className="font-semibold">{camp.strategy === "conversions" ? "Ищем тех, кто чаще записывается" : "Ищем больше переходов за бюджет"}</div></div>
                <div><div className="text-muted">Потрачено</div><div className="font-semibold">{rub(row.s.cost)}</div></div>
                <div><div className="text-muted">Обращения</div><div className="font-semibold">{num(row.s.conversions)}{row.cpl !== null ? ` · по ${rub(row.cpl)}` : ""}</div>{row.cac !== null ? <div className="text-xs text-muted">клиент {row.estimated ? "≈ " : ""}{rub(row.cac)}</div> : null}</div>
              </div>
              {camp.negativeKeywords?.length && ch !== "vk" ? (
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

            {groupStats
              .sort((x, y) => (y.g.status === "active" ? 1 : 0) - (x.g.status === "active" ? 1 : 0) || y.s.conversions - x.s.conversions || ctrOf(y.s) - ctrOf(x.s))
              .map(({ g, s: gs }) => {
                const gAds = visible
                  .filter((a) => a.adGroupId === g.id)
                  .sort((x, y) => rankKey(scores.get(x.id)) - rankKey(scores.get(y.id)));
                const hidden = ads.filter((a) => a.adGroupId === g.id && (a.status === "archived" || a.status === "error")).length;
                const gTv = ch === "search" ? tvOf(ads.filter((a) => a.adGroupId === g.id).map((a) => a.id)) : null;
                return (
                  <div key={g.id} className={`p-5 sm:p-7 border-b border-line last:border-b-0 ${g.status !== "active" ? "bg-paper/60" : ""}`}>
                    <div className={`grid items-start gap-3 ${cg.length > 1 ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-1"}`}>
                      <div className="min-w-0">
                        <div className="font-bold break-words">{ch === "search" ? "Услуга" : "Аудитория"}: {g.name}</div>
                        <div className="text-sm text-muted">
                          {g.audience ? `${g.audience} · ` : ""}{rub(gs.cost)}, {pl(gs.conversions, "обращение", "обращения", "обращений")}{gs.conversions ? ` по ${rub(gs.cost / gs.conversions)}` : ""}
                        </div>
                        {g.keywords?.length && ch === "search" ? <div className="text-sm text-faint mt-1 line-clamp-2 sm:line-clamp-1 break-words">Запросы: {g.keywords.join(", ")}</div> : null}
                        {ch === "search" && gTv !== null ? (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            <span className="pill bg-mark-soft text-ink">≈ {placeName(gTv)}</span>
                            {gs.clicks ? <span className="pill bg-paper text-ink-2">средний клик {rub(gs.cost / gs.clicks)}</span> : null}
                          </div>
                        ) : null}
                      </div>
                      {cg.length > 1 ? (
                        <label className="flex items-center gap-2 text-sm font-semibold justify-self-end">
                          <LiveToggle url={`/api/groups/${g.id}`} on={g.status === "active"} label={`${ch === "search" ? "Услуга" : "Аудитория"} ${g.name}`} />
                        </label>
                      ) : null}
                    </div>

                    {ch === "search" && gTv !== null && gAds[0] ? (
                      <details className="mt-3 group/serp">
                        <summary className="cursor-pointer list-none text-sm font-semibold text-ink-2 inline-flex items-start gap-1.5"><Eye size={15} className="shrink-0 mt-0.5" /> <span>Как это выглядит в выдаче и сколько стоит каждое место</span> <ChevronDown size={14} className="shrink-0 mt-0.5 transition group-open/serp:rotate-180" /></summary>
                        <div className="mt-3 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_20rem] gap-4 items-start">
                          <SerpScheme
                            query={g.keywords?.[0] ?? g.name.toLowerCase()}
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
                        const special = STATUS[ad.status];
                        const layout = ad.imageId ? layoutOf.get(ad.imageId) : null;
                        return (
                          <li key={ad.id} className={`rounded-xl border ${sc.verdict === "leader" ? "border-good/40 bg-good-soft/40" : "border-line"} ${ad.status === "paused" ? "opacity-60" : ""}`}>
                            <details className="group">
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
                                    {ad.statusNote && (ad.status === "rejected") ? <span className="text-bad">{ad.statusNote}</span> : sc.why}
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
                                <div className={`min-w-0 ${ch === "search" ? "max-w-xl" : "max-w-sm"}`}>
                                  {ch === "search" ? (
                                    <SearchAdPreview title={ad.title} title2={ad.title2} text={ad.text} host={host} image={ad.imageId ? `/api/images/${ad.imageId}` : null} extras={withPlanCallouts(adExtras(b, { channel: ch, href: landing, service: g.name, text: ad.text }), planCallouts)} />
                                  ) : (
                                    <ImageAdPreview channel={ch === "vk" ? "vk" : "network"} title={ad.title} text={ad.text} host={ch === "vk" ? b.name : host} image={ad.imageId ? `/api/images/${ad.imageId}` : null} extras={adExtras(b, { channel: ch, href: landing, text: ad.text })} logo={logoId ? `/api/images/${logoId}` : null} />
                                  )}
                                </div>
                                {combinatorial ? (() => {
                                  const ra = responsiveAssets(b, ad, { service: ch === "search" ? g.name : null });
                                  return <ResponsiveAssets titles={ra.titles} texts={ra.texts} className={ch === "search" ? "max-w-xl" : "max-w-sm"} />;
                                })() : null}
                                <div className="text-xs text-muted">{pl(s.impressions, "показ", "показа", "показов")} · потрачено {rub(s.cost)}{s.conversions ? ` · обращение по ${rub(s.cost / s.conversions)}` : ""}</div>
                                <AdActions ad={{ id: ad.id, title: ad.title, title2: ad.title2, text: ad.text, status: ad.status }} channel={ch} canTest={!inTest && camp.status === "active"} />
                              </div>
                            </details>
                          </li>
                        );
                      })}
                    </ol>
                    {hidden ? <p className="hint mt-3">Ещё {pl(hidden, "объявление", "объявления", "объявлений")} — {hidden === 1 ? "заменено более удачным вариантом или не принято" : "заменены более удачными вариантами или не приняты"} площадкой. Подробности — в «Истории».</p> : null}
                  </div>
                );
              })}
          </section>
        );
      })}
    </div>
  );
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

function CampaignPill({ s, ch }: { s?: { stopped: string | null; learningLeft: number }; ch: string }) {
  if (s?.stopped === "guard") return <span className="pill bg-bad-soft text-bad">Стоит: кончился бюджет месяца</span>;
  if (s?.stopped === "error") return <span className="pill bg-bad-soft text-bad">Ошибка площадки</span>;
  if (s?.stopped === "robot") return <span className="pill bg-paper text-muted">На паузе — остановил робот</span>;
  if (s?.stopped) return <span className="pill bg-paper text-muted">На паузе — вы остановили</span>;
  if (s && s.learningLeft > 0)
    return (
      <span className="pill bg-info-soft text-ink-2" title={`Обучение после запуска длится до ${pl(LEARNING_DAYS[ch] ?? 14, "дня", "дней", "дней")}, после изменения бюджета — до 7`}>
        <GraduationCap size={13} /> обучается — не трогаем {pl(s.learningLeft, "день", "дня", "дней")}
      </span>
    );
  return <span className="pill bg-good-soft text-good">Идёт</span>;
}

import { isLaunched, uid } from "@/lib/util";
import { route, json, fail, needBusiness } from "@/lib/api";
import { DIRECT_ADS_PER_GROUP, isDirectChannel, savePlan, type LaunchPlan, type PlanAd } from "@/lib/engine/launch";
import { rewriteAd, tidyText, validateAdText } from "@/lib/ai/copy";
import { formatOf } from "@/lib/channels";
import { isMedical } from "@/lib/niches";

export const maxDuration = 60;
const MAX_ADS = 12;

/**
 * Новое объявление в группе до запуска: своё (title/text) или вариант от робота с новым подходом.
 * Картинку берём у объявлений группы (по кругу) — новых генераций и ожидания нет.
 */
export const POST = route(async ({ business, req }) => {
  needBusiness(business);
  if (isLaunched(business.status)) return fail("Реклама уже запущена — новые объявления добавляются на странице «Реклама»");
  const plan = business.launchPlan as LaunchPlan | null;
  if (!plan) return fail("План не найден — начните подготовку заново");
  if (plan.launch) return fail("Запуск уже начат — дождитесь окончания", 409);
  const body = (await req.json().catch(() => ({}))) as { groupId?: string; title?: string; title2?: string; text?: string; wish?: string };
  const ch = plan.channels.find((c) => c.groups.some((g) => g.id === body.groupId));
  const g = ch?.groups.find((x) => x.id === body.groupId);
  if (!ch || !g) return fail("Группа не найдена");
  if (g.ads.length >= MAX_ADS) return fail(`В группе уже ${MAX_ADS} объявлений — выключите или поправьте лишние`);
  const fmt = formatOf(ch.channel);
  const medical = isMedical(business);

  let draft: { angle: string; title: string; title2?: string | null; text: string };
  if (typeof body.title === "string" || typeof body.text === "string") {
    draft = { angle: "custom", title: tidyText(body.title ?? ""), title2: fmt === "vk" ? null : tidyText(body.title2 ?? "") || null, text: tidyText(body.text ?? "") };
    const errs = validateAdText(fmt, draft, { medical });
    if (errs.length) return fail(errs.join(" "));
  } else {
    const base = g.ads[0] ?? { angle: "price", title: g.service ?? g.name, title2: null, text: "" };
    const wish = String(body.wish ?? "").trim().slice(0, 300);
    const r = await rewriteAd(business, {
      channel: fmt,
      base,
      tried: [...new Set(g.ads.map((a) => a.angle))],
      reason: wish ? `Владелец хочет ещё вариант: ${wish}` : "Владелец хочет больше вариантов для сравнения",
      service: ch.channel === "search" ? g.service ?? g.name : undefined,
    });
    // Не повторяем уже существующий текст
    if (g.ads.some((a) => a.title === r.title && a.text === r.text)) return fail("Новых идей для этой группы пока нет — напишите объявление сами");
    draft = { angle: r.angle, title: r.title, title2: r.title2 ?? null, text: r.text };
  }

  const pics = g.ads.filter((a) => a.imageId);
  const pic = pics.length ? pics[g.ads.length % pics.length] : null;
  const direct = isDirectChannel(ch.channel) && ch.platform !== "vk";
  const on = g.ads.filter((a) => a.enabled).length;
  const ad: PlanAd = { id: uid("a_"), ...draft, title2: draft.title2 ?? null, imageId: pic?.imageId ?? null, layout: pic?.layout ?? null, enabled: !direct || on < DIRECT_ADS_PER_GROUP };
  g.ads.push(ad);
  await savePlan(business.id, plan);
  return json({ plan, ad });
});

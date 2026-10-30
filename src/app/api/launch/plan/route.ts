import { isLaunched } from "@/lib/util";
import { route, json, fail, needBusiness } from "@/lib/api";
import { rebalancePlan, updatePlan, type LaunchPlan } from "@/lib/engine/launch";
import { tidyText, validateAdText } from "@/lib/ai/copy";
import { isMedical } from "@/lib/niches";
import { formatOf } from "@/lib/channels";
import { marks } from "./marks";

/**
 * План до запуска. Бюджет могли поменять после подготовки объявлений — недельные лимиты каналов пересчитываем
 * под текущий бюджет (rebalancePlan), объявления и правки владельца не трогаем.
 */
export const GET = route(async ({ business }) => {
  needBusiness(business);
  const plan = (business.launchPlan as LaunchPlan | null) ?? null;
  if (!plan || plan.launch || isLaunched(business.status) || business.status === "launching") return json({ plan });
  const check = rebalancePlan(structuredClone(plan), business.monthlyBudget);
  if (JSON.stringify(check.channels) === JSON.stringify(plan.channels)) return json({ plan });
  try {
    return json({ plan: await updatePlan(business.id, (pl, b) => { rebalancePlan(pl, b.monthlyBudget); }) });
  } catch {
    return json({ plan });
  }
});

const bad = (message: string) => Object.assign(new Error(message), { status: 400 });

/** Правки владельца перед запуском: текст объявления, вкл/выкл объявления или канала */
export const PATCH = route(async ({ business, req }) => {
  needBusiness(business);
  if (isLaunched(business.status)) return fail("Реклама уже запущена — объявления меняются на странице «Реклама»");
  if ((business.launchPlan as LaunchPlan | null)?.launch) return fail("Запуск уже начат — дождитесь окончания", 409);
  const body = await req.json().catch(() => ({}));
  // Правка применяется к свежему плану и сохраняется, только если его никто не поменял за это время (картинки, другая вкладка)
  const plan = await updatePlan(business.id, (plan, b) => {
    let channelToggled = false;
    for (const ch of plan.channels) {
      if (body.channel === ch.channel && typeof body.channelEnabled === "boolean") {
        channelToggled = ch.enabled !== body.channelEnabled;
        ch.enabled = body.channelEnabled;
        delete ch.disabledReason; // решение владельца
      }
      for (const g of ch.groups) {
        // Вся группа разом: включаем до 3 объявлений (лимит группы Директа; во VK — все), выключаем все
        if (body.groupId === g.id && typeof body.groupEnabled === "boolean") {
          const cap = ch.platform === "vk" || ch.channel === "vk" || ch.channel === "retarget_vk" ? Infinity : 3;
          g.ads.forEach((ad, i) => { ad.enabled = body.groupEnabled && i < cap; });
        }
        for (const ad of g.ads) {
          if (ad.id !== body.adId) continue;
          if (typeof body.enabled === "boolean") ad.enabled = body.enabled;
          if (typeof body.title === "string" || typeof body.title2 === "string" || typeof body.text === "string") {
            const next = {
              title: typeof body.title === "string" ? body.title : ad.title,
              title2: typeof body.title2 === "string" ? body.title2 : ad.title2,
              text: typeof body.text === "string" ? body.text : ad.text,
            };
            // Текст владельца не обрезаем молча — объясняем, что поправить
            const errs = validateAdText(formatOf(ch.channel), next, { medical: isMedical(b) });
            if (errs.length) throw bad(errs.join(" "));
            const changed = tidyText(next.title) !== ad.title || (tidyText(next.title2) || null) !== (ad.title2 ?? null) || tidyText(next.text) !== ad.text;
            if (changed) {
              // Запоминаем, что текст — владельца, и исходный вариант робота (его не предлагаем снова)
              const m = marks(ad);
              if (!m.original && ad.angle !== "custom") m.original = { title: ad.title, title2: ad.title2 ?? null, text: ad.text };
              m.edited = true;
            }
            ad.title = tidyText(next.title);
            ad.title2 = tidyText(next.title2) || null;
            ad.text = tidyText(next.text);
          }
        }
      }
    }
    // Фото поменялись — перерисуем картинки объявлений (POST /api/launch/images), тексты и правки остаются
    if (body.redrawImages === true) {
      for (const ch of plan.channels) for (const g of ch.groups) for (const ad of g.ads) { ad.imageId = null; ad.layout = null; }
    }
    if (!plan.channels.some((c) => c.enabled)) throw bad("Оставьте хотя бы один канал");
    // Доля выключенного канала переходит оставшимся (и возвращается, если канал включили обратно)
    if (channelToggled) rebalancePlan(plan, b.monthlyBudget);
  });
  return json({ plan });
});

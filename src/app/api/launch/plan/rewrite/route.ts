import { isLaunched } from "@/lib/util";
import { route, json, fail, needBusiness } from "@/lib/api";
import { savePlan, type LaunchPlan } from "@/lib/engine/launch";
import { rewriteAdsBatch } from "@/lib/ai/copy";
import { aiConfigured } from "@/lib/ai/yandex";
import { formatOf } from "@/lib/channels";
import type { Channel } from "@/lib/platforms/types";

export const maxDuration = 60;

const CHUNK = 8;
const PARALLEL = 3;

/**
 * «Переписать тексты» до запуска: все объявления канала по пожеланию владельца.
 * Порциями (лимит времени функции): клиент повторяет запрос, пока done=false. undo — вернуть прежние тексты.
 */
export const POST = route(async ({ business, req }) => {
  needBusiness(business);
  if (isLaunched(business.status)) return fail("Реклама уже запущена — тексты меняются на странице «Реклама»");
  const plan = business.launchPlan as LaunchPlan | null;
  if (!plan) return fail("План не найден — начните подготовку заново");
  if (plan.launch) return fail("Запуск уже начат — дождитесь окончания", 409);
  const body = (await req.json().catch(() => ({}))) as { channel?: Channel; wish?: string; start?: boolean; undo?: boolean };
  const ch = plan.channels.find((c) => c.channel === body.channel);
  if (!ch) return fail("Канал не найден");

  if (body.undo) {
    const r = plan.rewrite;
    if (!r || r.channel !== ch.channel) return fail("Возвращать нечего");
    for (const g of ch.groups) for (const ad of g.ads) if (r.undo[ad.id]) Object.assign(ad, r.undo[ad.id]);
    plan.rewrite = undefined;
    await savePlan(business.id, plan);
    return json({ plan, done: true });
  }

  const wish = String(body.wish ?? "").trim().slice(0, 300);
  if (body.start || !plan.rewrite || plan.rewrite.channel !== ch.channel) {
    // Переписываем повторно — «Вернуть» всё равно возвращает тексты до первого переписывания
    const keep = plan.rewrite?.channel === ch.channel ? plan.rewrite.undo : {};
    plan.rewrite = { channel: ch.channel, wish, done: [], failed: 0, undo: keep };
  }
  const job = plan.rewrite;
  const all = ch.groups.flatMap((g) => g.ads.map((ad) => ({ g, ad })));
  const todo = all.filter((x) => !job.done.includes(x.ad.id));
  const deadline = Date.now() + 40_000;
  const chunks: (typeof todo)[] = [];
  for (let i = 0; i < todo.length; i += CHUNK) chunks.push(todo.slice(i, i + CHUNK));

  let error: string | null = null;
  for (let i = 0; i < chunks.length && Date.now() < deadline; i += PARALLEL) {
    const wave = chunks.slice(i, i + PARALLEL);
    const results = await Promise.all(
      wave.map((c) =>
        rewriteAdsBatch(business, formatOf(ch.channel), c.map((x) => ({ key: x.ad.id, group: x.g.name, service: x.g.service, ad: x.ad })), job.wish).catch((e) => {
          error = (e as Error).message;
          return null;
        }),
      ),
    );
    wave.forEach((c, wi) => {
      const res = results[wi];
      for (const { ad } of c) {
        const next = res?.[ad.id];
        if (next) {
          if (!job.undo[ad.id]) job.undo[ad.id] = { angle: ad.angle, title: ad.title, title2: ad.title2 ?? null, text: ad.text };
          ad.title = next.title;
          ad.title2 = next.title2 ?? null;
          ad.text = next.text;
        } else job.failed++;
        job.done.push(ad.id);
      }
    });
    if (error && !Object.keys(job.undo).length) break;
  }
  const done = job.done.length >= all.length;
  // Модель не ответила ни разу — не делаем вид, что всё хорошо
  if (error && !Object.keys(job.undo).length) {
    plan.rewrite = undefined;
    await savePlan(business.id, plan);
    return fail(error);
  }
  await savePlan(business.id, plan);
  return json({ plan, done, progress: { done: job.done.length, total: all.length }, changed: Object.keys(job.undo).length, failed: job.failed, ai: aiConfigured() });
});

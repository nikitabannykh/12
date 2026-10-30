import { isLaunched } from "@/lib/util";
import { route, json, fail, needBusiness } from "@/lib/api";
import { useQuota } from "@/lib/ratelimit";
import { updatePlan, type LaunchPlan } from "@/lib/engine/launch";
import { rewriteAdsBatch, type AdDraft } from "@/lib/ai/copy";
import { aiConfigured } from "@/lib/ai/yandex";
import { formatOf } from "@/lib/channels";
import type { Channel } from "@/lib/platforms/types";
import { marks, ownText } from "../marks";

export const maxDuration = 60;

const CHUNK = 8;
const PARALLEL = 3;
const bad = (message: string, status = 400) => Object.assign(new Error(message), { status });

/**
 * «Переписать тексты» до запуска: все объявления канала по пожеланию владельца.
 * Порциями (лимит времени функции): клиент повторяет запрос, пока done=false. undo — вернуть прежние тексты.
 * Каждая волна сохраняется сразу и в свежий план (updatePlan): правки владельца и начатый запуск не затираются.
 */
export const POST = route(async ({ user, business, req }) => {
  const started = Date.now();
  needBusiness(business);
  if (isLaunched(business.status)) return fail("Реклама уже запущена — тексты меняются на странице «Реклама»");
  const initial = business.launchPlan as LaunchPlan | null;
  if (!initial) return fail("План не найден — начните подготовку заново");
  if (initial.launch) return fail("Запуск уже начат — дождитесь окончания", 409);
  const body = (await req.json().catch(() => ({}))) as { channel?: Channel; wish?: string; start?: boolean; undo?: boolean; includeEdited?: boolean };
  if (body.start && !body.undo) {
    const over = await useQuota("rewrite", user);
    if (over) return fail(over, 429);
  }
  const channel = body.channel;
  const chOf = (p: LaunchPlan) => {
    const ch = p.channels.find((c) => c.channel === channel);
    if (!ch) throw bad("Канал не найден");
    return ch;
  };
  chOf(initial);

  if (body.undo) {
    const plan = await updatePlan(business.id, (p) => {
      const ch = chOf(p);
      const r = p.rewrite;
      if (!r || r.channel !== ch.channel) throw bad("Возвращать нечего");
      for (const g of ch.groups) for (const ad of g.ads) if (r.undo[ad.id]) Object.assign(ad, r.undo[ad.id]); // вместе с меткой edited
      p.rewrite = undefined;
    });
    return json({ plan, done: true });
  }

  const wish = String(body.wish ?? "").trim().slice(0, 300);
  let plan = initial;
  if (body.start || !initial.rewrite || initial.rewrite.channel !== channel) {
    plan = await updatePlan(business.id, (p) => {
      const ch = chOf(p);
      // Переписываем повторно — «Вернуть» всё равно возвращает тексты до первого переписывания
      const keep = p.rewrite?.channel === ch.channel ? p.rewrite.undo : {};
      // Что переписываем: включённые объявления; написанные или поправленные владельцем — только если он попросил
      const ids = ch.groups.flatMap((g) => g.ads).filter((a) => a.enabled && (body.includeEdited || !ownText(a))).map((a) => a.id);
      p.rewrite = { channel: ch.channel, wish, done: [], failed: 0, undo: keep, changed: 0, ...{ ids } };
    });
  }
  const jobWish = plan.rewrite!.wish;
  const ch0 = chOf(plan);
  const targets = (p: LaunchPlan) => (p.rewrite as { ids?: string[] } | undefined)?.ids ?? chOf(p).groups.flatMap((g) => g.ads.map((a) => a.id));
  const todoIds = new Set(targets(plan));
  const todo = ch0.groups.flatMap((g) => g.ads.map((ad) => ({ g, ad }))).filter((x) => todoIds.has(x.ad.id) && !plan.rewrite!.done.includes(x.ad.id));
  const deadline = started + 40_000;
  const chunks: (typeof todo)[] = [];
  for (let i = 0; i < todo.length; i += CHUNK) chunks.push(todo.slice(i, i + CHUNK));

  let error: string | null = null;
  for (let i = 0; i < chunks.length && Date.now() < deadline; i += PARALLEL) {
    const wave = chunks.slice(i, i + PARALLEL);
    const results = await Promise.all(
      wave.map((c) =>
        // Модель ждём не дольше, чем остаётся до лимита функции
        rewriteAdsBatch(business, formatOf(ch0.channel), c.map((x) => ({ key: x.ad.id, group: x.g.name, service: x.g.service, ad: x.ad })), jobWish, { until: started + 52_000 }).catch((e) => {
          error = (e as Error).message;
          return null;
        }),
      ),
    );
    const got = new Map<string, AdDraft | null>();
    wave.forEach((c, wi) => { for (const { ad } of c) got.set(ad.id, results[wi]?.[ad.id] ?? null); });
    // Сохраняем волну сразу: оборвётся запрос — сделанное не пропадёт
    plan = await updatePlan(business.id, (p) => {
      const job = p.rewrite;
      if (!job || job.channel !== ch0.channel) throw bad("Переписывание отменили — тексты уже вернули", 409);
      const ads = new Map(chOf(p).groups.flatMap((g) => g.ads.map((a) => [a.id, a] as const)));
      for (const [id, next] of got) {
        if (job.done.includes(id)) continue;
        job.done.push(id);
        const ad = ads.get(id);
        if (!ad) continue;
        if (next) {
          // «Вернуть» возвращает и метку «текст владельца»
          if (!job.undo[id]) job.undo[id] = { angle: ad.angle, title: ad.title, title2: ad.title2 ?? null, text: ad.text, ...{ edited: marks(ad).edited ?? false } };
          ad.title = next.title;
          ad.title2 = next.title2 ?? null;
          ad.text = next.text;
          // Подход мог смениться (без модели берём другой шаблон) — подпись «идея» должна соответствовать тексту
          if (next.angle) ad.angle = next.angle;
          marks(ad).edited = false;
          job.changed = (job.changed ?? 0) + 1;
        } else job.failed++;
      }
    });
    // Ошибка — по успехам этого переписывания, а не по undo, оставшемуся от прошлого
    if (error && !plan.rewrite?.changed) break;
  }
  // Модель не ответила ни разу — не делаем вид, что всё хорошо. «Вернуть» к прошлому переписыванию сохраняем
  if (error && !plan.rewrite?.changed) {
    await updatePlan(business.id, (p) => {
      const r = p.rewrite;
      if (!r || r.channel !== ch0.channel) return;
      p.rewrite = Object.keys(r.undo).length ? { ...r, done: targets(p), failed: 0, changed: 0 } : undefined;
    }).catch(() => null);
    return fail(error);
  }
  const job = plan.rewrite;
  const ids = targets(plan);
  const doneCount = job ? ids.filter((id) => job.done.includes(id)).length : ids.length;
  return json({ plan, done: doneCount >= ids.length, progress: { done: doneCount, total: ids.length }, changed: Object.keys(job?.undo ?? {}).length, failed: job?.failed ?? 0, ai: aiConfigured() });
});

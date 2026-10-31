import "server-only";
import type { Business } from "../db/schema";
import { aiConfigured, gptJson } from "../ai/yandex";
import { conflicts, displayKeyword, phraseKey, stem, type SemanticCore } from "./semantics";

/**
 * Чистка ключевых фраз перед объявлениями — как директолог смотрит готовую семантику.
 * 1) Правила кода (без модели): осиротевшие единицы из прайса («остеопат лет старше» из «от 14 лет и старше»)
 *    и запросы чужой аудитории («массаж для взрослых» в группе «для детей»).
 * 2) YandexGPT по каждой группе: имена врачей и мастеров, чужие клиники и бренды, другой город, справочные запросы,
 *    другое значение слова, услуги, которых нет, запросы, которые относятся к другой группе.
 * В группе всегда остаётся хотя бы 2 фразы — пустая группа осталась бы без трафика.
 */

const KEEP_MIN = 2;
/** Единицы, которые без числа бессмысленны: число вырезали, слово осталось */
const ORPHAN = /(^|\s)(лет|месяцев|мес|минут|мин|шт|см|кг|руб|р|т\.?\s?р)(\s|$)/;
const KID = /(дет|ребен|ребён|малыш|новорожд|грудн|младен|подрост|школьн)/;
const ADULT = /взросл/;

/** Слова намерения: человек ищет, кто поможет, а не справку */
const INTENT = /(лечени|лечить|вылечить|врач|доктор|специалист|кому|куда|обратит|клиник|центр|кабинет|прием|приём|цен|стоимост|сколько стоит|запис|помощ|терапи|массаж|процедур|сеанс|рядом|недорог|отзыв)/;

/**
 * Смысл названия группы для слияния: «Остеопат для детей» и «Детский приём остеопата» — одно и то же.
 * Без предлогов и слов-оболочек («приём», «консультация»), «детский/для детей» → «дет», остальное — по основе
 */
const SHELL = new Set(["для", "у", "в", "во", "на", "и", "с", "со", "к", "по", "при", "прием", "консультация", "консультации", "услуги", "услуга", "сеанс", "запись"]);
export function intentKey(name: string): string {
  return [...new Set(name.toLowerCase().replace(/ё/g, "е").split(/[^\p{L}]+/u).filter((w) => w.length >= 2 && !SHELL.has(w))
    .map((w) => (/^(дет|ребен)/.test(w) ? "дет" : /^взросл/.test(w) ? "взросл" : stem(w))))].sort().join(" ");
}

const keep = (all: string[], next: string[]) => (next.length >= KEEP_MIN ? next : [...next, ...all.filter((k) => !next.includes(k))].slice(0, Math.min(KEEP_MIN, all.length)));

export function cleanByRules(core: SemanticCore): { core: SemanticCore; dropped: string[] } {
  const dropped: string[] = [];
  const groups = core.groups.map((g) => {
    const own = `${g.name} ${g.service}`.toLowerCase();
    const kid = KID.test(own), adult = ADULT.test(own);
    const noun = (g.hook?.noun ?? "").toLowerCase().split(" ").filter((w) => w.length >= 4).map((w) => w.slice(0, Math.max(4, w.length - 2)));
    const geo = [...core.geo.city, ...core.geo.local].map((w) => w.toLowerCase().slice(0, Math.max(4, w.length - 2)));
    const next = g.keywords.filter((k) => {
      const p = displayKeyword(k);
      if (ORPHAN.test(p)) return false;
      // Группа проблемы: фраза должна говорить, что человек ищет помощь (специалист, лечение, цена, город)
      if (g.layer === "problem" && !INTENT.test(p) && !noun.some((n) => p.includes(n)) && !geo.some((c) => c.length >= 4 && p.includes(c))) return false;
      if (kid && !adult && ADULT.test(p)) return false;
      if (adult && !kid && KID.test(p)) return false;
      return true;
    });
    // Правила кода надёжны — мусор не возвращаем ради минимума. Группа без фраз уходит (её запросы есть у соседних)
    dropped.push(...g.keywords.filter((k) => !next.includes(k)).map(displayKeyword));
    return { ...g, keywords: next };
  }).filter((g) => g.keywords.length > 0);
  return { core: { ...core, groups }, dropped };
}

const clean = (x: unknown) => String(x ?? "").toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9\s-]/g, " ").replace(/\s+/g, " ").trim();

export async function reviewKeywords(b: Business, core: SemanticCore, opts: { until?: number } = {}): Promise<{ core: SemanticCore; dropped: string[]; negatives: string[] }> {
  const ruled = cleanByRules(core);
  if (!aiConfigured() || !ruled.core.groups.length) return { core: ruled.core, dropped: ruled.dropped, negatives: [] };
  const groups = ruled.core.groups.map((g) => ({ ...g, keywords: [...g.keywords], negatives: [...g.negatives] }));
  const names = groups.map((g) => g.name);
  const services = (b.services ?? []).map((s) => s.name).filter(Boolean).slice(0, 30);
  const dropped = [...ruled.dropped];
  const campaignNeg: string[] = [];
  // Предложенные названия: совпали у двух групп услуг («Взрослый приём» и «Взрослый вторичный приём» → «Остеопат для взрослых») — сольём
  const proposed = new Map<number, string>();
  const one = async (gi: number) => {
    const g = groups[gi];
    const list = g.keywords.slice(0, 80);
    try {
      const r = await gptJson<{ drop: number[]; negatives: string[]; name?: string }>(
        "Ты опытный директолог. Проверяешь ключевые фразы одной группы объявлений перед запуском в Яндекс Директе. Ответ — строго JSON.",
        `Бизнес: ${b.name}, город ${b.city}. ${(b.description ?? "").slice(0, 400)}\nУслуги бизнеса: ${services.join("; ")}\nВсе группы кампании: ${names.join("; ")}\n\n` +
          `Группа: «${g.name}» (${g.layer === "problem" ? "проблема клиента, которую решает услуга" : g.layer === "audience" ? "аудитория" : g.layer === "adjacent" ? "смежный запрос" : "услуга"}).\nФразы:\n${list.map((k, i) => `${i + 1}. ${displayKeyword(k)}`).join("\n")}\n\n` +
          "Отметь фразы, по которым объявление этой группы показывать НЕ надо:\n" +
          "— имена и фамилии врачей, мастеров, авторов методик; названия чужих клиник, салонов, сетей, брендов;\n" +
          "— другой город или район, которого нет у бизнеса;\n" +
          "— справочные и бытовые запросы, где человек не ищет специалиста или заказ (лекарства, симптомы другого органа, «можно ли», рецепты, «что это»);\n" +
          "— другое значение слов, услуга или товар, которых у бизнеса нет;\n" +
          "— другая аудитория (взрослые в детской группе и наоборот);\n" +
          "— фраза явно про другую группу из списка — ей место там;\n" +
          "— обрывки без смысла («остеопат лет», «прием от и старше»).\n" +
          "Целевые фразы с «цена», «отзывы», «рядом», «записаться», «лучший», городом, улицей бизнеса — оставляй.\n" +
          "negatives — минус-слова (одно слово) ТОЛЬКО из найденных имён и фамилий людей, названий чужих брендов и клиник, чужих городов и чужих значений слова. Не минусуй аудитории (дети, подростки, взрослые, беременные), услуги и проблемы.\n" +
          "name — название группы так, как это ищут люди (2–4 слова, до 35 символов, без скобок, возрастов в цифрах и слов «первичный», «вторичный», «повторный»): «Взрослый вторичный прием остеопата» → «Остеопат для взрослых». Если название уже такое — верни его же.\n" +
          'JSON: {"drop": [номера], "negatives": ["..."], "name": "..."}',
        { temperature: 0.1, maxTokens: 600, timeoutMs: 15_000, until: opts.until },
      );
      const nm = String(r.name ?? "").replace(/[«»"()]/g, "").replace(/\s+/g, " ").trim();
      if (g.layer === "service" && nm.length >= 4 && nm.length <= 40 && !/\d/.test(nm)) proposed.set(gi, nm[0].toUpperCase() + nm.slice(1));
      const drop = new Set((r.drop ?? []).map(Number).filter((n) => n >= 1 && n <= list.length).map((n) => list[n - 1]));
      if (list.length <= KEEP_MIN || drop.size >= list.length - 1) return; // модель выкинула почти всё — не верим
      const next = keep(g.keywords, g.keywords.filter((k) => !drop.has(k)));
      dropped.push(...g.keywords.filter((k) => !next.includes(k)).map(displayKeyword));
      g.keywords = next;
      for (const n of r.negatives ?? []) {
        const w = clean(n);
        if (w.length >= 3 && !w.includes(" ")) campaignNeg.push(w);
      }
    } catch {
      /* без проверки модели — остаются правила кода */
    }
  };
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < groups.length && (!opts.until || Date.now() < opts.until - 3_000)) await one(next++);
  }));
  // Слияние групп услуг с одинаковым смыслом названия («Остеопат для детей» = «Детский приём остеопата»): фразы вместе, без повторов; минус-слова — только не задевающие фразы
  const merged: typeof groups = [];
  groups.forEach((g, gi) => {
    const nm = proposed.get(gi);
    const key = intentKey(nm ?? g.name);
    const into = g.layer === "service" && key ? merged.find((m) => m.layer === "service" && intentKey(m.name) === key) : undefined;
    if (into) {
      const keys = new Set(into.keywords.map(phraseKey));
      into.keywords.push(...g.keywords.filter((k) => !keys.has(phraseKey(k))));
      into.services = [...new Set([...into.services, ...g.services])];
      into.negatives = into.negatives.filter((n) => !into.keywords.some((k) => conflicts(n, k)));
      if (into.demand != null || g.demand != null) into.demand = (into.demand ?? 0) + (g.demand ?? 0);
      return;
    }
    merged.push(nm && !merged.some((m) => m.name.toLowerCase() === nm.toLowerCase()) ? { ...g, name: nm } : g);
  });
  // Минус-слово: не аудитория и не намерение, не задевает оставшиеся фразы и слова прайса
  // Улица, город и район бизнеса — целевые слова, не минусуем («остеопат на чайковского»)
  const own = `${services.join(" ")} ${merged.map((g) => g.name).join(" ")} ${b.address ?? ""} ${b.city ?? ""} ${[...core.geo.city, ...core.geo.local].join(" ")}`.toLowerCase().replace(/ё/g, "е");
  const before = merged.flatMap((g) => g.keywords);
  const negatives = [...new Set(campaignNeg)]
    .filter((n) => !KID.test(n) && !ADULT.test(n) && !INTENT.test(n) && !/беремен|мам|женщин|мужчин|пожил|спорт/.test(n) && !own.includes(n.slice(0, Math.max(4, n.length - 2))))
    .filter((n) => before.filter((k) => conflicts(n, k)).length <= Math.max(2, before.length * 0.02))
    .slice(0, 40);
  // Фразы с найденными именами и брендами («хамов остеопат екатеринбург») убираем и из тех групп, где модель их пропустила
  for (const g of merged) {
    const next = keep(g.keywords, g.keywords.filter((k) => !negatives.some((n) => conflicts(n, k))));
    dropped.push(...g.keywords.filter((k) => !next.includes(k)).map(displayKeyword));
    g.keywords = next;
  }
  const all = merged.flatMap((g) => g.keywords);
  const safeNeg = negatives.filter((n) => !all.some((k) => conflicts(n, k)));
  return { core: { ...ruled.core, groups: merged, negatives: [...new Set([...ruled.core.negatives, ...safeNeg])], total: all.length }, dropped, negatives: safeNeg };
}

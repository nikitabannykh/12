import "server-only";
import type { Business } from "../db/schema";
import { nicheById } from "../niches";
import { aiConfigured, gptJson } from "./yandex";

/**
 * Как клиенты ищут такой бизнес в целом — не по позициям прайса, а по типу: «доставка суши», «заказать пиццу»,
 * «детский остеопат», «маникюрный салон». Из этих фраз строится общая группа поиска: услуги с сайта читаются не всегда
 * полностью, а реклама только по ним теряет основной спрос. Без YandexGPT — пусто (общую группу не строим).
 */
export async function businessTopics(b: Pick<Business, "name" | "niche" | "city" | "description" | "services" | "advantages">): Promise<string[]> {
  const n = nicheById(b.niche);
  // Без модели общих запросов не придумываем: базовые запросы ниши могут быть про услуги, которых у владельца нет
  const fallback: string[] = [];
  if (!aiConfigured()) return fallback;
  try {
    const services = (b.services ?? []).map((s) => s.name).filter(Boolean).slice(0, 25);
    const r = await gptJson<{ queries: string[] }>(
      "Ты директолог. По описанию бизнеса перечисли поисковые запросы, которыми клиенты в Яндексе ищут ТАКОЙ бизнес в целом: тип заведения или специалиста и главное, что он делает. " +
        "Не позиции меню или прайса по отдельности («Чай с малиной», «Любимый сет»), а то, как называют сам бизнес и его основную услугу («доставка суши», «заказать роллы», «пиццерия», «детский остеопат», «остеопат для новорожденных», «маникюрный салон»). " +
        "Каждый запрос — 1–3 слова, в нижнем регистре, без города, без цен, без слов «лучший», «недорого», «отзывы». Только то, что действительно относится к этому бизнесу. " +
        'Ответ — JSON {"queries": ["...", ...]}, 5–10 запросов, самые частые первыми.',
      `Название: ${b.name}\nСфера: ${n.label}\nГород: ${b.city}\n${b.description ? `Описание: ${b.description.slice(0, 600)}\n` : ""}${services.length ? `Услуги и позиции: ${services.join("; ")}\n` : ""}${(b.advantages ?? []).length ? `Преимущества: ${(b.advantages ?? []).join("; ")}\n` : ""}`,
      { temperature: 0.3, maxTokens: 400, timeoutMs: 12_000 },
    );
    const city = (b.city ?? "").toLowerCase();
    const list = (r.queries ?? [])
      .map((q) => String(q).toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9\s-]/g, " ").replace(/\s+/g, " ").trim())
      .filter((q) => q.length >= 3 && q.split(" ").length <= 4 && (!city || !q.includes(city)) && !/лучш|недорог|отзыв|цен/.test(q));
    const out = [...new Set(list)].slice(0, 10);
    return out.length >= 2 ? out : fallback;
  } catch {
    return fallback;
  }
}

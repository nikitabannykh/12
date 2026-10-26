import "server-only";
import type { Business } from "../db/schema";
import { ANGLES, nicheById } from "../niches";
import { aiConfigured, gptJson } from "./yandex";

export const LIMITS = {
  search: { title: 56, title2: 30, text: 81 },
  network: { title: 40, title2: 30, text: 81 },
  vk: { title: 40, title2: 30, text: 90 },
} as const;

export type AdDraft = { angle: string; title: string; title2?: string | null; text: string };
export type GroupDraft = { name: string; audience: string; keywords: string[]; ads: AdDraft[]; ageFrom?: number; ageTo?: number; autotargeting?: boolean };
export type CopyPlan = {
  search: GroupDraft[];
  network: GroupDraft[];
  vk: GroupDraft[];
  negatives: string[];
  callouts: string[];
  imageIdeas: string[];
};

/** Аккуратно укорачиваем по границе слова. Директ режет длинные слова (>22–23 символов) — их тоже не пропускаем. */
export function fit(s: string | null | undefined, max: number): string {
  let t = (s ?? "").replace(/\s+/g, " ").trim();
  t = t.replace(/!{2,}/g, "!").replace(/(^|\s)(лучш[а-яё]*|№\s?1|сам(ый|ая|ое|ые))(?=\s|$|[.,!])/gi, " ").replace(/\s+/g, " ").trim();
  t = t.split(" ").filter((w) => w.length <= 22).join(" ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const i = cut.lastIndexOf(" ");
  return (i > max * 0.5 ? cut.slice(0, i) : cut.slice(0, max)).replace(/[,\-–—:;]$/, "").trim();
}

function normalizeAd(a: AdDraft, ch: keyof typeof LIMITS): AdDraft {
  const L = LIMITS[ch];
  return {
    angle: ANGLES[a.angle] ? a.angle : "price",
    title: fit(a.title, L.title),
    title2: a.title2 ? fit(a.title2, L.title2) : null,
    text: fit(a.text, L.text),
  };
}

function cleanKeyword(k: string) {
  return k
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-+!]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 7)
    .join(" ");
}

function bizBrief(b: Business) {
  const n = nicheById(b.niche);
  const services = (b.services ?? []).map((s) => `- ${s.name}${s.price ? ` — ${s.price}` : ""}${s.note ? ` (${s.note})` : ""}`).join("\n");
  return [
    `Бизнес: ${b.name} (${n.label}), город ${b.city}${b.address ? `, адрес: ${b.address}` : ""}.`,
    b.description ? `Описание от владельца: ${b.description}` : "",
    services ? `Услуги и цены:\n${services}` : "",
    b.advantages?.length ? `Преимущества: ${b.advantages.join("; ")}` : "",
    b.offer ? `Предложение для новых клиентов: ${b.offer}` : "",
    b.review ? `Реальный отзыв клиента: ${b.review}` : "",
    b.audience ? `Кто клиенты: ${b.audience}` : `Типичные клиенты: ${n.audience.text}`,
    `Что обычно убеждает в этой нише: ${n.proof}.`,
  ].filter(Boolean).join("\n");
}

const SYSTEM = `Ты — сильный директолог и копирайтер для малого бизнеса в России. Пишешь объявления для Яндекс Директа и VK Рекламы.
Правила:
- Только факты из описания бизнеса. Не выдумывай цены, скидки, рейтинги, сроки и награды.
- Никаких «лучший», «№1», «самый», капслока и восклицательных знаков подряд — модерация отклонит.
- Пиши конкретно и по-человечески: услуга, цена, выгода, место. Без канцелярита и штампов («индивидуальный подход», «высокое качество»).
- Заголовок 1 обязательно содержит услугу. В тексте — призыв записаться.
- Используй место почти целиком: заголовок 35–56 символов, второй заголовок 20–30, текст 65–81 (VK — 70–90). Короткое объявление на поиске проигрывает соседям.
- Второй заголовок не повторяет первый: туда — факт или выгода (срок, гарантия, район, график).
- Город не склоняй вслепую: пиши «— Казань» или «, Казань», а не «в Казань».
- Каждое объявление проверяет свою гипотезу (угол подачи): price, offer, proof, convenience, result, emotion.
Ответ — строго JSON без пояснений.`;

export async function generateCopyPlan(b: Business, channels: { search: boolean; network: boolean; vk: boolean }): Promise<CopyPlan> {
  const n = nicheById(b.niche);
  const fallback = templatePlan(b);
  if (!aiConfigured()) return fallback;

  const user = `${bizBrief(b)}

Подготовь рекламу. Верни JSON:
{
 "search": [ // 2–4 группы для поиска Яндекса: по одной на основную услугу
   {"name": "название группы (услуга)", "audience": "кто ищет, простыми словами", "keywords": ["8–15 коротких запросов 2–4 слова, как люди реально ищут, с городом/районом и без"],
    "ads": [3 объявления: {"angle": "price|offer|proof|convenience|result|emotion", "title": "до 56 символов", "title2": "до 30 символов", "text": "до 81 символа"}]}
 ],
 "network": [ // 2 группы для рекламы с картинками на сайтах (РСЯ): разные аудитории
   {"name": "...", "audience": "...", "keywords": ["5–10 тематических фраз-интересов"], "ads": [3 объявления, title до 40 символов, text до 81]}
 ],
 "vk": [ // 2 группы для ВКонтакте: разные возрастные аудитории (проверим, какая лучше)
   {"name": "...", "audience": "...", "ageFrom": 20, "ageTo": 34, "keywords": [], "ads": [3 объявления, title до 40 символов, text до 90]}
 ],
 "negatives": ["20–40 минус-слов: что ищут люди, которым мы не нужны (обучение, вакансии, товары, «своими руками» и т.п.)"],
 "callouts": ["6 уточнений, каждое до 25 символов целиком: конкретные факты о бизнесе"],
 "imageIdeas": ["3 сюжета фотографии для рекламы на английском языке: реалистичное фото без текста, без крупных лиц, детали процесса или результата, атмосфера места. Учитывай нишу: ${n.label}"]
}
Каналы, которые нужны: ${Object.entries(channels).filter(([, v]) => v).map(([k]) => k).join(", ")}. Для ненужных верни пустой массив.`;

  try {
    const raw = await gptJson<Partial<CopyPlan>>(SYSTEM, user, { temperature: 0.55, maxTokens: 6000 });
    const groups = (list: GroupDraft[] | undefined, ch: keyof typeof LIMITS, fb: GroupDraft[]) => {
      const out = (list ?? [])
        .filter((g) => g && g.name && Array.isArray(g.ads) && g.ads.length)
        .map((g) => ({
          ...g,
          name: fit(g.name, 60),
          audience: fit(g.audience || "", 120),
          keywords: [...new Set((g.keywords ?? []).map(cleanKeyword).filter((k) => k.length > 2))].slice(0, 40),
          ads: g.ads.slice(0, 4).map((a) => normalizeAd(a, ch)).filter((a) => a.title && a.text),
        }))
        .filter((g) => g.ads.length);
      return out.length ? out : fb;
    };
    return {
      search: channels.search ? groups(raw.search, "search", fallback.search) : [],
      network: channels.network ? groups(raw.network, "network", fallback.network) : [],
      vk: channels.vk ? groups(raw.vk, "vk", fallback.vk) : [],
      negatives: [...new Set([...(raw.negatives ?? []).map(cleanKeyword), ...fallback.negatives])].filter(Boolean).slice(0, 120),
      callouts: (raw.callouts ?? fallback.callouts).map((c) => c.trim()).filter((c) => c && c.length <= 25).slice(0, 6),
      imageIdeas: (raw.imageIdeas?.length ? raw.imageIdeas : fallback.imageIdeas).slice(0, 3),
    };
  } catch {
    return fallback;
  }
}

/** Новый вариант объявления с другой гипотезой: используется для A/B-тестов и для замены отклонённых */
export async function rewriteAd(
  b: Business,
  p: { channel: keyof typeof LIMITS; base: AdDraft; tried: string[]; reason: string; winner?: AdDraft | null; service?: string; angle?: string },
): Promise<AdDraft & { hypothesis: string }> {
  const untried = Object.keys(ANGLES).filter((a) => !p.tried.includes(a));
  const angle = p.angle && ANGLES[p.angle] ? p.angle : untried[0] ?? Object.keys(ANGLES)[Math.floor(Math.random() * 6)];
  if (aiConfigured()) {
    try {
      const L = LIMITS[p.channel];
      const r = await gptJson<AdDraft & { hypothesis: string }>(
        SYSTEM,
        `${bizBrief(b)}

Текущее объявление (${ANGLES[p.base.angle]?.name ?? p.base.angle}):
Заголовок: ${p.base.title}
${p.base.title2 ? `Заголовок 2: ${p.base.title2}\n` : ""}Текст: ${p.base.text}
Почему нужна замена: ${p.reason}
${p.winner ? `Лучшее объявление в группе сейчас: «${p.winner.title}» — «${p.winner.text}»` : ""}
Уже проверенные подходы: ${p.tried.join(", ") || "нет"}.

Напиши новое объявление с подходом "${angle}" (${ANGLES[angle].hint}). Лимиты: title до ${L.title}, title2 до ${L.title2}, text до ${L.text} символов.
Верни JSON: {"angle":"${angle}","title":"...","title2":"...","text":"...","hypothesis":"одно предложение для владельца бизнеса: что проверяем и почему, без жаргона"}`,
        { temperature: 0.7, maxTokens: 800 },
      );
      const ad = normalizeAd({ ...r, angle }, p.channel);
      if (ad.title && ad.text) return { ...ad, hypothesis: cleanHypothesis(fit(r.hypothesis, 220)) || hypothesisFor(angle) };
    } catch {
      /* ниже — шаблон */
    }
  }
  const svc = p.service ? b.services?.find((s) => s.name === p.service) : undefined;
  const pool = [...templateAds(b, p.channel, svc?.name ?? p.service, svc?.price), ...templateAds(b, p.channel, svc?.name ?? p.service, svc?.price, 1)];
  const t = pool.find((a) => a.angle === angle && a.title !== p.base.title) ?? pool.find((a) => a.title !== p.base.title) ?? pool[0];
  return { ...t, hypothesis: hypothesisFor(t.angle) };
}

function hypothesisFor(angle: string) {
  const a = ANGLES[angle] ?? ANGLES.price;
  return `приведёт ли больше клиентов подход «${a.name}» — ${a.hint.charAt(0).toLowerCase()}${a.hint.slice(1)}`;
}

/** Модель иногда начинает с «Проверяем, …» — в истории это слово уже есть */
function cleanHypothesis(h: string) {
  const t = h.replace(/^\s*(мы\s+)?проверяем[,:]?\s*(гипотезу[,:]?\s*)?(что\s+)?/i, "").trim();
  return t ? t.charAt(0).toLowerCase() + t.slice(1) : t;
}

/** Минус-слова из поисковых запросов: модель отмечает запросы людей, которым услуга не нужна */
export async function pickNegativeWords(b: Business, queries: string[], already: string[]): Promise<{ word: string; example: string }[]> {
  const n = nicheById(b.niche);
  const known = new Set(already.map((w) => w.toLowerCase()));
  const rules = n.negatives.filter((w) => !known.has(w));
  const found = new Map<string, string>();
  for (const q of queries) {
    for (const w of rules) if (q.toLowerCase().includes(w) && !found.has(w)) found.set(w, q);
  }
  if (aiConfigured() && queries.length) {
    try {
      const r = await gptJson<{ items: { word: string; query: string }[] }>(
        SYSTEM,
        `${bizBrief(b)}
Поисковые запросы, по которым показывалась реклама:
${queries.slice(0, 150).map((q) => `- ${q}`).join("\n")}
Найди запросы людей, которые точно не станут клиентами (ищут обучение, работу, товары, бесплатное, другой город, другую услугу).
Для каждого верни одно минус-слово (одно слово в начальной форме), которое отсечёт такие запросы, но не заденет целевые.
JSON: {"items":[{"word":"...","query":"пример запроса"}]}. Если таких нет — {"items":[]}.`,
        { temperature: 0.2, maxTokens: 1500 },
      );
      for (const it of r.items ?? []) {
        const w = cleanKeyword(it.word).split(" ")[0];
        if (w && w.length > 2 && !known.has(w) && !found.has(w)) found.set(w, it.query);
      }
    } catch {
      /* только правила */
    }
  }
  return [...found.entries()].map(([word, example]) => ({ word, example }));
}

/** Разбираем сайт владельца в черновик описания бизнеса */
export async function extractFromSite(text: string, hint: { niche?: string; city?: string }) {
  if (!aiConfigured()) return null;
  return gptJson<{ name?: string; description?: string; services?: { name: string; price?: string }[]; advantages?: string[]; address?: string; phone?: string }>(
    "Ты извлекаешь факты о малом бизнесе со страницы сайта. Только то, что явно написано. Ответ — JSON.",
    `Текст страницы:\n${text.slice(0, 12000)}\n\nНиша: ${hint.niche ?? "?"}, город: ${hint.city ?? "?"}.
Верни JSON: {"name":"","description":"2–3 предложения простыми словами","services":[{"name":"","price":"как на сайте, например «от 1 900 ₽»"}],"advantages":["до 5 фактов"],"address":"","phone":""}`,
    { temperature: 0.1, maxTokens: 2000 },
  );
}

// ─── Шаблоны (работают без генерации) ─────────────────────────────────

function mainService(b: Business) {
  const n = nicheById(b.niche);
  return b.services?.[0]?.name || n.examples[0];
}

/** Первый вариант, который помещается целиком; иначе — аккуратно укороченный последний */
function pick(cands: (string | null | undefined | false)[], max: number) {
  const list = cands.filter(Boolean) as string[];
  for (const c of list) {
    const t = c.replace(/\s+/g, " ").trim();
    if (t.length <= max) return t;
  }
  return fit(list[list.length - 1] ?? "", max);
}

/** Текст из предложений: добавляем, пока помещается, — без обрывков на полуслове */
function sentences(parts: (string | null | undefined | false)[], max: number) {
  let out = "";
  for (const raw of parts) {
    if (!raw) continue;
    const t = raw.trim();
    if (/онлайн/i.test(t) && /онлайн/i.test(out)) continue; // один призыв на текст
    const s = /[.!?…»"]$/.test(t) ? t : `${t}.`;
    const next = out ? `${out} ${s}` : s;
    if (next.length <= max) out = next;
  }
  return out || fit(String(parts.find(Boolean) ?? ""), max);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function templateAds(b: Business, ch: keyof typeof LIMITS, serviceName?: string, price?: string, set = 0): AdDraft[] {
  const L = LIMITS[ch];
  const n = nicheById(b.niche);
  const svc = serviceName || mainService(b);
  const p = price || b.services?.find((s) => s.name === svc)?.price || b.services?.[0]?.price;
  const street = b.address ? b.address.split(/[,—–-]/)[0].trim() : null;
  const where = street ? `${b.city}, ${street}` : b.city;
  const adv = b.advantages ?? [];
  const offer = b.offer?.replace(/\s*(на|за)\s+первый\s+визит\s*$/i, "").trim();
  // Отзыв укорачиваем так, чтобы в тексте осталось место для адреса или призыва
  const rmax = Math.max(30, L.text - 38);
  const review = b.review ? (b.review.length > rmax ? b.review.slice(0, rmax).replace(/\s+\S*$/, "").replace(/[,—–-]$/, "").trim() + "…" : b.review) : null;

  const brand = `${b.name} · ${b.city}`;
  const hours = b.hours?.trim() || null;
  const cta = "Запишитесь онлайн за минуту!";
  // Если длинный призыв не влез — добавится короткий «Запись онлайн»
  const fullOffer = b.offer ? cap(b.offer.trim()) : null;

  const price_: AdDraft = {
    angle: "price",
    title: pick([p && `${svc} — ${p}, ${b.city}`, p && `${svc} — ${p}`, p && `${svc} за ${p}`, svc], L.title),
    title2: pick([adv[0], brand, "Цена без сюрпризов"], L.title2),
    text: sentences([`${svc}${p ? ` — ${p}` : ""}`, adv[0], adv[1], `${b.name}, ${where}`, fullOffer, cta, "Запись онлайн"], L.text),
  };
  const offer_: AdDraft = offer
    ? {
        angle: "offer",
        title: pick([`${svc}: ${offer} на первый визит`, `${offer} на первый визит`, `${svc}: ${offer}`, offer], L.title),
        title2: pick([brand, "Для новых клиентов"], L.title2),
        text: sentences([`${cap(offer)} на первый визит`, p && `${svc} — ${p}`, adv[0], `${b.name}, ${where}`, cta, "Запись онлайн"], L.text),
      }
    : {
        angle: "convenience",
        title: pick([`${svc} рядом с вами — ${b.city}`, `${svc} рядом с вами`, `${svc} — ${b.city}`, svc], L.title),
        title2: pick([hours, "Онлайн-запись 24/7", "Без очереди"], L.title2),
        text: sentences([`${b.name}: ${where}`, adv[0], adv[1], hours, cta, "Запись онлайн"], L.text),
      };
  const proof_: AdDraft = review
    ? {
        angle: "proof",
        title: pick([`${svc}, к которому возвращаются`, `${svc} — отзывы клиентов`, `${b.name}: отзывы`], L.title),
        title2: pick([adv[0], brand, "Реальные отзывы"], L.title2),
        text: sentences([`«${review}»`, adv[0], `${b.name}, ${where}`, cta, "Запись онлайн"], L.text),
      }
    : {
        angle: "result",
        title: pick([`${svc} в ${b.name} — ${b.city}`, `${svc} в ${b.name}`, svc], L.title),
        title2: pick([adv[0], brand, "Аккуратно и в срок"], L.title2),
        text: sentences([cap(n.proof), adv[0], adv[1], `${b.name}, ${where}`, cta, "Запись онлайн"], L.text),
      };
  const convenience_: AdDraft = {
    angle: "convenience",
    title: pick([street ? `${svc} на ${street} — ${b.name}` : null, street ? `${svc} на ${street}` : null, `${svc} рядом с домом`, svc], L.title),
    title2: pick([hours, "Онлайн-запись 24/7", "Запись онлайн"], L.title2),
    text: sentences([`${b.name}, ${where}`, hours, adv[1] ?? adv[0], adv[0], "Выберите удобное время онлайн"], L.text),
  };
  const emotion_: AdDraft = {
    angle: "emotion",
    title: pick([`Час для себя: ${svc.toLowerCase()} в ${b.name}`, `Час для себя: ${svc.toLowerCase()}`, `Время для себя в ${b.name}`, svc], L.title),
    title2: pick([street ? `${b.name} · ${street}` : null, brand, "Запишитесь на эту неделю"], L.title2),
    text: sentences(["Время только для себя", `${cap(svc)} — ${b.name}, ${where}`, adv[0], fullOffer, cta, "Запись онлайн"], L.text),
  };
  const sets = [[price_, offer_, proof_], [convenience_, emotion_, price_]];
  return sets[set % 2].map((a) => normalizeAd(a, ch));
}

export function templatePlan(b: Business): CopyPlan {
  const n = nicheById(b.niche);
  const services = b.services?.length ? b.services.slice(0, 3) : n.examples.slice(0, 2).map((name) => ({ name, price: undefined as string | undefined }));
  const city = b.city.toLowerCase();
  const search: GroupDraft[] = services.map((s) => {
    const base = cleanKeyword(s.name);
    const kws = [base, `${base} ${city}`, `${base} рядом`, `${base} цена`, `${base} запись`];
    return { name: s.name, audience: `Ищут «${s.name.toLowerCase()}» в Яндексе`, keywords: kws, ads: templateAds(b, "search", s.name, s.price) };
  });
  const seeds = n.searchSeeds.map((k) => cleanKeyword(k.replace("{city}", city)));
  // Общие запросы ниши — в первую группу, но без запросов про другие услуги (иначе группы конкурируют)
  const otherWords = services.slice(1).map((s) => cleanKeyword(s.name).split(" ")[0]).filter((w) => w.length > 3);
  if (search[0]) search[0].keywords = [...new Set([...search[0].keywords, ...seeds.filter((k) => !otherWords.some((w) => k.includes(w.slice(0, -1))))])];
  const network: GroupDraft[] = [
    { name: "Интересуются услугой", audience: "Недавно искали похожие услуги", keywords: seeds.slice(0, 8), ads: templateAds(b, "network"), autotargeting: true },
    { name: "Похожие на клиентов", audience: "Интересы как у ваших клиентов — подбирает Яндекс", keywords: [], ads: templateAds(b, "network", undefined, undefined, 1), autotargeting: true },
  ];
  const vk: GroupDraft[] = [
    { name: `${n.audience.ageFrom}–34 года`, audience: `${n.audience.sex === "male" ? "Мужчины" : n.audience.sex === "female" ? "Женщины" : "Люди"} ${n.audience.ageFrom}–34 лет рядом с вами`, ageFrom: n.audience.ageFrom, ageTo: 34, keywords: [], ads: templateAds(b, "vk") },
    { name: `35–${n.audience.ageTo} лет`, audience: `${n.audience.sex === "male" ? "Мужчины" : n.audience.sex === "female" ? "Женщины" : "Люди"} 35–${n.audience.ageTo} лет рядом с вами`, ageFrom: 35, ageTo: n.audience.ageTo, keywords: [], ads: templateAds(b, "vk", undefined, undefined, 1) },
  ];
  return {
    search,
    network,
    vk,
    negatives: n.negatives,
    callouts: [...(b.advantages ?? []), b.offer, "Онлайн-запись 24/7", b.address ? "Удобно добраться" : null, "Без очереди"].filter((c): c is string => !!c && c.trim().length <= 25).slice(0, 6),
    imageIdeas: n.visuals,
  };
}

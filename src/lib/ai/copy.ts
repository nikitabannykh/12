import "server-only";
import type { Business, Service } from "../db/schema";
import { groupServices, hasCategories } from "../services";
import { ANGLES, isMedical, KIDS_RE, LAYER_LABEL, nicheById, type Layer } from "../niches";
import { adExtras, badChars, claimProblems, cleanText, factCallouts, hasClaims, hasSuperlative, parsePrice, parseWeekHours, SUPERLATIVE as SUPERLATIVE_ONE, withoutSuperlatives } from "../engine/extras";
import { plural } from "../util";
import { addPhrases, buildSemanticCore, displayKeyword, finalizeCore, networkInterests, conflicts, type SemanticCore, type SemanticGroup } from "../engine/semantics";
import { aiConfigured, gptJson } from "./yandex";
import { LIMITS } from "./limits";

/**
 * Лимиты площадок. Директ (ЕПК, поиск и РСЯ): заголовок 56, второй заголовок 30, текст 81, слово до 22 символов.
 * VK Реклама: заголовок 40, текст 90 (длинный текст 220 и «о компании» 115 — в extras.ts). Второго заголовка у VK нет.
 *
 * Директ теперь принимает только комбинаторные объявления (ResponsiveAd): до 7 заголовков и 3 текстов, второго
 * заголовка нет. Модель пишет основной вариант (title, title2, text) — он хранится в БД и его правит владелец.
 * Дополнительные заголовки и тексты строит adAssets (= extras.responsiveAssets) из фактов анкеты при каждой отправке:
 * детерминированно и без выдуманных утверждений, поэтому схема БД не меняется, а предпросмотр в браузере совпадает
 * с тем, что уходит в Директ. title2 уходит склейкой «Заголовок. Второй заголовок» (если влезает в 56) или
 * отдельным заголовком «Услуга: факт».
 */
export { responsiveAssets as adAssets } from "../engine/extras";
export { LIMITS };
export const MAX_WORD = 22;
/** Ключевая фраза Директа: до 7 слов, слово до 35 символов */
export const KEYWORD_LIMITS = { words: 7, wordLength: 35 } as const;

export type AdDraft = { angle: string; title: string; title2?: string | null; text: string };
export type GroupDraft = {
  name: string; audience: string; keywords: string[]; ads: AdDraft[]; ageFrom?: number; ageTo?: number; autotargeting?: boolean;
  /** Основная услуга группы (цена, заголовки) и все услуги прайса, которые она покрывает */
  service?: string; services?: string[];
  /** Минус-слова группы (кросс-минусовка между группами поиска) */
  negatives?: string[];
  /** Слой семантики: услуга, проблема клиента, смежный запрос, аудитория */
  layer?: Layer;
  /** Целевых запросов в месяц по Wordstat */
  demand?: number;
  /** VK: аудитория «искали услугу» (фразы) и интересы */
  searchPhrases?: string[];
  interests?: string[];
};
export type CopyPlan = {
  search: GroupDraft[];
  network: GroupDraft[];
  vk: GroupDraft[];
  negatives: string[];
  callouts: string[];
  imageIdeas: string[];
};

/** «лучший», «самый», «№1» — модерация пропускает их только с документами. Граница слова с учётом кириллицы и кавычек. */
const SUPERLATIVE = new RegExp(SUPERLATIVE_ONE.source, "giu");
/** Слово заглавными (4+ букв) — капслок модерация отклоняет */
const CAPS_WORD = /(?<![\p{L}])(\p{Lu}{4,})(?![\p{L}])/gu;

/** Чистим сгенерированный текст и аккуратно укорачиваем по границе слова. Для текстов владельца — validateAdText. */
export function fit(s: string | null | undefined, max: number): string {
  let t = cleanText(s);
  // Предложение с «лучший/самый» выкидываем целиком; если оно единственное — убираем само слово
  const parts = t.split(/(?<=[.!?])\s+/);
  if (parts.length > 1 && parts.some((x) => !hasSuperlative(x))) t = parts.filter((x) => !hasSuperlative(x)).join(" ");
  t = t.replace(/!{2,}/g, "!").replace(/\?{2,}/g, "?").replace(SUPERLATIVE, " ").replace(CAPS_WORD, (w) => w.charAt(0) + w.slice(1).toLowerCase());
  t = t.replace(/\s+/g, " ").replace(/\s+([.,!?;:])/g, "$1").replace(/«\s*»/g, "").replace(/«\s+/g, "«").replace(/\s+»/g, "»").trim();
  t = t.split(" ").filter((w) => w.length <= MAX_WORD).join(" ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const i = cut.lastIndexOf(" ");
  let r = (i > max * 0.5 ? cut.slice(0, i) : cut.slice(0, max)).trim();
  // Не оставляем висящий предлог, тире и прилагательное без слова, к которому оно относится:
  // «Студия «Прана» на» → «Студия «Прана»», «Йога — групповое» → «Йога»
  for (let k = 0; k < 4; k++) {
    const before = r;
    r = r.replace(/\s+(и|в|во|на|для|с|со|по|от|до|к|у|из|или|а|о|об|за|при|без|—|–|-)$/i, "").replace(/[,\-–—:;(]$/, "").trim();
    if (r.split(" ").length > 1 && DANGLING_ADJ.test(r)) r = r.replace(DANGLING_ADJ, "").trim();
    if (r === before) break;
  }
  // Незакрытая кавычка
  if ((r.match(/«/g) ?? []).length > (r.match(/»/g) ?? []).length) r += "»";
  return r;
}

/** Последнее слово — прилагательное («групповое», «детский», «ногтевой»): без существительного фраза оборвана.
 *  Существительные на -ние/-тие/-рий и т. п. («занятие», «покрытие», «санаторий») не трогаем. */
const DANGLING_ADJ = /\s+(?!\p{L}*(?:[нт]ие|чие|рий|лий|ций|зий|сий)$)\p{L}{3,}(ое|ый|ий|ой|ая|яя|ые|ие|ого|его|ому|ему|ых|их|ым|им|ую|юю)$/iu;

/**
 * Цена владельца в едином виде: «1900» → «1 900 ₽», «от 1900 руб.» → «от 1 900 ₽», «1 900 ₽» — без изменений.
 * Пробел обычный: неразрывный площадки иногда считают спецсимволом.
 */
export function priceText(s: string | null | undefined): string {
  const t = (s ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const groups = (n: string) => n.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  // Числа: «1900» и «1 900» → «1 900» (четырёхзначные тоже группируем — как в анкете Директа)
  let r = t.replace(/\d{1,3}(?: \d{3})+(?!\d)|\d{4,}/g, (m) => groups(m.replace(/ /g, "")));
  // Валюта: «руб.», «руб», «р.», «р» → «₽»; если валюты нет, а цена — число (с «от», «до», диапазоном) — добавляем «₽»
  r = r.replace(/(\d)\s*(?:рублей|рубля|рубль|руб\.?|р\.|р)(?![\p{L}])/giu, "$1 ₽").replace(/(\d)₽/g, "$1 ₽");
  if (!/₽|\$|€|usd|eur/i.test(r) && /^(от |до )?\d[\d ]*(?:\s*[-–—]\s*\d[\d ]*)?$/i.test(r)) r = `${r.trim()} ₽`;
  return r.replace(/\s+/g, " ").trim();
}

/** Пробелы по краям и двойные пробелы — единственное, что мы меняем в тексте владельца без спроса */
export const tidyText = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/**
 * Проверка текста, который владелец правит руками. Ничего не обрезаем и не вырезаем молча —
 * возвращаем понятные ошибки по-русски (пустой массив — всё хорошо). Сравнивать с tidyText(...).
 */
export function validateAdText(channel: keyof typeof LIMITS | string, ad: { title?: string | null; title2?: string | null; text?: string | null }, opts: { medical?: boolean } = {}): string[] {
  const ch = (channel in LIMITS ? channel : "search") as keyof typeof LIMITS;
  const L = LIMITS[ch];
  const errors: string[] = [];
  const sym = (n: number) => `${n} ${plural(n, "символ", "символа", "символов")}`;
  const fields: [string, string, number, boolean][] = [
    ["Заголовок", tidyText(ad.title), L.title, true],
    ...(ch === "vk" ? [] : [["Второй заголовок", tidyText(ad.title2), L.title2, false] as [string, string, number, boolean]]),
    ["Текст", tidyText(ad.text), L.text, true],
  ];
  for (const [label, v, max, required] of fields) {
    if (!v) {
      if (required) errors.push(`${label} не может быть пустым.`);
      continue;
    }
    if (v.length > max) errors.push(`${label}: ${sym(v.length)}, а можно до ${max}. Сократите на ${sym(v.length - max)}.`);
    const bad = badChars(v);
    if (bad.length) errors.push(`${label}: уберите эмодзи и спецсимволы (${bad.join(" ")}) — площадка их не примет.`);
    if (ch !== "vk") {
      const long = v.split(/[\s]+/).filter((w) => w.length > MAX_WORD);
      if (long.length) errors.push(`${label}: слово «${long[0]}» длиннее ${MAX_WORD} символов — Директ такие не пропускает. Разделите его пробелом или дефисом с пробелами.`);
    }
    const sup = v.match(SUPERLATIVE_ONE);
    if (sup) errors.push(`${label}: «${sup[0].trim()}» модерация пропускает только с документом-подтверждением. Лучше уберите.`);
    const caps = v.match(CAPS_WORD);
    if (caps) errors.push(`${label}: «${caps[0]}» написано заглавными — модерация отклонит. Напишите обычными буквами.`);
    if (/([!?])\1/.test(v)) errors.push(`${label}: несколько «!» или «?» подряд модерация не пропустит.`);
    const claims = claimProblems(v, Boolean(opts.medical));
    if (claims.length) errors.push(`${label}: ${claims.join(", ")} — ${opts.medical ? "в рекламе медицинских услуг это запрещает закон «О рекламе» (ст. 24), модерация отклонит" : "модерация отклонит"}.${opts.medical && claims.some((c) => c.startsWith("предположение")) ? " Пишите о специалисте, а не о болезни читателя: «Остеопат при боли в шее»." : ""}`);
  }
  return errors;
}

function normalizeAd(a: AdDraft, ch: keyof typeof LIMITS): AdDraft {
  const L = LIMITS[ch];
  return {
    angle: ANGLES[a.angle] ? a.angle : "price",
    title: fit(a.title, L.title),
    title2: a.title2 && ch !== "vk" ? fit(a.title2, L.title2) || null : null,
    text: fit(a.text, L.text),
  };
}

/**
 * Ключевая фраза для Директа: без эмодзи и операторов (+ ! - " [ ]), до 7 слов.
 * «Стрижка + борода 💈» → «стрижка борода».
 */
export function cleanKeyword(k: string) {
  return cleanText(k)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-"))
    .filter((w) => w && w.length <= KEYWORD_LIMITS.wordLength)
    .slice(0, KEYWORD_LIMITS.words)
    .join(" ");
}

const STOP = new Set(["и", "в", "во", "на", "для", "с", "со", "по", "от", "до", "к", "у", "из", "или", "а", "о", "об", "за"]);
/** Основа запроса из названия услуги: до трёх значимых слов, без висящих предлогов */
function keywordBase(name: string) {
  const words = cleanKeyword(name).split(" ").filter(Boolean);
  const out: string[] = [];
  let sig = 0;
  for (const w of words) {
    if (sig >= 3) break;
    out.push(w);
    if (!STOP.has(w)) sig++;
  }
  while (out.length && STOP.has(out[out.length - 1])) out.pop();
  return out.join(" ");
}

// ─── Проверка фактов: в объявлении — только то, что есть в анкете ─────────

/** Факты владельца одной строкой (без подсказок по нише) — с ними сверяем ответ модели */
function ownerFacts(b: Business) {
  const parts = [
    b.name, b.city, b.address, b.hours, b.description, b.offer, b.review, b.audience, ...derivedFacts(b),
    ...(b.advantages ?? []),
    ...(b.services ?? []).flatMap((s) => [s.name, s.price, s.note]),
    b.whatsapp ? "whatsapp ватсап" : null,
    b.telegram ? "telegram телеграм" : null,
    b.review ? "отзыв" : null,
    /%|[−-]\s?\d/.test(b.offer ?? "") ? "скидка" : null,
  ];
  return parts.filter(Boolean).join(" \n ").toLowerCase();
}

const numbersIn = (s: string) => (s.replace(/(\d)[\s\u00a0](?=\d{3}\b)/g, "$1").match(/\d+/g) ?? []).map((x) => x.replace(/^0+(?=\d)/, ""));

/** Темы-обещания: если в анкете их нет, модель их выдумала */
const CLAIMS: RegExp[] = [
  /пробн/i, /бесплатн/i, /скидк|%/i, /подар/i, /гаранти/i, /без\s+очеред/i, /24\/7|круглосуточ/i, /стерил/i, /сертифи/i,
  /лиценз/i, /диплом/i, /опыт|стаж/i, /рейтинг|звёзд|звезд|★/i, /отзыв/i, /кофе/i, /парков/i, /метро/i, /акци/i, /врач/i,
  /натуральн|органич/i, /гипоаллерген/i, /премиум|премиальн|эксклюзив/i, /в\s+центре/i, /рядом\s+с\s+(домом|вами|метро)|в\s+шаговой/i,
  /на\s+дому|выезд/i, /абонемент/i, /whatsapp|ватсап|telegram|телеграм/i, /маленьк\S*\s+групп|мини-групп/i, /для\s+начинающих/i, /детск|для\s+детей/i,
];

/** Утверждение опирается на анкету: все числа и «обещания» из него есть у владельца */
export function supportedBy(sentence: string, facts: string) {
  const factNums = new Set(numbersIn(facts));
  if (numbersIn(sentence).some((n) => !factNums.has(n))) return false;
  return CLAIMS.every((re) => !re.test(sentence) || re.test(facts));
}

/**
 * Оставляем только подтверждённые предложения. Заголовок либо подтверждён целиком, либо объявление отбрасываем.
 * medical: ещё и без обещаний, отзывов пациентов и «Болит…?» (extras.claimProblems); обещание вылечить — нигде.
 */
function factCheckAd(a: AdDraft, facts: string, medical = false): AdDraft | null {
  if (!supportedBy(a.title, facts) || hasClaims(a.title, medical)) return null;
  const title2 = a.title2 && supportedBy(a.title2, facts) && !hasClaims(a.title2, medical) ? a.title2 : null;
  const text = a.text
    .split(/(?<=[.!?])\s+/)
    .filter((x) => supportedBy(x, facts) && !hasClaims(x, medical))
    .join(" ")
    .trim();
  if (text.length < 25) return null;
  // От текста остался один призыв («Запишитесь онлайн!») — фактов в нём нет, лучше шаблонное объявление
  if (text.split(/(?<=[.!?])\s+/).every((x) => /запис|запиш/i.test(x) && x.length < 45)) return null;
  return { ...a, title2, text };
}

function bizBrief(b: Business) {
  const n = nicheById(b.niche);
  const derived = derivedFacts(b);
  const ext = { callouts: factCallouts(b, isMedical(b)), sitelinks: adExtras(b, { channel: "search", href: "https://example.ru/" }).sitelinks };
  const line = (s: Service) => `- ${s.name}${humanService(b, s.name) !== cleanText(s.name) ? ` (в рекламе называть: «${humanService(b, s.name)}»)` : ""}${s.price ? ` — ${priceText(s.price)}` : ""}${s.note ? ` (${s.note})` : ""}`;
  // Разделы прайса — заголовками: модели проще сделать по группе на раздел («Маникюр», «Педикюр»)
  const services = hasCategories(b.services ?? [])
    ? groupServices(b.services ?? []).map((g) => `${g.category || "Другое"}:\n${g.items.map((x) => line(x.s)).join("\n")}`).join("\n")
    : (b.services ?? []).map(line).join("\n");
  return [
    `Бизнес: ${b.name} (${n.label}), город ${b.city}${b.address ? `, адрес: ${b.address}` : ""}.`,
    specialistOf(b) ? `Кто принимает: ${specialistOf(b)!.nom}. Человек из рекламы не знает бизнес — в заголовке всегда понятно, что это за услуга и кто её оказывает.` : "",
    b.description ? `Описание от владельца: ${b.description}` : "",
    services ? `Услуги и цены:\n${services}` : "",
    b.advantages?.length ? `Преимущества: ${b.advantages.join("; ")}` : "",
    b.offer ? `Предложение для новых клиентов: ${b.offer}` : "",
    b.review ? `Реальный отзыв клиента: ${b.review}` : "",
    b.audience ? `Кто клиенты: ${b.audience}` : `Типичные клиенты (для выбора слов, не для обещаний): ${n.audience.text}`,
    b.hours ? `Часы работы: ${b.hours}` : "",
    b.whatsapp || b.telegram ? `Запись в мессенджерах: ${[b.whatsapp && "WhatsApp", b.telegram && "Telegram"].filter(Boolean).join(", ")}` : "",
    b.phone ? "Есть телефон для записи." : "",
    `На странице записи есть онлайн-форма — «онлайн-запись» писать можно.`,
    derived.length ? `Что ещё следует из прайса и часов (тоже факты, можно писать): ${derived.join("; ")}.` : "",
    `Под объявлением сами покажем уточнения (${ext.callouts.join(", ")}) и быстрые ссылки (${ext.sitelinks.map((x) => x.title).join(", ")}) — в тексте лучше другие факты.`,
  ].filter(Boolean).join("\n");
}

/** Факты, которые следуют из анкеты: «Принимаем взрослых и детей» (по прайсу), «Принимаем и в субботу», «Цены от 4 500 ₽» */
function derivedFacts(b: Business) {
  const f = factsOf(b);
  return [f.who, ...f.hoursFacts, f.from && `Цены ${f.from}`, f.addr && f.addr !== f.street ? `Адрес: ${f.addr}` : null].filter((x): x is string => !!x);
}

const SYSTEM = `Ты — сильный директолог и копирайтер для малого бизнеса в России. Пишешь объявления для Яндекс Директа и VK Рекламы.
Правила:
- Только факты из описания бизнеса. Каждое утверждение должно опираться на конкретную строку описания.
- Числа — только те, что есть в описании (цены, сроки, размер групп, длительность, стаж). Нет числа в описании — не пиши его.
- Не обещай того, чего нет в описании: пробное занятие, скидки, подарки, «бесплатно», гарантию, опыт и дипломы мастеров, рейтинг и звёзды, отзывы, кофе, парковку, метро, «без очереди», «24/7», «рядом с домом», маленькие группы, стерильность, сертификаты, «для начинающих», «для детей».
- Объявления с выдуманными фактами автоматически удаляются — лучше короче, но правдиво.
- Без эмодзи, без значков «+», «#», «*», без слов длиннее 22 символов.
- Никаких «лучший», «№1», «самый», капслока и восклицательных знаков подряд — модерация отклонит.
- Пиши конкретно и по-человечески: услуга, цена, выгода, место. Без канцелярита и штампов («индивидуальный подход», «высокое качество»).
- Заголовок 1 обязательно содержит услугу. В тексте — призыв записаться.
- Используй место почти целиком: заголовок 35–56 символов, второй заголовок 20–30, текст 65–81 (VK — 70–90). Короткое объявление на поиске проигрывает соседям.
- Название бизнеса пиши точно как у владельца, с теми же заглавными буквами. Цены — с пробелом в тысячах и знаком ₽: «1 900 ₽».
- Заголовки объявлений в одной группе не повторяют друг друга.
- Второй заголовок не повторяет первый: туда — факт из описания (преимущество, адрес, часы работы, предложение).
- Город не склоняй вслепую: пиши «— Казань» или «, Казань», а не «в Казань».
- Каждое объявление проверяет свою гипотезу (угол подачи): price, offer, proof, convenience, result, emotion.
Ответ — строго JSON без пояснений.`;

/** Медицинские услуги: закон «О рекламе», ст. 24, и правила Директа */
const MEDICAL_RULES = `Это медицинские услуги. Дополнительно:
- Не обещай излечение, результат и безопасность: никаких «вылечим», «избавим навсегда», «гарантия», «без боли», «эффективно».
- Не предполагай болезнь у читателя: нельзя «Болит шея?», «Мучает спина?». Можно: «Остеопат при боли в шее».
- Без отзывов и благодарностей пациентов.
- Предупреждение о противопоказаниях Директ добавит сам — в текст его не пиши.`;

/** Сколько групп отдаём модели: остальным — шаблонные объявления (ответ модели ограничен по длине) */
const AI_GROUPS = 8;

/** deadline — к какому моменту нужен ответ (лимит времени функции): не успела модель — шаблонные объявления */
export async function generateCopyPlan(b: Business, channels: { search: boolean; network: boolean; vk: boolean }, core: SemanticCore = buildSemanticCore(b), opts: { deadline?: number } = {}): Promise<CopyPlan> {
  const n = nicheById(b.niche);
  const fallback = templatePlan(b, core);
  if (!aiConfigured()) return fallback;

  const medical = isMedical(b);
  // Модели — только группы услуг: объявления групп проблем, смежных и аудиторий строим по шаблону «проблема → решение»
  // (проверенные формулировки, без обещаний), иначе модель пишет про услугу без связи с запросом
  const list = (gs: GroupDraft[]) => gs.filter((g) => (g.layer ?? "service") === "service").slice(0, AI_GROUPS).map((g, i) => `${i + 1}. ${g.name}${g.service && g.service !== g.name ? ` (услуга: ${g.service})` : ""}${g.services && g.services.length > 1 ? `; ещё: ${g.services.filter((x) => x !== g.service).slice(0, 4).join(", ")}` : ""}`).join("\n");
  const user = `${bizBrief(b)}
${medical ? `\n${MEDICAL_RULES}\n` : ""}
Группы поиска (семантика уже собрана, нужны только объявления):
${list(fallback.search)}
Группы РСЯ:
${list(fallback.network)}

Три объявления группы должны отличаться не только заголовком: у каждого свой первый факт в тексте и свой второй заголовок.
Например: 1) цена услуги и другие цены прайса; 2) для кого приём, описание или преимущество; 3) адрес, часы и запись. Не повторяй один и тот же текст в разных объявлениях и группах.
Используй преимущества, описание, заметки к услугам и факты из прайса и часов — объявление из одной цены и призыва проигрывает.

Подготовь рекламу. Верни JSON:
{
 "search": [ // по элементу на каждую группу поиска из списка, в том же порядке
   {"group": 1, "ads": [3 объявления про услугу этой группы, с разными подходами: {"angle": "price|offer|proof|convenience|result|emotion", "title": "до 56 символов, с услугой группы", "title2": "до 30 символов", "text": "до 81 символа"}]}
 ],
 "network": [ // по элементу на каждую группу РСЯ из списка, в том же порядке
   {"group": 1, "ads": [3 объявления, title до 56 символов, text до 81]}
 ],
 "vk": [ // 2 группы для ВКонтакте: разные возрастные аудитории (проверим, какая лучше)
   {"name": "...", "audience": "...", "ageFrom": 20, "ageTo": 34, "keywords": [], "ads": [3 объявления, title до 40 символов, text до 90]}
 ],
 "negatives": ["20–40 минус-слов: что ищут люди, которым мы не нужны (обучение, вакансии, товары, «своими руками» и т.п.)"],
 "callouts": ["до 6 уточнений, каждое до 25 символов целиком: только факты из описания"],
 "imageIdeas": ["3 сюжета фотографии для рекламы на английском языке: реалистичное фото без текста, без крупных лиц, детали процесса или результата, атмосфера места. Учитывай нишу: ${n.label}"]
}
Каналы, которые нужны: ${Object.entries(channels).filter(([, v]) => v).map(([k]) => k).join(", ")}. Для ненужных верни пустой массив.`;

  try {
    type Raw = { search?: { group?: number; ads?: AdDraft[] }[]; network?: { group?: number; ads?: AdDraft[] }[]; vk?: GroupDraft[]; negatives?: string[]; callouts?: string[]; imageIdeas?: string[] };
    const raw = await gptJson<Raw>(SYSTEM, user, { temperature: 0.55, maxTokens: 8000, timeoutMs: 45_000, until: opts.deadline });
    const facts = ownerFacts(b);
    // Объявления модели — в группы семантики по номеру; выдуманный факт — шаблонное объявление того же места
    const fill = (items: Raw["search"], ch: keyof typeof LIMITS, fb: GroupDraft[]): GroupDraft[] =>
      fb.map((g, gi) => {
        if ((g.layer ?? "service") !== "service") return g;
        const got = (items ?? []).find((x, xi) => (x?.group ?? xi + 1) === gi + 1);
        if (!got?.ads?.length) return g;
        const ads = got.ads.slice(0, 3).map((a, i) => {
          const nz = normalizeAd(a, ch);
          const checked = nz.title && nz.text ? factCheckAd(nz, facts, medical) : null;
          return checked ?? g.ads[i % Math.max(1, g.ads.length)] ?? null;
        });
        // После проверки фактов тексты могут сжаться до одинаковых — повтор заменяем шаблонным объявлением этой группы
        const sameText = (x: AdDraft, y: AdDraft) => titleKey(x.text) === titleKey(y.text) || titleKey(firstSentence(x.text)) === titleKey(firstSentence(y.text));
        const kept: AdDraft[] = [];
        for (const a of ads) {
          if (!a || !a.title || !a.text) continue;
          if (!kept.some((k) => sameText(k, a))) kept.push(a);
          else {
            const t = g.ads.find((x) => !kept.some((k) => sameText(k, x) || titleKey(k.title) === titleKey(x.title)));
            if (t) kept.push(t);
          }
        }
        const merged = uniqueAds(kept);
        // Меньше трёх после проверки — добираем шаблонными с другими подходами
        for (const t of g.ads) if (merged.length < 3 && !merged.some((m) => m.angle === t.angle || titleKey(m.title) === titleKey(t.title) || sameText(m, t))) merged.push(t);
        return { ...g, ads: merged.length ? merged : g.ads };
      });
    const vk = (raw.vk ?? [])
      .filter((g) => g && g.name && Array.isArray(g.ads) && g.ads.length)
      .map((g, gi) => {
        const fb = fallback.vk;
        const ads = g.ads.slice(0, 4).map((a, i) => {
          const nz = normalizeAd(a, "vk");
          const checked = nz.title && nz.text ? factCheckAd(nz, facts, medical) : null;
          return checked ?? fb[gi % Math.max(1, fb.length)]?.ads[i % 3] ?? null;
        });
        return { ...g, name: fit(g.name, 60), audience: fit(g.audience || "", 120), keywords: [], ads: uniqueAds(ads.filter((a): a is AdDraft => !!a && !!a.title && !!a.text)) };
      })
      .filter((g) => g.ads.length);
    // Минус-слова модели — только те, что не блокируют наши же фразы
    const allKw = fallback.search.flatMap((g) => g.keywords);
    const aiNeg = (raw.negatives ?? []).map(cleanKeyword).filter((w) => w && !allKw.some((k) => conflicts(w, k)));
    return {
      search: channels.search ? fill(raw.search, "search", fallback.search) : [],
      network: channels.network ? fill(raw.network, "network", fallback.network) : [],
      // Аудитории VK — наши (поиск, интересы, все рядом), объявления — от модели, если прошли проверку
      vk: channels.vk ? fallback.vk.map((g) => (vk.length && vk[0].ads.length ? { ...g, ads: vk[0].ads } : g)) : [],
      negatives: [...new Set([...fallback.negatives, ...aiNeg])].filter(Boolean).slice(0, 150),
      callouts: [...new Map([...(raw.callouts ?? []).map((c) => cleanText(c)).filter((c) => c && c.length <= 25 && supportedBy(c, facts) && !hasClaims(c, medical)), ...fallback.callouts].map((c) => [c.toLowerCase(), c])).values()].slice(0, 6),
      imageIdeas: (raw.imageIdeas?.length ? raw.imageIdeas : fallback.imageIdeas).slice(0, 3),
    };
  } catch {
    return fallback;
  }
}

/**
 * Расширение семантики моделью: синонимы и переформулировки, как люди ищут. Каждую фразу проверяем
 * (semantics.acceptPhrase): есть слово услуги группы, нет слов соседних групп и услуг, которых у владельца нет.
 */
export async function expandSemantics(b: Business, core: SemanticCore): Promise<SemanticCore> {
  if (!aiConfigured() || !core.groups.length) return core;
  // Только группы услуг (они идут первыми — номера совпадают с core.groups): слои собраны по проверенным словарям
  const groups = core.groups.filter((g) => (g.layer ?? "service") === "service").slice(0, 12);
  try {
    const r = await gptJson<{ groups: { group: number; phrases: string[] }[] }>(
      "Ты — директолог. Подбираешь поисковые запросы для Яндекс Директа. Только запросы людей, которые хотят получить именно эту услугу. Ответ — строго JSON.",
      `${bizBrief(b)}

Группы и уже собранные запросы:
${groups.map((g, i) => `${i + 1}. ${g.name}: ${g.core.slice(0, 8).map(displayKeyword).join(", ")}`).join("\n")}

Для каждой группы предложи до 15 других запросов (2–5 слов): синонимы и разговорные названия этой же услуги, как реально ищут.
Нельзя: другие услуги, которых нет в списке; город, цены и слова «рядом», «недорого» (их мы добавим сами); обучение, товары, «своими руками».
JSON: {"groups":[{"group":1,"phrases":["..."]}]}`,
      { temperature: 0.4, maxTokens: 3000 },
    );
    let added = 0;
    for (const x of r.groups ?? []) {
      const gi = Number(x.group) - 1;
      if (gi >= 0 && gi < groups.length) added += addPhrases(core, gi, (x.phrases ?? []).map(String), b.niche, 15);
    }
    return finalizeCore({ ...core, checks: { ...core.checks, ai: { added } } }, b.niche);
  } catch {
    return core;
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
${isMedical(b) ? `\n${MEDICAL_RULES}\n` : ""}
Текущее объявление (${ANGLES[p.base.angle]?.name ?? p.base.angle}):
Заголовок: ${p.base.title}
${p.base.title2 ? `Заголовок 2: ${p.base.title2}\n` : ""}Текст: ${p.base.text}
Почему нужна замена: ${p.reason}
${p.winner ? `Лучшее объявление в группе сейчас: «${p.winner.title}» — «${p.winner.text}»` : ""}
Уже проверенные подходы: ${p.tried.join(", ") || "нет"}.

Напиши новое объявление с подходом "${angle}" (${ANGLES[angle].hint}). Только факты из описания: если для этого подхода фактов нет — напиши про услугу, цену и адрес. Лимиты: title до ${L.title}, title2 до ${L.title2}, text до ${L.text} символов.
Верни JSON: {"angle":"${angle}","title":"...","title2":"...","text":"...","hypothesis":"одно предложение для владельца бизнеса: что проверяем и почему, без жаргона"}`,
        { temperature: 0.7, maxTokens: 800 },
      );
      const n = normalizeAd({ ...r, angle }, p.channel);
      const ad = n.title && n.text ? factCheckAd(n, ownerFacts(b), isMedical(b)) : null;
      if (ad) return { ...ad, hypothesis: cleanHypothesis(fit(r.hypothesis, 220)) || hypothesisFor(angle) };
    } catch {
      /* ниже — шаблон */
    }
  }
  const svc = p.service ? b.services?.find((s) => s.name === p.service) : undefined;
  const pool = [...templateAds(b, p.channel, svc?.name ?? p.service, svc?.price), ...templateAds(b, p.channel, svc?.name ?? p.service, svc?.price, 1)];
  const t = pool.find((a) => a.angle === angle && a.title !== p.base.title) ?? pool.find((a) => a.title !== p.base.title) ?? pool[0];
  return { ...t, hypothesis: hypothesisFor(t.angle) };
}

/**
 * Переписать пачку объявлений по пожеланию владельца («живее», «больше про боль в спине»…).
 * Угол подачи каждого объявления сохраняем — A/B-идея группы не ломается. Что не прошло проверку фактов, — null (оставим старое).
 */
export async function rewriteAdsBatch(
  b: Business,
  ch: keyof typeof LIMITS,
  items: { key: string; group: string; service?: string; ad: AdDraft }[],
  wish: string,
  opts: { until?: number } = {},
): Promise<Record<string, AdDraft | null>> {
  const out: Record<string, AdDraft | null> = {};
  if (!items.length) return out;
  if (!aiConfigured()) {
    // Без модели — другой проверенный шаблон с тем же подходом (пожелание учесть не можем)
    // Варианты в пачке не повторяют ни старые тексты, ни друг друга
    const taken = new Set(items.flatMap((it) => [titleKey(it.ad.title), titleKey(it.ad.text)]));
    for (const it of items) {
      const svc = it.service ? b.services?.find((s) => s.name === it.service) : undefined;
      const pool = [0, 1, 2].flatMap((set) => adPool(b, ch, svc?.name ?? it.service, svc?.price, set));
      const free = (a: AdDraft) => !taken.has(titleKey(a.title)) && !taken.has(titleKey(a.text));
      const alt = pool.find((a) => a.angle === it.ad.angle && free(a)) ?? pool.find(free);
      if (alt) taken.add(titleKey(alt.title)).add(titleKey(alt.text));
      out[it.key] = alt ?? null;
    }
    return out;
  }
  const L = LIMITS[ch];
  const medical = isMedical(b);
  const facts = ownerFacts(b);
  const r = await gptJson<{ ads: { n: number; title: string; title2?: string; text: string }[] }>(
    SYSTEM,
    `${bizBrief(b)}
${medical ? `\n${MEDICAL_RULES}\n` : ""}
Площадка: ${ch === "vk" ? "VK Реклама (лента соцсетей)" : ch === "search" ? "поиск Яндекса" : "сайты-партнёры Яндекса (РСЯ)"}.
Владельцу не нравятся тексты. Его пожелание: «${wish || "сделать живее, понятнее и конкретнее"}».
Перепиши каждое объявление с учётом пожелания. Угол подачи (angle) и группу не меняй. Человек из рекламы должен сразу понять, что за услуга и у кого.
Лимиты: title до ${L.title}${ch === "vk" ? "" : `, title2 до ${L.title2}`}, text до ${L.text} символов.

${items.map((x, i) => `${i + 1}. Группа «${x.group}», подход ${x.ad.angle}
Заголовок: ${x.ad.title}${x.ad.title2 ? `\nЗаголовок 2: ${x.ad.title2}` : ""}
Текст: ${x.ad.text}`).join("\n\n")}

JSON: {"ads":[{"n":1,"title":"...",${ch === "vk" ? "" : `"title2":"...",`}"text":"..."}]} — по одному на каждое объявление.`,
    { temperature: 0.7, maxTokens: Math.min(8000, 300 + items.length * 220), until: opts.until },
  );
  for (const a of r.ads ?? []) {
    const it = items[Number(a.n) - 1];
    if (!it) continue;
    const n = normalizeAd({ angle: it.ad.angle, title: String(a.title ?? ""), title2: a.title2 ? String(a.title2) : null, text: String(a.text ?? "") }, ch);
    const checked = n.title && n.text ? factCheckAd(n, facts, medical) : null;
    out[it.key] = checked && validateAdText(ch, checked, { medical }).length === 0 ? { ...checked, angle: it.ad.angle } : null;
  }
  return out;
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
// Правило: только данные из анкеты (услуги, цены, преимущества, предложение, отзыв, адрес, часы)
// и правда о продукте — на странице записи есть онлайн-форма. Никаких «Без очереди» и «до 10 человек».

/**
 * Кто оказывает услугу — по названию, описанию и прайсу бизнеса. Нужен, чтобы «Взрослый приём» из прайса
 * стал в объявлении «Приём остеопата для взрослых»: человек из рекламы не знает, что это за бизнес.
 */
const SPECIALISTS: { re: RegExp; gen: string; nom: string }[] = [
  { re: /остеопат/, gen: "остеопата", nom: "остеопат" },
  { re: /мануальн/, gen: "мануального терапевта", nom: "мануальный терапевт" },
  { re: /хиропракт/, gen: "хиропрактика", nom: "хиропрактик" },
  { re: /невролог/, gen: "невролога", nom: "невролог" },
  { re: /косметолог/, gen: "косметолога", nom: "косметолог" },
  { re: /дерматолог/, gen: "дерматолога", nom: "дерматолог" },
  { re: /трихолог/, gen: "трихолога", nom: "трихолог" },
  { re: /подолог/, gen: "подолога", nom: "подолог" },
  { re: /стоматолог/, gen: "стоматолога", nom: "стоматолог" },
  { re: /гинеколог/, gen: "гинеколога", nom: "гинеколог" },
  { re: /психотерапевт/, gen: "психотерапевта", nom: "психотерапевт" },
  { re: /психолог/, gen: "психолога", nom: "психолог" },
  { re: /логопед/, gen: "логопеда", nom: "логопед" },
  { re: /нутрициолог|диетолог/, gen: "нутрициолога", nom: "нутрициолог" },
  { re: /реабилитолог/, gen: "реабилитолога", nom: "реабилитолог" },
  { re: /ветеринар|ветклиник/, gen: "ветеринара", nom: "ветеринар" },
  { re: /массажист|массаж/, gen: "массажиста", nom: "массажист" },
  { re: /тренер|фитнес/, gen: "тренера", nom: "тренер" },
];
export function specialistOf(b: Pick<Business, "name" | "description" | "services" | "niche">) {
  const text = [b.name, b.description, ...(b.services ?? []).flatMap((x) => [x.name, x.category, x.note])].filter(Boolean).join(" ").toLowerCase().replace(/ё/g, "е");
  return SPECIALISTS.find((x) => x.re.test(text)) ?? null;
}

/**
 * Название услуги для рекламы: если в прайсе написано обезличенно («Взрослый приём», «Первичная консультация»,
 * «Сеанс 60 минут»), добавляем специалиста: «Приём остеопата для взрослых», «Первичная консультация остеопата».
 */
export function humanService(b: Pick<Business, "name" | "description" | "services" | "niche">, raw: string | null | undefined): string {
  const name = cleanText(raw);
  if (!name) return name;
  const sp = specialistOf(b);
  if (!sp) return name;
  const l = name.toLowerCase().replace(/ё/g, "е");
  if (sp.re.test(l)) return name; // специалист уже в названии
  const who = /взросл/.test(l) ? " для взрослых" : /детск|ребен|малыш|подрост/.test(l) ? " для детей" : /беремен/.test(l) ? " для беременных" : /младен|новорожд|грудн/.test(l) ? " для младенцев" : "";
  const kind = /консультац/.test(l) ? "консультация" : /сеанс/.test(l) ? "сеанс" : /диагност/.test(l) ? "диагностика" : /при[её]м|прием|визит/.test(l) ? "приём" : null;
  if (!kind) return name;
  const first = /первичн|перв(ый|ая)/.test(l) ? "Первичный " : /повторн/.test(l) ? "Повторный " : "";
  const k = kind === "консультация" ? (first ? `${first.replace("ый", "ая").trim()} консультация` : "Консультация") : kind === "сеанс" ? `${first}сеанс`.replace(/^с/, "С") : kind === "диагностика" ? "Диагностика" : `${first}приём`.replace(/^п/, "П");
  const tail = l.match(/\d+\s*(мин|минут|час)\S*/)?.[0];
  return `${k} ${sp.gen}${who}${tail ? `, ${tail}` : ""}`.replace(/\s+/g, " ").trim();
}

/** Интересы VK по теме бизнеса — названия категорий дерева интересов (ищем по ним в кабинете) */
export function vkInterestTopics(b: Pick<Business, "niche">, specialist?: string | null): { label: string; names: string[] } {
  if (specialist && /остеопат|мануальн|хиропракт|невролог|реабилит|массажист/.test(specialist)) return { label: "здоровье", names: ["Здоровье", "Медицина", "Здоровый образ жизни"] };
  if (specialist && /стоматолог|гинеколог|дерматолог|психотерап|психолог|логопед|нутрициолог/.test(specialist)) return { label: "здоровье", names: ["Здоровье", "Медицина"] };
  switch (b.niche) {
    case "nails": case "brows": case "hair": case "cosmetology": return { label: "красота", names: ["Красота", "Уход за собой", "Мода"] };
    case "barber": return { label: "мужской стиль", names: ["Красота", "Мода"] };
    case "massage": return { label: "здоровье и отдых", names: ["Здоровье", "Красота", "Отдых"] };
    case "yoga": case "fitness": return { label: "спорт и здоровье", names: ["Спорт", "Фитнес", "Здоровый образ жизни"] };
    case "dance": return { label: "танцы и спорт", names: ["Танцы", "Спорт", "Хобби"] };
    default: return { label: "семья и дом", names: ["Семья", "Здоровье"] };
  }
}

/** Название услуги, если владелец услуг не указал: нейтральное слово ниши, без выдуманных деталей */
function genericService(b: Business) {
  const n = nicheById(b.niche);
  return n.id === "other" ? cleanText(b.name) : n.generic;
}

function mainService(b: Business) {
  return humanService(b, b.services?.[0]?.name) || genericService(b);
}

/** Первый вариант, который помещается целиком (и не занят другим объявлением — used); иначе — аккуратно укороченный */
function pickTitle(cands: (string | null | undefined | false)[], max: number, used?: Set<string>) {
  const list = (cands.filter(Boolean) as string[]).map((c) => cleanText(c)).filter(Boolean);
  const free = (t: string) => !used || !used.has(titleKey(t));
  const take = (t: string) => {
    used?.add(titleKey(t));
    return t;
  };
  for (const t of list) if (t.length <= max && free(t)) return take(t);
  for (const t of list) {
    const f = fit(t, max);
    if (f && free(f)) return take(f);
  }
  for (const t of list) if (t.length <= max) return t;
  return fit(list[list.length - 1] ?? "", max);
}

/** Текст из предложений: добавляем, пока помещается, — без обрывков на полуслове */
function joinSentences(parts: (string | null | undefined | false)[], max: number) {
  let out = "";
  for (const raw of parts) {
    if (!raw) continue;
    const t = cleanText(raw);
    if (!t) continue;
    if (/онлайн/i.test(t) && /онлайн/i.test(out)) continue; // один призыв на текст
    const s = /[.!?»"]$/.test(t) ? t : `${t}.`;
    if (out.toLowerCase().includes(s.toLowerCase())) continue; // без повторов
    // Почти то же другими словами («Центр для взрослых и детей» → «Принимаем взрослых и детей») — пропускаем
    const words = t.toLowerCase().replace(/ё/g, "е").match(/\p{L}{4,}/gu) ?? [];
    const have = out.toLowerCase().replace(/ё/g, "е");
    if (words.length && words.filter((w) => have.includes(w)).length / words.length >= 0.6) continue;
    const next = out ? `${out} ${s}` : s;
    if (next.length <= max) out = next;
  }
  return out || fit(String(parts.find(Boolean) ?? ""), max);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/**
 * Строчная первая буква — только у обычных слов. Аббревиатуры («SPA»), названия с заглавными внутри
 * («Студия Лак», «Маникюр Shellac») и название бизнеса оставляем как написал владелец.
 */
const low = (s: string, brand?: string) => {
  if (/^\p{Lu}{2}/u.test(s) || /\s\p{Lu}/u.test(s)) return s;
  const first = s.split(/\s/)[0];
  if (brand && first && brand.split(/\s+/).some((w) => w === first && /^\p{Lu}/u.test(w))) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
};
const titleKey = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Объявления группы без повторяющихся заголовков (сравниваем без регистра, пробелов и знаков) */
function uniqueAds(ads: AdDraft[]): AdDraft[] {
  const seen = new Set<string>();
  return ads.filter((a) => {
    const k = titleKey(a.title);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Текст с призывом записаться: если факты заняли всё место, убираем последний факт ради короткого «Запись онлайн» */
function withCta(parts: (string | null | undefined | false)[], max: number) {
  const t = joinSentences(parts, max);
  const CALL = /запис|запиш/i;
  if (CALL.test(t)) return t;
  const CTA = "Запись онлайн.";
  // Два способа освободить место: убрать последние факты или заново набрать факты в укороченный текст — берём полнее
  const sents = t.split(/(?<=[.!?])\s+/);
  let popped = "";
  while (sents.length > 1 && !popped) {
    sents.pop();
    const x = `${sents.join(" ")} ${CTA}`;
    if (x.length <= max) popped = x;
  }
  const body = joinSentences(parts.filter((x) => !(x && CALL.test(x))), max - CTA.length - 1);
  const packed = body && body.split(/(?<=[.!?])\s+/)[0] === t.split(/(?<=[.!?])\s+/)[0] ? `${body} ${CTA}` : "";
  const best = [popped, packed].filter((x) => x && x.length <= max).sort((a, b) => b.length - a.length)[0];
  return best ?? t;
}

/** Первое предложение текста — по нему сравниваем объявления группы (два текста с одного предложения читаются одинаково) */
const firstSentence = (s: string) => cleanText(s).split(/(?<=[.!?])\s+/)[0] ?? "";
const fmtClock = (h: number) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;

/**
 * Факты анкеты для шаблонных объявлений — всё, из чего можно собрать разные тексты, и ничего сверх анкеты:
 * услуга и цена, другие услуги прайса с ценами, «цены от», для кого приём (взрослые и дети — по прайсу),
 * описание и заметка к услуге, преимущества, предложение, отзыв (не для медицины), адрес с домом, часы
 * и что из них следует (работаем в субботу, приём до 20:00), онлайн-запись, телефон и мессенджеры.
 */
function factsOf(b: Business, serviceName?: string, price?: string) {
  const rawSvc = cleanText(serviceName);
  const svc = humanService(b, rawSvc) || mainService(b);
  const services = (b.services ?? []).filter((s) => cleanText(s.name));
  const owned = services.find((s) => cleanText(s.name) === rawSvc) ?? (serviceName ? undefined : services[0]);
  const p = priceText(cleanText(price || owned?.price || (serviceName ? null : services[0]?.price))) || null;
  const medical = isMedical(b);
  const ok = (s: string | null | undefined): s is string => !!s && !hasClaims(s, medical) && !hasSuperlative(s);
  const name = cleanText(b.name);
  const addrFull = cleanText(b.address) || null;
  const street = b.address ? cleanText(b.address.split(/[,—–]/)[0]) : null;
  // Адрес с домом («улица Чайковского, 78»), если он короткий; иначе — только улица
  const addr = addrFull && addrFull.length <= 32 && addrFull !== street ? addrFull : street;
  const where = street ? `${b.city}, ${street}` : b.city;
  const adv = (b.advantages ?? []).map(withoutSuperlatives).filter((x) => x && !hasClaims(x, medical));
  // Описание владельца — по предложениям: короткие факты без обещаний («Центр остеопатии для взрослых и детей»)
  const desc = cleanText(b.description)
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.replace(/[.!]+$/, "").trim())
    .filter((x) => x.length >= 12 && x.length <= 75 && ok(x) && titleKey(x) !== titleKey(name));
  const note = owned?.note && ok(cleanText(owned.note)) && cleanText(owned.note).length <= 60 ? cap(cleanText(owned.note)) : null;
  // Другие услуги с ценами — названия как в прайсе владельца; сначала из того же раздела
  const others = services
    .filter((s) => s !== owned && s.price && cleanText(s.name).length <= 40 && ok(s.name))
    .sort((x, y) => Number((y.category ?? "") === (owned?.category ?? "")) - Number((x.category ?? "") === (owned?.category ?? "")))
    .map((s) => `${cap(cleanText(s.name))} — ${priceText(s.price)}`);
  // «Цены от …» — только если в прайсе несколько цен
  const priced = services.map((s) => parsePrice(s.price)).filter((x): x is NonNullable<typeof x> => !!x);
  const minPrice = priced.length >= 2 ? Math.min(...priced.map((x) => x.price)) : null;
  const ownPrice = parsePrice(p)?.price ?? null;
  const from = minPrice && (!ownPrice || minPrice < ownPrice) ? `от ${new Intl.NumberFormat("ru-RU").format(minPrice).replace(/[\u00a0\u202f]/g, " ")} ₽` : null;
  // Для кого — по прайсу: есть детская услуга и взрослая (или обычная)
  const kidsOf = (s: Service) => KIDS_RE.test(`${s.name} ${s.category ?? ""}`.toLowerCase().replace(/ё/g, "е"));
  const both = services.some(kidsOf) && services.some((s) => !kidsOf(s));
  const who = both ? (medical ? "Принимаем взрослых и детей" : "Для взрослых и детей") : null;
  const whoShort = both ? "Взрослые и дети" : null;
  // Часы и что из них следует — тоже факты
  const hours = cleanText(b.hours) || null;
  const hoursShort = hours ? (hours.length <= 30 ? hours : cleanText(hours.split(/[,;]/)[0])) : null;
  const week = parseWeekHours(b.hours);
  const open = week ? week.filter((d): d is { open: number; close: number } => !!d) : [];
  const verb = medical ? "Принимаем" : "Работаем";
  const hoursFacts: string[] = [];
  if (week && open.length) {
    if (week.every(Boolean)) hoursFacts.push("Работаем без выходных");
    else if (week[5] && week[6]) hoursFacts.push(`${verb} и в выходные`);
    else if (week[5]) hoursFacts.push(`${verb} и в субботу`);
    else if (week[6]) hoursFacts.push(`${verb} и в воскресенье`);
    const close = Math.max(...open.map((d) => d.close));
    if (close >= 19 && close < 24) hoursFacts.push(`${medical ? "Приём" : "Открыто"} до ${fmtClock(close)}`);
    const early = Math.min(...open.map((d) => d.open));
    if (early > 0 && early <= 9) hoursFacts.push(`${medical ? "Приём" : "Открыто"} с ${fmtClock(early)}`);
  }
  const msg = b.whatsapp && b.telegram ? "WhatsApp и Telegram" : b.whatsapp ? "WhatsApp" : b.telegram ? "Telegram" : null;
  // Призывы разные — чтобы и концовки текстов в группе не совпадали
  const book = [
    "Запишитесь онлайн за минуту!",
    "Онлайн-запись на удобное время",
    "Выберите удобное время онлайн",
    msg ? `Запись онлайн или в ${msg}` : b.phone ? "Запись онлайн или по телефону" : "Запись онлайн",
  ];
  const sp = specialistOf(b);
  const lsvc = svc.toLowerCase();
  const spLine = sp && !lsvc.includes(sp.gen) && !lsvc.includes(sp.nom) ? `${medical ? "Приём ведёт" : "Работает"} ${sp.nom}` : null;
  const offer = b.offer && !hasClaims(b.offer, medical) ? withoutSuperlatives(b.offer.replace(/\s*(на|за)\s+первый\s+визит\s*$/i, "")) || null : null;
  const firstVisit = Boolean(b.offer && /первый\s+визит/i.test(b.offer));
  const offerFull = offer ? (firstVisit ? `${offer} на первый визит` : offer) : null;
  const fullOffer = offer && b.offer ? cap(withoutSuperlatives(b.offer)) || null : null;
  const rv = medical ? null : withoutSuperlatives(b.review) || null;
  return { svc, p, name, addr, street, where, adv, desc, note, others, from, who, whoShort, hours, hoursShort, hoursFacts, book, sp, spLine, offer, offerFull, fullOffer, firstVisit, review: rv, medical, brand: `${name} — ${b.city}` };
}
type Facts = ReturnType<typeof factsOf>;

/** Сдвиг списка — у соседних групп второстепенные факты идут в другом порядке, тексты не повторяются */
const rot = <T,>(xs: T[], k: number) => (xs.length ? [...xs.slice(k % xs.length), ...xs.slice(0, k % xs.length)] : xs);

/**
 * Сборщик объявлений одной группы: заголовки, вторые заголовки, тексты и первые предложения текстов не повторяются.
 * Текст — первое предложение (свой «угол» объявления) + факты, пока помещаются.
 */
function adBuilder(b: Business, ch: keyof typeof LIMITS) {
  const L = LIMITS[ch];
  const name = cleanText(b.name);
  const nk = titleKey(name);
  // Услуга совпадает с названием («Студия Лак»): варианты вида «Студия Лак в Студия Лак» пропускаем
  const twice = (x: string | null | undefined | false) => !!x && nk.length > 2 && titleKey(x).split(nk).length > 2;
  const clean = (c: (string | null | undefined | false)[]) => c.map((x) => (twice(x) ? null : x));
  const used = new Set<string>(), used2 = new Set<string>(), firsts = new Set<string>(), texts = new Set<string>();
  const text = (leads: (string | null | undefined | false)[], rest: (string | null | undefined | false)[]) => {
    for (const lead of clean(leads)) {
      if (!lead) continue;
      const t = withCta([lead, ...clean(rest)], L.text);
      const f = titleKey(firstSentence(t));
      if (!t || firsts.has(f) || texts.has(titleKey(t)) || f !== titleKey(firstSentence(cleanText(lead).replace(/([^.!?»"])$/, "$1.")))) continue;
      firsts.add(f);
      texts.add(titleKey(t));
      return t;
    }
    const t = joinSentences(clean([...leads, ...rest]), L.text);
    firsts.add(titleKey(firstSentence(t)));
    texts.add(titleKey(t));
    return t;
  };
  const ad = (angle: string, titles: (string | null | undefined | false)[], title2: (string | null | undefined | false)[], leads: (string | null | undefined | false)[], rest: (string | null | undefined | false)[]): AdDraft =>
    normalizeAd({ angle, title: pickTitle(clean(titles), L.title, used), title2: ch === "vk" ? null : pickTitle(clean(title2), L.title2, used2), text: text(leads, rest) }, ch);
  return { ad };
}

/** До трёх объявлений: сначала с разными подходами, затем — хотя бы с разными заголовками и текстами */
function pickThree(pool: AdDraft[]): AdDraft[] {
  const out: AdDraft[] = [];
  for (const strict of [true, false]) {
    for (const a of pool) {
      if (out.length >= 3) break;
      if (out.includes(a) || out.some((x) => (strict && x.angle === a.angle) || titleKey(x.title) === titleKey(a.title) || titleKey(x.text) === titleKey(a.text) || titleKey(firstSentence(x.text)) === titleKey(firstSentence(a.text)))) continue;
      out.push(a);
    }
  }
  return out;
}

/** Порядок подходов в наборе: соседние группы начинают с разных гипотез */
const ANGLE_ORDER = [
  ["price", "offer", "proof", "result", "convenience", "booking", "emotion"],
  ["convenience", "offer", "result", "emotion", "price", "booking", "proof"],
  ["result", "booking", "offer", "price", "convenience", "proof", "emotion"],
] as const;

/**
 * Объявления группы услуги. set — номер группы: от него зависит, с какого подхода начинаем и какие второстепенные
 * факты идут в текст, поэтому у разных групп тексты разные даже при скудной анкете.
 */
function adPool(b: Business, ch: keyof typeof LIMITS, serviceName?: string, price?: string, set = 0): AdDraft[] {
  const f = factsOf(b, serviceName, price);
  const { svc, p, name, addr, street, where, adv, desc, note, others, from, who, whoShort, hours, hoursShort, hoursFacts, book, spLine } = f;
  const city = b.city;
  const sl = low(svc, name);
  const { ad } = adBuilder(b, ch);
  const k = Math.max(0, set);
  // Второстепенные факты — по кругу от номера группы
  const extra = [...rot([adv[0], desc[0], note, adv[1], desc[1]].filter((x): x is string => !!x), k), ...rot([others[0], who, spLine, hoursFacts[0], others[1]].filter((x): x is string => !!x), k)];
  const make: Record<string, () => AdDraft | null> = {
    price: () =>
      ad("price",
        [p && `${svc} — ${p}, ${city}`, p && `${svc} — ${p}`, p && `${svc} за ${p}`, `${svc} — ${city}`, svc],
        [others[0], from && `Цены ${from}`, adv[0], f.brand, name, "Онлайн-запись"],
        [p && `${svc} — ${p}`, p && `${sl} за ${p}`, svc],
        [...rot([others[0], others[1], from && `Цены ${from}`].filter(Boolean) as string[], k), adv[0], `${name}, ${where}`, book[0], "Запись онлайн"]),
    offer: () =>
      f.offerFull
        ? ad("offer",
            [`${svc}: ${f.offerFull}`, f.offerFull, `${svc}: ${f.offer}`, f.offer],
            [f.brand, f.firstVisit ? "Для новых клиентов" : name],
            [cap(f.offerFull)],
            [p && `${svc} — ${p}`, adv[0], `${name}, ${where}`, book[0], "Запись онлайн"])
        : null,
    proof: () =>
      f.review
        ? ad("proof",
            [`${svc} — отзыв клиента`, `${name}: отзыв клиента`, svc],
            [adv[0], f.brand, "Отзыв клиента"],
            [`«${f.review.length > Math.max(30, LIMITS[ch].text - 38) ? f.review.slice(0, Math.max(30, LIMITS[ch].text - 38)).replace(/\s+\S*$/, "").replace(/[,—–-]$/, "").trim() + "..." : f.review}»`],
            [adv[0], `${name}, ${where}`, book[1]])
        : null,
    // Для кого и что за приём: описание, преимущества, заметка к услуге, взрослые и дети — что есть в анкете
    result: () =>
      ad("result",
        [`${svc} в ${name} — ${city}`, `${svc} в ${name}`, who && `${svc}: ${low(who)}`, `${svc} — ${city}`, svc],
        [adv[0], whoShort, adv[1], f.brand, name],
        [desc[0], adv[0], note, who, spLine, `${name}, ${city}: ${sl}`, desc[1], adv[1]],
        [p && `${svc} — ${p}`, ...extra, `${name}, ${where}`, book[1], "Запись онлайн"]),
    convenience: () =>
      ad("convenience",
        [street ? `${svc} — ${city}, ${street}` : null, street ? `${svc} — ${street}, ${name}` : null, `${svc} — ${name}, ${city}`, `${svc} — ${city}`, svc, street && `${name}, ${street}`, f.brand],
        [hoursShort, addr, street, "Онлайн-запись"],
        // У группы услуги — адрес вместе с услугой: тексты «Удобства» разных групп не совпадают
        [serviceName && addr && `${svc}: ${addr}`, serviceName && `${svc} — ${name}, ${where}`, addr ? `${name}: ${city}, ${addr}` : `${name}, ${where}`, `${name}, ${where}`],
        [hours, hoursFacts[0], book[2], "Запись онлайн"]),
    // Простая запись: онлайн-форма, часы, мессенджеры
    booking: () =>
      ad("convenience",
        [`${svc} — запись онлайн`, `Запись онлайн: ${sl}`, `${svc} — ${name}, ${city}`, `${svc} — ${city}`],
        [hoursFacts[0], hoursFacts[1], from && `Цены ${from}`, "Онлайн-запись"],
        [`Запись онлайн: ${sl}${p ? ` — ${p}` : ""}`, `Запись онлайн: ${sl}`, "Онлайн-запись за минуту"],
        [...rot(hoursFacts, k), book[3] !== "Запись онлайн" ? book[3] : null, addr && `${name}, ${addr}`]),
    // Медуслуги: «Время для себя» не про приём специалиста
    emotion: () =>
      f.medical
        ? null
        : ad("emotion",
            [`Время для себя: ${sl} в ${name}`, `Время для себя: ${sl}`, `Время для себя в ${name}`, svc],
            [street ? `${name}, ${street}` : null, f.brand, name],
            ["Время только для себя"],
            [`${cap(svc)} — ${name}, ${where}`, adv[0], f.fullOffer, book[0]]),
  };
  const out: AdDraft[] = [];
  for (const angle of ANGLE_ORDER[k % ANGLE_ORDER.length]) {
    const a = make[angle]();
    if (a && a.title && a.text) out.push(a);
  }
  return uniqueAds(out);
}

function templateAds(b: Business, ch: keyof typeof LIMITS, serviceName?: string, price?: string, set = 0): AdDraft[] {
  return pickThree(adPool(b, ch, serviceName, price, set));
}

/** Три объявления группы с разными подходами, разными заголовками и разными текстами */
function threeAds(b: Business, ch: keyof typeof LIMITS, service?: string, price?: string, set = 0): AdDraft[] {
  return templateAds(b, ch, service, price, set);
}

/**
 * Объявления групп проблем, смежных запросов и аудиторий: «проблема → решение». Заголовок отвечает на запрос
 * («Ломкие ногти? Маникюр без покрытия», «Ищете мануального терапевта? Взрослый прием остеопата»), в тексте — услуга,
 * цена из прайса, адрес и запись. Медуслуги — без вопроса о болезни читателя: «Остеопат при боли в шее — Екатеринбург».
 * Никаких обещаний результата: только факты анкеты. Запрос группы есть и в тексте — у каждой группы свои тексты.
 */
export function layerAds(b: Business, g: Pick<SemanticGroup, "layer" | "hook" | "service" | "name">, set = 0): AdDraft[] {
  const L = LIMITS.search;
  const hook = g.hook;
  if (!hook) return threeAds(b, "search", g.service, b.services?.find((s) => s.name === g.service)?.price, set);
  const owned = b.services?.find((s) => s.name === g.service);
  const f: Facts = factsOf(b, g.service, owned?.price);
  const { svc, p, name, addr, street, where, adv, desc, others, from, hours, hoursShort, hoursFacts, book, sp } = f;
  const medical = f.medical;
  const city = b.city;
  const Noun = cap(cleanText(hook.noun));
  const ask = cleanText(hook.ask);
  const sl = low(svc, name);
  const when = hook.when ? cleanText(hook.when) : null;
  // «Остеопат после травмы: приём для взрослых» — специалиста второй раз не повторяем
  const hookText = `${Noun} ${ask} ${when ?? ""}`.toLowerCase().replace(/ё/g, "е");
  const short = sp && hookText.includes(sp.nom) ? svc.replace(new RegExp(`\\s+${sp.gen}(?=\\s|,|$)`), "") : svc;
  const ss = low(short, name);
  // Медуслуги: специалист и показание, а не вопрос о болезни читателя (закон «О рекламе», ст. 24, ч. 1 п. 5)
  const medProblem = medical && g.layer === "problem";
  const lead: (string | null)[] =
    medProblem ? (when ? [`${Noun} ${when} — ${city}`, `${Noun} ${when}`, `${cap(when)}: ${sl}`] : [`${Noun} — ${city}`, `${svc} — ${city}`])
    : g.layer === "audience" ? [`${ask} — ${city}`, ask]
    : [`${ask}? ${svc}`, `${ask}? ${Noun} — ${city}`, `${ask}? ${Noun}`];
  const priced: (string | null)[] =
    medProblem ? [p && when && `${Noun} ${when}: ${p}`, p && `${svc} — ${p}`]
    : g.layer === "audience" ? [p && `${ask} — ${p}`, p && `${ask}: ${sl} — ${p}`, p && `${svc} — ${p}`]
    : [p && `${ask}? ${Noun} — ${p}`, p && `${ask}? ${svc} — ${p}`, p && `${svc} — ${p}, ${city}`];
  const near: (string | null)[] =
    medProblem ? [street && when && `${Noun} ${when} — ${street}`, street && `${Noun} — ${city}, ${street}`]
    : g.layer === "audience" ? [street && `${ask} — ${street}`, street && `${ask} — ${city}, ${street}`]
    : [street && `${ask}? ${Noun} — ${street}`, street && `${Noun} — ${city}, ${street}`];
  // Первое предложение текста: запрос группы своими словами
  const hookLead: (string | null)[] =
    medProblem ? [when && `${cap(when)} — ${sl}`, when && `${Noun} ${when}: ${ss}`, `${Noun}: ${sl}`]
    : g.layer === "audience" ? [`${ask}: ${ss}`, `${ask} — ${name}`]
    : [`${ask}? ${cap(sl)}`, `${ask}? ${Noun} в ${name}`];
  const priceLead: (string | null | false)[] = [
    p && medProblem && when && `${Noun} ${when}: ${ss} — ${p}`,
    p && g.layer === "audience" && `${ask}: ${ss} — ${p}`,
    p && `${svc} — ${p}`,
    p && `${sl} за ${p}`,
    `${svc} в ${name}`,
    `${name}, ${city}: ${sl}`,
  ];
  const placeLead: (string | null | false)[] = [
    addr && medProblem && when && `${Noun} ${when} — ${addr}`,
    addr && g.layer === "audience" && `${ask} — ${name}, ${addr}`,
    addr && g.layer !== "audience" && !medProblem && `${Noun} — ${name}, ${addr}`,
    addr ? `${name}: ${city}, ${addr}` : `${name}, ${where}`,
  ];
  const k = Math.max(0, set);
  // «Взрослые и дети» в группе запроса про травму или роды не к месту — только факты о приёме
  // Сначала то, что написал владелец (описание, преимущества), — по кругу между группами; затем часы и прайс
  const facts = [...rot([desc[0], adv[0], adv[1], desc[1], adv[2]].filter((x): x is string => !!x), k), ...rot(hoursFacts, k), others[0]].filter((x): x is string => !!x);
  const used = new Set<string>(), used2 = new Set<string>(), firsts = new Set<string>(), seenText = new Set<string>();
  const safe = (list: (string | null | false | undefined)[]) => list.filter((x): x is string => !!x && !hasClaims(x, medical));
  const text = (leads: (string | null | false | undefined)[], rest: (string | null | false | undefined)[]) => {
    for (const l of safe(leads)) {
      const t = withCta(safe([l, ...rest]), L.text);
      const fk = titleKey(firstSentence(t));
      if (!t || firsts.has(fk) || seenText.has(titleKey(t)) || fk !== titleKey(firstSentence(cleanText(l).replace(/([^.!?»"])$/, "$1.")))) continue;
      firsts.add(fk);
      seenText.add(titleKey(t));
      return t;
    }
    return joinSentences(safe([...leads, ...rest]), L.text);
  };
  const ads: AdDraft[] = [
    {
      angle: "result",
      title: pickTitle(safe([...lead, `${svc} — ${city}`, svc]), L.title, used),
      title2: pickTitle(safe([adv[0], p && `Цена — ${p}`, from && `Цены ${from}`, `${name} — ${city}`, "Онлайн-запись"]), L.title2, used2),
      text: text(hookLead, [...facts, p && `${svc} — ${p}`, book[0], "Запись онлайн"]),
    },
    {
      angle: "price",
      title: pickTitle(safe([...priced, ...lead, `${svc} — ${city}`, svc]), L.title, used),
      title2: pickTitle(safe([others[0], from && `Цены ${from}`, adv[1] ?? adv[0], `${name} — ${city}`, name, "Онлайн-запись"]), L.title2, used2),
      text: text(priceLead, [...rot(others, k).slice(0, 2), from && `Цены ${from}`, adv[1] ?? adv[0], book[1], "Запись онлайн"]),
    },
    {
      angle: "convenience",
      title: pickTitle(safe([...near, ...lead, `${svc} — ${name}, ${city}`, svc]), L.title, used),
      title2: pickTitle(safe([hoursShort, addr, street, "Онлайн-запись"]), L.title2, used2),
      text: text(placeLead, [hours, ...rot(hoursFacts, k), book[2], "Запись онлайн"]),
    },
  ];
  return uniqueAds(ads.map((a) => normalizeAd(a, "search")).filter((a) => a.title && a.text && !hasClaims(`${a.title} ${a.title2 ?? ""} ${a.text}`, medical)));
}

const LAYER_AUDIENCE: Record<Layer, (g: SemanticGroup) => string> = {
  service: (g) => `Ищут «${g.name.toLowerCase()}» в Яндексе`,
  problem: (g) => `${LAYER_LABEL.problem}: ищут «${(g.core[0] ?? g.name).toLowerCase()}» и похожее, ещё не выбрали услугу`,
  adjacent: (g) => `${LAYER_LABEL.adjacent}: ищут «${(g.core[0] ?? g.name).toLowerCase()}» — показываем вашу услугу`,
  audience: (g) => `${LAYER_LABEL.audience}: ${g.name.toLowerCase()}`,
};

export function templatePlan(b: Business, core: SemanticCore = buildSemanticCore(b)): CopyPlan {
  const n = nicheById(b.niche);
  const priceOf = (name?: string) => b.services?.find((s) => s.name === name)?.price;
  const city = cleanKeyword(b.city);
  const seeds = n.searchSeeds.map((k) => cleanKeyword(k.replace("{city}", city)));
  // Поиск: группа на услугу (или раздел) из семантического ядра; у каждой — 3 объявления с разными подходами.
  // Наборы подходов чередуем между группами: так гипотезы проверяются шире
  const many = (g: SemanticGroup) => plural(g.keywords.length, `${g.keywords.length} запрос`, `${g.keywords.length} запроса`, `${g.keywords.length} запросов`);
  let search: GroupDraft[] = core.groups.map((g, i) => {
    const layer = g.layer ?? "service";
    return {
      name: g.name,
      service: g.service,
      services: g.services,
      layer,
      audience:
        layer === "service"
          ? `Ищут «${low(cleanText(g.name), b.name)}» в Яндексе — ${core.groups.length > 1 ? many(g) : "все запросы услуги"}`
          : `${LAYER_AUDIENCE[layer](g)} — ${many(g)}`,
      keywords: g.keywords,
      negatives: g.negatives,
      ...(typeof g.demand === "number" ? { demand: g.demand } : {}),
      // Тёплые запросы — только по фразам: автотаргетинг расширил бы их до совсем случайных («болит спина у собаки»)
      ...(layer === "service" ? {} : { autotargeting: false }),
      ads: layer === "service" ? threeAds(b, "search", g.service, priceOf(g.service), i) : layerAds(b, g, i),
    };
  });
  if (!search.length) {
    const base = keywordBase(mainService(b)) || cleanKeyword(genericService(b));
    search = [{ name: mainService(b), audience: `Ищут «${low(mainService(b), b.name)}» в Яндексе`, keywords: [...new Set([base, `${base} ${city}`, `${base} рядом`, `${base} цена`, ...seeds])], ads: templateAds(b, "search") }];
  }
  // РСЯ: интересы по разделам услуг (фразы из ядра) и «похожие на клиентов»
  const interests = networkInterests(core, 3);
  const network: GroupDraft[] = [
    ...(interests.length > 1
      ? interests.map((x, i) => ({ name: `Интересуются: ${low(cleanText(x.name), b.name)}`, service: x.service, audience: `Недавно искали «${x.keywords[0] ?? low(x.name)}» и похожее`, keywords: x.keywords, ads: threeAds(b, "network", x.service, priceOf(x.service), i), autotargeting: true }))
      : [{ name: "Интересуются услугой", audience: "Недавно искали похожие услуги", keywords: interests[0]?.keywords.length ? interests[0].keywords : seeds.slice(0, 8), ads: templateAds(b, "network"), autotargeting: true }]),
    { name: "Похожие на клиентов", audience: "Интересы как у ваших клиентов — подбирает Яндекс", keywords: [], ads: templateAds(b, "network", undefined, undefined, 1), autotargeting: true },
  ];
  const who = n.audience.sex === "male" ? "Мужчины" : n.audience.sex === "female" ? "Женщины" : "Люди";
  // VK: три разные аудитории с одними и теми же объявлениями — A/B-тест, кто приводит обращения дешевле:
  //  1) искали услугу в поиске (сегмент «вводили поисковые запросы» из нашего семантического ядра);
  //  2) интересы по теме ниши; 3) все рядом с вами нужного пола и возраста — для сравнения.
  const phrases = [...new Set(core.groups.filter((g) => (g.layer ?? "service") !== "adjacent").flatMap((g) => g.core.length ? g.core : g.keywords).map((k) => displayKeyword(k).replace(/["!+\[\]]/g, "").trim()).filter((k) => k && k.split(" ").length <= 5))].slice(0, 300);
  const sp = specialistOf(b);
  const topic = vkInterestTopics(b, sp?.nom);
  const ages = { ageFrom: n.audience.ageFrom, ageTo: n.audience.ageTo };
  const vk: GroupDraft[] = [
    ...(phrases.length >= 5 ? [{ name: `Искали «${sp ? sp.nom : phrases[0]}»`, audience: `Искали в поиске «${phrases[0]}» и ещё ${phrases.length - 1} похожих запросов за 30 дней`, ...ages, keywords: [], searchPhrases: phrases, ads: templateAds(b, "vk") }] : []),
    { name: `Интересы: ${topic.label}`, audience: `${who} ${ages.ageFrom}–${ages.ageTo} лет, интересуются: ${topic.names.join(", ").toLowerCase()}`, ...ages, keywords: [], interests: topic.names, ads: templateAds(b, "vk") },
    { name: "Рядом с вами", audience: `${who} ${ages.ageFrom}–${ages.ageTo} лет рядом с вами — без уточнений, для сравнения`, ...ages, keywords: [], ads: templateAds(b, "vk") },
  ];
  return {
    search,
    network,
    vk,
    negatives: core.groups.length ? core.negatives : n.negatives,
    callouts: factCallouts(b, isMedical(b)).slice(0, 6),
    imageIdeas: n.visuals,
  };
}

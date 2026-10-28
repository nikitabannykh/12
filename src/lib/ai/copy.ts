import "server-only";
import type { Business, Service } from "../db/schema";
import { groupServices, hasCategories } from "../services";
import { ANGLES, isMedical, LAYER_LABEL, nicheById, type Layer } from "../niches";
import { badChars, claimProblems, cleanText, factCallouts, hasClaims, hasSuperlative, SUPERLATIVE as SUPERLATIVE_ONE, withoutSuperlatives } from "../engine/extras";
import { plural } from "../util";
import { addPhrases, buildSemanticCore, displayKeyword, finalizeCore, networkInterests, conflicts, type SemanticCore, type SemanticGroup } from "../engine/semantics";
import { aiConfigured, gptJson } from "./yandex";

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
export const LIMITS = {
  search: { title: 56, title2: 30, text: 81 },
  network: { title: 56, title2: 30, text: 81 },
  vk: { title: 40, title2: 30, text: 90 },
} as const;
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
    b.name, b.city, b.address, b.hours, b.description, b.offer, b.review, b.audience,
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
  return { ...a, title2, text };
}

function bizBrief(b: Business) {
  const n = nicheById(b.niche);
  const line = (s: Service) => `- ${s.name}${s.price ? ` — ${priceText(s.price)}` : ""}${s.note ? ` (${s.note})` : ""}`;
  // Разделы прайса — заголовками: модели проще сделать по группе на раздел («Маникюр», «Педикюр»)
  const services = hasCategories(b.services ?? [])
    ? groupServices(b.services ?? []).map((g) => `${g.category || "Другое"}:\n${g.items.map((x) => line(x.s)).join("\n")}`).join("\n")
    : (b.services ?? []).map(line).join("\n");
  return [
    `Бизнес: ${b.name} (${n.label}), город ${b.city}${b.address ? `, адрес: ${b.address}` : ""}.`,
    b.description ? `Описание от владельца: ${b.description}` : "",
    services ? `Услуги и цены:\n${services}` : "",
    b.advantages?.length ? `Преимущества: ${b.advantages.join("; ")}` : "",
    b.offer ? `Предложение для новых клиентов: ${b.offer}` : "",
    b.review ? `Реальный отзыв клиента: ${b.review}` : "",
    b.audience ? `Кто клиенты: ${b.audience}` : `Типичные клиенты (для выбора слов, не для обещаний): ${n.audience.text}`,
    b.hours ? `Часы работы: ${b.hours}` : "",
    b.whatsapp || b.telegram ? `Запись в мессенджерах: ${[b.whatsapp && "WhatsApp", b.telegram && "Telegram"].filter(Boolean).join(", ")}` : "",
    `На странице записи есть онлайн-форма — «онлайн-запись» писать можно.`,
  ].filter(Boolean).join("\n");
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

export async function generateCopyPlan(b: Business, channels: { search: boolean; network: boolean; vk: boolean }, core: SemanticCore = buildSemanticCore(b)): Promise<CopyPlan> {
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
    const raw = await gptJson<Raw>(SYSTEM, user, { temperature: 0.55, maxTokens: 8000 });
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
        const merged = uniqueAds(ads.filter((a): a is AdDraft => !!a && !!a.title && !!a.text));
        // Меньше трёх после проверки — добираем шаблонными с другими подходами
        for (const t of g.ads) if (merged.length < 3 && !merged.some((m) => m.angle === t.angle || titleKey(m.title) === titleKey(t.title))) merged.push(t);
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
      vk: channels.vk ? (vk.length ? vk : fallback.vk) : [],
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

/** Название услуги, если владелец услуг не указал: нейтральное слово ниши, без выдуманных деталей */
function genericService(b: Business) {
  const n = nicheById(b.niche);
  return n.id === "other" ? cleanText(b.name) : n.generic;
}

function mainService(b: Business) {
  return cleanText(b.services?.[0]?.name) || genericService(b);
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

function templateAds(b: Business, ch: keyof typeof LIMITS, serviceName?: string, price?: string, set = 0): AdDraft[] {
  const L = LIMITS[ch];
  const svc = cleanText(serviceName) || mainService(b);
  const owned = b.services?.find((s) => cleanText(s.name) === svc);
  const p = priceText(cleanText(price || owned?.price || (serviceName ? null : b.services?.[0]?.price))) || null;
  const street = b.address ? cleanText(b.address.split(/[,—–]/)[0]) : null;
  const where = street ? `${b.city}, ${street}` : b.city;
  const name = cleanText(b.name);
  // Медуслуги: без отзывов пациентов и обещаний (закон «О рекламе», ст. 24)
  const medical = isMedical(b);
  const adv = (b.advantages ?? []).map(withoutSuperlatives).filter((x) => x && !hasClaims(x, medical));
  const offer = b.offer && !hasClaims(b.offer, medical) ? withoutSuperlatives(b.offer.replace(/\s*(на|за)\s+первый\s+визит\s*$/i, "")) : null;
  const firstVisit = b.offer && /первый\s+визит/i.test(b.offer);
  // Отзыв укорачиваем так, чтобы в тексте осталось место для адреса или призыва
  const rmax = Math.max(30, L.text - 38);
  const rv = medical ? null : withoutSuperlatives(b.review) || null;
  const review = rv ? (rv.length > rmax ? rv.slice(0, rmax).replace(/\s+\S*$/, "").replace(/[,—–-]$/, "").trim() + "..." : rv) : null;

  const brand = `${name} — ${b.city}`;
  // Заголовки не повторяются между объявлениями группы: занятый вариант пропускаем и берём следующий
  const used = new Set<string>();
  // Услуга совпадает с названием («Студия Лак»): варианты вида «Студия Лак в Студия Лак» пропускаем
  const nk = titleKey(name);
  const twice = (x: string | null | undefined | false) => !!x && nk.length > 2 && titleKey(x).split(nk).length > 2;
  const pick = (c: (string | null | undefined | false)[], max: number, u?: Set<string>) => pickTitle(c.map((x) => (twice(x) ? null : x)), max, u);
  const sentences = (c: (string | null | undefined | false)[], max: number) => joinSentences(c.map((x) => (twice(x) ? null : x)), max);
  const hours = cleanText(b.hours) || null;
  const cta = "Запишитесь онлайн за минуту!";
  const fullOffer = offer && b.offer ? cap(withoutSuperlatives(b.offer)) || null : null;
  const offerFull = offer ? (firstVisit ? `${offer} на первый визит` : offer) : null;

  const price_: AdDraft = {
    angle: "price",
    title: pick([p && `${svc} — ${p}, ${b.city}`, p && `${svc} — ${p}`, p && `${svc} за ${p}`, `${svc} — ${b.city}`, svc], L.title, used),
    title2: pick([adv[0], brand, name, "Онлайн-запись"], L.title2),
    text: sentences([`${svc}${p ? ` — ${p}` : ""}`, adv[0], adv[1], `${name}, ${where}`, fullOffer, cta, "Запись онлайн"], L.text),
  };
  const offer_: AdDraft = offerFull
    ? {
        angle: "offer",
        title: pick([`${svc}: ${offerFull}`, offerFull, `${svc}: ${offer}`, offer], L.title, used),
        title2: pick([brand, firstVisit ? "Для новых клиентов" : name], L.title2),
        text: sentences([cap(offerFull), p && `${svc} — ${p}`, adv[0], `${name}, ${where}`, cta, "Запись онлайн"], L.text),
      }
    : {
        angle: "convenience",
        title: pick([street ? `${svc} — ${b.city}, ${street}` : null, `${svc} в ${name} — ${b.city}`, `${svc} — ${b.city}`, svc], L.title, used),
        title2: pick([hours, street, "Онлайн-запись"], L.title2),
        text: sentences([`${name}: ${where}`, hours, adv[0], adv[1], cta, "Запись онлайн"], L.text),
      };
  const proof_: AdDraft = review
    ? {
        angle: "proof",
        title: pick([`${svc} — отзыв клиента`, `${name}: отзыв клиента`, svc], L.title, used),
        title2: pick([adv[0], brand, "Отзыв клиента"], L.title2),
        text: sentences([`«${review}»`, adv[0], `${name}, ${where}`, cta, "Запись онлайн"], L.text),
      }
    : {
        angle: "result",
        title: pick([`${svc} в ${name} — ${b.city}`, `${svc} в ${name}`, `${svc} — ${b.city}`, svc], L.title, used),
        title2: pick([adv[0], adv[1], brand, name], L.title2),
        text: sentences([adv[0], adv[1], adv[2], p && `${svc} — ${p}`, `${name}, ${where}`, cta, "Запись онлайн"], L.text),
      };
  const convenience_: AdDraft = {
    angle: "convenience",
    title: pick([street ? `${svc} — ${street}, ${name}` : null, street ? `${svc} — ${street}` : null, `${svc} — ${name}, ${b.city}`, `${svc} — ${b.city}`, svc], L.title, used),
    title2: pick([hours, "Онлайн-запись"], L.title2),
    text: sentences([`${name}, ${where}`, hours, adv[1] ?? adv[0], adv[0], "Выберите удобное время онлайн"], L.text),
  };
  const emotion_: AdDraft = {
    angle: "emotion",
    title: pick([`Время для себя: ${low(svc, name)} в ${name}`, `Время для себя: ${low(svc, name)}`, `Время для себя в ${name}`, svc], L.title, used),
    title2: pick([street ? `${name}, ${street}` : null, brand, name], L.title2),
    text: sentences(["Время только для себя", `${cap(svc)} — ${name}, ${where}`, adv[0], fullOffer, cta, "Запись онлайн"], L.text),
  };
  // Медуслуги: «Время для себя» не про приём специалиста — вместо него удобство
  const sets = [[price_, offer_, proof_], [convenience_, medical ? offer_ : emotion_, price_]];
  return uniqueAds(sets[set % 2].map((a) => normalizeAd(a, ch)));
}

/** Три объявления группы с разными подходами: основной набор, недостающие — из второго (без повторов подходов и заголовков) */
function threeAds(b: Business, ch: keyof typeof LIMITS, service?: string, price?: string, set = 0): AdDraft[] {
  const out: AdDraft[] = [];
  const pool = [...templateAds(b, ch, service, price, set), ...templateAds(b, ch, service, price, set + 1)];
  // Сначала разные подходы; если заголовки совпали (длинное название услуги) — хотя бы разные заголовки
  for (const strict of [true, false]) {
    for (const a of pool) {
      if (out.length >= 3) break;
      if (out.includes(a) || out.some((x) => (strict && x.angle === a.angle) || titleKey(x.title) === titleKey(a.title))) continue;
      out.push(a);
    }
  }
  return out;
}

/**
 * Объявления групп проблем, смежных запросов и аудиторий: «проблема → решение». Заголовок отвечает на запрос
 * («Ломкие ногти? Маникюр без покрытия», «Ищете мануального терапевта? Взрослый прием остеопата»), в тексте — услуга,
 * цена из прайса, адрес и запись. Медуслуги — без вопроса о болезни читателя: «Остеопат при боли в шее — Екатеринбург».
 * Никаких обещаний результата: только факты анкеты.
 */
export function layerAds(b: Business, g: Pick<SemanticGroup, "layer" | "hook" | "service" | "name">, set = 0): AdDraft[] {
  const L = LIMITS.search;
  const hook = g.hook;
  if (!hook) return threeAds(b, "search", g.service, b.services?.find((s) => s.name === g.service)?.price, set);
  const medical = isMedical(b);
  const owned = b.services?.find((s) => s.name === g.service);
  const svc = cleanText(g.service) || mainService(b);
  const p = priceText(cleanText(owned?.price)) || null;
  const name = cleanText(b.name);
  const street = b.address ? cleanText(b.address.split(/[,—–]/)[0]) : null;
  const where = street ? `${b.city}, ${street}` : b.city;
  const adv = (b.advantages ?? []).map(withoutSuperlatives).filter((x) => x && !hasClaims(x, medical));
  const hours = cleanText(b.hours) || null;
  const Noun = cap(cleanText(hook.noun));
  const ask = cleanText(hook.ask);
  const sl = low(svc, name);
  const when = hook.when ? cleanText(hook.when) : null;
  // Медуслуги: специалист и показание, а не вопрос о болезни читателя (закон «О рекламе», ст. 24, ч. 1 п. 5)
  const medProblem = medical && g.layer === "problem";
  const lead: (string | null)[] =
    medProblem ? (when ? [`${Noun} ${when} — ${b.city}`, `${Noun} ${when}`, `${cap(when)}: ${sl}`] : [`${Noun} — ${b.city}`, `${svc} — ${b.city}`])
    : g.layer === "audience" ? [`${ask} — ${b.city}`, ask]
    : [`${ask}? ${svc}`, `${ask}? ${Noun} — ${b.city}`, `${ask}? ${Noun}`];
  const priced: (string | null)[] =
    medProblem ? [p && when && `${Noun} ${when}: ${p}`, p && `${svc} — ${p}`]
    : g.layer === "audience" ? [p && `${ask} — ${p}`, p && `${ask}: ${sl} — ${p}`, p && `${svc} — ${p}`]
    : [p && `${ask}? ${Noun} — ${p}`, p && `${ask}? ${svc} — ${p}`, p && `${svc} — ${p}, ${b.city}`];
  const near: (string | null)[] =
    medProblem ? [street && when && `${Noun} ${when} — ${street}`, street && `${Noun} — ${b.city}, ${street}`]
    : g.layer === "audience" ? [street && `${ask} — ${street}`, street && `${ask} — ${b.city}, ${street}`]
    : [street && `${ask}? ${Noun} — ${street}`, street && `${Noun} — ${b.city}, ${street}`];
  const used = new Set<string>();
  const safe = (list: (string | null | false | undefined)[]) => list.filter((x): x is string => !!x && !hasClaims(x, medical));
  const cta = "Запишитесь онлайн за минуту!";
  const svcLine = `${svc}${p ? ` — ${p}` : ""}`;
  const ads: AdDraft[] = [
    {
      angle: "result",
      title: pickTitle(safe([...lead, `${svc} — ${b.city}`, svc]), L.title, used),
      title2: pickTitle(safe([adv[0], p && `Цена — ${p}`, `${name} — ${b.city}`, "Онлайн-запись"]), L.title2),
      text: joinSentences(safe([svcLine, adv[0], `${name}, ${where}`, cta, "Запись онлайн"]), L.text),
    },
    {
      angle: "price",
      title: pickTitle(safe([...priced, ...lead, `${svc} — ${b.city}`, svc]), L.title, used),
      title2: pickTitle(safe([adv[1] ?? adv[0], `${name} — ${b.city}`, name, "Онлайн-запись"]), L.title2),
      text: joinSentences(safe([svcLine, adv[1] ?? adv[0], `${name}, ${where}`, cta, "Запись онлайн"]), L.text),
    },
    {
      angle: "convenience",
      title: pickTitle(safe([...near, ...lead, `${svc} — ${name}, ${b.city}`, svc]), L.title, used),
      title2: pickTitle(safe([hours, street, "Онлайн-запись"]), L.title2),
      text: joinSentences(safe([`${name}: ${where}`, hours, svcLine, "Выберите удобное время онлайн"]), L.text),
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
      // Тёплые запросы — только по фразам: автотаргетинг расширил бы их до совсем случайных («болит спина у собаки»)
      ...(layer === "service" ? {} : { autotargeting: false }),
      ads: layer === "service" ? threeAds(b, "search", g.service, priceOf(g.service), i % 2) : layerAds(b, g, i % 2),
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
      ? interests.map((x, i) => ({ name: `Интересуются: ${low(cleanText(x.name), b.name)}`, service: x.service, audience: `Недавно искали «${x.keywords[0] ?? low(x.name)}» и похожее`, keywords: x.keywords, ads: threeAds(b, "network", x.service, priceOf(x.service), i % 2), autotargeting: true }))
      : [{ name: "Интересуются услугой", audience: "Недавно искали похожие услуги", keywords: interests[0]?.keywords.length ? interests[0].keywords : seeds.slice(0, 8), ads: templateAds(b, "network"), autotargeting: true }]),
    { name: "Похожие на клиентов", audience: "Интересы как у ваших клиентов — подбирает Яндекс", keywords: [], ads: templateAds(b, "network", undefined, undefined, 1), autotargeting: true },
  ];
  const who = n.audience.sex === "male" ? "Мужчины" : n.audience.sex === "female" ? "Женщины" : "Люди";
  const vk: GroupDraft[] = [
    { name: `${n.audience.ageFrom}–34 года`, audience: `${who} ${n.audience.ageFrom}–34 лет рядом с вами`, ageFrom: n.audience.ageFrom, ageTo: 34, keywords: [], ads: templateAds(b, "vk") },
    { name: `35–${n.audience.ageTo} лет`, audience: `${who} 35–${n.audience.ageTo} лет рядом с вами`, ageFrom: 35, ageTo: n.audience.ageTo, keywords: [], ads: templateAds(b, "vk", undefined, undefined, 1) },
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

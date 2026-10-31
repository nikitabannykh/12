/**
 * Всё, что можно показать в объявлении помимо заголовка и текста:
 * уточнения, быстрые ссылки, отображаемая ссылка, цена, профиль организации, длинный текст для VK,
 * дополнительные заголовки и тексты комбинаторного объявления Директа, расписание показов по часам работы.
 * Собирается из анкеты бизнеса — одинаково для запуска, робота и предпросмотра (модуль работает и в браузере).
 */
import { customSchedule, showOf } from "./show";
import type { Business } from "../db/schema";
import { isMedical, KIDS_RE, nicheById } from "../niches";

export type ExtrasBiz = { showSettings?: unknown } & Pick<Business, "name" | "niche" | "city" | "address" | "phone" | "whatsapp" | "telegram" | "hours" | "services" | "advantages" | "offer" | "review" | "description"> & {
  /** ID организации в Яндекс Бизнесе (permalink): адрес, телефон, часы и рейтинг Директ берёт из профиля */
  orgId?: string | null;
  /** Общие запросы бизнеса — чтобы понять, заказ это или запись */
  searchTopics?: string[] | null;
};

/**
 * Адрес без города и индекса: «г. Москва, ул. Тверская, 10» → «ул. Тверская, 10» — город в объявлениях и так пишем
 * отдельно, иначе выходит «Маникюр — Москва, Москва».
 */
export function addressWithoutCity(address: string | null | undefined, city: string | null | undefined): string | null {
  const c = String(city ?? "").trim().toLowerCase().replace(/ё/g, "е");
  const parts = String(address ?? "").split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean);
  const isCity = (x: string) => {
    const t = x.toLowerCase().replace(/ё/g, "е").replace(/^(г\.|г|город)\s*/, "").trim();
    return /^\d{6}$/.test(t) || t === "россия" || (c && t === c);
  };
  while (parts.length > 1 && isCity(parts[0])) parts.shift();
  const out = parts.join(", ");
  return out || null;
}

/** Уточнения из плана (их можно отредактировать в мастере) идут первыми, затем факты из анкеты */
export function withPlanCallouts<T extends { callouts: string[] }>(x: T, planned: string[] | undefined): T {
  const list = [...(planned ?? []), ...x.callouts].map((c) => cleanText(c)).filter((c) => c && c.length <= 25);
  return { ...x, callouts: [...new Map(list.map((c) => [c.toLowerCase(), c])).values()].slice(0, 8) };
}

export type Sitelink = { title: string; href: string; description?: string };
export type PriceExt = { price: number; qualifier: "FROM" | "NONE"; label: string };
export type AdExtras = {
  callouts: string[];
  sitelinks: Sitelink[];
  displayPath: string | null;
  price: PriceExt | null;
  /**
   * Профиль организации в Яндекс Бизнесе (Директ: BusinessId). Визитки (VCardId) Директ больше не сохраняет —
   * адрес, телефон, часы и рейтинг под объявлением показываются только из профиля организации.
   */
  org: { id: string } | null;
  /** Улица и дом — для подписи под картинкой в предпросмотре РСЯ */
  place: string | null;
  longText: string; // VK: до 220
  about: string; // VK: «о компании», до 115
};

// ─── Чистка текста для площадок (общая для сервера и предпросмотра в браузере) ───

/** Эмодзи, пиктограммы, модификаторы и невидимые символы — Директ и VK такое отклоняют */
const EMOJI_SRC = "[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u{1F3FB}-\\u{1F3FF}\\uFE0E\\uFE0F\\u200B-\\u200D\\u2060\\u20E3]";
const EMOJI = new RegExp(EMOJI_SRC, "gu");
const EMOJI_ONE = new RegExp(EMOJI_SRC, "u");
/** Что допускает Директ в текстах: буквы, цифры, пробел и обычная пунктуация */
const AD_CHAR = /[\p{L}\p{N}\s.,!?;:"'«»„“”()\[\]\-–—\/№%₽$€+&*#@’]/u;

export const stripEmoji = (s: string) => s.replace(EMOJI, "");

/** Символы, которые площадка не примет (для сообщений владельцу) */
export function badChars(s: string): string[] {
  const out = new Set<string>();
  for (const ch of s) if (EMOJI_ONE.test(ch) || (!AD_CHAR.test(ch) && !SUBST[ch])) out.add(ch);
  return [...out];
}

/** Похожие символы, которых нет в списке Директа, заменяем на допустимые */
const SUBST: Record<string, string> = { "−": "-", "‐": "-", "‑": "-", "…": "...", "·": "—", "•": "—", "×": "x", "`": "'", "ʼ": "'" };

/** Убираем эмодзи и неподдерживаемые символы, схлопываем пробелы */
export function cleanText(s: string | null | undefined): string {
  return [...stripEmoji(s ?? "").replace(/[−‐‑…·•×`ʼ]/g, (c) => SUBST[c] ?? c)].map((ch) => (AD_CHAR.test(ch) ? ch : " ")).join("").replace(/\s+/g, " ").replace(/\s+([.,!?;:])/g, "$1").trim();
}

const clean = (s: string) => cleanText(s);

/** «лучший», «самый», «№1» — модерация Директа пропускает их только с документами. Граница слова с учётом кириллицы и кавычек. */
export const SUPERLATIVE = /(?<![\p{L}\p{N}])(лучш[а-яё]*|№\s?1|номер\s+один|сам(ый|ая|ое|ые|ого|ой|ую|ых|ым)|первый\s+в\s+городе)(?![\p{L}\p{N}])/iu;
export const hasSuperlative = (s: string | null | undefined) => SUPERLATIVE.test(s ?? "");

// ─── Медицинские утверждения ───────────────────────────────────────────
// Закон «О рекламе», ст. 24 (ч. 1 п. 2–5, 8; ч. 3 распространяет их на медуслуги) и правила модерации Директа:
// нельзя обещать излечение, гарантировать результат и безопасность, приводить благодарности пациентов
// и предполагать болезнь у читателя («Болит шея?»). Обещание вылечить — нельзя ни в какой нише.

const CURE = /(?<![\p{L}])(вылеч\p{L}*|излеч\p{L}*|исцел\p{L}*|избав\p{L}*\s+навсегда|навсегда\s+избав\p{L}*|раз\s+и\s+навсегда)/iu;
const MED_CLAIMS: [RegExp, string][] = [
  [/(?<![\p{L}])гарант\p{L}*/iu, "гарантия результата"],
  [/(?<![\p{L}])(безопасн\p{L}*|безвредн\p{L}*|безболезненн\p{L}*|без\s+(побочн|последств|противопоказ)\p{L}*)/iu, "обещание безопасности"],
  [/100\s?%|(?<![\p{L}])эффективн\p{L}*/iu, "обещание эффективности"],
  [/(?<![\p{L}])(благодар\p{L}*|отзыв\p{L}*|спасибо)/iu, "отзыв или благодарность пациента"],
  [/(?<![\p{L}])(рейтинг\p{L}*|оценк\p{L}*\s+\d|звёзд\p{L}*|звезд\p{L}*)|★|\d[,.]\d\s*(из\s*5|в\s*2гис|на\s*(яндекс|картах))/iu, "рейтинг или оценки пациентов"],
  [/(у\s+вас|вас\s+беспоко\p{L}*|мучает|мучают|страдаете|болит|болят|ноет|беспокоит)[^.!?]*\?/iu, "предположение, что у читателя болезнь"],
];

/**
 * Что в тексте нельзя рекламе (пустой массив — всё хорошо). medical — медицинские услуги (niches.isMedical):
 * для них дополнительно гарантии, безопасность, отзывы пациентов и вопросы «Болит…?».
 */
export function claimProblems(s: string | null | undefined, medical: boolean): string[] {
  const t = s ?? "";
  const out: string[] = [];
  const m = t.match(CURE);
  if (m) out.push(`обещание вылечить («${m[0]}»)`);
  if (medical) for (const [re, what] of MED_CLAIMS) if (re.test(t)) out.push(what);
  return out;
}
export const hasClaims = (s: string | null | undefined, medical: boolean) => claimProblems(s, medical).length > 0;

/** Факт владельца без превосходных степеней: предложения с «лучший/самый» выкидываем целиком, а не калечим */
export function withoutSuperlatives(s: string | null | undefined): string {
  return clean(s ?? "")
    .split(/(?<=[.!?])\s+/)
    .filter((x) => x && !hasSuperlative(x))
    .join(" ")
    .trim();
}
const cut = (s: string, max: number) => {
  const t = clean(s);
  if (t.length <= max) return t;
  const c = t.slice(0, max + 1);
  const i = c.lastIndexOf(" ");
  return (i > max * 0.6 ? c.slice(0, i) : c.slice(0, max)).replace(/[,.\-–—:;]$/, "");
};

/** «от 3 000 ₽» → 3000, FROM */
export function parsePrice(s?: string | null): PriceExt | null {
  if (!s) return null;
  const m = s.replace(/\s/g, "").match(/(\d{2,7})/);
  if (!m) return null;
  const price = Number(m[1]);
  if (!price) return null;
  const from = /от/i.test(s);
  return { price, qualifier: from ? "FROM" : "NONE", label: `${from ? "от " : ""}${new Intl.NumberFormat("ru-RU").format(price)} ₽` };
}

/**
 * Уточнения — только факты из анкеты и правда о продукте (на странице записи есть онлайн-форма).
 * Ничего не придумываем: «Без очереди», «Удобно добраться», «Стерильные инструменты» — только если это написал владелец.
 * Короткие факты не длиннее 25 символов: длинные преимущества сокращаем по смыслу, а не обрезаем на полуслове.
 */
export function factCallouts(b: Pick<ExtrasBiz, "advantages" | "offer" | "whatsapp" | "telegram"> & Partial<Pick<ExtrasBiz, "services" | "hours">>, medical = false) {
  const out: string[] = [];
  const add = (s?: string | null) => {
    if (!s || hasClaims(s, medical)) return;
    const t = clean(s).replace(/[.!]$/, "");
    if (t && t.length <= 25 && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  for (const a0 of b.advantages ?? []) {
    const a = withoutSuperlatives(a0);
    if (!a) continue;
    add(a);
    // «Покрытие держится 3–4 недели» → «Держится 3–4 недели»
    // Остаток не должен начинаться с союза или предлога: «Маникюр и педикюр в 4 руки» → не «И педикюр в 4 руки»
    if (clean(a).length > 25) {
      const rest = clean(a).replace(/^[А-ЯЁA-Z][а-яёa-z]+\s+/, "");
      if (rest !== clean(a) && !/^(и|или|а|но|да|в|во|на|с|со|для|по|от|до|из|к|ко|у|о|об|за|без|при|под|над|через)\s/i.test(rest)) add(rest.replace(/^./, (c) => c.toUpperCase()));
    }
  }
  if (b.offer) add(withoutSuperlatives(b.offer));
  const order = isOrderBusiness(b as ExtrasBiz);
  add(order ? "Заказ онлайн" : "Онлайн-запись");
  if (b.whatsapp && b.telegram) add(`${order ? "Заказ" : "Запись"} в WhatsApp и Telegram`);
  else if (b.whatsapp || b.telegram) add(`${order ? "Заказ" : "Запись"} в ${b.whatsapp ? "WhatsApp" : "Telegram"}`);
  // Факты из прайса и часов работы: есть и детская, и взрослая услуга; часы — если короткие
  const svc = (b.services ?? []).map((s) => `${s.name ?? ""} ${s.category ?? ""}`.toLowerCase().replace(/ё/g, "е"));
  if (svc.some((x) => KIDS_RE.test(x)) && svc.some((x) => !KIDS_RE.test(x))) add(medical ? "Приём взрослых и детей" : "Для взрослых и детей");
  const h = clean(b.hours ?? "");
  if (h) add(h.length <= 25 ? h : clean(h.split(/[,;]/)[0]));
  return out.slice(0, 8);
}

/** Директ: суммарная длина заголовков быстрых ссылок 1–4 — не больше 66 символов, 5–8 — тоже не больше 66 */
export const SITELINK_LIMITS = { title: 30, description: 60, groupTotal: 66 } as const;

/**
 * Подбираем быстрые ссылки так, чтобы набор прошёл проверку Директа: ссылки берём по приоритету,
 * пропуская те, что не влезают в лимит четвёрки. Вторая четвёрка — только если первая заполнена целиком,
 * иначе её ссылки встанут на места 1–4 и превысят лимит.
 */
export function fitSitelinks(list: Sitelink[]): Sitelink[] {
  const L = SITELINK_LIMITS;
  const ok = list
    .map((s) => ({ ...s, title: clean(s.title), description: s.description ? cut(s.description, L.description) : undefined }))
    .filter((s) => s.title && s.title.length <= L.title);
  const a: Sitelink[] = [], b: Sitelink[] = [];
  let la = 0, lb = 0;
  const seen = new Set<string>();
  for (const s of ok) {
    const key = s.title.toLowerCase();
    if (seen.has(key)) continue;
    if (a.length < 4 && la + s.title.length <= L.groupTotal) { a.push(s); la += s.title.length; seen.add(key); }
    else if (b.length < 4 && lb + s.title.length <= L.groupTotal) { b.push(s); lb += s.title.length; seen.add(key); }
  }
  return a.length === 4 ? [...a, ...b] : a;
}

function splitAddress(addr?: string | null) {
  if (!addr) return { street: null, house: null };
  const parts = addr.split(",").map((x) => x.trim()).filter(Boolean);
  const houseIdx = parts.findIndex((p) => /^(д\.?\s*)?\d+[а-яa-z]?(\/\d+)?(\s*(к|корп|стр)\.?\s*\d+)?$/i.test(p));
  if (houseIdx > 0) return { street: parts[houseIdx - 1], house: parts[houseIdx].replace(/^д\.?\s*/i, "") };
  const m = addr.match(/^(.*?)[,\s]+(\d+[а-яa-z]?(?:\/\d+)?)\s*$/i);
  if (m) return { street: m[1].replace(/,$/, "").trim(), house: m[2] };
  return { street: parts[0] ?? addr, house: null };
}

/** «Пн–Пт 9:00–20:00» → «0;4;09;00;20;00». По умолчанию ежедневно 10–21. */
export function parseHours(h?: string | null) {
  const text = clean(h ?? "") || "Ежедневно 10:00–21:00";
  const t = text.match(/(\d{1,2})[:.](\d{2})\s*[–—-]\s*(\d{1,2})[:.](\d{2})/);
  const from = t ? [t[1], t[2]] : ["10", "00"];
  const to = t ? [t[3], t[4]] : ["21", "00"];
  const weekdays = /будн|пн\s*[–—-]\s*пт/i.test(text) && !/ежедн|без выходных|пн\s*[–—-]\s*вс/i.test(text);
  const q = (m: string) => String(Math.round(Number(m) / 15) * 15 % 60).padStart(2, "0");
  return { text, workTime: `0;${weekdays ? 4 : 6};${from[0].padStart(2, "0")};${q(from[1])};${to[0].padStart(2, "0")};${q(to[1])}` };
}

function withAnchor(href: string, anchor: string) {
  const i = href.indexOf("#");
  return `${i >= 0 ? href.slice(0, i) : href}#${anchor}`;
}

/** Заказ, а не запись: доставка еды, кафе, кондитерская — кнопки и подписи «Заказать», «Меню» вместо «Записаться», «Услуги» */
export function isOrderBusiness(b: Pick<ExtrasBiz, "name" | "description"> & { searchTopics?: string[] | null; services?: { name: string }[] | null }): boolean {
  const t = [b.name, b.description ?? "", ...(b.searchTopics ?? []), ...(b.services ?? []).slice(0, 15).map((s) => s.name)].join(" ").toLowerCase().replace(/ё/g, "е");
  return /доставк\S* (еды|пицц|суши|ролл|обед)|пиццер|суши|ролл|кафе|ресторан|бургер|шаурм|кондитер|пекарн|торт[ыа]? на заказ|еда на дом|готов\S* еда|бизнес.?ланч/.test(t);
}

/** Слова для сравнения услуг с запросами группы: основа слова (первые 5 букв) у слов от 4 букв */
/** Служебные слова запросов («цена», «запись», «рядом») — не про конкретную позицию */
const STOP_ROOTS = new Set(["цена", "цены", "стои", "недо", "запи", "онла", "рядо", "побл", "отзы", "скол", "заказ".slice(0, 4), "быст", "дешё", "деше"]);
const roots = (x: string) => new Set(x.toLowerCase().replace(/ё/g, "е").split(/[^а-яa-z0-9]+/).filter((w) => w.length >= 4 && !STOP_ROOTS.has(w.slice(0, 4))).map((w) => w.slice(0, 4)));

export function adExtras(b: ExtrasBiz, o: { channel: string; href: string; service?: string | null; text?: string; keywords?: string[] }): AdExtras {
  // Услуги — по близости к объявлению: сначала те, что про запросы группы и текст («доставка пиццы» → пиццы), а не первые по прайсу
  const topic = roots([o.service ?? "", o.text ?? "", ...(o.keywords ?? []).slice(0, 15)].join(" "));
  const score = (name: string) => [...roots(name)].filter((r) => topic.has(r)).length;
  const services = topic.size ? [...(b.services ?? [])].map((s, i) => ({ s, i, k: score(s.name) })).sort((a, z) => z.k - a.k || a.i - z.i).map((x) => x.s) : b.services ?? [];
  const order = isOrderBusiness(b);
  const svc = (o.service && services.find((s) => s.name === o.service)) || null;
  const priced = services.map((s) => ({ s, p: parsePrice(s.price) })).filter((x) => x.p);
  const price = svc ? parsePrice(svc.price) : priced.sort((a, c) => a.p!.price - c.p!.price)[0]?.p ?? null;
  const priceLabel = price && !svc && price.qualifier === "NONE" ? { ...price, qualifier: "FROM" as const, label: `от ${price.label}` } : price;

  // Цены целиком, без обрыва на полуслове: добавляем услуги, пока описание помещается
  let priceList = "";
  for (const s of services.filter((x) => x.price)) {
    const next = `${priceList ? `${priceList}, ` : ""}${clean(s.name).toLowerCase()} ${clean(s.price ?? "")}`;
    if (next.length > SITELINK_LIMITS.description) break;
    priceList = next;
  }
  const { street, house } = splitAddress(b.address);
  const hours = parseHours(b.hours);
  const hasPrices = services.some((s) => s.price);
  const named = services.filter((s) => clean(s.name));
  // Медуслуги: без отзывов пациентов и обещаний (закон «О рекламе», ст. 24)
  const medical = isMedical(b);
  const adv = (b.advantages ?? []).map(withoutSuperlatives).filter((x) => x && !hasClaims(x, medical));
  const review = medical ? "" : withoutSuperlatives(b.review);
  // Только ссылки, за которыми есть содержимое: без цен нет «Цен», без адреса — «Как добраться»
  const cand: (Sitelink | null)[] = [
    hasPrices
      ? { title: order ? "Меню и цены" : "Цены на услуги", href: withAnchor(o.href, "services"), description: priceList ? cap(priceList) : undefined }
      : named.length
        ? { title: order ? "Меню" : "Услуги", href: withAnchor(o.href, "services"), description: cap(named.map((s) => clean(s.name).toLowerCase()).join(", ")) }
        : null,
    order
      ? { title: "Заказать онлайн", href: withAnchor(o.href, "form"), description: "Оставьте заявку — перезвоним и примем заказ" }
      : { title: "Записаться онлайн", href: withAnchor(o.href, "form"), description: "Выберите удобное время в форме записи" },
    review ? { title: "Отзыв клиента", href: withAnchor(o.href, "reviews"), description: review.length <= 58 ? `«${review}»` : `«${cut(review, 54)}...»` } : null,
    adv.length || withoutSuperlatives(b.description)
      ? { title: "Почему мы", href: withAnchor(o.href, "about"), description: adv.join(". ") || withoutSuperlatives(b.description) }
      : null,
    b.address ? { title: "Как добраться", href: withAnchor(o.href, "contacts"), description: [b.address, b.hours ? hours.text : null].filter(Boolean).join(". ") } : null,
    !b.address && b.hours ? { title: "Часы работы", href: withAnchor(o.href, "contacts"), description: hours.text } : null,
  ];
  // Директ принимает до 8 быстрых ссылок: добавляем другие услуги — каждая ведёт к своей строке прайса
  // Якорь — по месту услуги в прайсе (порядок здесь — по близости к объявлению)
  // Есть услуги про этот запрос — быстрые ссылки только на них (пицца к «доставке пиццы», без десертов)
  const relevant = topic.size ? services.filter((sv) => score(sv.name) > 0) : [];
  (relevant.length ? relevant : services).forEach((sv) => {
    if (sv.name === o.service) return;
    const i = (b.services ?? []).indexOf(sv);
    cand.push({ title: sv.name, href: withAnchor(o.href, `s${i + 1}`), description: [sv.price, sv.note, order ? "заказ онлайн" : "запись онлайн"].filter(Boolean).join(", ") });
  });
  const sitelinks = fitSitelinks(cand.filter((x): x is Sitelink => !!x));

  // Отображаемая ссылка: до 20 символов, буквы, цифры и дефис
  const displayPath = (o.service || services[0]?.name || "")
    .toLowerCase()
    .replace(/[^а-яёa-z0-9\s-]/gi, " ")
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .reduce((acc, w) => (acc.done ? acc : (acc.s ? `${acc.s}-${w}` : w).length <= 20 ? { s: acc.s ? `${acc.s}-${w}` : w, done: false } : { ...acc, done: true }), { s: "", done: false })
    .s.replace(/(-(и|в|во|на|для|с|со|по|от|до|к|у|из|или|а|о|за))+$/, "");

  const orgId = b.orgId && /^\d{3,20}$/.test(String(b.orgId).trim()) ? String(b.orgId).trim() : null;

  const longParts = [
    o.text,
    ...adv.slice(0, 3),
    b.offer ? `${cap(withoutSuperlatives(b.offer))}.` : null,
    b.address ? `Ждём вас: ${b.city}, ${addressWithoutCity(b.address, b.city)}.` : null,
    order ? "Закажите онлайн — это займёт минуту." : "Запишитесь онлайн — это займёт минуту.",
  ];
  // Длинный текст VK: без повторов — каждое предложение один раз
  const seen = new Set<string>();
  const norm = (x: string) => x.toLowerCase().replace(/[^а-яёa-z0-9]/gi, "");
  let longText = "";
  for (const p of longParts) {
    if (!p) continue;
    for (const raw of clean(p).split(/(?<=[.!?…])\s+/)) {
      const t = raw.trim();
      if (!t || seen.has(norm(t)) || hasSuperlative(t)) continue;
      const sentence = /[.!?…»]$/.test(t) ? t : `${t}.`;
      const next = longText ? `${longText} ${sentence}` : sentence;
      if (next.length > 220) continue;
      seen.add(norm(t));
      longText = next;
    }
  }

  const n = nicheById(b.niche);
  const about = cut(`${clean(b.name)} — ${n.label.toLowerCase()} в городе ${b.city}${b.address ? `, ${addressWithoutCity(b.address, b.city)}` : ""}.`, 115);

  return {
    callouts: factCallouts(b, medical),
    sitelinks,
    displayPath: displayPath || null,
    price: o.channel === "vk" ? null : priceLabel,
    org: o.channel === "vk" || !orgId ? null : { id: orgId },
    place: street ? `${street}${house ? `, ${house}` : ""}` : null,
    longText,
    about,
  };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ─── Организация в Яндекс Картах / Бизнесе ─────────────────────────────

/**
 * ID организации (permalink) из ссылки владельца:
 *  - yandex.ru/maps/org/<slug>/<id>/ (и yandex.com, .kz, .by, с /maps/<город>/org/…);
 *  - yandex.ru/maps/?…&oid=<id> и …&ll=…&poi[uri]=ymapsbm1://org?oid=<id>;
 *  - yandex.ru/sprav/<id>/… и yandex.ru/sprav/companies/<id>, business.yandex.ru/…/<id>;
 *  - просто число.
 * Короткие ссылки (yandex.ru/maps/-/…) без запроса к Яндексу не раскрыть — для них null.
 */
export function parseOrgId(input?: string | null): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  if (/^\d{5,20}$/.test(raw)) return raw;
  let s = raw;
  try {
    s = decodeURIComponent(raw);
  } catch {
    /* как есть */
  }
  if (!/yandex\.|ya\.ru/i.test(s)) return null;
  const pats = [
    /\/maps\/(?:\d+\/[^/]+\/)?org\/(?:[^/?#]+\/)?(\d{5,20})(?:[/?#]|$)/i,
    /[?&](?:oid|orgid|permalink)=(\d{5,20})/i,
    /org\?oid=(\d{5,20})/i,
    /\/sprav\/(?:companies\/)?(\d{5,20})(?:[/?#]|$)/i,
    /business\.yandex\.[a-z]+\/[^?#]*?\/(\d{5,20})(?:[/?#]|$)/i,
  ];
  for (const re of pats) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return null;
}

// ─── Расписание показов по часам работы ────────────────────────────────

const DAY_CODES = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"] as const;
const DAY_FULL: [RegExp, string][] = [
  [/понедельник[а-я]*/g, "пн"], [/вторник[а-я]*/g, "вт"], [/сред[а-я]*/g, "ср"], [/четверг[а-я]*/g, "чт"],
  [/пятниц[а-я]*/g, "пт"], [/суббот[а-я]*/g, "сб"], [/воскресень[а-я]*|воскресен[а-я]*/g, "вс"],
];

/** Часы работы по дням: [открытие, закрытие) в часах (0–24) или null — выходной. null целиком — разобрать не удалось. */
export function parseWeekHours(h?: string | null): ({ open: number; close: number } | null)[] | null {
  let t = ` ${(h ?? "").toLowerCase().replace(/ё/g, "е").replace(/[–—−‐‑]/g, "-")} `;
  if (!t.trim()) return null;
  for (const [re, code] of DAY_FULL) t = t.replace(re, code);
  // «пн-пт» → «пн вт ср чт пт»
  t = t.replace(/(пн|вт|ср|чт|пт|сб|вс)\.?\s*-\s*(пн|вт|ср|чт|пт|сб|вс)\.?/g, (_, a: string, b: string) => {
    const i = DAY_CODES.indexOf(a as (typeof DAY_CODES)[number]), j = DAY_CODES.indexOf(b as (typeof DAY_CODES)[number]);
    const out: string[] = [];
    for (let k = i; ; k = (k + 1) % 7) {
      out.push(DAY_CODES[k]);
      if (k === j || out.length > 7) break;
    }
    return ` ${out.join(" ")} `;
  });
  const days: ({ open: number; close: number } | null | undefined)[] = Array(7).fill(undefined);
  let pending: number[] = [];
  let any = false;
  const assign = (v: { open: number; close: number } | null) => {
    const target = pending.length ? pending : days.map((d, i) => (d === undefined ? i : -1)).filter((i) => i >= 0);
    for (const i of target) days[i] = v;
    pending = [];
    any = true;
  };
  const re = /(?<![а-я])(ежедневно|каждый день|без выходных|круглосуточно|24\s*\/\s*7|будни|будние дни|по будням|выходн[а-я]*|закрыт[а-я]*|пн|вт|ср|чт|пт|сб|вс)(?![а-я])|(\d{1,2})(?:[:.](\d{2}))?\s*(?:-|до)\s*(\d{1,2})(?:[:.](\d{2}))?/g;
  for (const m of t.matchAll(re)) {
    const w = m[1];
    if (w) {
      if (/^(ежедневно|каждый день|без выходных)$/.test(w)) pending = [0, 1, 2, 3, 4, 5, 6];
      else if (/^(круглосуточно|24)/.test(w)) assign({ open: 0, close: 24 });
      else if (/^(будни|будние дни|по будням)$/.test(w)) pending = [0, 1, 2, 3, 4];
      else if (/^выходн/.test(w)) {
        if (pending.length) assign(null); // «сб, вс — выходной»
        else pending = [5, 6]; // «выходные 11-20»
      } else if (/^закрыт/.test(w)) assign(null);
      else {
        const i = DAY_CODES.indexOf(w as (typeof DAY_CODES)[number]);
        if (i >= 0 && !pending.includes(i)) pending.push(i);
      }
      continue;
    }
    const open = Number(m[2]) + Number(m[3] ?? 0) / 60;
    let close = Number(m[4]) + Number(m[5] ?? 0) / 60;
    if (open > 24 || close > 24) continue;
    if (close === 0 || close <= open) close = 24; // «до 00:00», «до 2 ночи» — считаем до полуночи
    assign({ open, close });
  }
  if (!any) return null;
  // Дни, которые владелец не упомянул («Пн–Пт 9–20»), считаем выходными
  return days.map((d) => (d === undefined ? null : d));
}

/** Часовой пояс Директа по городу (по умолчанию — московское время) */
const CITY_TZ: [RegExp, string][] = [
  [/калининград/, "Europe/Kaliningrad"],
  [/самар|тольятти|ижевск|сызран/, "Europe/Samara"],
  [/ульяновск/, "Europe/Ulyanovsk"],
  [/саратов/, "Europe/Saratov"],
  [/волгоград|волжск/, "Europe/Volgograd"],
  [/астрахан/, "Europe/Astrakhan"],
  [/екатеринбург|челябинск|пермь|уфа|тюмень|оренбург|курган|магнитогорск|сургут|нижневартовск|стерлитамак|нижний тагил|ханты/, "Asia/Yekaterinburg"],
  [/омск/, "Asia/Omsk"],
  [/новосибирск|бердск/, "Asia/Novosibirsk"],
  [/барнаул|бийск/, "Asia/Barnaul"],
  [/томск/, "Asia/Tomsk"],
  [/кемерово|новокузнецк/, "Asia/Novokuznetsk"],
  [/красноярск|абакан|норильск/, "Asia/Krasnoyarsk"],
  [/иркутск|улан-удэ|братск|ангарск/, "Asia/Irkutsk"],
  [/чита/, "Asia/Chita"],
  [/якутск/, "Asia/Yakutsk"],
  [/владивосток|хабаровск|уссурийск|находка|комсомольск/, "Asia/Vladivostok"],
  [/магадан|южно-сахалинск/, "Asia/Magadan"],
  [/петропавловск-камчатский/, "Asia/Kamchatka"],
];
export function timeZoneFor(city?: string | null) {
  const c = (city ?? "").toLowerCase().replace(/ё/g, "е");
  // «Омск» не путаем с «Томском»: сначала проверяем более длинные совпадения
  if (/томск/.test(c)) return "Asia/Tomsk";
  return CITY_TZ.find(([re]) => re.test(c))?.[1] ?? "Europe/Moscow";
}

/**
 * Расписание показов Директа (TimeTargeting.Schedule) по часам работы: реклама идёт с часа-двух до открытия
 * (люди планируют визит заранее) и до часа после закрытия. Ночью не показываем: записаться можно только на завтра,
 * а звонок останется без ответа. В выходной день бизнеса реклама идёт в обычные часы — записываются на другие дни
 * через онлайн-форму. Коэффициенты только 0 и 100: почасовые корректировки автостратегии Директа не учитывают.
 * null — часы неизвестны, работают круглосуточно или окно вышло бы слишком узким (Директ требует от 40 часов
 * показов в рабочие дни недели).
 */
export function timeTargeting(b: Pick<ExtrasBiz, "hours" | "city"> & { showSettings?: unknown }): { schedule: string[]; timeZone: string; considerWorkingWeekends: boolean; note: string } | null {
  // Владелец сам выбрал время показа
  const s = showOf(b);
  if (s.scheduleMode === "always") return null;
  if (s.scheduleMode === "custom") {
    const c = customSchedule(s);
    return { schedule: c.schedule, timeZone: timeZoneFor(b.city), considerWorkingWeekends: false, note: c.warning ?? c.note };
  }
  const week = parseWeekHours(b.hours);
  if (!week) return null;
  const open = week.filter((d): d is { open: number; close: number } => !!d);
  if (!open.length || open.every((d) => d.open <= 0 && d.close >= 24)) return null;
  // Обычные часы — самые частые среди рабочих дней
  const key = (d: { open: number; close: number }) => `${d.open}-${d.close}`;
  const freq = new Map<string, number>();
  for (const d of open) freq.set(key(d), (freq.get(key(d)) ?? 0) + 1);
  const usual = open.find((d) => key(d) === [...freq.entries()].sort((x, y) => y[1] - x[1])[0][0])!;
  const windowOf = (d: { open: number; close: number }) => ({ from: Math.max(0, Math.floor(d.open) - 2), to: Math.min(24, Math.ceil(d.close) + 1) });
  const schedule: string[] = [];
  let weekdayHours = 0;
  for (let i = 0; i < 7; i++) {
    const w = windowOf(week[i] ?? usual);
    const coef = Array.from({ length: 24 }, (_, h) => (h >= w.from && h < w.to ? 100 : 0));
    if (i < 5) weekdayHours += coef.filter(Boolean).length;
    schedule.push(`${i + 1},${coef.join(",")}`);
  }
  if (weekdayHours < 40) return null;
  const u = windowOf(usual);
  const hh = (x: number) => `${String(x).padStart(2, "0")}:00`;
  return {
    schedule,
    timeZone: timeZoneFor(b.city),
    considerWorkingWeekends: true,
    note: `Реклама показывается с ${hh(u.from)} до ${hh(u.to)} (по часам работы: за пару часов до открытия и час после закрытия), ночью — нет.`,
  };
}

// ─── Комбинаторное объявление Директа: дополнительные заголовки и тексты ──

/** Директ: заголовок до 56 символов (слово до 22), текст до 81 (слово до 23); до 7 заголовков и 3 текстов */
export const RESPONSIVE_LIMITS = { title: 56, text: 81, word: 22, textWord: 23, titles: 7, texts: 3 } as const;

/**
 * Заголовки и тексты комбинаторного объявления (ResponsiveAd): основной вариант + варианты из фактов анкеты
 * (услуга, цена, адрес, предложение, преимущества, часы). Ничего не придумываем — только то, что написал владелец,
 * и правда о продукте (онлайн-запись). Детерминированно: одинаково при запуске, у робота и в предпросмотре,
 * поэтому в БД хранится только основной заголовок и текст.
 *
 * Группа поиска может покрывать несколько услуг прайса (o.services): их названия с ценами — тоже заголовки (факты из
 * прайса). Порядок кандидатов зависит от подхода объявления (ad.angle): у «Цены» первыми идут цены, у «Удобства» —
 * адрес и часы, у «Предложения» — предложение; так три объявления группы различаются не только основным заголовком.
 */
export function responsiveAssets(b: ExtrasBiz, ad: { title: string; title2?: string | null; text: string; angle?: string | null }, o: { service?: string | null; services?: string[] | null } = {}) {
  const L = RESPONSIVE_LIMITS;
  const services = b.services ?? [];
  const svcRow = (o.service && services.find((s) => s.name === o.service)) || null;
  const svc = clean(svcRow?.name ?? o.service ?? services[0]?.name ?? "") || (nicheById(b.niche).id === "other" ? clean(b.name) : nicheById(b.niche).generic);
  // «1900» → «1 900 ₽», «от 1900р» → «от 1 900 ₽» (как в объявлениях из шаблонов)
  const fmtPrice = (raw: string) =>
    raw
      ? raw
          .replace(/\s*(р\.?|руб\.?|рублей|₽)\s*$/i, "")
          .replace(/\d[\d\s]*\d|\d/g, (m) => new Intl.NumberFormat("ru-RU").format(Number(m.replace(/\s/g, ""))).replace(/[\u00a0\u202f]/g, " ")) + " ₽"
      : null;
  const p = fmtPrice(clean((svcRow ?? (o.service ? null : services[0]))?.price ?? ""));
  const name = clean(b.name);
  const address = addressWithoutCity(b.address, b.city);
  const street = address ? clean(address.split(/[,—–]/)[0]) : null;
  const where = street ? `${b.city}, ${street}` : b.city;
  const medical = isMedical(b);
  const adv = (b.advantages ?? []).map(withoutSuperlatives).filter((x) => x && !hasClaims(x, medical));
  const offer = b.offer && !hasClaims(b.offer, medical) ? withoutSuperlatives(b.offer) : null;
  const hours = clean(b.hours ?? "") || null;
  // Со строчной — только обычные слова: название бизнеса и аббревиатуры оставляем как у владельца
  const low = (s: string) => (/^\p{Lu}{2}/u.test(s) || s.startsWith(name) || (name && s.toLowerCase().startsWith(name.toLowerCase())) ? s : s.charAt(0).toLowerCase() + s.slice(1));
  const okWords = (s: string, max: number) => s.split(/\s+/).every((w) => w.length <= max);
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

  const pickList = (cands: (string | null | false | undefined)[], max: number, word: number, limit: number, distinct = false) => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const c0 of cands) {
      if (!c0) continue;
      const c = clean(c0).replace(/\s+([.,!?;:])/g, "$1");
      if (!c || c.length > max || !okWords(c, word) || hasSuperlative(c) || badChars(c).length || hasClaims(c, medical)) continue;
      const k = norm(c);
      if (!k || seen.has(k)) continue;
      // Текст, который почти целиком повторяет уже взятый, Яндексу ничего не добавляет
      if (distinct && [...seen].some((x) => x.includes(k) || k.includes(x))) continue;
      seen.add(k);
      out.push(c);
      if (out.length >= limit) break;
    }
    return out;
  };
  const sent = (parts: (string | null | false | undefined)[], max: number) => {
    let out = "";
    for (const raw of parts) {
      if (!raw) continue;
      const t = clean(raw).replace(/[.!]+$/, "");
      if (!t) continue;
      const s = `${t}.`;
      if (out.toLowerCase().includes(t.toLowerCase())) continue;
      const next = out ? `${out} ${s}` : s;
      if (next.length <= max) out = next;
    }
    return out;
  };

  const title = clean(ad.title);
  const title2 = clean(ad.title2 ?? "");
  // Другие услуги группы с ценами из прайса: «Японский маникюр — 2 500 ₽»
  const siblings = (o.services ?? [])
    .filter((x) => x && x !== svcRow?.name)
    .map((x) => services.find((s) => s.name === x))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s) => {
      const sp = fmtPrice(clean(s.price ?? ""));
      return sp ? `${clean(s.name)} — ${sp}` : null;
    });
  const pool = {
    lead: [title, title2 && `${title.replace(/[.!]$/, "")}. ${title2}`, title2 && !norm(title2).includes(norm(svc)) && !/цен|₽|\bруб/i.test(title2) && `${svc}: ${low(title2)}`],
    price: [p && `${svc} — ${p}`, p && `${svc} — ${p}, ${b.city}`, ...siblings],
    place: [street ? `${svc} — ${b.city}, ${street}` : `${svc} — ${b.city}`, hours && `${svc} — ${hours}`, `${svc} — онлайн-запись`],
    brand: [`${name}: ${low(svc)}`, `${svc} в ${name}`],
    offer: [offer && `${svc}: ${low(offer)}`],
    // Преимущество — отдельным заголовком, не приписывая его конкретной услуге
    adv: [adv[0] && adv[0].length >= 12 && adv[0], adv[1] && adv[1].length >= 12 && adv[1]],
  };
  const order: (keyof typeof pool)[] =
    ad.angle === "convenience" ? ["lead", "place", "price", "brand", "adv", "offer"]
    : ad.angle === "offer" ? ["lead", "offer", "price", "place", "adv", "brand"]
    : ad.angle === "proof" || ad.angle === "result" ? ["lead", "adv", "price", "brand", "place", "offer"]
    : ad.angle === "emotion" ? ["lead", "brand", "adv", "place", "price", "offer"]
    : ["lead", "price", "place", "brand", "offer", "adv"];
  const titles = pickList(order.flatMap((k) => pool[k]), L.title, L.word, L.titles);
  const texts = pickList(
    [
      clean(ad.text),
      sent([`${svc}${p ? ` — ${p}` : ""}`, adv[0], adv[1], `${name}, ${where}`, "Запишитесь онлайн за минуту"], L.text),
      sent([offer ? offer.charAt(0).toUpperCase() + offer.slice(1) : null, adv[1] ?? adv[0], hours && `Работаем: ${hours}`, `${name}, ${where}`, "Онлайн-запись на удобное время"], L.text),
      sent([`${name}, ${where}`, hours, "Выберите удобное время онлайн"], L.text),
    ],
    L.text, L.textWord, L.texts, true,
  );
  // Основной заголовок и текст идут первыми, даже если они длиннее лимита (их проверяет валидация владельца)
  if (title && titles[0] !== title) titles.unshift(title);
  if (clean(ad.text) && texts[0] !== clean(ad.text)) texts.unshift(clean(ad.text));
  return { titles: titles.slice(0, L.titles), texts: texts.slice(0, L.texts) };
}

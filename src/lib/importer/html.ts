/**
 * Небольшие разборщики HTML без сторонних библиотек: мета-теги, JSON-LD, ссылки, картинки, видимый текст.
 * Работают на регулярных выражениях — для черновика анкеты этого достаточно, а зависимостей не прибавляется.
 */

const NAMED: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", laquo: "«", raquo: "»", mdash: "—", ndash: "–",
  hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", bdquo: "„", bull: "•", middot: "·", times: "×",
  thinsp: " ", ensp: " ", emsp: " ", shy: "", copy: "©", reg: "®", deg: "°", rub: "₽", minus: "−", numero: "№",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

export const clean = (s: unknown): string =>
  typeof s === "string" ? decodeEntities(s).replace(/<[^>]+>/g, " ").replace(/[\s  ]+/g, " ").trim() : "";

/** Атрибуты одного тега: <a href="x" data-y='z' disabled> → { href: "x", "data-y": "z", disabled: "" } */
export function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const body = tag.replace(/^<\s*[\w:-]+/, "").replace(/\/?>$/, "");
  for (const m of body.matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g)) {
    const k = m[1].toLowerCase();
    if (!(k in out)) out[k] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

/** Все открывающие теги с именем name */
export function tags(html: string, name: string): Record<string, string>[] {
  const re = new RegExp(`<${name}\\b[^>]*>`, "gi");
  return [...html.matchAll(re)].map((m) => attrs(m[0]));
}

/** Мета-теги: og:title, description, twitter:image… (ключи в нижнем регистре, первое значение) */
export function metaTags(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of tags(html, "meta")) {
    const k = (a.property || a.name || a.itemprop || "").toLowerCase();
    if (k && a.content !== undefined && !(k in out)) out[k] = a.content.trim();
  }
  return out;
}

export function titleOf(html: string): string {
  return clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
}

/** JSON с мелкими огрехами, которые встречаются в разметке сайтов: висячие запятые, переводы строк в строках */
export function looseJson(s: string): unknown {
  const t = s.trim().replace(/^<!--|-->$/g, "").replace(/^\s*\/\/<!\[CDATA\[|\/\/\]\]>\s*$/g, "");
  try {
    return JSON.parse(t);
  } catch {
    try {
      return JSON.parse(t.replace(/,\s*([}\]])/g, "$1").replace(/[\u0000-\u001f]+/g, " "));
    } catch {
      return null;
    }
  }
}

/** Все объекты JSON-LD страницы — @graph и массивы развёрнуты */
export function jsonLd(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const push = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(push);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (Array.isArray(o["@graph"])) (o["@graph"] as unknown[]).forEach(push);
      out.push(o);
    }
  };
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) push(looseJson(m[1]));
  return out;
}

/** Типы schema.org объекта в нижнем регистре */
export const ldTypes = (o: Record<string, unknown>): string[] =>
  ([] as unknown[]).concat(o["@type"] ?? []).map((t) => String(t).replace(/^https?:\/\/schema\.org\//, "").toLowerCase());

/** Видимый текст: строки сохраняются, ячейки таблиц разделены « | » — так прайс остаётся «услуга | цена» в одной строке */
export function htmlToText(html: string, max = 60000): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(td|th)>\s*/gi, " | ")
      .replace(/<(br|hr)\b[^>]*>/gi, "\n")
      .replace(/<\/?(p|div|li|ul|ol|h[1-6]|tr|table|section|article|header|footer|main|nav|aside|dt|dd|dl|figure|figcaption|blockquote|form|label|option|button|summary|details)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[\t   ]+/g, " ")
    .split("\n")
    .map((l) => l.trim().replace(/^\|\s*|\s*\|$/g, "").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, max);
}

export type Link = { href: string; text: string };

/** Ссылки страницы с абсолютными адресами */
export function links(html: string, base: string): Link[] {
  const out: Link[] = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]{0,600}?)<\/a>/gi)) {
    const a = attrs(`<a ${m[1]}>`);
    if (!a.href) continue;
    const raw = a.href.trim();
    if (/^(javascript|data):/i.test(raw)) continue;
    let href = raw;
    if (!/^(tel|mailto|whatsapp|viber|tg):/i.test(raw)) {
      try {
        href = new URL(raw, base).toString();
      } catch {
        continue;
      }
    }
    out.push({ href, text: clean(m[2]).slice(0, 120) });
  }
  return out;
}

export type Img = { src: string; width: number; height: number; alt: string; cls: string };

/** Картинки страницы (src, data-src, srcset — самый большой вариант) */
export function images(html: string, base: string): Img[] {
  const out: Img[] = [];
  for (const a of tags(html, "img")) {
    let src = a["data-original"] || a["data-src"] || a["data-lazy-src"] || a["data-original-src"] || a.src || "";
    const set = a.srcset || a["data-srcset"];
    if (set) {
      const best = set
        .split(",")
        .map((p) => p.trim().split(/\s+/))
        .map(([u, w]) => ({ u, w: parseInt(w ?? "0", 10) || 0 }))
        .sort((x, y) => y.w - x.w)[0];
      if (best?.u) src = best.u;
    }
    if (!src || src.startsWith("data:")) continue;
    try {
      src = new URL(src, base).toString();
    } catch {
      continue;
    }
    out.push({ src, width: parseInt(a.width ?? "0", 10) || 0, height: parseInt(a.height ?? "0", 10) || 0, alt: a.alt ?? "", cls: a.class ?? "" });
  }
  // Фоновые картинки блоков (Tilda: data-original у div, style="background-image:url(...)")
  for (const m of html.matchAll(/<div\b[^>]*data-original=["']([^"']+)["'][^>]*>/gi)) {
    try {
      out.push({ src: new URL(decodeEntities(m[1]), base).toString(), width: 0, height: 0, alt: "", cls: "bg" });
    } catch {
      /* пропускаем */
    }
  }
  return out;
}

/** Микроразметка: itemprop → значение (content, href, src или текст элемента) */
export function microdata(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<([a-z0-9]+)\b([^>]*\bitemprop\s*=\s*["']?([\w-]+)["']?[^>]*)>([^<]{0,300})/gi)) {
    const a = attrs(`<x ${m[2]}>`);
    const k = m[3].toLowerCase();
    const v = clean(a.content ?? a.href ?? a.src ?? (a.datetime || m[4]));
    if (v && !(k in out)) out[k] = v;
  }
  return out;
}

// ─── Блоки страницы: текст в порядке документа + уровень заголовка ─────────

/**
 * Строка видимого текста с «контекстом»: уровень заголовка (h1–h6 или класс конструктора вроде
 * text-style-h3, t-title, t-name, __title), пункт списка, меню/навигация, номер секции.
 * По заголовкам услуги получают категорию («Маникюр», «Педикюр»), по ним же ищем «Почему мы».
 */
export type Block = { text: string; level: number; li: boolean; nav: boolean; sec: number };

const BLOCK_TAGS = new Set([
  "p", "div", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "table", "tbody", "thead", "section", "article", "header", "footer",
  "main", "nav", "aside", "dt", "dd", "dl", "figure", "figcaption", "blockquote", "form", "label", "option", "button", "summary", "details", "a",
]);
const VOID = new Set(["br", "hr", "img", "input", "meta", "link", "source", "wbr", "area", "col", "embed", "param", "track"]);

/** Уровень «заголовка» по тегу и классу: 0 — обычный текст */
function headingLevel(tag: string, cls: string): number {
  const h = /^h([1-6])$/.exec(tag);
  if (h) return Number(h[1]);
  if (!cls) return 0;
  const m = /(?:text-style-|heading-?|title-?|\bt)h([1-6])\b/i.exec(cls);
  if (m) return Number(m[1]);
  if (/(^|\s)(t-title|t-section__title|t\d+__title|section-title|block-title|title-section)(\s|$)/i.test(cls)) return 2;
  if (/(^|[\s_-])(t-name|t-card__title|card-title|card__title|item-title|item__title|tab-title|tabs?__(item|title|link)|accordion[\w-]*(title|header|button)|t-tabs__item|spoiler[\w-]*title|faq[\w-]*question)(\s|$)/i.test(cls)) return 4;
  if (/(^|\s)(t-heading|t-title_xs|t-title_sm|t-title_md|t-title_lg|t-title_xl|t-title_xxs)/i.test(cls)) return 3;
  return 0;
}

export function blocks(html: string, max = 4000): Block[] {
  const src = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head|select)\b[\s\S]*?<\/\1>/gi, " ");
  const out: Block[] = [];
  type El = { tag: string; level: number; li: boolean; nav: boolean };
  const stack: El[] = [];
  let buf = "";
  let sec = 0;
  const flush = () => {
    const t = decodeEntities(buf).replace(/[\s  ]+/g, " ").replace(/^\s*\|\s*|\s*\|\s*$/g, "").trim();
    buf = "";
    if (!t || out.length >= max) return;
    let level = 0;
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i].level) { level = stack[i].level; break; }
    out.push({ text: t.slice(0, 600), level, li: stack.some((e) => e.li), nav: stack.some((e) => e.nav), sec });
  };
  for (const m of src.matchAll(/<(\/?)([a-zA-Z][\w:-]*)([^>]*)>|([^<]+)/g)) {
    if (m[4] !== undefined) {
      buf += m[4];
      continue;
    }
    const close = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (tag === "br") {
      flush();
      continue;
    }
    if ((tag === "td" || tag === "th") && close) {
      buf += " | ";
      continue;
    }
    if (VOID.has(tag) || !BLOCK_TAGS.has(tag)) continue;
    flush();
    if (close) {
      const i = stack.map((e) => e.tag).lastIndexOf(tag);
      if (i >= 0) stack.length = i;
      continue;
    }
    if (/\/\s*$/.test(m[3])) continue;
    const cls = /\bclass\s*=\s*["']([^"']*)["']/i.exec(m[3])?.[1] ?? "";
    const id = /\bid\s*=\s*["']([^"']*)["']/i.exec(m[3])?.[1] ?? "";
    if (tag === "section" || /^rec\d+$/.test(id)) sec++;
    // Меню, хлебные крошки, формы и всплывающие окна — служебный текст (адрес и телефон из шапки всё равно берём)
    const nav = tag === "nav" || tag === "form" || /(^|[\s_-])(menu|navbar|nav|t228|t450|t451|t456|burger|breadcrumbs?|popup|modal|t-popup|t702|t-form|callback|cookie)([\s_-]|$)/i.test(cls);
    stack.push({ tag, level: headingLevel(tag, cls), li: tag === "li", nav });
    if (stack.length > 400) stack.splice(0, stack.length - 400);
  }
  flush();
  return out;
}

// ─── Фото: все осмысленные картинки страницы ─────────────────────────────

export type PhotoCand = { url: string; key: string; width: number; height: number; score: number; order: number; caption?: string };

const IMG_EXT = /\.(jpe?g|png|webp|avif)(?:[?#]|$)/i;
const PHOTO_BAD = /(logo|icon|favicon|sprite|avatar|placeholder|blank|pixel|badge|button|arrow|social|soc-|whatsapp|telegram|instagram|vk[-_.]?(icon|logo)|payment|visa|mastercard|qr[-_]?code|counter|metrika|mc\.yandex|1x1|emoji|flag|star[-_]?rating|loader|spinner|preloader|%[a-z]+%|\/-\/empty\/|\/resize\/20x\/|_16\.png|_32\.png|_120\.png|_180\.png|_192\.png|apple-touch|thumb_?small)/i;

/** Ключ одной и той же картинки в разных размерах: 123_1920_q70.jpg = 123.jpg; foo-300x200.jpg = foo.jpg; Tilda /-/resize/… */
export function photoKey(u: string): string {
  try {
    const x = new URL(u);
    let p = decodeURIComponent(x.pathname).toLowerCase();
    p = p.replace(/\/-\/[^/]+\/[^/]*(?=\/)/g, "").replace(/\/-\/[^/]+(?=\/)/g, ""); // Tilda/Uploadcare: /-/resize/600x/, /-/format/webp/
    p = p.replace(/[-_](\d{2,4}x\d{2,4}|\d{3,4}(_q\d{1,3})?|scaled|large|medium|small|thumb)(?=\.\w+$)/g, "");
    p = p.replace(/\.(jpe?g|png|webp|avif)$/, "");
    const tild = /(tild[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})/.exec(p)?.[1];
    return tild ?? `${x.hostname.replace(/^(www|static|thb|optim)\./, "")}${p}`;
  } catch {
    return u;
  }
}

/** Ширина из имени/параметров ссылки: _1920_q70, -1024x768, /resize/600x/, ?w=800 */
function widthHint(u: string): number {
  const m = /[-_](\d{3,4})x(\d{3,4})\.\w+(?:$|\?)/.exec(u) ?? /\/resize\/(\d{2,4})x/.exec(u) ?? /_(\d{3,4})(?:_q\d+)?\.\w+(?:$|\?)/.exec(u) ?? /[?&](?:w|width)=(\d{2,4})/.exec(u);
  return m ? Number(m[1]) : 0;
}

/**
 * Картинки страницы: img (src, data-src, data-original, data-lazy…, srcset — самый крупный вариант), picture/source,
 * любые атрибуты со ссылкой на картинку (data-lightbox, data-bg, data-original у фонов Tilda, href лайтбоксов),
 * Flexbe (data-img-id + data-img-ext), CSS background-image в style. Без иконок, логотипов и дублей размеров.
 */
export function photoCandidates(html: string, base: string): PhotoCand[] {
  const src = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|noscript|template)\b[\s\S]*?<\/\1>/gi, (m) => (/noscript/i.test(m.slice(0, 10)) ? m.replace(/<\/?noscript[^>]*>/gi, " ") : " "));
  const found = new Map<string, PhotoCand>();
  let order = 0;
  const add = (raw: string | undefined, w: number, h: number, bonus: number, ctx: string, caption = "") => {
    if (!raw) return;
    let s = decodeEntities(raw.trim()).replace(/^url\(\s*["']?|["']?\s*\)$/g, "");
    if (!s || s.startsWith("data:") || s.includes("{") || s.length > 600) return;
    try {
      s = new URL(s, base).toString();
    } catch {
      return;
    }
    if (!/^https?:/.test(s)) return;
    if (!IMG_EXT.test(s) && !/tildacdn|\/img\/|\/upload|\/images?\//i.test(s)) return;
    if (/\.(svg|gif|ico)(?:[?#]|$)/i.test(s)) return;
    if (PHOTO_BAD.test(s) || PHOTO_BAD.test(ctx)) return;
    if ((w && w < 200) || (h && h < 200)) return;
    const key = photoKey(s);
    const hint = widthHint(s);
    const width = w || hint;
    const score = bonus + (width >= 800 ? 3 : width >= 450 ? 2 : width ? -1 : 0) + (/(galler|galer|slider|swiper|carousel|portfolio|works?|raboty|foto|photo|lightbox|fancybox|interior|interer)/i.test(ctx + " " + s) ? 3 : 0);
    const prev = found.get(key);
    if (prev) {
      if (!prev.caption && caption) prev.caption = caption;
      prev.score = Math.max(prev.score, score); // повтор той же картинки (миниатюра + оригинал) — не повод ставить выше
      // Лучший вариант размера: 800–2000 px по подсказке; без подсказки — оригинал
      const better = (hint >= 800 && hint <= 2000 && !(widthHint(prev.url) >= 800 && widthHint(prev.url) <= 2000)) || (!hint && widthHint(prev.url) > 0 && widthHint(prev.url) < 800);
      if (better) prev.url = s;
      prev.width = Math.max(prev.width, width);
      prev.height = Math.max(prev.height, h);
      return;
    }
    found.set(key, { url: s, key, width, height: h, score, order: order++, ...(caption ? { caption } : {}) });
  };
  const bestOfSet = (set: string | undefined) => {
    if (!set) return undefined;
    const list = set.split(/,\s+(?=\S)/).map((p) => p.trim().split(/\s+/)).map(([u, w]) => ({ u, w: parseFloat(w ?? "0") || 0 }));
    return list.sort((x, y) => y.w - x.w)[0]?.u;
  };
  for (const m of src.matchAll(/<([a-zA-Z][\w-]*)\b([^>]*)>/g)) {
    const tag = m[1].toLowerCase();
    const body = m[2];
    if (!/(src|data-|style|href)/i.test(body)) continue;
    const a = attrs(`<x ${body}>`);
    const ctx = `${a.class ?? ""} ${a.id ?? ""} ${a.alt ?? ""}`;
    const w = parseInt(a.width ?? a["data-width"] ?? "0", 10) || 0;
    const h = parseInt(a.height ?? a["data-height"] ?? "0", 10) || 0;
    if (tag === "img") {
      // alt/title — что на фото («Сет Свежесть»): по нему позиция прайса получит свою картинку
      const cap = decodeEntities((a.alt || a.title || "").trim()).replace(/\s+/g, " ").slice(0, 120);
      add(bestOfSet(a.srcset || a["data-srcset"] || a["data-lazy-srcset"]) || a["data-original"] || a["data-src"] || a["data-lazy-src"] || a["data-lazy"] || a["data-original-src"] || a["data-full"] || a.src, w, h, 2, ctx, cap.length >= 3 && !/^(image|img|photo|фото|картинка)\b/i.test(cap) ? cap : "");
      continue;
    }
    if (tag === "source") {
      add(bestOfSet(a.srcset || a["data-srcset"]), w, h, 2, ctx);
      continue;
    }
    // Flexbe: <figure data-img-id="53238969" data-img-ext="jpg">
    if (a["data-img-id"] && /^\d+$/.test(a["data-img-id"])) add(`/img/${a["data-img-id"]}.${(a["data-img-ext"] || "jpg").replace(/\W/g, "")}`, 0, 0, a["data-lightbox"] ? 3 : 1, ctx);
    for (const [k, v] of Object.entries(a)) {
      if (!v || k === "srcset") continue;
      if (k.startsWith("data-") && IMG_EXT.test(v) && !/\s/.test(v.trim())) add(v, w, h, k === "data-original" || /lightbox|zoom|full|big|large|bg|background|image/.test(k) ? 2 : 1, ctx);
      else if (k === "href" && tag === "a" && IMG_EXT.test(v)) add(v, 0, 0, 3, ctx); // лайтбокс: ссылка на крупную картинку
    }
    if (a.style && /background(-image)?\s*:/i.test(a.style)) {
      for (const u of a.style.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) add(u[1], w, h, 1, ctx + " bg");
    }
  }
  return [...found.values()];
}

/** Фото по убыванию «полезности»: галереи и крупные выше, затем порядок на странице */
export function rankPhotos(list: PhotoCand[], limit = 40): string[] {
  return [...list].sort((a, b) => b.score - a.score || a.order - b.order).slice(0, limit).map((p) => p.url);
}

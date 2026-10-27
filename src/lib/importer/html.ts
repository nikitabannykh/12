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

/**
 * Чистые помощники VK Рекламы (без сети и БД): формат баннера пакета → ключи textblocks/content, расписание
 * показов из часов работы, радиус показа вокруг адреса, возрастная метка, код пикселя Top@Mail.ru.
 * Модуль без "server-only": код пикселя нужен странице записи (трекер), остальное — vk.ts / regions.ts.
 *
 * Документация (сверено 2026-10-26):
 *  - Набор ключей urls/content/textblocks задаёт пакет: «The list of available keys in the urls, content, and textblocks
 *    fields is determined by the advertising package» — https://ads.vk.ru/en/doc/api/info/Quick%20start
 *  - Package.banner_format_id → BannerFormat — https://ads.vk.ru/en/doc/api/object/Package
 *    (страница BannerFormat на момент сверки не открывалась, поэтому формат разбираем «по ключам» — см. parseBannerFormat)
 *  - Ключи из примеров: https://ads.vk.ru/en/doc/api/info/Add%20banners
 *  - Тексты/картинки «сайта»: заголовок 40, короткий 90, длинный 2000, «о компании» 115 (только юр. данные),
 *    картинки 1:1 600×600, 4:5 1080×1350, 16:9 1080×607, иконка 256×256 — https://ads.vk.ru/en/help/features/formats
 *  - Расписание: targetings.fulltime {mon..sun: number[], flags}, минимум 8 часов показа (ошибка min_translation_hours) —
 *    https://ads.vk.ru/en/doc/api/resource/AdGroups
 *  - Возрастная метка AdGroup.age_restrictions: шаблон ^[1-9]?[0-9]\+$ — https://ads.vk.ru/en/doc/api/object/AdGroup
 *  - Радиус: LocalGeoPointTargeting.radius 500…10000 м — https://ads.vk.ru/en/doc/api/object/LocalGeoPointTargeting
 */

// ─── Формат баннера ─────────────────────────────────────────────────────

/** Роль (ключ) в баннере: textblocks.<key> / content.<key> */
export type VkRole = { key: string; kind: "text" | "content" | "url"; maxLength?: number; width?: number; height?: number; choices?: string[] };
export type VkFormat = { known: boolean; roles: Map<string, VkRole> };

const ROLE_RE = /^(title_\d+[a-z0-9_]*|text_\d+[a-z0-9_]*|about_company_\d+|cta_[a-z0-9_]+|image_\d+x\d+[a-z0-9_]*|icon_\d+x\d+|video_[a-z0-9_]+|primary)$/;

function kindOf(key: string): VkRole["kind"] {
  if (/^(image|icon|video)_/.test(key)) return "content";
  if (key === "primary") return "url";
  return "text";
}

/** Длина из имени ключа: title_40_vkads → 40, text_2000 → 2000, about_company_115 → 115 */
export function lengthFromKey(key: string): number | undefined {
  const m = key.match(/^(?:title|text|about_company)_(\d+)/);
  return m ? Number(m[1]) : undefined;
}

export function sizeFromKey(key: string): { width: number; height: number } | undefined {
  const m = key.match(/^(?:image|icon)_(\d+)x(\d+)/);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : undefined;
}

/**
 * Разбор ответа о формате баннера. Точная схема BannerFormat не сверена (страница документации не открылась), поэтому
 * обходим объект целиком и собираем всё, что похоже на роль: ключи объекта и значения полей name/role/key/field.
 * Рядом ищем max_length / choices / values / options (массив строк) — допустимые значения CTA.
 * Ничего не нашли → known=false, и vk.ts использует безопасный набор по умолчанию (defaultFormat).
 */
export function parseBannerFormat(raw: unknown): VkFormat {
  const roles = new Map<string, VkRole>();
  const add = (key: string, meta: any) => {
    if (!ROLE_RE.test(key) || key === "primary") return;
    const r: VkRole = roles.get(key) ?? { key, kind: kindOf(key), maxLength: lengthFromKey(key), ...sizeFromKey(key) };
    if (meta && typeof meta === "object") {
      const ml = Number(meta.max_length ?? meta.maxlength ?? meta.max_len ?? meta.length);
      if (Number.isFinite(ml) && ml > 0 && r.kind === "text") r.maxLength = Math.min(r.maxLength ?? ml, ml);
      const ch = meta.choices ?? meta.values ?? meta.options ?? meta.allowed_values;
      const list = Array.isArray(ch) ? ch.map((c: any) => (typeof c === "string" ? c : c?.value ?? c?.id ?? c?.name)).filter((c: any) => typeof c === "string") : null;
      if (list?.length) r.choices = list;
    }
    roles.set(key, r);
  };
  const walk = (x: any, depth: number) => {
    if (!x || depth > 8) return;
    if (Array.isArray(x)) return x.forEach((v) => (typeof v === "string" ? add(v, null) : walk(v, depth + 1)));
    if (typeof x !== "object") return;
    for (const f of ["name", "role", "key", "field", "slot"]) if (typeof x[f] === "string") add(x[f], x);
    for (const [k, v] of Object.entries(x)) {
      add(k, v);
      walk(v, depth + 1);
    }
  };
  walk(raw, 0);
  return { known: roles.size > 0, roles };
}

/**
 * Набор по умолчанию, если формат пакета прочитать не удалось: ключи из примеров документации для пакета «сайт»
 * (Quick start, Add banners) и справки по форматам. Длинный текст — text_2000 (справка: «for sites — up to 2000»).
 * Если VK ответит unallowed_field, vk.ts повторит запрос без необязательных блоков.
 */
export function defaultFormat(): VkFormat {
  const keys = ["title_40_vkads", "text_90", "text_2000", "about_company_115", "cta_sites_full", "icon_256x256", "image_600x600", "image_1080x607", "image_1080x1350"];
  return { known: false, roles: new Map(keys.map((key) => [key, { key, kind: kindOf(key), maxLength: lengthFromKey(key), ...sizeFromKey(key) }])) };
}

const pickFirst = (f: VkFormat, prefs: (string | RegExp)[]) => {
  for (const p of prefs) {
    if (typeof p === "string") {
      if (f.roles.has(p)) return f.roles.get(p)!;
    } else {
      const hit = [...f.roles.values()].find((r) => p.test(r.key));
      if (hit) return hit;
    }
  }
  return undefined;
};

/** Какие ключи брать для объявления «на сайт» из формата пакета */
export function textKeys(f: VkFormat) {
  const title = pickFirst(f, ["title_40_vkads", "title_40", /^title_\d+$/]);
  const short = pickFirst(f, ["text_90", /^text_(\d{2})$/]);
  // Длинный текст: самый длинный из text_* (кроме короткого)
  const long = [...f.roles.values()]
    .filter((r) => r.kind === "text" && /^text_\d+$/.test(r.key) && r.key !== short?.key && (r.maxLength ?? 0) > (short?.maxLength ?? 90))
    .sort((a, b) => (b.maxLength ?? 0) - (a.maxLength ?? 0))[0];
  const about = pickFirst(f, [/^about_company_\d+$/]);
  const cta = pickFirst(f, ["cta_sites_full", /^cta_sites/, /^cta_/]);
  return { title, short, long, about, cta };
}

/** Кнопка: «Записаться» (signUp), если формат её разрешает или список неизвестен; иначе visitSite (из примера Add banners) */
export function ctaValue(role: VkRole | undefined, preferSafe = false): string {
  const want = ["signUp", "visitSite", "learnMore"];
  if (role?.choices?.length) return want.find((w) => role.choices!.includes(w)) ?? role.choices[0];
  return preferSafe ? "visitSite" : "signUp";
}

/**
 * Слот картинки под пропорцию: из ключей формата image_WxH выбираем ближайший по соотношению сторон (допуск 6%).
 * Нет подходящего — null (vk.ts тогда пробует квадрат и пишет предупреждение).
 */
export function imageKeyFor(f: VkFormat, width: number, height: number): string | null {
  const r = width / height;
  const cands = [...f.roles.values()]
    .filter((x) => x.kind === "content" && /^image_\d+x\d+$/.test(x.key) && x.width && x.height)
    .map((x) => ({ key: x.key, d: Math.abs(x.width! / x.height! - r) / r, w: x.width! }))
    .filter((x) => x.d <= 0.06)
    .sort((a, b) => a.d - b.d || b.w - a.w);
  return cands[0]?.key ?? null;
}

export const iconKey = (f: VkFormat) => pickFirst(f, ["icon_256x256", /^icon_/])?.key ?? null;

/** Обрезка по слову (без «оборванных» слов), с запасом под многоточие не заморачиваемся — VK его не требует */
export function fit(s: string, max: number | undefined): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (!max || t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:—–-]+$/, "");
}

// ─── Расписание показов ─────────────────────────────────────────────────

export type Fulltime = Partial<Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", number[]>>;
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
/** Минимум часов показа (AdGroups: ошибка min_translation_hours «at least 8 hours») */
export const VK_MIN_HOURS = 8;

/**
 * targetings.fulltime из workTime parseHours() ("0;6;10;00;21;00": дни с–по (0 = пн), часы с–до).
 * Часы — номера часов 0…23 (час h = h:00–h:59; так кабинет VK показывает сетку). Показы начинаем за час до открытия
 * (записываются заранее) и заканчиваем последним часом работы. Меньше 8 часов в день — расширяем вечер, чтобы не
 * получить min_translation_hours. Выходные дни (если салон работает только по будням) — пустой список.
 * Круглосуточно (00:00–24:00) или нераспознанные часы → null (поле не отправляем = показы весь день).
 */
export function vkFulltime(workTime: string | null | undefined): Fulltime | null {
  const p = (workTime ?? "").split(";").map(Number);
  if (p.length < 6 || p.some((x) => !Number.isFinite(x))) return null;
  const [d1, d2, h1, m1, h2, m2] = p;
  let from = Math.max(0, h1 - 1);
  let to = (m2 > 0 ? h2 : h2 - 1); // последний час, в котором салон ещё открыт
  if (h2 === 0 || h2 >= 24) to = 23;
  if (to < from) return null; // работа через полночь — не ограничиваем
  if (from === 0 && to >= 23) return null;
  while (to - from + 1 < VK_MIN_HOURS) {
    if (to < 23) to++;
    else from--;
  }
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const out: Fulltime = {};
  DAYS.forEach((d, i) => (out[d] = i >= d1 && i <= d2 ? hours : []));
  return out;
}

// ─── Радиус, возраст ────────────────────────────────────────────────────

/** Города-миллионники РФ (Росстат). Москва и Петербург — плотнее, радиус меньше */
const MILLION = ["москва", "санкт-петербург", "новосибирск", "екатеринбург", "казань", "нижний новгород", "красноярск", "челябинск", "самара", "уфа", "ростов-на-дону", "краснодар", "омск", "воронеж", "пермь", "волгоград"];
const normCity = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/^г\.?\s*/, "").trim();

/** Радиус показа вокруг салона, м (500…10000 по LocalGeoPointTargeting): Москва/СПб 2 км, миллионники 3 км, остальные 5 км */
export function vkRadiusFor(city: string): number {
  const env = Number(process.env.VK_GEO_RADIUS_M);
  if (Number.isFinite(env) && env >= 500 && env <= 10000) return Math.round(env);
  const c = normCity(city);
  if (c === "москва" || c === "санкт-петербург" || c === "петербург" || c === "спб") return 2000;
  if (MILLION.includes(c)) return 3000;
  return 5000;
}

/** Возрастная метка объявления: салоны, фитнес, йога — «0+»; явные «взрослые» услуги — «18+». Переопределение: VK_AGE_RESTRICTIONS */
export function vkAgeRestriction(b: { niche: string; description?: string | null; name?: string | null }): string {
  const env = process.env.VK_AGE_RESTRICTIONS;
  if (env && /^[1-9]?[0-9]\+$/.test(env)) return env;
  const t = `${b.name ?? ""} ${b.description ?? ""}`;
  if (/тату|пирсинг|кальян|алкогол|вино|пиво|бар\b|эрот|18\s*\+/i.test(t)) return "18+";
  return "0+";
}

/** «О компании» — только юридические данные (справка: «legal details only, not advertising text») */
export function legalAbout(s: string | null | undefined): string | null {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (!/ИНН|ОГРН|\bИП\b|ООО|АО\b|самозанят/i.test(t)) return null;
  return t.length <= 115 ? t : null; // обрезанные реквизиты хуже, чем никаких — не отправляем
}

// ─── Пиксель Top@Mail.ru ────────────────────────────────────────────────

/** Имя JS-события «заявка»: его нужно отправлять при успешной записи и выбрать в событии пикселя в кабинете VK */
export const VK_LEAD_GOAL = "lead";

/**
 * Код пикселя VK Рекламы (Top@Mail.ru) — стандартный код счётчика top-fwz1.mail.ru. Вставлять в <head> страницы записи.
 * counterId — число; строку не принимаем, чтобы в HTML не попало ничего лишнего.
 */
export function vkPixelSnippet(counterId: number): string {
  const id = Math.trunc(Number(counterId));
  if (!Number.isFinite(id) || id <= 0) return "";
  return `<script type="text/javascript">
var _tmr = window._tmr || (window._tmr = []);
_tmr.push({id: "${id}", type: "pageView", start: (new Date()).getTime()});
(function (d, w, id) {
  if (d.getElementById(id)) return;
  var ts = d.createElement("script"); ts.type = "text/javascript"; ts.async = true; ts.id = id;
  ts.src = "https://top-fwz1.mail.ru/js/code.js";
  var f = function () {var s = d.getElementsByTagName("script")[0]; s.parentNode.insertBefore(ts, s);};
  if (w.opera == "[object Opera]") { d.addEventListener("DOMContentLoaded", f, false); } else { f(); }
})(document, window, "tmr-code");
</script>
<noscript><div><img src="https://top-fwz1.mail.ru/counter?id=${id};js=na" style="position:absolute;left:-9999px;" alt="Top.Mail.Ru" /></div></noscript>`;
}

/** JS, который нужно выполнить при успешной отправке формы записи (событие VK_LEAD_GOAL) */
export function vkReachGoalJs(counterId: number, goal = VK_LEAD_GOAL): string {
  const id = Math.trunc(Number(counterId));
  if (!Number.isFinite(id) || id <= 0) return "";
  return `(window._tmr = window._tmr || []).push({type: "reachGoal", id: ${id}, goal: ${JSON.stringify(goal)}});`;
}

// ─── Шаблоны баннеров (BannerPattern) ────────────────────────────────────
// Баннер должен ровно соответствовать одному шаблону пакета: GET v2/banner_patterns.json →
// {id, name, status, format:[{field:"url"|"textblock"|"content", role, required}]} (https://ads.vk.ru/en/doc/api/object/BannerPattern).
// Разрешённые шаблоны пакета VK присылает в ошибке arguments.patterns, если баннер не подошёл.

export type VkPRole = { field: "url" | "textblock" | "content"; role: string; required: boolean };
export type VkPattern = { id: number; name: string; roles: VkPRole[] };
/** Что мы можем положить в баннер: тексты, «о компании», логотип и пропорции картинок */
export type VkHave = { title: boolean; text: boolean; about: boolean; logo: boolean; ratios: number[] };

export function parsePatterns(items: any[]): VkPattern[] {
  return (items ?? [])
    .filter((p) => p && (p.status ?? "active") === "active")
    .map((p) => ({
      id: Number(p.id),
      name: String(p.name ?? ""),
      roles: (Array.isArray(p.format) ? p.format : []).map((f: any) => ({ field: f.field, role: String(f.role ?? ""), required: Boolean(f.required) })),
    }))
    .filter((p) => p.id && p.roles.length);
}

export function canFill(r: VkPRole, h: VkHave): boolean {
  if (r.field === "url") return r.role === "primary";
  if (r.field === "textblock") {
    if (/^title_\d+/.test(r.role)) return h.title;
    if (/^text_\d+/.test(r.role)) return h.text;
    if (/^about_company_/.test(r.role)) return h.about;
    if (/^cta_sites/.test(r.role)) return true;
    return false;
  }
  if (/_slide_|_app$|^video|^html5|^audio|^animated/.test(r.role)) return false;
  if (/^icon_/.test(r.role)) return h.logo;
  const s = sizeFromKey(r.role);
  return !!s && h.ratios.some((q) => Math.abs(q - s.width / s.height) / q < 0.06);
}

/** Шаблон, который мы можем заполнить целиком (все обязательные роли), — с максимумом заполняемых ролей */
export function pickPattern(ps: VkPattern[], h: VkHave): VkPattern | null {
  const score = (p: VkPattern) => p.roles.filter((r) => canFill(r, h)).length;
  return ps.filter((p) => p.roles.every((r) => !r.required || canFill(r, h))).sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** ID разрешённых шаблонов из ошибки VK (arguments.patterns на любой глубине) */
export function patternIdsFromError(x: any, depth = 0): number[] {
  if (!x || typeof x !== "object" || depth > 12) return [];
  const a = x?.arguments?.patterns;
  if (Array.isArray(a)) return a.map(Number).filter(Boolean);
  for (const v of Object.values(x)) {
    const r = patternIdsFromError(v, depth + 1);
    if (r.length) return r;
  }
  return [];
}

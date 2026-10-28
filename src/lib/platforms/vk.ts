import "server-only";
import type { AdSpec, AdState, AudienceSpec, CampaignSpec, Channel, LaunchHooks, LaunchResult, PlatformClient, StatRow, Strategy, TargetingUpdate } from "./types";
import { PlatformError } from "./types";
import { sleep } from "../util";
import { ctaValue, defaultFormat, fit, iconKey, imageKeyFor, legalAbout, parseBannerFormat, textKeys, type Fulltime, type VkFormat } from "./vk-formats";
/** Максимальный размер страницы в списках VK Ads API v2 */
const VK_PAGE = 50;
export { vkPixelSnippet, vkReachGoalJs, VK_LEAD_GOAL } from "./vk-formats";

/**
 * Клиент API VK Рекламы (ads.vk.com, API v2).
 * Структура: кампания (ad_plan) → группы объявлений (ad_groups) → объявления (banners).
 * Создание: POST v2/ad_plans.json с ключом `ad_groups` (в каждой группе — `banners`), ответ {"id", "ad_groups":[{"id"}]};
 * объявление в существующую группу — POST v2/ad_groups/{id}/banners.json (документация «Quick start» и «Add banners»).
 * Деньги — в валюте кабинета (рубли), бюджет VK задаётся на день.
 * Маркировку VK Реклама делает сама для прямых рекламодателей: токен erid присваивается автоматически.
 */
const BASE = () => process.env.VK_ADS_API_URL || "https://ads.vk.com/api";
/** Минимальный дневной бюджет VK — 100 ₽ (в единицах кабинета, то есть без НДС) */
export const VK_MIN_DAILY = 100;

/**
 * НДС. Бюджет владельца — реальные деньги с НДС (как и для Директа, см. yandex.ts). Финансовые показатели кабинета
 * VK Рекламы — ставки, лимиты, остаток — указаны без НДС; расход, который VK отдаёт во внешние системы
 * (выгрузка расходов в Метрику), тоже «без учёта НДС». Документация API (объект AdPlan: budget_limit_day —
 * «Daily campaign budget») единиц не уточняет, поэтому ставка настраивается: VK_ADS_VAT (по умолчанию 0.22;
 * 0 — если на реальном кабинете окажется, что лимиты и spent уже с НДС).
 *  - дневной лимит: недельный бюджет с НДС / 7 / (1 + ставка);
 *  - расход из статистики (base.spent): × (1 + ставка), чтобы сравнивать с бюджетом владельца.
 */
export const VK_VAT = (() => {
  const v = Number(process.env.VK_ADS_VAT ?? 0.22);
  return Number.isFinite(v) && v >= 0 && v < 1 ? v : 0.22;
})();
export const vkDailyNet = (weeklyGross: number) => Math.max(VK_MIN_DAILY, Math.floor(weeklyGross / 7 / (1 + VK_VAT)));
/** Минимальный недельный бюджет VK с НДС: 100 ₽/день без НДС × 7 */
export const VK_MIN_WEEKLY_GROSS = Math.ceil(VK_MIN_DAILY * (1 + VK_VAT)) * 7;
const grossOf = (net: number) => Math.round(net * (1 + VK_VAT) * 100) / 100;

type Tokens = { accessToken: string; refreshToken: string | null };
/** Ключи API самого рекламодателя — тогда токен можно получить заново без OAuth */
export type VkCreds = { clientId: string; clientSecret: string };

/**
 * Данные бизнеса, которых нет в CampaignSpec (общий тип площадок): задаются через VkAds.useBusiness() перед
 * launchCampaign/addAd — это делает engine/regions.ts → prepareVk() (запуск) и vkAdContext() (новые объявления).
 * Ничего не задано — поведение как раньше: регион города, без расписания, без «о компании», цель — переходы.
 */
export type VkBusinessContext = {
  /** targetings.geo.local_geo (точка с радиусом); null — показ по регионам группы. С regions не совмещается (GeoTargeting) */
  localGeo?: { visit_type: "all" | "usual" | "now"; loc_type?: ("home" | "work")[]; locations: { lat: number; lng: number; radius: number; label?: string; address?: string }[] } | null;
  /** targetings.fulltime — дни/часы показа */
  fulltime?: Fulltime | null;
  /** «О компании» (about_company_115) — только юр. данные: «ИП Иванова А. А., ИНН …». Нет — блок не отправляем */
  legalInfo?: string | null;
  /** AdGroup.age_restrictions ("0+", "18+") */
  ageRestrictions?: string | null;
  /** AdPlan.priced_goal — оптимизация по цели пикселя Top@Mail.ru; null — оптимизация по переходам */
  pricedGoal?: { name: string; source_id: number } | null;
  /** Предупреждения подготовки (нет пикселя/цели, юр. данных) — уходят в LaunchResult.warnings */
  notes?: string[];
};

/**
 * Уровни повтора при 400 (запрос отклонён целиком, на площадке ничего не создано):
 * 0 — всё; 1 — без цели, «о компании», логотипа и длинного текста, кнопка visitSite; 2 — ещё и без радиуса
 * (регион города), расписания и возрастной метки.
 */
type Level = 0 | 1 | 2;

export class VkAds implements PlatformClient {
  platform = "vk" as const;
  private packagesCache?: any[];
  private formatCache = new Map<number, VkFormat>();
  private biz: VkBusinessContext = {};
  constructor(private tokens: Tokens, private onTokens?: (t: Tokens & { expiresIn: number }) => Promise<void>, private creds?: VkCreds | null) {}

  private async refresh() {
    let t: Awaited<ReturnType<typeof vkToken>> | null = null;
    if (this.tokens.refreshToken) {
      try {
        t = await vkToken({ grant_type: "refresh_token", refresh_token: this.tokens.refreshToken }, this.creds);
      } catch (e) {
        if (!this.creds) throw e;
      }
    }
    // Свои ключи API: просто получаем новый токен
    if (!t && this.creds) t = await vkToken({ grant_type: "client_credentials" }, this.creds);
    if (!t) throw new PlatformError("vk", "Доступ к VK Рекламе истёк — подключите кабинет заново");
    this.tokens = { accessToken: t.accessToken, refreshToken: t.refreshToken ?? this.tokens.refreshToken };
    await this.onTokens?.({ ...this.tokens, expiresIn: t.expiresIn });
  }

  async req<T = any>(method: "GET" | "POST" | "DELETE", path: string, opts: { query?: Record<string, string | number | undefined>; body?: unknown; form?: FormData } = {}, attempt = 0): Promise<T> {
    const url = new URL(`${BASE()}/${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { Authorization: `Bearer ${this.tokens.accessToken}` };
    let body: BodyInit | undefined;
    if (opts.form) body = opts.form;
    else if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    const res = await fetch(url, { method, headers, body });
    if (res.status === 401 && attempt === 0) {
      await this.refresh();
      return this.req(method, path, opts, 1);
    }
    if (res.status === 429 && attempt < 3) {
      await sleep(1000 * (attempt + 1) * 2);
      return this.req(method, path, opts, attempt + 1);
    }
    if (res.status === 204) return {} as T;
    const text = await res.text();
    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new PlatformError("vk", `VK Реклама ответила не JSON (${res.status})`, text.slice(0, 300));
    }
    if (!res.ok || json.error) {
      const e = json.error ?? json;
      const fields = e.fields ? ` — поля: ${JSON.stringify(e.fields).slice(0, 400)}` : "";
      const err = new PlatformError("vk", `VK Реклама: ${e.message || e.code || res.status}${fields}`, json);
      err.httpStatus = res.status;
      throw err;
    }
    return json as T;
  }

  /** Данные бизнеса для таргетингов и баннеров (см. VkBusinessContext) */
  useBusiness(ctx: VkBusinessContext) {
    this.biz = { ...this.biz, ...ctx };
    return this;
  }

  async user() {
    return this.req("GET", "v2/user.json");
  }

  /** Весь список постранично (VK отдаёт не больше 50 за раз) */
  private async listAll(path: string, query: Record<string, string | number | undefined> = {}, maxPages = 20): Promise<any[]> {
    const out: any[] = [];
    for (let p = 0; p < maxPages; p++) {
      const j = await this.req("GET", path, { query: { ...query, limit: VK_PAGE, offset: p * VK_PAGE } });
      const items: any[] = j?.items ?? [];
      out.push(...items);
      if (items.length < VK_PAGE || (typeof j?.count === "number" && out.length >= j.count)) break;
    }
    return out;
  }

  private async packages(): Promise<any[]> {
    if (this.packagesCache) return this.packagesCache;
    this.packagesCache = await this.listAll("v2/packages.json");
    return this.packagesCache!;
  }

  /**
   * Пакеты-кандидаты под «трафик на сайт», лучшие первыми. VK не говорит заранее, какой пакет подойдёт плану
   * (ответ «invalid_package» приходит только при создании), поэтому при отказе пробуем следующий.
   */
  async trafficPackageCandidates(): Promise<number[]> {
    if (process.env.VK_ADS_PACKAGE_ID) return [Number(process.env.VK_ADS_PACKAGE_ID)];
    const list = await this.packages();
    const active = list.filter((p) => !p.status || p.status === "active");
    const obj = (p: any) => JSON.stringify(p.objective ?? p.objectives ?? "");
    const score = (p: any) =>
      (obj(p).includes("traffic") ? 0 : obj(p).includes("site") ? 1 : 3) +
      (/универс|multi|мульти/i.test(p.name ?? "") ? 0 : 0.5) +
      (/сайт|site|трафик|traffic/i.test(p.name ?? "") ? 0 : 0.3) +
      (/приложен|app|игр|видео|video|лид.?форм|lead|сообществ|community|каталог|catalog|магазин|shop|музык/i.test(`${p.name ?? ""} ${obj(p)}`) ? 2 : 0);
    return [...active].sort((a, b) => score(a) - score(b)).map((p) => Number(p.id)).filter(Boolean).slice(0, 8);
  }

  /** Пакет (формат размещения) под цель «трафик на сайт». Можно переопределить через VK_ADS_PACKAGE_ID. */
  async trafficPackageId(): Promise<number> {
    if (process.env.VK_ADS_PACKAGE_ID) return Number(process.env.VK_ADS_PACKAGE_ID);
    const list = await this.packages();
    const active = list.filter((p) => !p.status || p.status === "active");
    const byObjective = active.filter((p) => JSON.stringify(p.objective ?? p.objectives ?? "").includes("traffic"));
    const pick =
      byObjective.find((p) => /универс|multi|мульти/i.test(p.name ?? "")) ??
      byObjective[0] ??
      active.find((p) => /сайт|site|трафик/i.test(p.name ?? "")) ??
      active[0];
    if (!pick) throw new PlatformError("vk", "Не нашли подходящий формат размещения (пакет) в кабинете VK");
    return Number(pick.id);
  }

  /**
   * Формат баннера пакета: Package.banner_format_id → BannerFormat (https://ads.vk.ru/en/doc/api/object/Package).
   * Ресурс форматов в документации не открылся при сверке, поэтому пробуем v2/banner_formats/{id}.json и список
   * v2/banner_formats.json; не вышло — defaultFormat() (ключи из примеров документации). Отключить: VK_ADS_FORMAT_LOOKUP=0.
   */
  async packageFormat(packageId: number): Promise<VkFormat> {
    const hit = this.formatCache.get(packageId);
    if (hit) return hit;
    let f: VkFormat = defaultFormat();
    if (process.env.VK_ADS_FORMAT_LOOKUP !== "0") {
      try {
        const pkg = (await this.packages()).find((p) => Number(p.id) === packageId);
        const fid = Number(pkg?.banner_format_id);
        if (fid) {
          let raw: any = await this.req("GET", `v2/banner_formats/${fid}.json`).catch(() => null);
          if (!raw) {
            const list = await this.listAll("v2/banner_formats.json").catch(() => [] as any[]);
            raw = list.find((x: any) => Number(x.id) === fid) ?? null;
          }
          const parsed = raw ? parseBannerFormat(raw) : null;
          if (parsed?.known) f = parsed;
        }
      } catch {
        /* формат по умолчанию */
      }
    }
    this.formatCache.set(packageId, f);
    return f;
  }

  /** Пакет существующей группы (для объявлений, которые робот добавляет позже) */
  private async groupPackageId(groupExt: string): Promise<number> {
    const g = await this.req("GET", `v2/ad_groups/${groupExt}.json`, { query: { fields: "id,package_id" } }).catch(() => null);
    return Number(g?.package_id) || this.trafficPackageId();
  }

  // ─── Пиксель Top@Mail.ru и цель ─────────────────────────────────────────

  /**
   * Пиксель (счётчик Top@Mail.ru) в источниках данных кабинета — https://ads.vk.ru/en/doc/api/resource/RemarketingCounters
   *  1) known — ранее сохранённый ID: проверяем, что он есть в этом кабинете (GET ?_counter_id=);
   *  2) ищем по домену страницы и имени (в имени — наш ключ, чтобы не взять пиксель другого бизнеса на том же домене);
   *  3) создаём: POST remarketing/counters.json {name, url}. В документации пример создания ещё с email/password
   *     владельца Top@Mail.ru — их у нас нет; пробуем без них (VK_ADS_CREATE_PIXEL=0 — не пытаться). Не вышло — null.
   */
  async ensurePixel(o: { name: string; url: string; tag: string; known?: number | null; email?: string | null }): Promise<{ counterId: number | null; note?: string }> {
    const items = async (query: Record<string, string>) => (await this.listAll("v2/remarketing/counters.json", query, 10)) as any[];
    const ok = (c: any) => c && c.status !== "deleted" && c.system_status !== "blocked";
    try {
      if (o.known) {
        const c = (await items({ _counter_id: String(o.known) }))[0];
        if (ok(c)) return { counterId: Number(c.counter_id) };
      }
      const domain = new URL(o.url).hostname;
      const byDomain = (await items({ _domain: domain })).filter(ok);
      // Наш (с меткой) — первым; иначе любой пиксель кабинета на этот же домен (его мог создать сам владелец)
      const mine = byDomain.find((c) => String(c.name ?? "").includes(o.tag)) ?? byDomain[0];
      if (mine) return { counterId: Number(mine.counter_id) };
    } catch (e) {
      return { counterId: null, note: `не смогли прочитать пиксели кабинета (${(e as Error).message})` };
    }
    if (process.env.VK_ADS_CREATE_PIXEL === "0") return { counterId: null, note: "создание пикселя отключено (VK_ADS_CREATE_PIXEL=0)" };
    const manual = `создайте его в кабинете VK Рекламы: «Сайты» → «Добавить сайт», адрес ${o.url}`;
    try {
      // Пиксель в VK — счётчик Top@Mail.ru: VK требует email владельца и пароль к счётчику. Пароль генерируем сами
      // (входить по нему не нужно — пиксель виден в кабинете VK Рекламы), email — только с согласия владельца
      const password = o.email ? Array.from(crypto.getRandomValues(new Uint8Array(18)), (x) => "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"[x % 55]).join("") + "7a" : undefined;
      const c = await this.req("POST", "v2/remarketing/counters.json", { body: { name: `${o.name.slice(0, 60)} ${o.tag}`, url: o.url, ...(o.email ? { email: o.email, password } : {}) } });
      const id = Number(c.counter_id);
      return id ? { counterId: id } : { counterId: null, note: `VK не вернул номер пикселя — ${manual}` };
    } catch (e) {
      // Через API VK создаёт пиксель только с логином Top@Mail.ru — такого доступа у нас нет
      const needsLogin = /email|password/.test((e as Error).message);
      return { counterId: null, note: needsLogin ? `через API VK пиксель не создаёт — ${manual}` : `VK не создал пиксель (${(e as Error).message}) — ${manual}` };
    }
  }

  /**
   * Цель «заявка» пикселя для AdPlan.priced_goal {name, source_id} (https://ads.vk.ru/en/doc/api/object/PricedGoal:
   * name — «goal identifier», source_id — «counter ID of Top@Mail.ru»). Список целей — GET v2/goals.json → topmailru[]
   * {counter_id, goal, description} (https://ads.vk.ru/en/doc/api/resource/Goals). Создать событие через API нельзя
   * (не документировано) — его создают в кабинете: Пиксели → Настройки → События → JS-событие с ID `lead`.
   */
  async leadGoal(counterId: number, goal = "lead"): Promise<{ name: string; source_id: number } | null> {
    const j = await this.req("GET", "v2/goals.json").catch(() => null);
    const list: any[] = (j?.topmailru ?? []).filter((g: any) => Number(g.counter_id) === counterId);
    const want = goal.toLowerCase();
    const hit =
      list.find((g) => String(g.goal ?? "").toLowerCase() === want) ??
      list.find((g) => String(g.goal ?? "").toLowerCase().endsWith(`:${want}`)) ??
      list.find((g) => /заявк|запис|lead|form|submit|контакт/i.test(`${g.goal ?? ""} ${g.description ?? ""}`));
    return hit?.goal ? { name: String(hit.goal), source_id: counterId } : null;
  }

  /**
   * Сегмент ретаргетинга «были на сайте, но не оставили заявку» — POST v2/remarketing/segments.json
   * (https://ads.vk.ru/en/doc/api/resource/Segments): связь remarketing_counter с пикселем (goal_id "uss" — все посетители
   * сайта по счётчику Top@Mail.ru, как в примере документации), type positive, за последние N дней (left — сколько дней
   * назад начало окна, right — конец), и, если есть событие «заявка», та же связь с type negative.
   * pass_condition — сколько связей должно выполниться: все. Сегмент с тем же именем используем повторно.
   */
  async ensureAudience(a: AudienceSpec): Promise<string> {
    if (!a.pixelId) throw new PlatformError("vk", "Ретаргетинг: нет пикселя VK на сайте");
    const name = a.name.slice(0, 200);
    const list = await this.req("GET", "v2/remarketing/segments.json", { query: { limit: VK_PAGE, _name: name } }).catch(() => null);
    const found = ((list?.items ?? []) as any[]).find((x) => x.name === name);
    if (found) return String(found.id);
    const left = Math.max(1, Math.min(365, a.days));
    const relations: Record<string, unknown>[] = [
      { object_type: "remarketing_counter", params: { source_id: a.pixelId, goal_id: "uss", type: "positive", left, right: 0 } },
    ];
    if (a.leadGoal) relations.push({ object_type: "remarketing_counter", params: { source_id: a.pixelId, goal_id: a.leadGoal, type: "negative", left, right: 0 } });
    try {
      const j = await this.req("POST", "v2/remarketing/segments.json", { body: { name, pass_condition: relations.length, relations } });
      return String(j.id);
    } catch (e) {
      // Событие «заявка» не создано в пикселе — сегмент без исключения, только посетители
      if (relations.length < 2 || !VkAds.isValidation(e)) throw e;
      const j = await this.req("POST", "v2/remarketing/segments.json", { body: { name, pass_condition: 1, relations: relations.slice(0, 1) } });
      return String(j.id);
    }
  }

  private segmentCache = new Map<string, string | null>();
  /**
   * Аудитория «вводили поисковые запросы»: список фраз (v3/search_phrases, https://ads.vk.ru/en/doc/api/info/SearchPhrases)
   * и сегмент на его основе (remarketing_search_phrases, за последние 30 дней). Один и тот же список переиспользуем по имени.
   */
  async ensureSearchSegment(name: string, phrases: string[]): Promise<string> {
    const key = `sp:${name}`;
    const hit = this.segmentCache.get(key);
    if (hit) return hit;
    const listName = name.slice(0, 200);
    const lists = await this.req("GET", "v3/search_phrases.json").catch(() => null);
    let listId: number | null = Number(((lists?.items ?? lists ?? []) as any[]).find?.((x: any) => x?.name === listName)?.id) || null;
    if (!listId) {
      const j = await this.req("POST", "v3/search_phrases.json", { query: { name: listName }, body: { phrases: phrases.slice(0, 1000), expires: "30d" } });
      listId = Number(j?.id) || null;
    }
    if (!listId) throw new PlatformError("vk", "VK не создал список поисковых фраз");
    const segName = `${listName} — сегмент`.slice(0, 200);
    const seg = await this.req("GET", "v2/remarketing/segments.json", { query: { limit: VK_PAGE, _name: segName } }).catch(() => null);
    const found = ((seg?.items ?? []) as any[]).find((x) => x.name === segName);
    const id = found
      ? String(found.id)
      : String((await this.req("POST", "v2/remarketing/segments.json", { body: { name: segName, pass_condition: 1, relations: [{ object_type: "remarketing_search_phrases", params: { source_id: listId, type: "positive", left: 30, right: 0 } }] } })).id);
    this.segmentCache.set(key, id);
    return id;
  }

  private interestTree?: { id: number; name: string }[];
  /** ID интересов по названиям категорий (дерево интересов кабинета, ищем по вхождению названия) */
  async interestIds(names: string[]): Promise<number[]> {
    if (!this.interestTree) {
      const j = await this.req("GET", "v2/targetings_tree.json", { query: { targetings: "interests" } }).catch(() => null);
      const flat: { id: number; name: string }[] = [];
      const walk = (x: any) => {
        if (Array.isArray(x)) return x.forEach(walk);
        if (x && typeof x === "object") {
          if (typeof x.id === "number" && typeof x.name === "string") flat.push({ id: x.id, name: x.name });
          for (const v of Object.values(x)) if (v && typeof v === "object") walk(v);
        }
      };
      walk(j?.interests ?? j);
      this.interestTree = flat;
    }
    const want = names.map((n) => n.toLowerCase());
    const ids = this.interestTree.filter((x) => want.some((w) => x.name.toLowerCase() === w || x.name.toLowerCase().startsWith(w))).map((x) => x.id);
    return [...new Set(ids)].slice(0, 20);
  }

  async createUrl(href: string): Promise<number> {
    const j = await this.req("POST", "v2/urls.json", { body: { url: href } });
    return Number(j.id);
  }

  private imageCache = new Map<string, number>();

  private onImageUploaded?: LaunchHooks["onImageUploaded"];

  async uploadImage(img: NonNullable<AdSpec["image"]>): Promise<number> {
    if (img.cachedRef) return Number(img.cachedRef);
    const hit = this.imageCache.get(img.imageId);
    if (hit) return hit;
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(img.data)], { type: img.mime }), `pz-${img.imageId}.${img.mime.includes("png") ? "png" : "jpg"}`);
    form.append("data", JSON.stringify({ width: img.width, height: img.height }));
    const j = await this.req("POST", "v2/content/static.json", { form });
    this.imageCache.set(img.imageId, Number(j.id));
    await this.onImageUploaded?.(img.imageId, String(j.id)).catch(() => undefined);
    return Number(j.id);
  }

  /**
   * Баннер под формат пакета: ключи textblocks/content берём из формата (vk-formats.ts), а не вслепую.
   * level ≥ 1 — без необязательного («о компании», логотип, длинный текст), кнопка visitSite.
   */
  private async banner(ad: AdSpec, urlId: number, packageId: number, level: Level = 0, warn?: (s: string) => void) {
    if (!ad.title.trim() || !ad.text.trim()) throw new PlatformError("vk", "У объявления пустой заголовок или текст");
    const f = await this.packageFormat(packageId);
    const def = textKeys(defaultFormat());
    const k = textKeys(f);
    const title = k.title ?? def.title!;
    const short = k.short ?? def.short!;
    const x = ad.extras;
    const textblocks: Record<string, { text: string; title?: string }> = {
      [title.key]: { text: fit(ad.title, title.maxLength) },
      [short.key]: { text: fit(ad.text, short.maxLength) },
    };
    const cta = k.cta ?? (f.known ? undefined : def.cta);
    if (cta) textblocks[cta.key] = { text: ctaValue(cta, level > 0) };
    if (level === 0) {
      const long = k.long ?? (f.known ? undefined : def.long);
      const longText = x?.longText || [ad.text, ad.title2].filter(Boolean).join(". ");
      if (long && longText) textblocks[long.key] = { text: fit(longText, long.maxLength) };
      // «О компании» — только юр. данные (справка по форматам). Нет их — блок не отправляем
      const about = legalAbout(this.biz.legalInfo) ?? legalAbout(x?.about);
      const aboutRole = k.about ?? (f.known ? undefined : def.about);
      if (about && aboutRole) textblocks[aboutRole.key] = { text: fit(about, aboutRole.maxLength) };
    }
    const content: Record<string, { id: number }> = {};
    let imageRef: string | undefined;
    if (ad.image) {
      let key = imageKeyFor(f, ad.image.width, ad.image.height);
      if (!key) {
        key = imageKeyFor(defaultFormat(), ad.image.width, ad.image.height) ?? "image_600x600";
        warn?.(`Формат VK не описывает слот для картинки ${ad.image.width}×${ad.image.height} — отправили в ${key}`);
      }
      const id = await this.uploadImage(ad.image);
      content[key] = { id };
      imageRef = String(id);
    }
    const icon = iconKey(f) ?? (f.known ? null : "icon_256x256");
    if (level === 0 && ad.logo && icon) {
      try {
        content[icon] = { id: await this.uploadImage(ad.logo) };
      } catch {
        /* без логотипа */
      }
    }
    return { banner: { name: ad.title.slice(0, 60), urls: { primary: { id: urlId } }, textblocks, content }, imageRef };
  }

  private age(from?: number, to?: number) {
    const a = Math.max(12, from ?? 18), b = Math.min(75, to ?? 60);
    const list: number[] = [];
    for (let i = a; i <= b; i++) list.push(i);
    return list;
  }

  /** Ошибка валидации (400 с перечнем полей): запрос отклонён целиком, на площадке ничего не создано */
  private static isValidation(e: unknown) {
    return e instanceof PlatformError && e.httpStatus === 400;
  }

  /** Имя плана на площадке: с меткой запуска, чтобы по имени находить только свой план (а не план прошлого запуска) */
  static planName(spec: Pick<CampaignSpec, "name" | "tag">) {
    const tag = spec.tag ? ` #${spec.tag}` : "";
    return spec.name.slice(0, 120 - tag.length) + tag;
  }

  async findCampaignByName(name: string) {
    return this.findPlanByName(name);
  }

  /** Наш план по точному имени (кроме удалённых) — проверка перед созданием и повтором, чтобы не создать дубль */
  private async findPlanByName(name: string): Promise<string | null> {
    // Список отдаётся страницами максимум по 50 (VK_PAGE) — больше VK отвечает «Value is more than maximum allowed»
    for (let offset = 0; offset < 5000; offset += VK_PAGE) {
      const j = await this.req("GET", "v2/ad_plans.json", { query: { fields: "id,name,status", limit: VK_PAGE, offset } });
      const items: any[] = j.items ?? [];
      const hit = items.filter((p) => p.name === name && p.status !== "deleted").sort((p, q) => Number(q.id) - Number(p.id))[0];
      if (hit) return String(hit.id);
      if (items.length < VK_PAGE) break;
    }
    return null;
  }

  /**
   * План создаётся заблокированным (status "blocked" — допустимое значение AdPlan.status наряду с active/deleted):
   * показы включает activateCampaign в конце успешного запуска, поэтому прерванный запуск не тратит деньги.
   * Перед созданием ищем план по имени с меткой запуска: если прошлая попытка создала его, но ответ потерялся
   * (или функцию убили до сохранения ID), используем его вместо второго.
   */
  async launchCampaign(spec: CampaignSpec, hooks?: LaunchHooks): Promise<LaunchResult> {
    const warnings: string[] = [];
    this.onImageUploaded = hooks?.onImageUploaded;
    const name = VkAds.planName(spec);
    let planId: string | null = spec.resume?.campaignExt ?? (await this.findPlanByName(name));
    let groupIdsFromResponse: string[] = [];
    const imageRefs: Record<string, string | undefined> = {};

    if (!planId) {
      const urlId = await this.createUrl(spec.siteUrl);
      const candidates = await this.trafficPackageCandidates();
      if (!candidates.length) throw new PlatformError("vk", "Не нашли подходящий формат размещения (пакет) в кабинете VK");
      let packageId = candidates[0];
      const daily = vkDailyNet(spec.weeklyBudget);

      const biz = this.biz;
      warnings.push(...(biz.notes ?? []));
      if (!biz.pricedGoal && !biz.notes?.length) warnings.push("VK: цель «заявка» не настроена — кампания оптимизируется по переходам на сайт");

      const buildGroups = async (level: Level) => {
        const groups = [];
        for (const g of spec.groups) {
          const banners = [];
          for (const ad of g.ads) {
            try {
              const b = await this.banner(ad, urlId, packageId, level, level === 0 ? (w) => warnings.push(w) : undefined);
              imageRefs[ad.localId] = b.imageRef;
              banners.push(b.banner);
            } catch (e) {
              if (level === 0) warnings.push(`Объявление «${ad.title}»: ${(e as Error).message}`);
            }
          }
          // geo: либо точка с радиусом, либо регионы — вместе нельзя (GeoTargeting).
          // Ретаргетинг: аудитория — сегмент посетителей сайта (targetings.segments), радиус не нужен — показываем в городе
          const geo = level < 2 && !g.retargetingId && biz.localGeo?.locations.length ? { local_geo: biz.localGeo } : { regions: g.regionIds.length ? g.regionIds : [188] };
          const targetings: Record<string, unknown> = { geo, age: { age_list: this.age(g.ageFrom, g.ageTo) } };
          if (g.retargetingId) targetings.segments = [Number(g.retargetingId)];
          // Аудитории для A/B: кто искал услугу (сегмент поисковых фраз) и интересы. Не получилось — группа идёт на всех рядом
          if (level < 2 && !g.retargetingId && g.searchPhrases?.length) {
            try {
              targetings.segments = [Number(await this.ensureSearchSegment(`${spec.name} · ${g.name}`, g.searchPhrases))];
            } catch (e) {
              if (level === 0) warnings.push(`Аудитория «${g.name}»: VK не принял список поисковых фраз (${(e as Error).message}) — группа показывается всем рядом`);
            }
          }
          if (level < 2 && !g.retargetingId && g.interests?.length) {
            const ids = await this.interestIds(g.interests).catch(() => [] as number[]);
            if (ids.length) targetings.interests = ids;
            else if (level === 0) warnings.push(`Аудитория «${g.name}»: не нашли интересы «${g.interests.join(", ")}» в кабинете VK — группа показывается всем рядом`);
          }
          if (g.sex && g.sex !== "any") targetings.sex = [g.sex];
          if (level < 2 && biz.fulltime) targetings.fulltime = biz.fulltime;
          const group: Record<string, unknown> = { name: g.name.slice(0, 120), package_id: packageId, targetings, budget_limit_day: daily, date_start: spec.startDate, banners };
          if (level < 2 && biz.ageRestrictions) group.age_restrictions = biz.ageRestrictions;
          // При бюджете на уровне кампании бюджет и дата старта групп должны ему соответствовать
          groups.push(group);
        }
        return groups;
      };
      // Цель плана: обычно «traffic», но часть пакетов принимает только «site_conversions» — VK сам говорит, какую
      let objective = "traffic";
      const planBody = (ad_groups: unknown[], level: Level) => ({
        name, status: "blocked", objective, autobidding_mode: "max_goals",
        budget_limit_day: daily, date_start: spec.startDate, ad_object_type: "url", ad_object_id: urlId,
        // Оптимизация по цели пикселя (PricedGoal). Цель пакета остаётся traffic: в списке Package.objective отдельной
        // «конверсии на сайте» нет (https://ads.vk.ru/en/doc/api/object/Package)
        // «Конверсии на сайте» без цели VK не принимает — цель оставляем на всех уровнях упрощения
        ...((level === 0 || objective === "site_conversions") && biz.pricedGoal ? { priced_goal: biz.pricedGoal } : {}),
        ad_groups,
      });
      const create = async (level: Level) => {
        const plan = await this.req("POST", "v2/ad_plans.json", { body: planBody(await buildGroups(level), level) });
        planId = String(plan.id);
        groupIdsFromResponse = (plan.ad_groups ?? []).map((g: any) => String(g.id));
      };

      let lastErr: unknown = null;
      const errs: string[] = [];
      const badPackage = (e: unknown) => /invalid_package/.test(String((e as Error)?.message ?? e));
      const allowedObjective = (e: unknown) => {
        const m = String((e as Error)?.message ?? e).match(/"allowed_values":\["([a-z_]+)"[^\]]*\],"objective"|"objective":\{[^}]*"allowed_values":\["([a-z_]+)"/);
        return m ? m[1] || m[2] : null;
      };
      packages: for (const pkg of candidates) {
      packageId = pkg;
      lastErr = null;
      for (let li = 0, levels = [0, 1, 2] as Level[]; li < levels.length; li++) {
        const level = levels[li];
        try {
          await create(level);
          if (level >= 1) warnings.push(`VK не принял часть настроек (${(lastErr as Error).message}) — кампания создана без цели, «о компании», логотипа и длинного текста`);
          if (level === 2) warnings.push("…а также без радиуса вокруг адреса, расписания и возрастной метки — показ на город");
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          errs.push(`пакет ${packageId}, уровень ${level}, цель ${objective}: ${(e as Error).message}`);
          // Ответ мог потеряться, хотя план создан (таймаут, 5xx) — сначала ищем его по имени
          planId = await this.findPlanByName(name).catch(() => null);
          if (planId) {
            warnings.push("VK ответил с ошибкой, но кампания создалась — используем её");
            lastErr = null;
            break;
          }
          if (!VkAds.isValidation(e)) throw e;
          // Пакет принимает другую цель плана — повторяем с ней на том же уровне
          const obj = allowedObjective(e);
          if (obj && obj !== objective) {
            objective = obj;
            li--;
            continue;
          }
          // Пакет не подошёл плану — уровни упрощения не помогут, берём следующий пакет
          if (badPackage(e)) continue packages;
        }
      }
      break;
      }
      if (lastErr && /priced_goal/.test(String((lastErr as Error).message)) && /required/.test(String((lastErr as Error).message))) {
        if (biz.pricedGoal) throw new PlatformError("vk", `VK не принял кампанию «Конверсии на сайте» с целью «${biz.pricedGoal.name}» пикселя ${biz.pricedGoal.source_id}. Ответы VK: ${errs.slice(0, 3).join(" | ")}`);
        throw new PlatformError("vk", `Ваш кабинет VK принимает только кампании «Конверсии на сайте», а им нужен пиксель с событием «Заявка». Нажмите «Настроить VK за меня» в блоке VK Рекламы выше (или в «Настройках» → «Рекламные кабинеты») — пиксель создадим сами; затем добавьте в пикселе событие «Заявка» по подсказке и нажмите «Продолжить запуск».`);
      }
      if (lastErr) throw badPackage(lastErr) ? new PlatformError("vk", `Ни один формат размещения кабинета не подошёл для рекламы сайта (проверили ${candidates.length}). Укажите пакет в переменной VK_ADS_PACKAGE_ID или напишите нам.`) : lastErr;
      if (!planId) throw new PlatformError("vk", "VK не создал кампанию");
    }
    await hooks?.onCampaignCreated?.(planId);

    let groupItems: { id: string; name: string }[] = [];
    if (groupIdsFromResponse.length !== spec.groups.length) {
      const groupsRes = await this.req("GET", "v2/ad_groups.json", { query: { _ad_plan_id: planId, fields: "id,name", limit: VK_PAGE } });
      groupItems = (groupsRes.items ?? []).map((x: any) => ({ id: String(x.id), name: String(x.name) }));
    }
    const out: LaunchResult = { campaignExt: planId, groups: [], warnings, complete: true };
    for (const [gi, g] of spec.groups.entries()) {
      const groupExt = groupIdsFromResponse[gi] ?? (groupItems.find((x) => x.name === g.name.slice(0, 120)) ?? groupItems[gi])?.id ?? "";
      let bannerItems: any[] = [];
      const used = new Set<string>();
      if (groupExt) {
        const br = await this.req("GET", "v2/banners.json", { query: { _ad_group_id: groupExt, fields: "id,name", limit: VK_PAGE } });
        bannerItems = br.items ?? [];
      }
      out.groups.push({
        localId: g.localId,
        groupExt,
        ads: g.ads.map((ad, i) => {
          // По имени среди ещё не сопоставленных (у двух объявлений группы заголовок может совпадать), иначе по порядку
          const free = bannerItems.filter((x) => !used.has(String(x.id)));
          const b = free.find((x) => x.name === ad.title.slice(0, 60)) ?? (bannerItems[i] && !used.has(String(bannerItems[i].id)) ? bannerItems[i] : free[0]);
          if (b) used.add(String(b.id));
          return { localId: ad.localId, adExt: b ? String(b.id) : null, imageRef: imageRefs[ad.localId], error: b ? undefined : "VK не вернул объявление" };
        }),
      });
      await hooks?.onGroupCreated?.(g.localId, groupExt);
      await hooks?.onAdsCreated?.(g.localId, groupExt, out.groups[out.groups.length - 1].ads);
    }
    return out;
  }

  /** Разблокировать план после успешного запуска */
  async activateCampaign(campaignExt: string) {
    await this.setCampaignActive(campaignExt, true);
  }

  async removeCampaign(campaignExt: string) {
    await this.req("POST", `v2/ad_plans/${campaignExt}.json`, { body: { status: "deleted" } });
  }

  async addAd(_campaignExt: string, groupExt: string, ad: AdSpec, _ctx: { channel: Channel }) {
    const urlId = await this.createUrl(ad.href);
    const packageId = await this.groupPackageId(groupExt);
    const path = `v2/ad_groups/${groupExt}/banners.json`;
    let b = await this.banner(ad, urlId, packageId, 0);
    let j;
    try {
      j = await this.req("POST", path, { body: b.banner });
    } catch (e) {
      // Повтор без необязательных блоков — только если VK отклонил запрос валидацией (значит, баннер не создан)
      if (!VkAds.isValidation(e)) throw e;
      b = await this.banner(ad, urlId, packageId, 1);
      j = await this.req("POST", path, { body: b.banner });
    }
    return { adExt: String(j.id), imageRef: b.imageRef };
  }

  async setCampaignActive(campaignExt: string, active: boolean) {
    await this.req("POST", `v2/ad_plans/${campaignExt}.json`, { body: { status: active ? "active" : "blocked" } });
  }

  async setAdsActive(adExts: string[], active: boolean) {
    for (const id of adExts) await this.req("POST", `v2/banners/${id}.json`, { body: { status: active ? "active" : "blocked" } });
  }

  async setBudget(campaignExt: string, p: { channel: Channel; weeklyBudget: number; strategy: Strategy }) {
    await this.req("POST", `v2/ad_plans/${campaignExt}.json`, { body: { budget_limit_day: vkDailyNet(p.weeklyBudget) } });
  }

  /**
   * Регион, возраст, пол и время у идущих групп: читаем текущие таргетинги (там могут быть сегменты, интересы)
   * и меняем только geo / age / sex / fulltime. Контекст бизнеса (радиус, расписание) — из useBusiness().
   */
  async updateTargeting(_campaignExt: string, t: TargetingUpdate): Promise<string[]> {
    const warnings: string[] = [];
    const biz = this.biz;
    for (const g of t.groups) {
      try {
        const cur = await this.req("GET", `v2/ad_groups/${g.groupExt}.json`, { query: { fields: "id,targetings" } }).catch(() => null);
        const targetings: Record<string, unknown> = { ...((cur?.targetings ?? {}) as Record<string, unknown>) };
        targetings.geo = !g.retargetingId && biz.localGeo?.locations.length ? { local_geo: biz.localGeo } : { regions: g.regionIds.length ? g.regionIds : [188] };
        targetings.age = { ...((targetings.age as object) ?? {}), age_list: this.age(g.ageFrom, g.ageTo) };
        if (g.sex && g.sex !== "any") targetings.sex = [g.sex];
        else delete targetings.sex;
        if (biz.fulltime) targetings.fulltime = biz.fulltime;
        else delete targetings.fulltime;
        await this.req("POST", `v2/ad_groups/${g.groupExt}.json`, { body: { targetings } });
      } catch (e) {
        warnings.push(`Группа ${g.groupExt}: ${(e as Error).message}`);
      }
    }
    return warnings;
  }

  async setNegativeKeywords() {
    // У VK Рекламы нет минус-слов: аудитория задаётся интересами и демографией
  }

  /** Секция textblocks при обновлении заменяется целиком — поэтому берём текущие блоки и меняем только тексты */
  /** Новая ссылка объявлений: создаём URL в VK и подменяем urls.primary у баннеров */
  async updateAdsHref(adExts: string[], href: string): Promise<string[]> {
    const warnings: string[] = [];
    let urlId: number;
    try {
      urlId = await this.createUrl(href);
    } catch (e) {
      return [`VK не принял ссылку: ${(e as Error).message}`];
    }
    for (const id of adExts) {
      try {
        await this.req("POST", `v2/banners/${id}.json`, { body: { urls: { primary: { id: urlId } } } });
      } catch (e) {
        warnings.push(`Объявление ${id}: ${(e as Error).message}`);
      }
    }
    return warnings;
  }

  async updateAdText(adExt: string, t: { title: string; title2?: string | null; text: string }) {
    if (!t.title.trim() || !t.text.trim()) throw new PlatformError("vk", "У объявления пустой заголовок или текст");
    // Без текущих блоков не обновляем: POST заменил бы textblocks целиком и стёр «о компании», кнопку и длинный текст
    const cur = await this.req("GET", `v2/banners/${adExt}.json`, { query: { fields: "id,textblocks" } });
    if (!cur?.textblocks) throw new PlatformError("vk", "VK не отдал текущие тексты объявления — обновление отложено");
    const textblocks: Record<string, any> = { ...(cur.textblocks ?? {}) };
    const keys = Object.keys(textblocks);
    const len = (k: string) => Number(k.match(/_(\d+)/)?.[1]) || undefined;
    const titleKey = keys.find((k) => /^title_\d+/.test(k)) ?? "title_40_vkads";
    const shortKey = keys.find((k) => /^text_\d{2}$/.test(k)) ?? "text_90";
    textblocks[titleKey] = { ...(textblocks[titleKey] ?? {}), text: fit(t.title, len(titleKey)) };
    textblocks[shortKey] = { ...(textblocks[shortKey] ?? {}), text: fit(t.text, len(shortKey)) };
    // Длинный текст — только если он уже есть в объявлении (ключ зависит от формата пакета)
    for (const k of keys.filter((k) => /^text_\d{3,}$/.test(k))) textblocks[k] = { ...textblocks[k], text: fit([t.text, t.title2].filter(Boolean).join(". "), len(k)) };
    await this.req("POST", `v2/banners/${adExt}.json`, { body: { textblocks } });
  }

  async getAdStates(adExts: string[]): Promise<Record<string, AdState>> {
    const out: Record<string, AdState> = {};
    for (let i = 0; i < adExts.length; i += VK_PAGE) {
      const ids = adExts.slice(i, i + VK_PAGE);
      const j = await this.req("GET", "v2/banners.json", { query: { _id__in: ids.join(","), fields: "id,status,moderation_status,moderation_reasons", limit: VK_PAGE } });
      for (const b of j.items ?? []) {
        let status: AdState["status"] = "moderation";
        if (b.status === "deleted") status = "archived";
        else if (b.moderation_status === "banned") status = "rejected";
        else if (b.moderation_status === "pending") status = "moderation";
        else if (b.status === "active") status = "active";
        else status = "paused";
        const reasons = Array.isArray(b.moderation_reasons) ? b.moderation_reasons.map((r: any) => r.title || r.name || r).join("; ") : undefined;
        out[String(b.id)] = { status, note: reasons || undefined };
      }
    }
    return out;
  }

  async getStats(campaignExts: string[], from: string, to: string): Promise<StatRow[]> {
    if (!campaignExts.length) return [];
    // Объявления наших кампаний → статистика по дням
    const banners: { id: string; plan: string }[] = [];
    for (const plan of campaignExts) {
      const groups = await this.req("GET", "v2/ad_groups.json", { query: { _ad_plan_id: plan, fields: "id", limit: VK_PAGE } });
      for (const g of groups.items ?? []) {
        const br = await this.req("GET", "v2/banners.json", { query: { _ad_group_id: g.id, fields: "id", limit: VK_PAGE } });
        for (const b of br.items ?? []) banners.push({ id: String(b.id), plan });
      }
    }
    if (!banners.length) return [];
    const planOf = new Map(banners.map((b) => [b.id, b.plan]));
    const out: StatRow[] = [];
    for (let i = 0; i < banners.length; i += 100) {
      const ids = banners.slice(i, i + 100).map((b) => b.id);
      const j = await this.req("GET", "v2/statistics/banners/day.json", { query: { id: ids.join(","), date_from: from, date_to: to, metrics: "base" } });
      for (const item of j.items ?? []) {
        for (const row of item.rows ?? []) {
          const base = row.base ?? {};
          out.push({
            campaignExt: planOf.get(String(item.id)) ?? "",
            adExt: String(item.id),
            day: row.date,
            impressions: Number(base.shows) || 0,
            clicks: Number(base.clicks) || 0,
            cost: grossOf(Number(base.spent) || 0), // VK отдаёт расход без НДС — приводим к деньгам владельца
            conversions: Number(base.goals) || 0,
          });
        }
      }
    }
    return out;
  }
}

// ─── OAuth ──────────────────────────────────────────────────────────────

export function vkAuthUrl(state: string, redirectUri: string) {
  const p = new URLSearchParams({
    action: "oauth2",
    response_type: "code",
    client_id: process.env.VK_ADS_CLIENT_ID || "",
    state,
    scope: "read_ads,create_ads",
    redirect_uri: redirectUri,
  });
  return `https://ads.vk.com/hq/settings/access?${p}`;
}

export async function vkToken(params: Record<string, string>, creds?: VkCreds | null) {
  const res = await fetch(`${BASE()}/v2/oauth2/token.json`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds?.clientId || process.env.VK_ADS_CLIENT_ID || "",
      client_secret: creds?.clientSecret || process.env.VK_ADS_CLIENT_SECRET || "",
      ...params,
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    const msg = JSON.stringify(j).toLowerCase();
    const hint = /token.*limit|limit.*token|tokens_left/.test(msg) ? " (лимит в 5 токенов на ключ — удалите старые токены в «Настройки → Доступ к API» в VK)" : "";
    throw new Error(`VK Реклама не выдала доступ: ${j.error_description || j.message || j.error || res.status}${hint}`);
  }
  return { accessToken: j.access_token as string, refreshToken: (j.refresh_token as string) || null, expiresIn: Number(j.expires_in) || 86400 };
}

export const vkConfigured = () => Boolean(process.env.VK_ADS_CLIENT_ID && process.env.VK_ADS_CLIENT_SECRET);

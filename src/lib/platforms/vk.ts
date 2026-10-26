import "server-only";
import type { AdSpec, AdState, CampaignSpec, Channel, LaunchHooks, LaunchResult, PlatformClient, StatRow, Strategy } from "./types";
import { PlatformError } from "./types";
import { sleep } from "../util";

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

export class VkAds implements PlatformClient {
  platform = "vk" as const;
  private packagesCache?: any[];
  constructor(private tokens: Tokens, private onTokens?: (t: Tokens & { expiresIn: number }) => Promise<void>) {}

  private async refresh() {
    if (!this.tokens.refreshToken) throw new PlatformError("vk", "Доступ к VK Рекламе истёк — подключите кабинет заново");
    const t = await vkToken({ grant_type: "refresh_token", refresh_token: this.tokens.refreshToken });
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

  async user() {
    return this.req("GET", "v2/user.json");
  }

  private async packages(): Promise<any[]> {
    if (this.packagesCache) return this.packagesCache;
    const j = await this.req("GET", "v2/packages.json", { query: { limit: 250 } });
    this.packagesCache = j.items ?? [];
    return this.packagesCache!;
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
   * Слот картинки в баннере. В документации («Quick start», «Add banners») встречаются image_1080x607 (16:9) и
   * квадратный 600x600; слота image_1080x1080 там нет. Квадрат 1080×1080 VK принимает в слот 600x600 (пропорция та же).
   * TODO: точный набор слотов задаётся форматом баннера пакета (package.banner_format_id) — читать его, когда
   * получим доступ к API и сверим ответ на реальном кабинете.
   */
  private contentKey(img: NonNullable<AdSpec["image"]>) {
    const r = img.width / img.height;
    return r > 1.3 ? "image_1080x607" : "image_600x600";
  }

  /** rich=false — только обязательные поля (если VK не принял «о компании» или логотип) */
  private async banner(ad: AdSpec, urlId: number, rich = true) {
    if (!ad.title.trim() || !ad.text.trim()) throw new PlatformError("vk", "У объявления пустой заголовок или текст");
    const x = ad.extras;
    const textblocks: Record<string, { text: string; title?: string }> = {
      title_40_vkads: { text: ad.title.slice(0, 40) },
      text_90: { text: ad.text.slice(0, 90) },
      text_220: { text: (x?.longText || [ad.text, ad.title2].filter(Boolean).join(". ")).slice(0, 220) },
      cta_sites_full: { text: "signUp" },
    };
    if (rich && x?.about) textblocks.about_company_115 = { text: x.about.slice(0, 115) };
    const content: Record<string, { id: number }> = {};
    let imageRef: string | undefined;
    if (ad.image) {
      const id = await this.uploadImage(ad.image);
      content[this.contentKey(ad.image)] = { id };
      imageRef = String(id);
    }
    if (rich && ad.logo) {
      try {
        content.icon_256x256 = { id: await this.uploadImage(ad.logo) };
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
    for (let offset = 0; offset < 5000; offset += 250) {
      const j = await this.req("GET", "v2/ad_plans.json", { query: { fields: "id,name,status", limit: 250, offset } });
      const items: any[] = j.items ?? [];
      const hit = items.filter((p) => p.name === name && p.status !== "deleted").sort((p, q) => Number(q.id) - Number(p.id))[0];
      if (hit) return String(hit.id);
      if (items.length < 250) break;
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
      const packageId = await this.trafficPackageId();
      const daily = vkDailyNet(spec.weeklyBudget);

      const buildGroups = async (rich: boolean) => {
        const groups = [];
        for (const g of spec.groups) {
          const banners = [];
          for (const ad of g.ads) {
            try {
              const b = await this.banner(ad, urlId, rich);
              imageRefs[ad.localId] = b.imageRef;
              banners.push(b.banner);
            } catch (e) {
              if (rich) warnings.push(`Объявление «${ad.title}»: ${(e as Error).message}`);
            }
          }
          const targetings: Record<string, unknown> = {
            geo: { regions: g.regionIds.length ? g.regionIds : [188] },
            age: { age_list: this.age(g.ageFrom, g.ageTo) },
          };
          if (g.sex && g.sex !== "any") targetings.sex = [g.sex];
          // При бюджете на уровне кампании бюджет и дата старта групп должны ему соответствовать
          groups.push({ name: g.name.slice(0, 120), package_id: packageId, targetings, budget_limit_day: daily, date_start: spec.startDate, banners });
        }
        return groups;
      };
      const planBody = (ad_groups: unknown[]) => ({
        name, status: "blocked", objective: "traffic", autobidding_mode: "max_goals",
        budget_limit_day: daily, date_start: spec.startDate, ad_object_type: "url", ad_object_id: urlId, ad_groups,
      });

      try {
        const plan = await this.req("POST", "v2/ad_plans.json", { body: planBody(await buildGroups(true)) });
        planId = String(plan.id);
        groupIdsFromResponse = (plan.ad_groups ?? []).map((g: any) => String(g.id));
      } catch (e) {
        // Ответ мог потеряться, хотя план создан (таймаут, 5xx) — сначала ищем его по имени
        planId = await this.findPlanByName(name).catch(() => null);
        if (planId) warnings.push("VK ответил с ошибкой, но кампания создалась — используем её");
        else if (VkAds.isValidation(e)) {
          // 400: план не создан. Чаще всего VK не принимает необязательные «о компании» или логотип — повторяем без них
          const plan = await this.req("POST", "v2/ad_plans.json", { body: planBody(await buildGroups(false)) });
          planId = String(plan.id);
          groupIdsFromResponse = (plan.ad_groups ?? []).map((g: any) => String(g.id));
          warnings.push(`Блок «о компании» и логотип VK не принял, объявления созданы без них: ${(e as Error).message}`);
        } else throw e;
      }
    }
    await hooks?.onCampaignCreated?.(planId);

    let groupItems: { id: string; name: string }[] = [];
    if (groupIdsFromResponse.length !== spec.groups.length) {
      const groupsRes = await this.req("GET", "v2/ad_groups.json", { query: { _ad_plan_id: planId, fields: "id,name", limit: 100 } });
      groupItems = (groupsRes.items ?? []).map((x: any) => ({ id: String(x.id), name: String(x.name) }));
    }
    const out: LaunchResult = { campaignExt: planId, groups: [], warnings, complete: true };
    for (const [gi, g] of spec.groups.entries()) {
      const groupExt = groupIdsFromResponse[gi] ?? (groupItems.find((x) => x.name === g.name.slice(0, 120)) ?? groupItems[gi])?.id ?? "";
      let bannerItems: any[] = [];
      const used = new Set<string>();
      if (groupExt) {
        const br = await this.req("GET", "v2/banners.json", { query: { _ad_group_id: groupExt, fields: "id,name", limit: 100 } });
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
    const path = `v2/ad_groups/${groupExt}/banners.json`;
    let b = await this.banner(ad, urlId);
    let j;
    try {
      j = await this.req("POST", path, { body: b.banner });
    } catch (e) {
      // Повтор без «о компании» и логотипа — только если VK отклонил запрос валидацией (значит, баннер не создан)
      if (!VkAds.isValidation(e) || (!ad.extras?.about && !ad.logo)) throw e;
      b = await this.banner(ad, urlId, false);
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

  async setNegativeKeywords() {
    // У VK Рекламы нет минус-слов: аудитория задаётся интересами и демографией
  }

  /** Секция textblocks при обновлении заменяется целиком — поэтому берём текущие блоки и меняем только тексты */
  async updateAdText(adExt: string, t: { title: string; title2?: string | null; text: string }) {
    if (!t.title.trim() || !t.text.trim()) throw new PlatformError("vk", "У объявления пустой заголовок или текст");
    const cur = await this.req("GET", `v2/banners/${adExt}.json`, { query: { fields: "id,textblocks" } }).catch(() => ({} as any));
    const textblocks: Record<string, any> = { ...(cur.textblocks ?? {}) };
    textblocks.title_40_vkads = { ...(textblocks.title_40_vkads ?? {}), text: t.title.slice(0, 40) };
    textblocks.text_90 = { ...(textblocks.text_90 ?? {}), text: t.text.slice(0, 90) };
    if (textblocks.text_220 || !cur.textblocks) textblocks.text_220 = { ...(textblocks.text_220 ?? {}), text: [t.text, t.title2].filter(Boolean).join(". ").slice(0, 220) };
    if (!textblocks.cta_sites_full) textblocks.cta_sites_full = { text: "signUp" };
    await this.req("POST", `v2/banners/${adExt}.json`, { body: { textblocks } });
  }

  async getAdStates(adExts: string[]): Promise<Record<string, AdState>> {
    const out: Record<string, AdState> = {};
    for (let i = 0; i < adExts.length; i += 100) {
      const ids = adExts.slice(i, i + 100);
      const j = await this.req("GET", "v2/banners.json", { query: { _id__in: ids.join(","), fields: "id,status,moderation_status,moderation_reasons", limit: 100 } });
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
      const groups = await this.req("GET", "v2/ad_groups.json", { query: { _ad_plan_id: plan, fields: "id", limit: 100 } });
      for (const g of groups.items ?? []) {
        const br = await this.req("GET", "v2/banners.json", { query: { _ad_group_id: g.id, fields: "id", limit: 100 } });
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

export async function vkToken(params: Record<string, string>) {
  const res = await fetch(`${BASE()}/v2/oauth2/token.json`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.VK_ADS_CLIENT_ID || "",
      client_secret: process.env.VK_ADS_CLIENT_SECRET || "",
      ...params,
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    const hint = res.status === 403 ? " (лимит в 5 токенов на приложение — удалите старые в настройках доступа VK)" : "";
    throw new Error(`VK Реклама не выдала доступ: ${j.error_description || j.message || j.error || res.status}${hint}`);
  }
  return { accessToken: j.access_token as string, refreshToken: (j.refresh_token as string) || null, expiresIn: Number(j.expires_in) || 86400 };
}

export const vkConfigured = () => Boolean(process.env.VK_ADS_CLIENT_ID && process.env.VK_ADS_CLIENT_SECRET);

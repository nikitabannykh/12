import "server-only";
import type { AuctionRow } from "./types";
import type { Sitelink, VCard } from "../engine/extras";
import type {
  AdSpec, AdState, CampaignSpec, Channel, LaunchHooks, LaunchResult, PlatformClient, QueryRow, StatRow, Strategy,
} from "./types";
import { PlatformError } from "./types";
import { sleep, uid } from "../util";

/**
 * Клиент API Яндекс Директа.
 * Кампании создаются как Единые перфоманс-кампании (UnifiedCampaign) — это основной тип Директа.
 * Для ЕПК нужна версия API v501; отчёты работают через сервис Reports (v5).
 */
const sandbox = () => process.env.YANDEX_DIRECT_SANDBOX === "true";
const host = () => (sandbox() ? "https://api-sandbox.direct.yandex.com" : "https://api.direct.yandex.com");
const API = () => process.env.YANDEX_DIRECT_API_URL || `${host()}/json/v501`;
const REPORTS = () => process.env.YANDEX_DIRECT_REPORTS_URL || `${host()}/json/v5/reports`;

const MICRO = 1_000_000;
const micros = (rub: number) => Math.round(rub) * MICRO;
// Минимальный недельный бюджет автостратегии в Директе — 300 ₽
export const DIRECT_MIN_WEEKLY = 300;

/**
 * НДС. Бюджет владельца в сервисе — это реальные деньги, которые он платит (с НДС), поэтому:
 *  - расход из Reports берём с НДС (IncludeVAT: "YES") — его и сравниваем с месячным бюджетом;
 *  - лимиты стратегии (WeeklySpendLimit) Директ задаёт в валюте кабинета без НДС: документация API единиц не уточняет,
 *    но справка Директа приводит денежные настройки стратегий «без НДС» (напр. минимальная средняя цена клика 0,9 ₽ без НДС).
 *    Поэтому недельный лимит с НДС делим на (1 + ставка), иначе Директ тратил бы на ставку НДС больше бюджета.
 * Ставка НДС с 2026 года — 22 %; переопределяется YANDEX_DIRECT_VAT (0 — если лимиты в кабинете уже с НДС).
 * Предел ставки (BidCeiling) не пересчитываем: он берётся из аукциона keywordbids, где цены в тех же единицах, что и ставки.
 */
export const DIRECT_VAT = (() => {
  const v = Number(process.env.YANDEX_DIRECT_VAT ?? 0.22);
  return Number.isFinite(v) && v >= 0 && v < 1 ? v : 0.22;
})();
export const netOfVat = (grossRub: number) => Math.max(DIRECT_MIN_WEEKLY, Math.floor(grossRub / (1 + DIRECT_VAT)));

/** Ограничения Директа на быстрые ссылки: до 8 штук, заголовок до 30 символов, сумма заголовков 1–4 и 5–8 — до 66 в каждой четвёрке */
export const SITELINK_TITLE_MAX = 30;
export const SITELINKS_GROUP_TOTAL = 66;

/**
 * Подгоняем набор быстрых ссылок под лимиты, не теряя его целиком: ссылка, которая не помещается в первую четвёрку,
 * переходит во вторую; не помещается никуда — отбрасываем только её.
 */
export function fitSitelinks<T extends { title: string }>(list: T[]): T[] {
  const pool = list.map((l) => ({ ...l, title: l.title.trim().slice(0, SITELINK_TITLE_MAX) })).filter((l) => l.title);
  const take = (from: T[], total: number) => {
    const out: T[] = [], rest: T[] = [];
    let sum = 0;
    for (const s of from) {
      if (out.length < 4 && sum + s.title.length <= total) { out.push(s); sum += s.title.length; }
      else rest.push(s);
    }
    return { out, rest };
  };
  // Позиции 1–4 и 5–8 считаются по порядку в наборе, поэтому вторую четвёрку добавляем только к полной первой
  const first = take(pool, SITELINKS_GROUP_TOTAL);
  if (first.out.length < 4) return first.out;
  return [...first.out, ...take(first.rest, SITELINKS_GROUP_TOTAL).out];
}

/** utm-метки объявления переносим в ссылки дополнений — иначе клики по быстрым ссылкам теряют атрибуцию */
function withAdUtm(href: string, adHref: string) {
  try {
    const u = new URL(href), ad = new URL(adHref);
    if (u.host !== ad.host) return href;
    for (const [k, v] of ad.searchParams) if (k.startsWith("utm_") && !u.searchParams.has(k)) u.searchParams.set(k, v);
    return u.toString().replace(/%7B/g, "{").replace(/%7D/g, "}");
  } catch {
    return href;
  }
}

type DirectItemResult = { Id?: number; AdImageHash?: string; Errors?: { Code: number; Message: string; Details?: string }[]; Warnings?: { Code: number; Message: string; Details?: string }[] };

export class YandexDirect implements PlatformClient {
  platform = "yandex" as const;
  constructor(private token: string, private clientLogin?: string) {}

  private headers(extra: Record<string, string> = {}) {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "Accept-Language": "ru",
      "Content-Type": "application/json; charset=utf-8",
      ...extra,
    };
    if (this.clientLogin) h["Client-Login"] = this.clientLogin;
    return h;
  }

  async call<T = any>(service: string, method: string, params: unknown): Promise<T> {
    const res = await fetch(`${API()}/${service}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ method, params }),
    });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new PlatformError("yandex", `Директ ответил не JSON (${res.status})`, text.slice(0, 500));
    }
    if (json.error) {
      const e = json.error;
      throw new PlatformError("yandex", `Директ: ${e.error_string}${e.error_detail ? ` — ${e.error_detail}` : ""} (код ${e.error_code})`, e);
    }
    return json.result as T;
  }

  /** Разбор AddResults/UpdateResults: ошибки по элементам превращаем в исключение, предупреждения — в список */
  private items(results: DirectItemResult[] | undefined, what: string, warnings?: string[]) {
    const list = results ?? [];
    for (const r of list) {
      if (r.Errors?.length) {
        const e = r.Errors[0];
        throw new PlatformError("yandex", `${what}: ${e.Message}${e.Details ? ` — ${e.Details}` : ""}`, r.Errors);
      }
      for (const w of r.Warnings ?? []) warnings?.push(`${what}: ${w.Message}${w.Details ? ` — ${w.Details}` : ""}`);
    }
    return list;
  }

  private strategy(channel: Channel, weeklyBudget: number, strategy: Strategy, goalId?: number | null, bidCeiling?: number | null) {
    // Потолок ставки ограничивает, сколько автостратегия готова платить за клик, — а значит, и место в выдаче
    const ceiling = bidCeiling && channel === "search" ? { BidCeiling: micros(bidCeiling) } : {};
    const active =
      strategy === "conversions" && goalId
        ? { BiddingStrategyType: "WB_MAXIMUM_CONVERSION_RATE", WbMaximumConversionRate: { WeeklySpendLimit: micros(netOfVat(weeklyBudget)), GoalId: goalId, ...ceiling } }
        : { BiddingStrategyType: "WB_MAXIMUM_CLICKS", WbMaximumClicks: { WeeklySpendLimit: micros(netOfVat(weeklyBudget)), ...ceiling } };
    const off = { BiddingStrategyType: "SERVING_OFF" };
    return channel === "search" ? { Search: active, Network: off } : { Search: off, Network: active };
  }

  async launchCampaign(spec: CampaignSpec, hooks?: LaunchHooks): Promise<LaunchResult> {
    const warnings: string[] = [];
    const unified: Record<string, unknown> = {
      BiddingStrategy: this.strategy(spec.channel, spec.weeklyBudget, spec.strategy, spec.goalId),
      Settings: [
        { Option: "ADD_METRICA_TAG", Value: "YES" },
        { Option: "ENABLE_SITE_MONITORING", Value: "YES" },
        { Option: "ALTERNATIVE_TEXTS_ENABLED", Value: "YES" },
      ],
    };
    if (spec.counterId) unified.CounterIds = { Items: [spec.counterId] };
    if (spec.counterId && spec.goalId) unified.PriorityGoals = { Items: [{ GoalId: spec.goalId, Value: micros(1000) }] };

    const campaign: Record<string, unknown> = {
      Name: spec.name.slice(0, 255),
      StartDate: spec.startDate,
      UnifiedCampaign: unified,
    };
    if (spec.negativeKeywords.length) campaign.NegativeKeywords = { Items: spec.negativeKeywords.slice(0, 1000) };

    const res = await this.call("campaigns", "add", { Campaigns: [campaign] });
    const [c] = this.items(res.AddResults, "Кампания", warnings);
    const campaignExt = String(c.Id);
    await hooks?.onCampaignCreated?.(campaignExt);

    const out: LaunchResult = { campaignExt, groups: [], warnings };
    for (const g of spec.groups) {
      const gr = await this.call("adgroups", "add", {
        AdGroups: [{ Name: g.name.slice(0, 255), CampaignId: Number(campaignExt), RegionIds: g.regionIds, UnifiedAdGroup: { OfferRetargeting: "NO" } }],
      });
      const [gi] = this.items(gr.AddResults, `Группа «${g.name}»`, warnings);
      const groupExt = String(gi.Id);

      const keywords = [...new Set(g.keywords.map((k) => k.trim()).filter(Boolean))].slice(0, 200);
      if (g.autotargeting) keywords.push("---autotargeting");
      if (keywords.length) {
        try {
          const kr = await this.call("keywords", "add", { Keywords: keywords.map((Keyword) => ({ Keyword, AdGroupId: Number(groupExt) })) });
          for (const [i, r] of ((kr.AddResults ?? []) as DirectItemResult[]).entries()) {
            if (r.Errors?.length) warnings.push(`Фраза «${keywords[i]}» не добавлена: ${r.Errors[0].Message}`);
          }
        } catch (e) {
          warnings.push(`Ключевые фразы группы «${g.name}»: ${(e as Error).message}`);
        }
      }

      const ads: LaunchResult["groups"][number]["ads"] = [];
      for (const ad of g.ads) {
        try {
          const r = await this.addAd(campaignExt, groupExt, ad, { channel: spec.channel }, warnings, false);
          ads.push({ localId: ad.localId, adExt: r.adExt, imageRef: r.imageRef });
        } catch (e) {
          ads.push({ localId: ad.localId, adExt: null, error: (e as Error).message });
        }
      }
      out.groups.push({ localId: g.localId, groupExt, ads });
    }

    const toModerate = out.groups.flatMap((g) => g.ads.map((a) => a.adExt)).filter(Boolean) as string[];
    if (toModerate.length) {
      try {
        await this.call("ads", "moderate", { SelectionCriteria: { Ids: toModerate.map(Number) } });
      } catch (e) {
        warnings.push(`Отправка на модерацию: ${(e as Error).message}`);
      }
    }
    return out;
  }

  /** Удаляем недосозданную кампанию; если Директ не даёт (уже были показы) — останавливаем */
  async removeCampaign(campaignExt: string) {
    const sel = { SelectionCriteria: { Ids: [Number(campaignExt)] } };
    try {
      const res = await this.call("campaigns", "delete", sel);
      this.items(res.DeleteResults, "Удаление кампании");
    } catch {
      const res = await this.call("campaigns", "suspend", sel);
      this.items(res.SuspendResults, "Остановка кампании");
    }
  }

  private imageCache = new Map<string, string>();

  async uploadImage(img: NonNullable<AdSpec["image"]>): Promise<string> {
    if (img.cachedRef) return img.cachedRef;
    const hit = this.imageCache.get(img.imageId);
    if (hit) return hit;
    const res = await this.call("adimages", "add", {
      AdImages: [{ ImageData: img.data.toString("base64"), Name: `pz-${img.imageId}`.slice(0, 255) }],
    });
    const [r] = this.items(res.AddResults, "Изображение");
    this.imageCache.set(img.imageId, r.AdImageHash!);
    return r.AdImageHash!;
  }

  private calloutCache = new Map<string, number>();
  private vcardCache = new Map<string, number | null>();

  /** Уточнения переиспользуем: у Директа они общие на весь аккаунт */
  private async callouts(texts: string[], warnings?: string[]): Promise<number[]> {
    const items = [...new Set(texts.map((t) => t.trim()).filter((t) => t && t.length <= 25))].slice(0, 8);
    const missing = items.filter((t) => !this.calloutCache.has(t));
    if (missing.length) {
      try {
        const res = await this.call("adextensions", "add", { AdExtensions: missing.map((CalloutText) => ({ Callout: { CalloutText } })) });
        ((res.AddResults ?? []) as DirectItemResult[]).forEach((r, i) => r.Id && this.calloutCache.set(missing[i], r.Id));
      } catch (e) {
        warnings?.push(`Уточнения: ${(e as Error).message}`);
      }
    }
    return items.map((t) => this.calloutCache.get(t)).filter(Boolean) as number[];
  }

  private sitelinkCache = new Map<string, number | null>();

  /** Набор быстрых ссылок. Одинаковые наборы Директ и так не дублирует, но кэш экономит вызовы. */
  private async sitelinks(links: Sitelink[], adHref: string, warnings?: string[]): Promise<number | null> {
    const fitted = fitSitelinks(links);
    if (fitted.length < links.length) warnings?.push(`Быстрые ссылки: оставили ${fitted.length} из ${links.length} — у Директа лимит 66 символов на заголовки каждой четвёрки`);
    const items = fitted.map((l) => ({ Title: l.title, Href: withAdUtm(l.href, adHref).slice(0, 1024), Description: l.description?.trim().slice(0, 60) || undefined }));
    if (items.length < 2) return null;
    const key = JSON.stringify(items);
    if (this.sitelinkCache.has(key)) return this.sitelinkCache.get(key)!;
    try {
      const res = await this.call("sitelinks", "add", { SitelinksSets: [{ Sitelinks: items }] });
      const [r] = this.items(res.AddResults, "Быстрые ссылки");
      this.sitelinkCache.set(key, r.Id ?? null);
      return r.Id ?? null;
    } catch (e) {
      warnings?.push(`Быстрые ссылки: ${(e as Error).message}`);
      this.sitelinkCache.set(key, null);
      return null;
    }
  }

  /** Визитка: адрес, телефон и часы работы под объявлением. Одна на кампанию. */
  private async vcard(campaignExt: string, v: VCard, warnings?: string[]): Promise<number | null> {
    if (this.vcardCache.has(campaignExt)) return this.vcardCache.get(campaignExt)!;
    if (!v.phone) return null;
    try {
      const card: Record<string, unknown> = {
        CampaignId: Number(campaignExt),
        Country: "Россия",
        City: v.city,
        CompanyName: v.company,
        WorkTime: v.workTime,
        Phone: { CountryCode: v.phone.country, CityCode: v.phone.city, PhoneNumber: v.phone.number },
      };
      if (v.street) card.Street = v.street.slice(0, 55);
      if (v.house) card.House = v.house.slice(0, 30);
      const res = await this.call("vcards", "add", { VCards: [card] });
      const [r] = this.items(res.AddResults, "Визитка");
      this.vcardCache.set(campaignExt, r.Id ?? null);
      return r.Id ?? null;
    } catch (e) {
      warnings?.push(`Визитка (адрес и телефон): ${(e as Error).message}`);
      this.vcardCache.set(campaignExt, null);
      return null;
    }
  }

  async addAd(campaignExt: string, groupExt: string, ad: AdSpec, _ctx: { channel: Channel }, warnings: string[] = [], moderate = true) {
    if (!ad.title.trim() || !ad.text.trim()) throw new PlatformError("yandex", "У объявления пустой заголовок или текст");
    let imageRef: string | undefined;
    if (ad.image) {
      try {
        imageRef = await this.uploadImage(ad.image);
      } catch (e) {
        warnings.push(`Картинка не загрузилась, объявление пойдёт без неё: ${(e as Error).message}`);
      }
    }
    const x = ad.extras;
    const extIds = x?.callouts.length ? await this.callouts(x.callouts, warnings) : [];
    const sitelinkSetId = x?.sitelinks.length ? await this.sitelinks(x.sitelinks, ad.href, warnings) : null;
    const vcardId = x?.vcard ? await this.vcard(campaignExt, x.vcard, warnings) : null;

    const textAd: Record<string, unknown> = {
      Title: ad.title,
      Text: ad.text,
      Href: ad.href,
      Mobile: "NO",
    };
    if (ad.title2) textAd.Title2 = ad.title2;
    if (imageRef) textAd.AdImageHash = imageRef;
    if (extIds.length) textAd.AdExtensionIds = extIds;
    if (sitelinkSetId) textAd.SitelinkSetId = sitelinkSetId;
    if (ad.marking) textAd.ErirAdDescription = ad.marking.slice(0, 255);
    // Необязательные поля: если Директ отклонит объявление, убираем их по одному (сначала визитку — в ЕПК её могут не принять),
    // чтобы из-за одного поля не терять остальные
    const optional: [string, string, unknown][] = [];
    if (vcardId) optional.push(["VCardId", "визитка", vcardId]);
    if (x?.price) optional.push(["PriceExtension", "цена", { Price: micros(x.price.price), PriceQualifier: x.price.qualifier, PriceCurrency: "RUB" }]);
    if (x?.displayPath) optional.push(["DisplayUrlPath", "отображаемая ссылка", x.displayPath.slice(0, 20)]);

    let res: any;
    const dropped: string[] = [];
    for (;;) {
      const extra = Object.fromEntries(optional.map(([k, , v]) => [k, v]));
      let err: unknown = null;
      try {
        res = await this.call("ads", "add", { Ads: [{ AdGroupId: Number(groupExt), TextAd: { ...textAd, ...extra } }] });
        const e = (res.AddResults as DirectItemResult[] | undefined)?.[0]?.Errors?.[0];
        if (e) err = new Error(`${e.Message}${e.Details ? ` — ${e.Details}` : ""}`);
      } catch (e) {
        err = e;
      }
      if (!err) break;
      if (!optional.length) throw err;
      const [, label] = optional.shift()!;
      dropped.push(label);
      warnings.push(`Объявление «${ad.title}»: Директ не принял поле «${label}», создаём без него: ${(err as Error).message}`);
    }
    const [r] = this.items(res.AddResults, "Объявление", warnings);
    const adExt = String(r.Id);
    if (moderate) await this.call("ads", "moderate", { SelectionCriteria: { Ids: [Number(adExt)] } });
    void campaignExt;
    return { adExt, imageRef };
  }

  async setCampaignActive(campaignExt: string, active: boolean) {
    await this.call("campaigns", active ? "resume" : "suspend", { SelectionCriteria: { Ids: [Number(campaignExt)] } });
  }

  async setAdsActive(adExts: string[], active: boolean) {
    if (!adExts.length) return;
    const res = await this.call("ads", active ? "resume" : "suspend", { SelectionCriteria: { Ids: adExts.map(Number) } });
    const results = (active ? res.ResumeResults : res.SuspendResults) as DirectItemResult[] | undefined;
    // Повторная остановка уже остановленного объявления — не ошибка
    for (const r of results ?? []) {
      if (r.Errors?.length && !/уже|already/i.test(r.Errors[0].Message + (r.Errors[0].Details ?? ""))) {
        throw new PlatformError("yandex", `Объявление: ${r.Errors[0].Message}`, r.Errors);
      }
    }
  }

  async setBudget(campaignExt: string, p: { channel: Channel; weeklyBudget: number; strategy: Strategy; goalId?: number | null; bidCeiling?: number | null }) {
    const res = await this.call("campaigns", "update", {
      Campaigns: [{ Id: Number(campaignExt), UnifiedCampaign: { BiddingStrategy: this.strategy(p.channel, p.weeklyBudget, p.strategy, p.goalId, p.bidCeiling) } }],
    });
    this.items(res.UpdateResults, "Бюджет кампании");
  }

  async setNegativeKeywords(campaignExt: string, words: string[]) {
    const res = await this.call("campaigns", "update", {
      Campaigns: [{ Id: Number(campaignExt), NegativeKeywords: words.length ? { Items: words.slice(0, 1000) } : null }],
    });
    this.items(res.UpdateResults, "Минус-слова");
  }

  async updateAdText(adExt: string, t: { title: string; title2?: string | null; text: string }) {
    const textAd: Record<string, unknown> = { Title: t.title, Text: t.text };
    textAd.Title2 = t.title2 || null;
    const res = await this.call("ads", "update", { Ads: [{ Id: Number(adExt), TextAd: textAd }] });
    this.items(res.UpdateResults, "Текст объявления");
    await this.call("ads", "moderate", { SelectionCriteria: { Ids: [Number(adExt)] } });
  }

  async getAdStates(adExts: string[]): Promise<Record<string, AdState>> {
    const out: Record<string, AdState> = {};
    for (let i = 0; i < adExts.length; i += 1000) {
      const chunk = adExts.slice(i, i + 1000).map(Number);
      const res = await this.call("ads", "get", { SelectionCriteria: { Ids: chunk }, FieldNames: ["Id", "State", "Status", "StatusClarification"] });
      for (const a of res.Ads ?? []) {
        // State: ON — показывается; SUSPENDED — остановлено владельцем (suspend); OFF — не показывается по другой причине
        // (черновик, модерация, отклонено, кампания остановлена или нет денег); OFF_BY_MONITORING — сайт недоступен;
        // ARCHIVED — в архиве. «paused» у нас — только SUSPENDED: иначе после возобновления кампании объявления
        // навсегда «застревали» выключенными.
        let status: AdState["status"] = "moderation";
        let note: string | undefined = a.StatusClarification || undefined;
        if (a.State === "ARCHIVED") status = "archived";
        else if (a.Status === "REJECTED") status = "rejected";
        else if (a.State === "SUSPENDED") status = "paused";
        else if (a.Status === "DRAFT" || a.Status === "MODERATION") status = "moderation";
        else if (a.State === "ON") status = "active";
        else if (a.Status === "ACCEPTED" || a.Status === "PREACCEPTED") {
          status = "active";
          note = a.State === "OFF_BY_MONITORING" ? "Не показывается: сайт недоступен (мониторинг Директа)" : note ?? "Сейчас не показывается: кампания остановлена или на счёте нет денег";
        }
        out[String(a.Id)] = { status, note };
      }
    }
    return out;
  }

  /** Отчёт Reports API в формате TSV. Отчёты строятся в офлайне — опрашиваем до готовности. */
  private async report(def: Record<string, unknown>): Promise<Record<string, string>[]> {
    const body = JSON.stringify({ params: { ...def, ReportName: `pz-${uid()}`, DateRangeType: "CUSTOM_DATE", Format: "TSV", IncludeVAT: "YES" } });
    const deadline = Date.now() + 40_000;
    for (;;) {
      const res = await fetch(REPORTS(), {
        method: "POST",
        headers: this.headers({ processingMode: "auto", returnMoneyInMicros: "false", skipReportHeader: "true", skipReportSummary: "true" }),
        body,
      });
      if (res.status === 200) {
        const tsv = await res.text();
        const [head, ...rows] = tsv.trim().split("\n");
        if (!head) return [];
        const cols = head.split("\t");
        return rows.filter(Boolean).map((line) => {
          const v = line.split("\t");
          return Object.fromEntries(cols.map((c, i) => [c, v[i]]));
        });
      }
      if (res.status === 201 || res.status === 202) {
        if (Date.now() > deadline) throw new PlatformError("yandex", "Отчёт Директа готовится дольше обычного — заберём при следующей проверке");
        const wait = Number(res.headers.get("retryIn") || 3);
        await sleep(Math.min(wait, 8) * 1000);
        continue;
      }
      const text = await res.text();
      let msg = text.slice(0, 300);
      try {
        const j = JSON.parse(text);
        msg = `${j.error.error_string} — ${j.error.error_detail}`;
      } catch {}
      throw new PlatformError("yandex", `Отчёт Директа: ${msg}`);
    }
  }

  async getStats(campaignExts: string[], from: string, to: string, goalIds: number[]): Promise<StatRow[]> {
    if (!campaignExts.length) return [];
    const goals = goalIds.filter(Boolean).slice(0, 10);
    const rows = await this.report({
      SelectionCriteria: { DateFrom: from, DateTo: to, Filter: [{ Field: "CampaignId", Operator: "IN", Values: campaignExts }] },
      FieldNames: ["Date", "CampaignId", "AdId", "Impressions", "Clicks", "Cost", "AvgTrafficVolume", "AvgImpressionPosition", ...(goals.length ? ["Conversions"] : [])],
      ReportType: "AD_PERFORMANCE_REPORT",
      ...(goals.length ? { Goals: goals, AttributionModels: ["AUTO"] } : {}),
    });
    return rows.map((r) => {
      const conv = Object.entries(r)
        .filter(([k]) => k.startsWith("Conversions"))
        .reduce((s, [, v]) => s + (Number(v) || 0), 0);
      return {
        campaignExt: r.CampaignId,
        adExt: r.AdId || "",
        day: r.Date,
        impressions: Number(r.Impressions) || 0,
        clicks: Number(r.Clicks) || 0,
        cost: Number(r.Cost) || 0,
        conversions: conv,
        trafficVolume: num(r.AvgTrafficVolume),
        position: num(r.AvgImpressionPosition),
      };
    });
  }

  /** Аукцион на поиске по каждой фразе → медиана по группе для каждого объёма трафика */
  async getAuction(campaignExt: string): Promise<AuctionRow[]> {
    const res = await this.call("keywordbids", "get", {
      SelectionCriteria: { CampaignIds: [Number(campaignExt)] },
      FieldNames: ["KeywordId", "AdGroupId", "ServingStatus"],
      SearchFieldNames: ["Bid", "AuctionBids"],
      Page: { Limit: 2000 },
    });
    const byGroup = new Map<string, { keywords: number; tiers: Map<number, { bids: number[]; prices: number[] }> }>();
    for (const k of (res.KeywordBids ?? []) as any[]) {
      const items: any[] = k.Search?.AuctionBids?.AuctionBidItems ?? [];
      if (!items.length) continue;
      const g = byGroup.get(String(k.AdGroupId)) ?? { keywords: 0, tiers: new Map() };
      g.keywords++;
      for (const it of items) {
        const t = g.tiers.get(it.TrafficVolume) ?? { bids: [], prices: [] };
        t.bids.push(it.Bid / 1e6);
        t.prices.push(it.Price / 1e6);
        g.tiers.set(it.TrafficVolume, t);
      }
      byGroup.set(String(k.AdGroupId), g);
    }
    const med = (a: number[]) => { const x = [...a].sort((p, q) => p - q); return x[Math.floor(x.length / 2)] ?? 0; };
    return [...byGroup.entries()].map(([groupExt, g]) => ({
      groupExt,
      keywords: g.keywords,
      tiers: [...g.tiers.entries()].map(([trafficVolume, t]) => ({ trafficVolume, bid: med(t.bids), price: med(t.prices) })).sort((a, b) => b.trafficVolume - a.trafficVolume),
    }));
  }

  async getSearchQueries(campaignExts: string[], from: string, to: string): Promise<QueryRow[]> {
    if (!campaignExts.length) return [];
    const rows = await this.report({
      SelectionCriteria: { DateFrom: from, DateTo: to, Filter: [{ Field: "CampaignId", Operator: "IN", Values: campaignExts }] },
      FieldNames: ["CampaignId", "Query", "Impressions", "Clicks", "Cost"],
      ReportType: "SEARCH_QUERY_PERFORMANCE_REPORT",
    });
    return rows.map((r) => ({
      campaignExt: r.CampaignId,
      query: r.Query,
      impressions: Number(r.Impressions) || 0,
      clicks: Number(r.Clicks) || 0,
      cost: Number(r.Cost) || 0,
    }));
  }

  /** Справочник регионов — для поиска ID города */
  async geoRegions(): Promise<{ id: number; name: string; type: string; parent: number | null }[]> {
    const res = await this.call("dictionaries", "get", { DictionaryNames: ["GeoRegions"] });
    return (res.GeoRegions ?? []).map((r: any) => ({ id: r.GeoRegionId, name: r.GeoRegionName, type: r.GeoRegionType, parent: r.ParentId ?? null }));
  }

  async clientInfo(): Promise<{ login: string; currency: string; clientId?: number }> {
    const res = await this.call("clients", "get", { FieldNames: ["Login", "Currency", "ClientId"] });
    const c = res.Clients?.[0] ?? {};
    return { login: c.Login, currency: c.Currency, clientId: c.ClientId };
  }
}

// ─── OAuth ──────────────────────────────────────────────────────────────

export function yandexAuthUrl(state: string, redirectUri: string) {
  const p = new URLSearchParams({
    response_type: "code",
    client_id: process.env.YANDEX_CLIENT_ID || "",
    redirect_uri: redirectUri,
    state,
    force_confirm: "yes",
  });
  return `https://oauth.yandex.ru/authorize?${p}`;
}

export async function yandexExchange(code: string) {
  const res = await fetch("https://oauth.yandex.ru/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: process.env.YANDEX_CLIENT_ID || "",
      client_secret: process.env.YANDEX_CLIENT_SECRET || "",
    }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error(j.error_description || j.error || "Яндекс не выдал токен");
  return { accessToken: j.access_token as string, refreshToken: (j.refresh_token as string) || null, expiresIn: Number(j.expires_in) || 365 * 24 * 3600 };
}

export async function yandexRefresh(refreshToken: string) {
  const res = await fetch("https://oauth.yandex.ru/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.YANDEX_CLIENT_ID || "",
      client_secret: process.env.YANDEX_CLIENT_SECRET || "",
    }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error(j.error_description || "Не удалось обновить доступ к Яндексу");
  return { accessToken: j.access_token as string, refreshToken: (j.refresh_token as string) || refreshToken, expiresIn: Number(j.expires_in) || 365 * 24 * 3600 };
}

export async function yandexLogin(token: string): Promise<{ login: string; id: string }> {
  const res = await fetch("https://login.yandex.ru/info?format=json", { headers: { Authorization: `OAuth ${token}` } });
  const j = await res.json();
  return { login: j.login || j.default_email || "яндекс", id: String(j.id || "") };
}

export const yandexConfigured = () => Boolean(process.env.YANDEX_CLIENT_ID && process.env.YANDEX_CLIENT_SECRET);

function num(v: string | undefined) {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

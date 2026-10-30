import "server-only";
import type { AuctionRow, AudienceSpec, CampaignDelivery, DemographicsAdjustment, TargetingUpdate } from "./types";
import type { Sitelink } from "../engine/extras";
import type {
  AdLimits, AdSpec, AdState, CampaignSpec, Channel, GroupSpec, LaunchHooks, LaunchResult, PlacementRow, PlatformClient, QueryRow, StatRow, Strategy, WordstatPhrase, WordstatReports,
} from "./types";
import { PlatformError } from "./types";
import { sleep, uid } from "../util";

/**
 * Клиент API Яндекс Директа.
 * Кампании создаются как Единые перфоманс-кампании (UnifiedCampaign) — это основной тип Директа.
 * Для ЕПК нужна версия API v501; отчёты работают через сервис Reports (v5).
 *
 * Объявления — комбинаторные (ResponsiveAd): с 30 июня текстово-графические объявления в ЕПК доступны только для
 * редактирования (https://yandex.ru/dev/direct/doc/ru/objects/ad, https://yandex.ru/dev/direct/doc/ru/update-tga).
 * ResponsiveAd: Titles 1–7 (до 56 символов, слово до 22), Texts 1–3 (до 81, слово до 23), AdImageHashes 1–5,
 * Href и/или BusinessId, SitelinkSetId и DisplayUrlPath — только вместе с Href, AdExtensionIds до 50, PriceExtension,
 * ErirAdDescription (https://yandex.ru/dev/direct/doc/ru/ads/add). VCardId в ResponsiveAd нет — вместо визитки профиль
 * организации (BusinessId), который должен быть опубликован (businesses.get → IsPublished = YES).
 * В группе — не больше 3 неархивных комбинаторных объявлений и 10 вместе с архивными (objects/ad).
 */
const sandbox = () => process.env.YANDEX_DIRECT_SANDBOX === "true";
const host = () => (sandbox() ? "https://api-sandbox.direct.yandex.com" : "https://api.direct.yandex.com");
const API = () => process.env.YANDEX_DIRECT_API_URL || `${host()}/json/v501`;
const REPORTS = () => process.env.YANDEX_DIRECT_REPORTS_URL || `${host()}/json/v5/reports`;
/** Директ: не больше 1000 запрещённых площадок в кампании (Campaign.ExcludedSites) */
export const MAX_EXCLUDED_SITES = 1000;
/** JSON API v4 — только ради Wordstat (CreateNewWordstatReport и т. п.): в v5 этих методов нет */
const V4 = () => process.env.YANDEX_DIRECT_V4_URL || (sandbox() ? "https://api-sandbox.direct.yandex.ru/v4/json/" : "https://api.direct.yandex.ru/v4/json/");

/** Строка отчёта Wordstat v4 (WordstatReportInfo) → WordstatPhrase. Поля читаем осторожно: Shows может прийти строкой */
export function parseWordstatInfo(r: any): WordstatPhrase {
  const items = (list: unknown): { phrase: string; shows: number }[] =>
    (Array.isArray(list) ? list : [])
      .map((x: any) => ({ phrase: String(x?.Phrase ?? x?.phrase ?? "").trim(), shows: Math.max(0, Number(x?.Shows ?? x?.shows ?? 0) || 0) }))
      .filter((x) => x.phrase);
  const phrase = String(r?.Phrase ?? r?.phrase ?? "").trim();
  const searchedWith = items(r?.SearchedWith ?? r?.searchedWith);
  // Всего запросов — строка SearchedWith с самой фразой (Яндекс может нормализовать её написание), иначе первая строка:
  // она и есть фраза целиком; пустой список — 0
  const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const self = searchedWith.find((x) => norm(x.phrase) === norm(phrase));
  const shows = self?.shows ?? searchedWith[0]?.shows ?? 0;
  return { phrase: phrase || searchedWith[0]?.phrase || "", shows, searchedWith };
}

const MICRO = 1_000_000;
// Деньги в API — микроединицы, кратные копейке (10 000): 0,4 ₽ → 400 000, а не 0
const micros = (rub: number) => Math.round(rub * 100) * (MICRO / 100);
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

/** Лимит Директа на комбинаторные объявления в группе: 3 неархивных, 10 вместе с архивными */
export const DIRECT_AD_LIMITS: AdLimits = { nonArchived: 3, total: 10 };

/** Ограничения ResponsiveAd (ads.add): заголовок до 56 символов (слово до 22), текст до 81 (слово до 23) */
const RA = { titles: 7, texts: 3, title: 56, text: 81, titleWord: 22, textWord: 23, images: 5 } as const;
const fitsWords = (s: string, max: number) => s.split(/\s+/).every((w) => w.length <= max);

/**
 * Заголовки и тексты комбинаторного объявления: основной первым, затем дополнительные из AdSpec.titles/texts.
 * Без списков — основной заголовок и, если влезает, склейка «Заголовок. Второй заголовок» (так Директ сам поступает
 * со вторым заголовком при переводе ТГО в комбинаторные).
 */
export function responsiveTexts(ad: Pick<AdSpec, "title" | "title2" | "text" | "titles" | "texts">) {
  const uniq = (list: (string | null | undefined)[], max: number, word: number, limit: number, first: string) => {
    const out: string[] = [first];
    const seen = new Set([first.toLowerCase()]);
    for (const x of list) {
      const t = (x ?? "").replace(/\s+/g, " ").trim();
      if (!t || seen.has(t.toLowerCase()) || t.length > max || !fitsWords(t, word)) continue;
      seen.add(t.toLowerCase());
      out.push(t);
      if (out.length >= limit) break;
    }
    return out;
  };
  const title = ad.title.trim(), text = ad.text.trim();
  const merged = ad.title2?.trim() ? `${title.replace(/[.!]$/, "")}. ${ad.title2.trim()}` : null;
  return {
    titles: uniq([...(ad.titles ?? []), merged], RA.title, RA.titleWord, RA.titles, title),
    texts: uniq(ad.texts ?? [], RA.text, RA.textWord, RA.texts, text),
  };
}

/**
 * Автотаргетинг без брендов конкурентов и слишком широких запросов (keywords.add → AutotargetingSettings,
 * https://yandex.ru/dev/direct/doc/ru/keywords/add). Категории без явного YES/NO Директ считает включёнными,
 * поэтому передаём все. В сетях «широкие» оставляем: там это охват интересов, а не мусорные запросы.
 */
/** Минус-слова группы в лимите Директа: до 7 слов во фразе, слово до 35 символов, все вместе — до 4096 символов */
export function groupNegatives(words: string[]) {
  const out: string[] = [];
  let len = 0;
  for (const w0 of words) {
    const w = w0.replace(/^-+/, "").replace(/\s+/g, " ").trim();
    if (!w || w.split(" ").length > 7 || w.split(" ").some((x) => x.replace(/^[!+]/, "").length > 35) || out.includes(w)) continue;
    if (len + w.length + 1 > 4096) break;
    out.push(w);
    len += w.length + 1;
  }
  return out;
}

export function autotargetingSettings(channel: Channel) {
  return {
    Categories: { Exact: "YES", Narrow: "YES", Alternative: "YES", Accessory: "NO", Broader: channel === "network" ? "YES" : "NO" },
    BrandOptions: { WithoutBrands: "YES", WithAdvertiserBrand: "YES", WithCompetitorsBrand: "NO" },
  };
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

/**
 * ads.moderate: объявление уже не черновик (отправлено раньше, идёт или прошло модерацию) — не ошибка.
 * Директ отвечает кодом 8300 «Неверный статус объекта»; текст проверяем строго, без любого упоминания «статуса».
 */
const notDraft = (e: { Code: number; Message: string; Details?: string }) =>
  e.Code === 8300 || /DRAFT|черновик|(неверн|недопустим)\S*\s+статус|invalid\s+(object\s+)?status/i.test(`${e.Message} ${e.Details ?? ""}`);

/** Ошибка API Директа (json.error) — запрос отклонён целиком; иначе транспорт (сеть, таймаут, не-JSON) и исход неизвестен */
const isApiError = (e: unknown) => e instanceof PlatformError && !!e.detail && typeof e.detail === "object" && "error_code" in (e.detail as object);


/**
 * ID объявлений, ключевых фраз и т. п. в Директе бывают 19-значными (1925601344670434674) — больше 2^53:
 * обычный JSON.parse/Number их искажает, и Директ отвечает «Объект не найден». Длинные целые из ответа читаем
 * строками, а в запрос отправляем как есть (BigInt → цифры без кавычек).
 */
export function bigParse(text: string): any {
  // Проходим текст, помня, внутри ли мы строки: длинные числа вне строк оборачиваем в кавычки
  let out = "", i = 0, inStr = false;
  while (i < text.length) {
    const ch = text[i];
    if (inStr) {
      out += ch;
      if (ch === "\\") { out += text[i + 1] ?? ""; i += 2; continue; }
      if (ch === '"') inStr = false;
      i++;
      continue;
    }
    if (ch === '"') { inStr = true; out += ch; i++; continue; }
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      let j = i + 1;
      while (j < text.length && /[0-9.eE+-]/.test(text[j])) j++;
      const num = text.slice(i, j);
      out += /^-?\d{16,}$/.test(num) ? `"${num}"` : num;
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return JSON.parse(out);
}
export function bigStringify(x: unknown): string {
  // BigInt и строки из одних цифр длиной от 16 (ID, прочитанные bigParse) уходят числом, как ждёт Директ
  return JSON.stringify(x, (_k, v) => (typeof v === "bigint" || (typeof v === "string" && /^\d{16,}$/.test(v)) ? `__BIGINT__${v}` : v)).replace(/"__BIGINT__(-?\d+)"/g, "$1");
}
/** ID Директа для запроса: длинный — BigInt (без потери точности), короткий — число */
export const did = (x: unknown): number => {
  const t = String(x ?? "").trim();
  return (/^-?\d{16,}$/.test(t) ? BigInt(t) : Number(t)) as unknown as number;
};

/** Праздники: показываем в обычные часы (Директ требует StartHour/EndHour, если не останавливать показы в праздники) */
export function holidaysFrom(schedule: string[]) {
  let from = 24, to = 0;
  for (const row of schedule) {
    const coef = row.split(",").slice(1).map(Number);
    coef.forEach((c, h) => { if (c > 0) { from = Math.min(from, h); to = Math.max(to, h + 1); } });
  }
  if (from >= to) { from = 0; to = 24; }
  return { SuspendOnHolidays: "NO", BidPercent: 100, StartHour: from, EndHour: to };
}

export class YandexDirect implements PlatformClient, WordstatReports {
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
      body: bigStringify({ method, params }),
    });
    const text = await res.text();
    let json: any;
    try {
      json = bigParse(text);
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

  private strategy(channel: Channel, weeklyBudget: number, strategy: Strategy, goalId?: number | null, bidCeiling?: number | null, placements?: Record<string, "YES" | "NO"> | null) {
    // Потолок ставки ограничивает, сколько автостратегия готова платить за клик, — а значит, и место в выдаче
    const ceiling = bidCeiling && channel === "search" ? { BidCeiling: micros(bidCeiling) } : {};
    const active =
      strategy === "conversions" && goalId
        ? { BiddingStrategyType: "WB_MAXIMUM_CONVERSION_RATE", WbMaximumConversionRate: { WeeklySpendLimit: micros(netOfVat(weeklyBudget)), GoalId: goalId, ...ceiling } }
        : { BiddingStrategyType: "WB_MAXIMUM_CLICKS", WbMaximumClicks: { WeeklySpendLimit: micros(netOfVat(weeklyBudget)), ...ceiling } };
    const off = { BiddingStrategyType: "SERVING_OFF" };
    // Места показов на поиске (UnifiedCampaign BiddingStrategy.Search.PlacementTypes): Карты и список организаций — с профилем организации
    return channel === "search" ? { Search: placements ? { ...active, PlacementTypes: placements } : active, Network: off } : { Search: off, Network: active };
  }

  /**
   * Создаёт ЕПК с группами и объявлениями. Объявления остаются черновиками (DRAFT) — на модерацию их отправляет
   * activateCampaign в конце запуска: «Отправить на модерацию можно только объявления со статусом DRAFT» (ads.moderate),
   * а черновики не показываются, поэтому недозапущенная кампания не тратит деньги.
   * Возобновляемо: spec.resume — что уже создано (кампания, группы, объявления); хуки сохраняют каждый шаг сразу.
   * Объявления группы уходят одним ads.add (до 1000 в вызове по документации), поштучно — только отклонённые.
   */
  async launchCampaign(spec: CampaignSpec, hooks?: LaunchHooks): Promise<LaunchResult> {
    const warnings: string[] = [];
    const resume = spec.resume ?? null;
    const late = () => spec.deadline !== undefined && Date.now() > spec.deadline;
    this.onImageUploaded = hooks?.onImageUploaded;

    // Профиль организации: привязываем, только если он опубликован и доступен этому логину
    const businessId = await this.linkableBusiness(spec.orgId, warnings);

    let campaignExt = resume?.campaignExt ?? null;
    if (!campaignExt) {
      campaignExt = await this.addCampaign(spec, businessId, warnings);
      await hooks?.onCampaignCreated?.(campaignExt);
    }
    const out: LaunchResult = { campaignExt, groups: [], warnings, complete: true };
    for (const g of spec.groups) {
      const done = resume?.groups[g.localId];
      let groupExt = done?.groupExt ?? "";
      const known: Record<string, string> = { ...(done?.ads ?? {}) };
      const todo = g.ads.filter((a) => !known[a.localId]);
      if (!groupExt || todo.length) {
        if (late()) {
          out.complete = false;
          break;
        }
      }
      if (!groupExt) {
        groupExt = await this.createGroup(campaignExt, g, spec.channel, warnings);
        await hooks?.onGroupCreated?.(g.localId, groupExt);
      }

      const created: LaunchResult["groups"][number]["ads"] = [];
      if (todo.length) {
        // Готовим все объявления группы (картинки, уточнения, быстрые ссылки), затем одним ads.add.
        // В группе не больше 3 неархивных комбинаторных объявлений: лишние не отправляем, а честно пишем почему.
        const room = Math.max(0, DIRECT_AD_LIMITS.nonArchived - Object.keys(known).length);
        const built: { ad: AdSpec; b: Awaited<ReturnType<YandexDirect["buildResponsiveAd"]>> }[] = [];
        for (const [i, ad] of todo.entries()) {
          if (i >= room) {
            created.push({ localId: ad.localId, adExt: null, error: `В группе Директа может быть не больше ${DIRECT_AD_LIMITS.nonArchived} объявлений — это не отправили` });
            continue;
          }
          try {
            built.push({ ad, b: await this.buildResponsiveAd(ad, warnings, businessId) });
          } catch (e) {
            created.push({ localId: ad.localId, adExt: null, error: (e as Error).message });
          }
        }
        let batch: DirectItemResult[] | null = null;
        if (built.length) {
          try {
            const res = await this.call("ads", "add", {
              Ads: built.map(({ b }) => ({ AdGroupId: did(groupExt), ResponsiveAd: { ...b.ad, ...Object.fromEntries(b.optional.map(([k, , v]) => [k, v])) } })),
            });
            batch = (res.AddResults ?? []) as DirectItemResult[];
          } catch (e) {
            // Директ отклонил запрос целиком — пробуем по одному. Сбой транспорта: пачка могла создаться —
            // сверяемся с ads.get по группе, иначе повтор создал бы дубли
            if (isApiError(e)) batch = null;
            else batch = await this.findCreated(groupExt, built.map(({ ad }) => ad), new Set(Object.values(known))).catch(() => { throw e; });
          }
        }
        for (const [i, { ad, b }] of built.entries()) {
          const r = batch?.[i];
          if (r?.Id && !r.Errors?.length) {
            for (const w of r.Warnings ?? []) warnings.push(`Объявление: ${w.Message}${w.Details ? ` — ${w.Details}` : ""}`);
            created.push({ localId: ad.localId, adExt: String(r.Id), imageRef: b.imageRef });
            continue;
          }
          // Отклонено в пачке: по одному, убирая необязательные поля
          try {
            const adExt = await this.addBuilt(groupExt, ad, b, warnings);
            created.push({ localId: ad.localId, adExt, imageRef: b.imageRef });
          } catch (e) {
            created.push({ localId: ad.localId, adExt: null, error: (e as Error).message });
          }
        }
        await hooks?.onAdsCreated?.(g.localId, groupExt, created);
      }
      out.groups.push({
        localId: g.localId,
        groupExt,
        ads: g.ads.map((a) => created.find((x) => x.localId === a.localId) ?? { localId: a.localId, adExt: known[a.localId] ?? null }),
      });
    }
    return out;
  }

  /**
   * Сбой транспорта при пачке ads.add: какие из объявлений всё-таки создались. Сопоставляем по основному заголовку
   * среди объявлений группы, которых мы ещё не знаем. Результат — в формате AddResults (нет совпадения — пустой элемент).
   */
  private async findCreated(groupExt: string, ads: AdSpec[], knownIds: Set<string>): Promise<DirectItemResult[]> {
    const res = await this.call("ads", "get", { SelectionCriteria: { AdGroupIds: [did(groupExt)] }, FieldNames: ["Id"], ResponsiveAdFieldNames: ["Titles"] });
    const pool = ((res?.Ads ?? []) as any[])
      .filter((a) => !knownIds.has(String(a.Id)))
      .map((a) => ({ id: did(a.Id), title: String((a.ResponsiveAd?.Titles?.Items ?? a.ResponsiveAd?.Titles ?? [])[0] ?? "") }));
    return ads.map((ad) => {
      const i = pool.findIndex((x) => x.title === ad.title.trim());
      return i < 0 ? {} : { Id: pool.splice(i, 1)[0].id };
    });
  }

  /** ads.moderate (до 10 000 ID в вызове): результаты по объявлениям; «уже не черновик» — не ошибка */
  private async moderate(ids: number[]): Promise<{ bad: DirectItemResult[]; warnings: string[] }> {
    const bad: DirectItemResult[] = [];
    for (let i = 0; i < ids.length; i += 10_000) {
      const chunk = ids.slice(i, i + 10_000);
      const res = await this.call("ads", "moderate", { SelectionCriteria: { Ids: chunk } });
      ((res?.ModerateResults ?? []) as DirectItemResult[]).forEach((r, k) => {
        if (r.Errors?.length && !notDraft(r.Errors[0])) bad.push({ ...r, Id: r.Id ?? chunk[k] });
      });
    }
    const warnings = bad.map((r) => `Объявление ${r.Id} не ушло на модерацию: ${r.Errors![0].Message}${r.Errors![0].Details ? ` — ${r.Errors![0].Details}` : ""}`);
    return { bad, warnings };
  }

  /** Черновики — на модерацию (sync: объявление осталось DRAFT, например прошлая отправка не прошла) */
  async moderateAds(adExts: string[]): Promise<string[]> {
    if (!adExts.length) return [];
    return (await this.moderate(adExts.map(did))).warnings;
  }

  /** Включение после запуска: черновики объявлений — на модерацию */
  async activateCampaign(_campaignExt: string, adExts: string[]) {
    const { bad, warnings } = await this.moderate(adExts.map(did));
    if (bad.length && bad.length === adExts.length) {
      throw new PlatformError("yandex", `Отправка на модерацию: ${bad[0].Errors![0].Message}${bad[0].Errors![0].Details ? ` — ${bad[0].Errors![0].Details}` : ""}`, bad[0].Errors);
    }
    // Часть не ушла — оставшиеся черновиками sync отправит повторно
    for (const w of warnings) console.warn(`[yandex] ${w}`);
  }

  /** Удаляем недосозданную кампанию; если Директ не даёт (уже были показы) — останавливаем */
  async removeCampaign(campaignExt: string) {
    const sel = { SelectionCriteria: { Ids: [did(campaignExt)] } };
    try {
      const res = await this.call("campaigns", "delete", sel);
      this.items(res.DeleteResults, "Удаление кампании");
    } catch {
      const res = await this.call("campaigns", "suspend", sel);
      this.items(res.SuspendResults, "Остановка кампании");
    }
  }

  private imageCache = new Map<string, string>();
  private onImageUploaded?: LaunchHooks["onImageUploaded"];

  async uploadImage(img: NonNullable<AdSpec["image"]>): Promise<string> {
    if (img.cachedRef) return img.cachedRef;
    const hit = this.imageCache.get(img.imageId);
    if (hit) return hit;
    const res = await this.call("adimages", "add", {
      AdImages: [{ ImageData: img.data.toString("base64"), Name: `pz-${img.imageId}`.slice(0, 255) }],
    });
    const [r] = this.items(res.AddResults, "Изображение");
    this.imageCache.set(img.imageId, r.AdImageHash!);
    await this.onImageUploaded?.(img.imageId, r.AdImageHash!).catch(() => undefined);
    return r.AdImageHash!;
  }

  private calloutCache = new Map<string, number>();

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

  // ─── Кампания, группа, организация ───────────────────────────────────

  /**
   * campaigns.add для ЕПК. Необязательные части (расписание показов, профиль организации и места показа на Картах)
   * при отказе Директа снимаем по одной, чтобы кампания всё равно создалась.
   */
  private async addCampaign(spec: CampaignSpec, businessId: number | null, warnings: string[]): Promise<string> {
    const settings = [
      { Option: "ADD_METRICA_TAG", Value: "YES" },
      { Option: "ENABLE_SITE_MONITORING", Value: "YES" },
      { Option: "ALTERNATIVE_TEXTS_ENABLED", Value: "YES" },
    ];
    // Карты и список организаций на поиске — только вместе с профилем организации
    const placements = businessId && spec.channel === "search"
      ? { SearchResults: "YES", ProductGallery: "YES", DynamicPlaces: "YES", Maps: "YES", SearchOrganizationList: "YES" } as Record<string, "YES" | "NO">
      : null;
    const optional: { label: string; apply: (c: Record<string, any>, u: Record<string, any>) => void }[] = [];
    const tt = spec.timeTargeting;
    if (tt?.schedule.length) {
      optional.push({
        label: "расписание показов по часам работы",
        apply: (c) => {
          c.TimeZone = tt.timeZone;
          c.TimeTargeting = { Schedule: { Items: tt.schedule }, ConsiderWorkingWeekends: tt.considerWorkingWeekends ? "YES" : "NO", HolidaysSchedule: holidaysFrom(tt.schedule) };
        },
      });
    }
    if (businessId) {
      optional.push({
        label: "показ на Картах и данные организации",
        apply: (_c, u) => {
          u.Settings = [...u.Settings, { Option: "ENABLE_COMPANY_INFO", Value: "YES" }];
          if (placements) u.BiddingStrategy = this.strategy(spec.channel, spec.weeklyBudget, spec.strategy, spec.goalId, null, placements);
        },
      });
    }
    for (;;) {
      const unified: Record<string, any> = {
        BiddingStrategy: this.strategy(spec.channel, spec.weeklyBudget, spec.strategy, spec.goalId),
        Settings: [...settings],
      };
      if (spec.counterId) unified.CounterIds = { Items: [spec.counterId] };
      if (spec.counterId && spec.goalId) unified.PriorityGoals = { Items: [{ GoalId: spec.goalId, Value: micros(1000) }] };
      const campaign: Record<string, any> = { Name: spec.name.slice(0, 255), StartDate: spec.startDate, UnifiedCampaign: unified };
      if (spec.negativeKeywords.length) campaign.NegativeKeywords = { Items: spec.negativeKeywords.slice(0, 1000) };
      for (const o of optional) o.apply(campaign, unified);
      try {
        const res = await this.call("campaigns", "add", { Campaigns: [campaign] });
        const local: string[] = [];
        const [c] = this.items(res.AddResults, "Кампания", local);
        warnings.push(...local);
        if (spec.demographics?.length) {
          const w = await this.setDemographics(String(c.Id), spec.demographics);
          warnings.push(...w);
        }
        return String(c.Id);
      } catch (e) {
        if (!optional.length) throw e;
        const o = optional.shift()!; // сначала расписание (часовой пояс), потом организация
        warnings.push(`Кампания: Директ не принял ${o.label}, создаём без этого — ${(e as Error).message}`);
      }
    }
  }

  /**
   * Пол и возраст в ЕПК — корректировки ставок кампании (bidmodifiers, https://yandex.ru/dev/direct/doc/ru/bidmodifiers/add):
   * BidModifier 0 = «−100%», т. е. не показывать этой группе. Старые корректировки «пол и возраст» сначала удаляем.
   */
  private async setDemographics(campaignExt: string, list: DemographicsAdjustment[]): Promise<string[]> {
    try {
      const got = await this.call("bidmodifiers", "get", {
        SelectionCriteria: { CampaignIds: [did(campaignExt)], Levels: ["CAMPAIGN"], Types: ["DEMOGRAPHICS_ADJUSTMENT"] },
        FieldNames: ["Id", "Type"],
      }).catch(() => null);
      const ids = ((got?.BidModifiers ?? []) as { Id: number }[]).map((x) => x.Id);
      if (ids.length) await this.call("bidmodifiers", "delete", { SelectionCriteria: { Ids: ids } });
      if (!list.length) return [];
      await this.call("bidmodifiers", "add", { BidModifiers: [{ CampaignId: did(campaignExt), DemographicsAdjustments: list }] });
      return [];
    } catch (e) {
      return [`Возраст и пол: Директ не принял корректировки — ${(e as Error).message}`];
    }
  }

  /** Регион групп, расписание и пол/возраст у идущей кампании — без пересоздания */
  async updateTargeting(campaignExt: string, t: TargetingUpdate): Promise<string[]> {
    const warnings: string[] = [];
    if (t.timeTargeting !== undefined) {
      const tt = t.timeTargeting;
      const all = Array.from({ length: 7 }, (_, i) => `${i + 1},${Array(24).fill(100).join(",")}`);
      try {
        await this.call("campaigns", "update", {
          Campaigns: [{
            Id: did(campaignExt),
            ...(tt ? { TimeZone: tt.timeZone } : {}),
            TimeTargeting: { Schedule: { Items: tt?.schedule ?? all }, ConsiderWorkingWeekends: tt?.considerWorkingWeekends ? "YES" : "NO", HolidaysSchedule: holidaysFrom(tt?.schedule ?? all) },
          }],
        });
      } catch (e) {
        warnings.push(`Расписание: ${(e as Error).message}`);
      }
    }
    const groups = t.groups.filter((g) => g.regionIds.length);
    for (let i = 0; i < groups.length; i += 1000) {
      try {
        await this.call("adgroups", "update", { AdGroups: groups.slice(i, i + 1000).map((g) => ({ Id: did(g.groupExt), RegionIds: g.regionIds })) });
      } catch (e) {
        warnings.push(`Регион: ${(e as Error).message}`);
      }
    }
    if (t.demographics) warnings.push(...(await this.setDemographics(campaignExt, t.demographics)));
    return warnings;
  }

  /**
   * Условие ретаргетинга «были на сайте, но не оставили заявку» (retargetinglists.add, https://yandex.ru/dev/direct/doc/ru/retargetinglists/add):
   * правило ANY — цель Метрики «посетил сайт» за N дней, правило NONE — цель «обращение» за те же дни (MembershipLifeSpan 1–540).
   * Пользователь попадает в аудиторию, если выполнены все правила. Условие с тем же именем используем повторно.
   */
  async ensureAudience(a: AudienceSpec): Promise<string> {
    if (!a.visitGoalId || !a.leadGoalId) throw new PlatformError("yandex", "Ретаргетинг: нет целей Метрики «посетил сайт» и «обращение»");
    const name = a.name.slice(0, 250);
    const got = await this.call("retargetinglists", "get", { SelectionCriteria: {}, FieldNames: ["Id", "Name"] }).catch(() => null);
    const found = ((got?.RetargetingLists ?? []) as { Id: number; Name: string }[]).find((x) => x.Name === name);
    if (found) return String(found.Id);
    const days = Math.max(1, Math.min(540, a.days));
    const res = await this.call("retargetinglists", "add", {
      RetargetingLists: [{
        Type: "RETARGETING",
        Name: name,
        Description: "Самоход: были на сайте или странице записи, но не оставили заявку",
        Rules: [
          { Operator: "ANY", Arguments: [{ ExternalId: a.visitGoalId, MembershipLifeSpan: days }] },
          { Operator: "NONE", Arguments: [{ ExternalId: a.leadGoalId, MembershipLifeSpan: days }] },
        ],
      }],
    });
    const [r] = this.items(res.AddResults, "Условие ретаргетинга");
    return String(r.Id);
  }

  /**
   * Группа с ключевыми фразами и автотаргетингом (без брендов конкурентов и слишком широких запросов).
   * Ретаргетинг (retargetingId): без фраз и автотаргетинга, только условие ретаргетинга — audiencetargets.add
   * (https://yandex.ru/dev/direct/doc/ru/audiencetargets/add; при автостратегии ставка не нужна, приоритет — обычный).
   */
  private async createGroup(campaignExt: string, g: Pick<GroupSpec, "name" | "regionIds" | "keywords" | "autotargeting" | "retargetingId" | "negatives">, channel: Channel, warnings: string[]) {
    const group: Record<string, unknown> = { Name: g.name.slice(0, 255), CampaignId: did(campaignExt), RegionIds: g.regionIds, UnifiedAdGroup: { OfferRetargeting: "NO" } };
    // Минус-слова группы (кросс-минусовка): AdGroupAddItem.NegativeKeywords, до 4096 символов вместе (adgroups/add).
    // Не приняли — создаём группу без них: группа важнее
    const neg = groupNegatives(g.negatives ?? []);
    let gr;
    if (neg.length && !g.retargetingId) {
      try {
        gr = await this.call("adgroups", "add", { AdGroups: [{ ...group, NegativeKeywords: { Items: neg } }] });
        if ((gr.AddResults as DirectItemResult[] | undefined)?.[0]?.Errors?.length) {
          warnings.push(`Группа «${g.name}»: Директ не принял минус-слова группы — ${gr.AddResults[0].Errors[0].Message}; создали без них`);
          gr = null;
        }
      } catch (e) {
        warnings.push(`Группа «${g.name}»: Директ не принял минус-слова группы — ${(e as Error).message}; создали без них`);
        gr = null;
      }
    }
    gr ??= await this.call("adgroups", "add", { AdGroups: [group] });
    const [gi] = this.items(gr.AddResults, `Группа «${g.name}»`, warnings);
    const groupExt = String(gi.Id);
    if (g.retargetingId) {
      const ar = await this.call("audiencetargets", "add", { AudienceTargets: [{ AdGroupId: did(groupExt), RetargetingListId: did(g.retargetingId), StrategyPriority: "NORMAL" }] });
      this.items(ar.AddResults, `Аудитория группы «${g.name}»`, warnings);
      return groupExt;
    }
    const keywords = [...new Set(g.keywords.map((k) => k.trim()).filter(Boolean))].slice(0, 200);
    const items: Record<string, unknown>[] = keywords.map((Keyword) => ({ Keyword, AdGroupId: did(groupExt) }));
    if (g.autotargeting) items.push({ Keyword: "---autotargeting", AdGroupId: did(groupExt), AutotargetingSettings: autotargetingSettings(channel) });
    if (items.length) {
      try {
        const kr = await this.call("keywords", "add", { Keywords: items });
        for (const [i, r] of ((kr.AddResults ?? []) as DirectItemResult[]).entries()) {
          if (!r.Errors?.length) continue;
          const it = items[i];
          if (it.AutotargetingSettings) {
            // Настройки категорий не приняты — включаем автотаргетинг как раньше, со всеми категориями
            const retry = await this.call("keywords", "add", { Keywords: [{ Keyword: "---autotargeting", AdGroupId: did(groupExt) }] }).catch(() => null);
            warnings.push(`Автотаргетинг группы «${g.name}»: Директ не принял исключение конкурентов и широких запросов — ${r.Errors[0].Message}${retry ? "; включили со всеми категориями" : ""}`);
          } else warnings.push(`Фраза «${it.Keyword}» не добавлена: ${r.Errors[0].Message}`);
        }
      } catch (e) {
        warnings.push(`Ключевые фразы группы «${g.name}»: ${(e as Error).message}`);
      }
    }
    return groupExt;
  }

  /**
   * Есть ли показы по фразам в регионах (keywordsresearch.hasSearchVolume: до 10 000 фраз, без повторов;
   * https://yandex.ru/dev/direct/doc/ru/keywordsresearch/hasSearchVolume). Фраза → AllDevices === "YES".
   */
  async hasSearchVolume(keywords: string[], regionIds: number[]): Promise<Map<string, boolean>> {
    const out = new Map<string, boolean>();
    const list = [...new Set(keywords)];
    for (let i = 0; i < list.length; i += 10_000) {
      const res = await this.call("keywordsresearch", "hasSearchVolume", {
        SelectionCriteria: { Keywords: list.slice(i, i + 10_000), RegionIds: regionIds.length ? regionIds : [0] },
        FieldNames: ["Keyword", "AllDevices"],
      });
      for (const r of (res?.HasSearchVolumeResults ?? []) as { Keyword: string; AllDevices?: string }[]) out.set(r.Keyword, r.AllDevices === "YES");
    }
    return out;
  }

  /**
   * Дубли фраз с точки зрения Директа (keywordsresearch.deduplicate, MERGE_DUPLICATES; до 400 000 фраз;
   * https://yandex.ru/dev/direct/doc/ru/keywordsresearch/deduplicate). Пересечения (ELIMINATE_OVERLAPPING) не включаем:
   * между группами их разводят минус-слова групп, а внутри группы минус-хвосты лишь режут показы автостратегии.
   */
  async deduplicateKeywords(items: { id: number; keyword: string }[]): Promise<{ update: { id: number; keyword: string }[]; remove: number[] }> {
    const res = await this.call("keywordsresearch", "deduplicate", { Keywords: items.map((x) => ({ Id: x.id, Keyword: x.keyword })), Operation: ["MERGE_DUPLICATES"] });
    return {
      update: ((res?.Update ?? []) as { Id: number; Keyword: string }[]).map((u) => ({ id: did(u.Id), keyword: u.Keyword })),
      remove: ((res?.Delete?.Ids ?? []) as number[]).map(Number),
    };
  }

  // ─── Wordstat (API v4: в v5 прогноза и статистики запросов нет, Live4 CreateNewForecast отключён) ───

  /**
   * Вызов JSON API v4 (https://yandex.ru/dev/direct/doc/dg-v4/concepts/JSON): токен — в теле запроса, ответ —
   * {"data": …} или {"error_code", "error_str", "error_detail"}. Ошибки — PlatformError с detail.error_code
   * (31 — уже 5 отчётов, 152 — не хватает баллов, 53 — токен не подходит).
   */
  /** Последние сырые ответы v4 по методам (первые 500 символов) — для диагностики сбора спроса */
  v4Raw: Record<string, string> = {};

  async callV4<T = any>(method: string, param?: unknown): Promise<T> {
    const body: Record<string, unknown> = { method, token: this.token, locale: "ru" };
    if (param !== undefined) body.param = param;
    let res: Response;
    try {
      res = await fetch(V4(), { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      this.v4Raw[method] = `(нет ответа: ${(e as Error).name}: ${(e as Error).message})`.slice(0, 500);
      throw new PlatformError("yandex", `Директ v4 ${method}: нет ответа (${(e as Error).name})`);
    }
    const text = await res.text();
    // Токен в ответах не встречается, но на всякий случай вырезаем его из образца
    this.v4Raw[method] = `HTTP ${res.status}: ${text.split(this.token).join("***").slice(0, 500)}`;
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new PlatformError("yandex", `Директ v4 ${method} ответил не JSON (HTTP ${res.status})`, { sample: text.slice(0, 300) });
    }
    // Ошибка v4 — на верхнем уровне ({error_code, error_str, error_detail}); на всякий случай смотрим и в error/data
    const errObj = json?.error_code !== undefined && json?.error_code !== null ? json : json?.error && typeof json.error === "object" ? json.error : null;
    if (errObj) {
      const code = Number(errObj.error_code ?? errObj.code);
      const str = errObj.error_str ?? errObj.error_string ?? errObj.message ?? "ошибка";
      const detail = errObj.error_detail ?? errObj.detail;
      const err = new PlatformError("yandex", `Директ v4 ${method}: ${str}${detail ? ` — ${detail}` : ""} (код ${Number.isFinite(code) ? code : "?"})`, { error_code: code, error_str: str, error_detail: detail });
      err.httpStatus = res.status;
      throw err;
    }
    if (!res.ok) throw new PlatformError("yandex", `Директ v4 ${method}: HTTP ${res.status}`, { sample: text.slice(0, 300) });
    return (json && typeof json === "object" && "data" in json ? json.data : json) as T;
  }

  /** CreateNewWordstatReport: до 10 фраз, регионы GeoID. Возвращает ID отчёта */
  async wordstatCreate(phrases: string[], regionIds: number[]): Promise<number> {
    const data = await this.callV4<any>("CreateNewWordstatReport", { Phrases: phrases.slice(0, 10), GeoID: regionIds.filter((r) => r) });
    const n = Number(typeof data === "object" && data ? data.ReportID ?? data.ReportId ?? data.Id ?? data.id : data);
    if (!Number.isFinite(n) || n <= 0) throw new PlatformError("yandex", "Директ v4 CreateNewWordstatReport: в ответе нет номера отчёта", { sample: JSON.stringify(data)?.slice(0, 300) });
    return n;
  }

  /** GetWordstatReportList: до 5 отчётов пользователя со статусом Done | Pending | Failed */
  async wordstatList(): Promise<{ id: number; status: string }[]> {
    const data = await this.callV4<any>("GetWordstatReportList");
    const list = Array.isArray(data) ? data : Array.isArray(data?.Reports) ? data.Reports : Array.isArray(data?.reports) ? data.reports : [];
    return list
      .map((r: any) => ({ id: Number(r?.ReportID ?? r?.ReportId ?? r?.reportID ?? r?.Id ?? r?.id), status: String(r?.StatusReport ?? r?.Status ?? r?.status ?? "") }))
      .filter((r: { id: number }) => Number.isFinite(r.id));
  }

  /** GetWordstatReport: по каждой фразе отчёта — SearchedWith [{Phrase, Shows}] (Shows — запросов за прошлый месяц) */
  async wordstatGet(reportId: number): Promise<WordstatPhrase[]> {
    const data = await this.callV4<any>("GetWordstatReport", reportId);
    const rows = Array.isArray(data) ? data : Array.isArray(data?.Report) ? data.Report : Array.isArray(data?.Phrases) ? data.Phrases : data && typeof data === "object" && (data.Phrase || data.SearchedWith) ? [data] : [];
    return rows.map((r: any) => parseWordstatInfo(r));
  }

  async wordstatDelete(reportId: number): Promise<void> {
    await this.callV4("DeleteWordstatReport", reportId);
  }

  /** Синхронно: создать отчёт, дождаться (не дольше timeoutMs), прочитать и удалить. Для движка спроса — раздельные методы */
  async wordstat(phrases: string[], regionIds: number[], opts: { timeoutMs?: number } = {}): Promise<WordstatPhrase[]> {
    const until = Date.now() + (opts.timeoutMs ?? 40_000);
    const out: WordstatPhrase[] = [];
    for (let i = 0; i < phrases.length; i += 10) {
      const id = await this.wordstatCreate(phrases.slice(i, i + 10), regionIds);
      try {
        for (;;) {
          const st = (await this.wordstatList()).find((r) => String(r.id) === String(id))?.status;
          if (st === "Done") break;
          if (st === "Failed" || !st) throw new PlatformError("yandex", "Директ v4: отчёт Wordstat не сформировался");
          if (Date.now() + 3000 > until) throw new PlatformError("yandex", "Директ v4: отчёт Wordstat не успел сформироваться");
          await sleep(3000);
        }
        out.push(...(await this.wordstatGet(id)));
      } finally {
        await this.wordstatDelete(id).catch(() => {});
      }
    }
    return out;
  }

  /** Новая группа в работающей кампании — когда в старой исчерпан лимит в 10 объявлений */
  async addGroup(campaignExt: string, g: Omit<GroupSpec, "ads" | "localId">, ctx: { channel: Channel }) {
    const warnings: string[] = [];
    const groupExt = await this.createGroup(campaignExt, g, ctx.channel, warnings);
    return { groupExt, warnings };
  }

  private businessCache = new Map<string, { id: number; name: string; isPublished: boolean; address: string | null; profileUrl: string | null } | null>();

  /**
   * Профиль организации в Яндекс Бизнесе (businesses.get). Директ отдаёт только профили, на которые у представителя
   * подтверждены права, или уже привязанные к объявлениям; привязать можно только опубликованный (IsPublished = YES).
   * https://yandex.ru/dev/direct/doc/ru/businesses/get
   */
  async businessProfile(orgId: string | number) {
    const key = String(orgId);
    if (this.businessCache.has(key)) return this.businessCache.get(key)!;
    const res = await this.call("businesses", "get", { SelectionCriteria: { Ids: [did(orgId)] }, FieldNames: ["Id", "Name", "Address", "ProfileUrl", "IsPublished"] });
    const b = (res?.Businesses ?? []).find((x: any) => String(x.Id) === key) ?? (res?.Businesses ?? [])[0];
    const out = b ? { id: did(b.Id), name: String(b.Name ?? ""), isPublished: b.IsPublished === "YES", address: b.Address ?? null, profileUrl: b.ProfileUrl ?? null } : null;
    this.businessCache.set(key, out);
    return out;
  }

  /** BusinessId для объявлений или null с понятным предупреждением владельцу */
  private async linkableBusiness(orgId: string | null | undefined, warnings: string[]): Promise<number | null> {
    if (!orgId || !/^\d{3,20}$/.test(String(orgId))) return null;
    try {
      const p = await this.businessProfile(orgId);
      if (!p) {
        warnings.push("Организация из Яндекс Карт не привязана: Директ не видит её профиль. Подтвердите права на организацию в Яндекс Бизнесе тем же логином, что и рекламный кабинет, — робот привяжет её к новым объявлениям.");
        return null;
      }
      if (!p.isPublished) {
        warnings.push(`Организация «${p.name}» ещё не опубликована в Яндекс Бизнесе (не прошла проверку) — привяжем, когда опубликуют.`);
        return null;
      }
      return p.id;
    } catch (e) {
      warnings.push(`Профиль организации проверить не удалось: ${(e as Error).message}`);
      return null;
    }
  }

  // ─── Объявления ──────────────────────────────────────────────────────

  /** Картинки объявления: основная + другие пропорции, до 5 разных (ResponsiveAd.AdImageHashes) */
  private async uploadImages(ad: AdSpec, warnings: string[]) {
    const list = [ad.image, ...(ad.images ?? [])].filter((x): x is NonNullable<AdSpec["image"]> => !!x);
    const seen = new Set<string>();
    const hashes: string[] = [];
    let imageRef: string | undefined;
    for (const img of list) {
      if (seen.has(img.imageId) || hashes.length >= RA.images) continue;
      seen.add(img.imageId);
      try {
        const h = await this.uploadImage(img);
        if (!hashes.includes(h)) hashes.push(h);
        if (img === ad.image) imageRef = h;
      } catch (e) {
        warnings.push(`Картинка ${img.width}×${img.height} не загрузилась, объявление пойдёт без неё: ${(e as Error).message}`);
      }
    }
    return { hashes, imageRef };
  }

  /** Поля комбинаторного объявления и необязательные дополнения (в порядке, в котором их убираем, если Директ отклонит) */
  private async buildResponsiveAd(ad: AdSpec, warnings: string[], businessId: number | null) {
    if (!ad.title.trim() || !ad.text.trim()) throw new PlatformError("yandex", "У объявления пустой заголовок или текст");
    const { titles, texts } = responsiveTexts(ad);
    const { hashes, imageRef } = await this.uploadImages(ad, warnings);
    const x = ad.extras;
    const extIds = x?.callouts.length ? await this.callouts(x.callouts, warnings) : [];
    const sitelinkSetId = x?.sitelinks.length ? await this.sitelinks(x.sitelinks, ad.href, warnings) : null;

    const body: Record<string, unknown> = { Titles: titles, Texts: texts, Href: ad.href };
    if (hashes.length) body.AdImageHashes = hashes;
    if (extIds.length) body.AdExtensionIds = extIds;
    if (sitelinkSetId) body.SitelinkSetId = sitelinkSetId;
    // ErirAdDescription Директ больше не принимает («Параметр устарел»): маркировку своей рекламы он делает сам
    // Необязательные поля: если Директ отклонит объявление, убираем их по одному (сначала профиль организации),
    // чтобы из-за одного поля не терять остальные
    const optional: [string, string, unknown][] = [];
    if (businessId) optional.push(["BusinessId", "профиль организации", businessId]);
    if (x?.price) optional.push(["PriceExtension", "цена", { Price: micros(x.price.price), PriceQualifier: x.price.qualifier, PriceCurrency: "RUB" }]);
    if (x?.displayPath) optional.push(["DisplayUrlPath", "отображаемая ссылка", x.displayPath.slice(0, 20)]);
    return { ad: body, optional, imageRef };
  }

  /** Одно объявление с повторами без необязательных полей */
  private async addBuilt(groupExt: string, ad: AdSpec, b: { ad: Record<string, unknown>; optional: [string, string, unknown][] }, warnings: string[]) {
    const optional = [...b.optional];
    let res: any;
    for (;;) {
      const extra = Object.fromEntries(optional.map(([k, , v]) => [k, v]));
      let err: unknown = null;
      try {
        res = await this.call("ads", "add", { Ads: [{ AdGroupId: did(groupExt), ResponsiveAd: { ...b.ad, ...extra } }] });
        const e = (res.AddResults as DirectItemResult[] | undefined)?.[0]?.Errors?.[0];
        if (e) err = new Error(`${e.Message}${e.Details ? ` — ${e.Details}` : ""}`);
      } catch (e) {
        err = e;
      }
      if (!err) break;
      if (!optional.length) throw err;
      const [, label] = optional.shift()!;
      warnings.push(`Объявление «${ad.title}»: Директ не принял поле «${label}», создаём без него: ${(err as Error).message}`);
    }
    const [r] = this.items(res.AddResults, "Объявление", warnings);
    return String(r.Id);
  }

  /** Новое объявление в работающую группу (робот): сразу на модерацию */
  async addAd(_campaignExt: string, groupExt: string, ad: AdSpec, ctx: { channel: Channel; orgId?: string | null }, warnings: string[] = [], moderate = true) {
    const businessId = await this.linkableBusiness(ctx.orgId, warnings);
    const b = await this.buildResponsiveAd(ad, warnings, businessId);
    const adExt = await this.addBuilt(groupExt, ad, b, warnings);
    if (moderate) warnings.push(...(await this.moderate([did(adExt)])).warnings);
    return { adExt, imageRef: b.imageRef };
  }

  adLimits(_channel: Channel): AdLimits {
    return DIRECT_AD_LIMITS;
  }

  /** В архив (ads.archive): освобождает место среди 3 неархивных объявлений группы */
  async archiveAds(adExts: string[]) {
    if (!adExts.length) return;
    const res = await this.call("ads", "archive", { SelectionCriteria: { Ids: adExts.map(did) } });
    for (const r of (res?.ArchiveResults ?? []) as DirectItemResult[]) {
      if (r.Errors?.length && !/архив|archiv/i.test(r.Errors[0].Message + (r.Errors[0].Details ?? ""))) {
        throw new PlatformError("yandex", `Архивирование объявления: ${r.Errors[0].Message}`, r.Errors);
      }
    }
  }

  /** ads.delete: Директ удаляет только объявления без статистики (черновики, отклонённые без показов) */
  async deleteAds(adExts: string[]) {
    if (!adExts.length) return [];
    const res = await this.call("ads", "delete", { SelectionCriteria: { Ids: adExts.map(did) } });
    return ((res?.DeleteResults ?? []) as DirectItemResult[]).map((r, i) => (r.Id && !r.Errors?.length ? String(r.Id ?? adExts[i]) : null)).filter((x): x is string => !!x);
  }

  async setCampaignActive(campaignExt: string, active: boolean) {
    await this.call("campaigns", active ? "resume" : "suspend", { SelectionCriteria: { Ids: [did(campaignExt)] } });
  }

  async setAdsActive(adExts: string[], active: boolean) {
    if (!adExts.length) return;
    if (active) {
      // Архивное объявление (робот освобождал место в группе) сначала достаём из архива — иначе resume его не включит
      const got = await this.call("ads", "get", { SelectionCriteria: { Ids: adExts.map(did) }, FieldNames: ["Id", "State"] }).catch(() => null);
      const archived = ((got?.Ads ?? []) as { Id: number; State: string }[]).filter((a) => a.State === "ARCHIVED").map((a) => a.Id);
      if (archived.length) {
        const ur = await this.call("ads", "unarchive", { SelectionCriteria: { Ids: archived } });
        for (const r of (ur?.UnarchiveResults ?? []) as DirectItemResult[]) {
          if (r.Errors?.length) throw new PlatformError("yandex", `Объявление в архиве и не возвращается: ${r.Errors[0].Message}${r.Errors[0].Details ? ` — ${r.Errors[0].Details}` : ""}. В группе Директа может быть не больше ${DIRECT_AD_LIMITS.nonArchived} неархивных объявлений — сначала остановите и уберите в архив другое.`, r.Errors);
        }
      }
    }
    const res = await this.call("ads", active ? "resume" : "suspend", { SelectionCriteria: { Ids: adExts.map(did) } });
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
      Campaigns: [{ Id: did(campaignExt), UnifiedCampaign: { BiddingStrategy: this.strategy(p.channel, p.weeklyBudget, p.strategy, p.goalId, p.bidCeiling) } }],
    });
    this.items(res.UpdateResults, "Бюджет кампании");
  }

  async setNegativeKeywords(campaignExt: string, words: string[]) {
    const res = await this.call("campaigns", "update", {
      Campaigns: [{ Id: did(campaignExt), NegativeKeywords: words.length ? { Items: words.slice(0, 1000) } : null }],
    });
    this.items(res.UpdateResults, "Минус-слова");
  }

  /**
   * Правка текста (ads.update → ResponsiveAd). Titles и Texts в update передаются целиком: без готовых списков
   * берём текущие у Директа и меняем в них основной вариант (первый), убирая склейки со старым основным заголовком.
   */
  /** Новая ссылка объявлений (ResponsiveAd.Href) — объявления уходят на модерацию заново */
  async updateAdsHref(adExts: string[], href: string): Promise<string[]> {
    const warnings: string[] = [];
    for (let i = 0; i < adExts.length; i += 1000) {
      const ids = adExts.slice(i, i + 1000).map(Number);
      try {
        const res = await this.call("ads", "update", { Ads: ids.map((Id) => ({ Id, ResponsiveAd: { Href: href } })) });
        const local: string[] = [];
        try { this.items(res.UpdateResults, "Ссылка объявления", local); } catch (e) { warnings.push((e as Error).message); }
        warnings.push(...local);
        warnings.push(...(await this.moderate(ids).catch((e) => ({ warnings: [`Модерация: ${(e as Error).message}`] }))).warnings);
      } catch (e) {
        warnings.push((e as Error).message);
      }
    }
    return warnings;
  }

  async updateAdText(adExt: string, t: { title: string; title2?: string | null; text: string; titles?: string[]; texts?: string[] }) {
    let titles = t.titles, texts = t.texts;
    if (!titles || !texts) {
      const cur = await this.call("ads", "get", { SelectionCriteria: { Ids: [did(adExt)] }, FieldNames: ["Id"], ResponsiveAdFieldNames: ["Titles", "Texts"] }).catch(() => null);
      const ra = cur?.Ads?.[0]?.ResponsiveAd;
      const oldTitles: string[] = ra?.Titles?.Items ?? ra?.Titles ?? [];
      const oldTexts: string[] = ra?.Texts?.Items ?? ra?.Texts ?? [];
      const oldMain = oldTitles[0];
      titles ??= oldTitles.slice(1).filter((x) => !oldMain || !x.startsWith(oldMain.replace(/[.!]$/, "")));
      texts ??= oldTexts.slice(1);
    }
    const r = responsiveTexts({ title: t.title, title2: t.title2, text: t.text, titles, texts });
    const res = await this.call("ads", "update", { Ads: [{ Id: did(adExt), ResponsiveAd: { Titles: r.titles, Texts: r.texts } }] });
    this.items(res.UpdateResults, "Текст объявления");
    // Текст уже изменён — ошибку отправки не бросаем (черновик sync отправит повторно), но и не глотаем молча
    for (const w of (await this.moderate([did(adExt)])).warnings) console.warn(`[yandex] ${w}`);
  }

  /** Реальное состояние кампаний: State ON — показывается; иначе причина из StatusClarification (деньги, модерация) */
  async getCampaignDelivery(campaignExts: string[]): Promise<Record<string, CampaignDelivery>> {
    const out: Record<string, CampaignDelivery> = {};
    for (let i = 0; i < campaignExts.length; i += 1000) {
      const res = await this.call("campaigns", "get", { SelectionCriteria: { Ids: campaignExts.slice(i, i + 1000).map(Number) }, FieldNames: ["Id", "State", "Status", "StatusPayment", "StatusClarification"] }).catch(() => null);
      for (const c of res?.Campaigns ?? []) {
        if (c.State === "ON" || c.State === "SUSPENDED" || c.State === "ARCHIVED") { out[String(c.Id)] = { ok: true }; continue; }
        const why = String(c.StatusClarification ?? "");
        const note = c.StatusPayment === "DISALLOWED" || /средств|деньг|оплат/i.test(why) ? "Не хватает средств на счёте Директа — пополните кабинет, и показы начнутся"
          : c.Status === "MODERATION" || /модерац/i.test(why) ? "Кампания на модерации Директа"
          : why || "Директ сейчас не показывает кампанию";
        out[String(c.Id)] = { ok: false, code: `${c.State}/${c.Status}/${c.StatusPayment ?? ""}`, note };
      }
    }
    return out;
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
        else if (a.Status === "DRAFT") {
          // Черновик сам на модерацию не уйдёт: помечаем, sync отправит его (у работающих кампаний)
          status = "moderation";
          note = "Черновик: ещё не отправлено на модерацию";
          out[String(a.Id)] = { status, note, draft: true };
          continue;
        } else if (a.Status === "MODERATION") status = "moderation";
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
    // Постранично: LimitedBy в ответе — есть следующая страница (Page.Offset); не больше 10 страниц
    const all: any[] = [];
    for (let offset = 0, p = 0; p < 10; p++) {
      const res = await this.call("keywordbids", "get", {
        SelectionCriteria: { CampaignIds: [did(campaignExt)] },
        FieldNames: ["KeywordId", "AdGroupId", "ServingStatus"],
        SearchFieldNames: ["Bid", "AuctionBids"],
        Page: { Limit: 2000, Offset: offset },
      });
      all.push(...((res?.KeywordBids ?? []) as any[]));
      if (!res?.LimitedBy) break;
      offset = Number(res.LimitedBy);
    }
    const byGroup = new Map<string, { keywords: number; tiers: Map<number, { bids: number[]; prices: number[] }> }>();
    for (const k of all) {
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

  /**
   * Поисковые запросы (SEARCH_QUERY_PERFORMANCE_REPORT). С целями Метрики — ещё и обращения по запросу (Conversions по каждой цели,
   * колонки Conversions_<цель>_<модель> складываем) и ключевая фраза, по которой был показ (Criterion).
   */
  async getSearchQueries(campaignExts: string[], from: string, to: string, goalIds: number[] = []): Promise<QueryRow[]> {
    if (!campaignExts.length) return [];
    const goals = goalIds.filter(Boolean).slice(0, 10);
    const rows = await this.report({
      SelectionCriteria: { DateFrom: from, DateTo: to, Filter: [{ Field: "CampaignId", Operator: "IN", Values: campaignExts }] },
      FieldNames: ["CampaignId", "Query", "Criterion", "Impressions", "Clicks", "Cost", ...(goals.length ? ["Conversions"] : [])],
      ReportType: "SEARCH_QUERY_PERFORMANCE_REPORT",
      ...(goals.length ? { Goals: goals, AttributionModels: ["AUTO"] } : {}),
    });
    return rows.map((r) => ({
      campaignExt: r.CampaignId,
      query: r.Query,
      criterion: r.Criterion && r.Criterion !== "--" ? r.Criterion : undefined,
      impressions: Number(r.Impressions) || 0,
      clicks: Number(r.Clicks) || 0,
      cost: Number(r.Cost) || 0,
      conversions: sumConversions(r),
    }));
  }

  /** РСЯ по площадкам: CUSTOM_REPORT с полем Placement (сайт или приложение), только сети (AdNetworkType = AD_NETWORK) */
  async getPlacements(campaignExts: string[], from: string, to: string, goalIds: number[] = []): Promise<PlacementRow[]> {
    if (!campaignExts.length) return [];
    const goals = goalIds.filter(Boolean).slice(0, 10);
    const rows = await this.report({
      SelectionCriteria: {
        DateFrom: from, DateTo: to,
        Filter: [{ Field: "CampaignId", Operator: "IN", Values: campaignExts }, { Field: "AdNetworkType", Operator: "EQUALS", Values: ["AD_NETWORK"] }],
      },
      FieldNames: ["CampaignId", "Placement", "Impressions", "Clicks", "Cost", ...(goals.length ? ["Conversions"] : [])],
      ReportType: "CUSTOM_REPORT",
      ...(goals.length ? { Goals: goals, AttributionModels: ["AUTO"] } : {}),
    });
    return rows
      .filter((r) => r.Placement && r.Placement !== "--")
      .map((r) => ({
        campaignExt: r.CampaignId,
        placement: r.Placement,
        impressions: Number(r.Impressions) || 0,
        clicks: Number(r.Clicks) || 0,
        cost: Number(r.Cost) || 0,
        conversions: sumConversions(r),
      }));
  }

  /** Запрещённые площадки кампании (campaigns.get → ExcludedSites) */
  async getExcludedSites(campaignExt: string): Promise<string[]> {
    const res = await this.call("campaigns", "get", { SelectionCriteria: { Ids: [did(campaignExt)] }, FieldNames: ["Id", "ExcludedSites"] });
    return ((res?.Campaigns?.[0]?.ExcludedSites?.Items ?? []) as string[]).map(String);
  }

  /** Новый список запрещённых площадок целиком (campaigns.update; Директ принимает не больше 1000) */
  async setExcludedSites(campaignExt: string, sites: string[]) {
    if (sites.length > MAX_EXCLUDED_SITES) throw new PlatformError("yandex", `Директ принимает не больше ${MAX_EXCLUDED_SITES} запрещённых площадок в кампании`);
    const res = await this.call("campaigns", "update", {
      Campaigns: [{ Id: did(campaignExt), ExcludedSites: sites.length ? { Items: sites } : null }],
    });
    this.items(res.UpdateResults, "Запрещённые площадки");
  }

  /**
   * Счётчики Метрики кампании (UnifiedCampaign.CounterIds) и приоритетная цель (PriorityGoals, операция SET).
   * Если Директ не примет цель — ставим хотя бы счётчики и возвращаем предупреждение.
   */
  async setCounters(campaignExt: string, counterIds: number[], goalId?: number | null): Promise<string[]> {
    const warnings: string[] = [];
    const unified: Record<string, unknown> = { CounterIds: { Items: counterIds.slice(0, 100) } };
    if (goalId) unified.PriorityGoals = { Items: [{ GoalId: goalId, Value: micros(1000), Operation: "SET" }] };
    try {
      const res = await this.call("campaigns", "update", { Campaigns: [{ Id: did(campaignExt), UnifiedCampaign: unified }] });
      this.items(res.UpdateResults, "Счётчик Метрики", warnings);
    } catch (e) {
      if (!goalId) throw e;
      warnings.push(`Ключевая цель не принята (${(e as Error).message}) — привязали только счётчик`);
      const res = await this.call("campaigns", "update", { Campaigns: [{ Id: did(campaignExt), UnifiedCampaign: { CounterIds: unified.CounterIds } }] });
      this.items(res.UpdateResults, "Счётчик Метрики", warnings);
    }
    return warnings;
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
    client_id: yaId(),
    redirect_uri: redirectUri,
    state,
    force_confirm: "yes",
  });
  return `https://oauth.yandex.ru/authorize?${p}`;
}

/** Значения из настроек Vercel чистим от пробелов и кавычек — частая причина «Wrong client secret» при вставке */
const envClean = (v?: string) => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();
const yaId = () => envClean(process.env.YANDEX_CLIENT_ID);
const yaSecret = () => envClean(process.env.YANDEX_CLIENT_SECRET);

/** Ошибки OAuth Яндекса — по-русски и с подсказкой, что сделать */
function yaOauthError(j: { error?: string; error_description?: string }, fallback: string) {
  const d = `${j.error_description ?? ""} ${j.error ?? ""}`.toLowerCase();
  if (d.includes("client secret") || d.includes("invalid_client") || d.includes("client not found"))
    return "Яндекс не принял ключи приложения: ClientID и Client secret в настройках сервиса (Vercel → Environment Variables: YANDEX_CLIENT_ID и YANDEX_CLIENT_SECRET) не подходят друг к другу. Скопируйте оба заново со страницы приложения на oauth.yandex.ru и сделайте Redeploy.";
  if (d.includes("code has expired") || d.includes("invalid_grant") || d.includes("bad verification code"))
    return "Код подтверждения от Яндекса устарел — нажмите «Подключить Яндекс» ещё раз.";
  return j.error_description || j.error || fallback;
}

export async function yandexExchange(code: string) {
  const res = await fetch("https://oauth.yandex.ru/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: yaId(),
      client_secret: yaSecret(),
    }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error(yaOauthError(j, "Яндекс не выдал токен"));
  return { accessToken: j.access_token as string, refreshToken: (j.refresh_token as string) || null, expiresIn: Number(j.expires_in) || 365 * 24 * 3600 };
}

export async function yandexRefresh(refreshToken: string) {
  const res = await fetch("https://oauth.yandex.ru/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: yaId(),
      client_secret: yaSecret(),
    }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error(yaOauthError(j, "Не удалось обновить доступ к Яндексу"));
  return { accessToken: j.access_token as string, refreshToken: (j.refresh_token as string) || refreshToken, expiresIn: Number(j.expires_in) || 365 * 24 * 3600 };
}

export async function yandexLogin(token: string): Promise<{ login: string; id: string }> {
  const res = await fetch("https://login.yandex.ru/info?format=json", { headers: { Authorization: `OAuth ${token}` } });
  const j = await res.json();
  return { login: j.login || j.default_email || "яндекс", id: String(j.id || "") };
}

export const yandexConfigured = () => Boolean(yaId() && yaSecret());

/** Колонки Conversions_<цель>_<модель> отчёта Директа — сумма по всем целям */
function sumConversions(r: Record<string, string>) {
  return Object.entries(r).filter(([k]) => k.startsWith("Conversions")).reduce((s, [, v]) => s + (Number(v) || 0), 0);
}

function num(v: string | undefined) {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

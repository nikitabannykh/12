import { isLaunched } from "@/lib/util";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { route, json, fail } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { normalizeUrl, plural, rub, uid } from "@/lib/util";
import { firstChannel, minMonthlyFor } from "@/lib/engine/budget";
import { accountsFor, channelsFor, listProjects, projectLimit, setCurrentProject } from "@/lib/engine/launch";
import { CHANNEL_NAME } from "@/lib/platforms";
import type { Channel } from "@/lib/platforms/types";
import { NICHES } from "@/lib/niches";
import { logChange } from "@/lib/engine/ops";
import { parseOrgId, stripEmoji } from "@/lib/engine/extras";
import { cleanLinks, linkKey, normalizeLink, MAX_SOURCE_LINKS, type SourceLink } from "@/lib/links";
import { landingAfterSiteCheck, siteWarning } from "./site";

const Body = z.object({
  name: z.string().trim().min(1, "Укажите название").max(80),
  niche: z.enum(NICHES.map((n) => n.id) as [string, ...string[]]),
  city: z.string().trim().min(2, "Укажите город").max(60),
  address: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable().refine((v) => !v || v.replace(/\D/g, "").length >= 10, "Телефон: нужен номер целиком, 10–11 цифр, например +7 900 123-45-67"),
  whatsapp: z.string().trim().max(60).optional().nullable(),
  telegram: z.string().trim().max(60).optional().nullable(),
  hours: z.string().trim().max(80).optional().nullable(),
  siteUrl: z.string().trim().max(300).optional().nullable(),
  orgUrl: z.string().trim().max(500).optional().nullable(),
  // Все ссылки на бизнес из блока ссылок: строки или { kind, url } (kind определяем сами по адресу)
  sourceLinks: z.array(z.union([z.string().trim().max(500), z.object({ url: z.string().trim().max(500), kind: z.string().max(20).optional() }).transform((x) => x.url)])).max(MAX_SOURCE_LINKS).optional(),
  legalInfo: z.string().trim().max(200).optional().nullable(),
  description: z.string().trim().max(1500).optional().default(""),
  services: z.array(z.object({ name: z.string().trim().min(1).max(80), price: z.string().trim().max(40).optional().refine((v) => !v || /\d|бесплатн|договор|запрос|уточн/i.test(v), "Цена: укажите число, например «1 900 ₽» или «от 3 000 ₽»"), note: z.string().trim().max(120).optional(), category: z.string().trim().max(40).optional() })).max(40).default([]),
  advantages: z.array(z.string().trim().min(1).max(100)).max(8).default([]),
  audience: z.string().trim().max(300).optional().nullable(),
  offer: z.string().trim().max(80).optional().nullable(),
  review: z.string().trim().max(300).optional().nullable(),
  monthlyBudget: z.number().int().min(1000).max(5_000_000).optional(),
  leadToClientRate: z.number().min(0.05).max(1).optional(),
});

const FIELD: Record<string, string> = {
  name: "Название", niche: "Чем занимаетесь", city: "Город", address: "Адрес", phone: "Телефон", whatsapp: "WhatsApp", telegram: "Telegram",
  hours: "Часы работы", siteUrl: "Сайт", sourceLinks: "Ссылки на бизнес", orgUrl: "Ссылка на организацию в Яндекс Картах", legalInfo: "Юр. данные для рекламы", description: "Что ещё важно знать", services: "Услуги", advantages: "Преимущества",
  audience: "Кто ваши клиенты", offer: "Предложение для новых клиентов", review: "Отзыв клиента", monthlyBudget: "Бюджет в месяц",
  leadToClientRate: "Сколько обратившихся записываются",
};

/** Ссылка на организацию в Яндекс Картах → её ID (разбор — parseOrgId из extras.ts) и понятная ошибка, если не разобрать */
function orgFromUrl(url: string): { orgId: string; url: string } | { error: string } {
  const raw = url.trim();
  if (/^\d{5,20}$/.test(raw)) return { orgId: raw, url: `https://yandex.ru/maps/org/${raw}/` };
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { error: "Ссылка на организацию: не похоже на ссылку. Скопируйте её в Яндекс Картах кнопкой «Поделиться»." };
  }
  if (!/(^|\.)(yandex\.[a-z.]{2,6}|ya\.ru)$/i.test(u.hostname)) return { error: "Ссылка на организацию: нужна ссылка на Яндекс Карты — вида yandex.ru/maps/org/название/1234567890/." };
  if (/\/maps\/-\//.test(u.pathname)) return { error: "Ссылка на организацию: это короткая ссылка. Откройте её в браузере и скопируйте полный адрес — вида yandex.ru/maps/org/название/1234567890/." };
  const orgId = parseOrgId(u.toString());
  if (!orgId) return { error: "Ссылка на организацию: не нашли в ней номер организации. Откройте свою карточку (а не поиск или адрес) и скопируйте ссылку — вида yandex.ru/maps/org/название/1234567890/." };
  return { orgId, url: u.toString().slice(0, 500) };
}

/** ИНН: 10 цифр (организация) или 12 (ИП, самозанятый) с проверкой контрольных цифр */
function innValid(inn: string) {
  const d = inn.split("").map(Number);
  const sum = (w: number[]) => (w.reduce((s, k, i) => s + k * d[i], 0) % 11) % 10;
  if (d.length === 10) return sum([2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[9];
  if (d.length === 12) return sum([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[10] && sum([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[11];
  return false;
}

/** «ИП Иванова А. С., ИНН 165012345680» — форма, название и ИНН. Возвращает текст ошибки или null. */
function legalError(v: string): string | null {
  const form = v.match(/(?:^|[^\p{L}])(ИП|ООО|АО|ПАО|ЗАО|НКО|АНО|самозанят[\p{L}]*|индивидуальн[\p{L}]* предпринимател[\p{L}]*)(?=[^\p{L}]|$)/iu)?.[1];
  if (!form) return "Юр. данные: укажите форму — ИП, ООО или «самозанятый»";
  // ИП и самозанятые — ИНН физлица (12 цифр), организации — 10 цифр
  const person = /^(ИП|самозанят|индивидуальн)/i.test(form);
  const need = person ? 12 : 10;
  const who = person ? (/^самозанят/i.test(form) ? "самозанятого" : "ИП") : form.toUpperCase();
  const nums = v.match(/\d[\d\s]{8,14}\d/g)?.map((x) => x.replace(/\s/g, "")).filter((x) => x.length === 10 || x.length === 12) ?? [];
  if (!nums.length) return "Юр. данные: укажите ИНН — 12 цифр у ИП и самозанятых, 10 у ООО";
  const fit = nums.filter((x) => x.length === need);
  if (!fit.length) return `Юр. данные: у ${who} ИНН из ${need} цифр, а указано ${nums[0].length}. ${person ? "10 цифр — это ИНН организации (ООО)." : "12 цифр — это ИНН ИП или физлица."}`;
  if (!fit.some(innValid)) return "Юр. данные: ИНН не сходится — проверьте цифры (ошибка в одной цифре — частая причина отказа в маркировке)";
  return null;
}

/** Каналы для минимального бюджета — как в /api/budget: запущенные кампании, а до запуска — подключённые кабинеты */
async function budgetChannels(businessId: string | null, userId: string): Promise<Channel[]> {
  const db = await getDb();
  const camps = businessId
    ? await db.select({ channel: schema.campaigns.channel }).from(schema.campaigns).where(and(eq(schema.campaigns.businessId, businessId), inArray(schema.campaigns.status, ["active", "paused"])))
    : [];
  const list = camps.length ? camps.map((c) => c.channel as Channel) : channelsFor(await accountsFor(userId)).map((c) => c.channel);
  return list.length ? list : ["search"];
}

/** Понятная ошибка по-русски: «Услуга 2 — название: не длиннее 80 символов» */
function ruIssue(iss: z.core.$ZodIssue): string {
  if (/[а-яё]/i.test(iss.message)) return iss.message; // своё сообщение из схемы
  const [key, idx, sub] = iss.path as (string | number)[];
  let label = FIELD[String(key)] ?? "Поле";
  if (key === "services" && typeof idx === "number") label = `Услуга ${idx + 1}${sub === "price" ? " — цена" : sub === "note" ? " — примечание" : sub === "category" ? " — раздел" : ""}`;
  if (key === "advantages" && typeof idx === "number") label = `Преимущество ${idx + 1}`;
  if (key === "sourceLinks" && typeof idx === "number") label = `Ссылка ${idx + 1}`;
  const x = iss as unknown as { origin?: string; maximum?: number | bigint; minimum?: number | bigint; expected?: string };
  const n = Number(x.maximum ?? x.minimum ?? 0);
  switch (iss.code) {
    case "too_big":
      if (x.origin === "string") return `${label}: не длиннее ${n} ${plural(n, "символа", "символов", "символов")}`;
      if (x.origin === "array") return `${label}: не больше ${n} ${key === "services" ? plural(n, "услуги", "услуг", "услуг") : plural(n, "пункта", "пунктов", "пунктов")}`;
      return `${label}: не больше ${new Intl.NumberFormat("ru-RU").format(n)}`;
    case "too_small":
      if (x.origin === "string") return n <= 1 ? `${label}: заполните поле` : `${label}: не короче ${n} ${plural(n, "символа", "символов", "символов")}`;
      if (x.origin === "array") return `${label}: добавьте хотя бы ${n}`;
      return `${label}: не меньше ${new Intl.NumberFormat("ru-RU").format(n)}`;
    case "invalid_type":
      if (iss.input === undefined || iss.input === null) return `${label}: заполните поле`;
      return x.expected === "int" ? `${label}: нужно целое число` : `${label}: неверный формат`;
    case "invalid_value":
      return key === "niche" ? "Выберите, чем вы занимаетесь" : `${label}: выберите вариант из списка`;
    default:
      return `${label}: проверьте значение`;
  }
}

export const POST = route(async ({ user, business, req }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail(parsed.error.issues.slice(0, 3).map(ruIssue).join(". ") || "Проверьте поля");
  // Эмодзи в названиях услуг и фактах площадки не примут — убираем сразу, чтобы они не попали ни в объявления, ни в названия групп
  const se = <T extends string | null | undefined>(v: T) => (typeof v === "string" ? stripEmoji(v).replace(/\s+/g, " ").trim() : v) as T;
  const raw = parsed.data;
  const d = {
    ...raw,
    name: se(raw.name), address: se(raw.address), hours: se(raw.hours), offer: se(raw.offer), review: se(raw.review),
    services: raw.services.map((s) => ({ ...s, name: se(s.name), price: se(s.price), note: se(s.note), category: se(s.category) })),
    advantages: raw.advantages.map((a) => se(a)),
  };
  if (!d.name) return fail("Название: напишите буквами, без одних эмодзи");
  // Организация в Картах и юр. данные — необязательные, но если указаны, должны быть правильными
  let org: { orgUrl: string | null; orgId: string | null } = { orgUrl: null, orgId: null };
  if (d.orgUrl) {
    const p = orgFromUrl(d.orgUrl);
    if ("error" in p) return fail(p.error);
    org = { orgUrl: p.url, orgId: p.orgId };
  }
  // Ссылки на бизнес: только http(s), без повторов. Сайт и Яндекс Карты из блока ссылок становятся «главными»,
  // если отдельные поля пустые; и наоборот — главные всегда есть в общем списке.
  const rawLinks = (d.sourceLinks ?? (business?.sourceLinks ?? []).map((l) => l.url)).filter(Boolean);
  const badLink = rawLinks.find((l) => !normalizeLink(l));
  if (badLink) return fail(`Ссылка «${badLink.slice(0, 60)}» не похожа на адрес сайта. Нужна ссылка вида https://… — скопируйте её из браузера.`);
  let links: SourceLink[] = cleanLinks(rawLinks);
  if (!org.orgUrl) {
    for (const l of links.filter((x) => x.kind === "yandex")) {
      const p = orgFromUrl(l.url);
      if (!("error" in p)) {
        org = { orgUrl: p.url, orgId: p.orgId };
        break;
      }
    }
  }
  const siteUrl = normalizeUrl(d.siteUrl) ?? links.find((l) => l.kind === "site")?.url ?? null;
  const main = [siteUrl, org.orgUrl].filter((x): x is string => Boolean(x));
  const keys = new Set(links.map((l) => linkKey(l.url)));
  if (main.some((m) => !keys.has(linkKey(normalizeLink(m) ?? m)))) links = cleanLinks([...main, ...links.map((l) => l.url)]);
  const legalInfo = d.legalInfo ? stripEmoji(d.legalInfo).replace(/\s+/g, " ").trim() || null : null;
  if (legalInfo) {
    const err = legalError(legalInfo);
    if (err) return fail(err);
  }
  // Бюджет сохраняем только до запуска (у запущенной рекламы он меняется через /api/budget) — минимум тот же, что там
  if (d.monthlyBudget !== undefined && !isLaunched(business?.status) && d.monthlyBudget !== business?.monthlyBudget) {
    const channels = await budgetChannels(business?.id ?? null, user.id);
    const min = minMonthlyFor(channels);
    if (d.monthlyBudget < min) return fail(`Бюджет в месяц: минимум ${rub(min)} — меньше площадка «${CHANNEL_NAME[firstChannel(channels)]}» не принимает`);
  }
  const db = await getDb();
  // Сайт, который не открывается, не делаем ссылкой объявлений по умолчанию — ведём на страницу записи и предупреждаем.
  // У запущенной рекламы ссылки объявлений не трогаем (их меняют в «Настройках»)
  const site = isLaunched(business?.status) ? null : await landingAfterSiteCheck(siteUrl, business?.siteUrl, business?.landing);
  const landingPatch = site ? { landing: site.landing as Record<string, unknown> } : {};
  const warning = site?.bad && siteUrl ? siteWarning(siteUrl) : undefined;
  const values = {
    ...d,
    ...landingPatch,
    siteUrl,
    ...org,
    sourceLinks: links,
    legalInfo,
    services: d.services.filter((s) => s.name).map((s) => ({ name: s.name, ...(s.price ? { price: s.price } : {}), ...(s.note ? { note: s.note } : {}), ...(s.category ? { category: s.category } : {}) })),
    advantages: d.advantages.filter(Boolean),
    updatedAt: new Date(),
  };
  if (business) {
    // Сфера определяет запросы, минус-слова, аудитории и тексты. У запущенной рекламы её не меняем:
    // кампании продолжили бы крутиться со старыми запросами, а робот писал бы объявления уже про другое.
    const nicheChanged = values.niche !== business.niche;
    const plan = business.launchPlan as { launch?: unknown } | null;
    if (nicheChanged && (business.status !== "draft" || plan?.launch)) {
      return fail("Сферу нельзя сменить, пока реклама запущена: запросы, аудитории и объявления подобраны под неё. Если вы сменили направление — напишите в поддержку, поможем перезапустить рекламу. Остальное в описании можно менять.", 409);
    }
    // До запуска: план объявлений был под другой бизнес (сфера, город, название или набор услуг поменялись —
    // например, владелец вставил ссылку на другой сайт) — подготовим объявления и запросы заново
    const key = (x: string | null | undefined) => (x ?? "").toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]/g, "");
    const names = (list: { name: string }[] | null | undefined) => [...new Set((list ?? []).map((s) => key(s.name)).filter(Boolean))].sort().join("|");
    const contentChanged = nicheChanged || key(values.city) !== key(business.city) || key(values.name) !== key(business.name) || names(values.services) !== names(business.services);
    const replan = Boolean(contentChanged && plan && !plan.launch && !isLaunched(business.status));
    const reset = replan ? { launchPlan: null } : {};
    // Месячный бюджет у запущенной рекламы меняется отдельно (/api/budget) — с пересчётом кампаний
    const { monthlyBudget, ...rest } = values;
    await db.update(schema.businesses).set(isLaunched(business.status) ? rest : { ...rest, ...reset, monthlyBudget: monthlyBudget ?? business.monthlyBudget }).where(eq(schema.businesses.id, business.id));
    if (isLaunched(business.status)) {
      await logChange({ businessId: business.id, actor: "owner", kind: "profile", title: "Обновлено описание бизнеса", reason: "Новые объявления робот будет писать с учётом изменений. Уже работающие объявления не трогаем — их можно поправить в разделе «Объявления»." });
    }
    return json({ id: business.id, planReset: replan, ...(warning ? { warning } : {}) });
  }
  // Новый проект: не больше лимита, и сразу делаем его текущим
  const count = (await listProjects(user.id)).length;
  if (count >= projectLimit(user.email)) return fail(`Можно вести до ${projectLimit(user.email)} проектов в одном аккаунте`);
  const id = uid("b_");
  await db.insert(schema.businesses).values({ id, userId: user.id, publicKey: uid().replace(/[-_]/g, "").slice(0, 10).toLowerCase(), ...values });
  await setCurrentProject(user.id, id);
  return json({ id, created: true, ...(warning ? { warning } : {}) });
});

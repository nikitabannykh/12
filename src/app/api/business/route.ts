import { eq } from "drizzle-orm";
import { z } from "zod";
import { route, json, fail } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { normalizeUrl, plural, uid } from "@/lib/util";
import { NICHES } from "@/lib/niches";
import { logChange } from "@/lib/engine/ops";
import { stripEmoji } from "@/lib/engine/extras";

const Body = z.object({
  name: z.string().trim().min(1, "Укажите название").max(80),
  niche: z.enum(NICHES.map((n) => n.id) as [string, ...string[]]),
  city: z.string().trim().min(2, "Укажите город").max(60),
  address: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  whatsapp: z.string().trim().max(60).optional().nullable(),
  telegram: z.string().trim().max(60).optional().nullable(),
  hours: z.string().trim().max(80).optional().nullable(),
  siteUrl: z.string().trim().max(300).optional().nullable(),
  description: z.string().trim().max(1500).optional().default(""),
  services: z.array(z.object({ name: z.string().trim().min(1).max(80), price: z.string().trim().max(40).optional(), note: z.string().trim().max(120).optional() })).max(15).default([]),
  advantages: z.array(z.string().trim().min(1).max(100)).max(8).default([]),
  audience: z.string().trim().max(300).optional().nullable(),
  offer: z.string().trim().max(80).optional().nullable(),
  review: z.string().trim().max(300).optional().nullable(),
  monthlyBudget: z.number().int().min(1000).max(5_000_000).optional(),
  leadToClientRate: z.number().min(0.05).max(1).optional(),
});

const FIELD: Record<string, string> = {
  name: "Название", niche: "Чем занимаетесь", city: "Город", address: "Адрес", phone: "Телефон", whatsapp: "WhatsApp", telegram: "Telegram",
  hours: "Часы работы", siteUrl: "Сайт", description: "Что ещё важно знать", services: "Услуги", advantages: "Преимущества",
  audience: "Кто ваши клиенты", offer: "Предложение для новых клиентов", review: "Отзыв клиента", monthlyBudget: "Бюджет в месяц",
  leadToClientRate: "Сколько обратившихся записываются",
};

/** Понятная ошибка по-русски: «Услуга 2 — название: не длиннее 80 символов» */
function ruIssue(iss: z.core.$ZodIssue): string {
  if (/[а-яё]/i.test(iss.message)) return iss.message; // своё сообщение из схемы
  const [key, idx, sub] = iss.path as (string | number)[];
  let label = FIELD[String(key)] ?? "Поле";
  if (key === "services" && typeof idx === "number") label = `Услуга ${idx + 1}${sub === "price" ? " — цена" : sub === "note" ? " — примечание" : ""}`;
  if (key === "advantages" && typeof idx === "number") label = `Преимущество ${idx + 1}`;
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
    services: raw.services.map((s) => ({ ...s, name: se(s.name), price: se(s.price), note: se(s.note) })),
    advantages: raw.advantages.map((a) => se(a)),
  };
  if (!d.name) return fail("Название: напишите буквами, без одних эмодзи");
  const db = await getDb();
  const values = {
    ...d,
    siteUrl: normalizeUrl(d.siteUrl),
    services: d.services.filter((s) => s.name).map((s) => ({ name: s.name, ...(s.price ? { price: s.price } : {}), ...(s.note ? { note: s.note } : {}) })),
    advantages: d.advantages.filter(Boolean),
    updatedAt: new Date(),
  };
  if (business) {
    // Месячный бюджет у запущенной рекламы меняется отдельно (/api/budget) — с пересчётом кампаний
    const { monthlyBudget, ...rest } = values;
    await db.update(schema.businesses).set(business.status === "active" ? rest : { ...rest, monthlyBudget: monthlyBudget ?? business.monthlyBudget }).where(eq(schema.businesses.id, business.id));
    if (business.status === "active") {
      await logChange({ businessId: business.id, actor: "owner", kind: "profile", title: "Обновлено описание бизнеса", reason: "Новые объявления робот будет писать с учётом изменений. Уже работающие объявления не трогаем — их можно поправить в разделе «Объявления»." });
    }
    return json({ id: business.id });
  }
  const id = uid("b_");
  await db.insert(schema.businesses).values({ id, userId: user.id, publicKey: uid().replace(/[-_]/g, "").slice(0, 10).toLowerCase(), ...values });
  return json({ id });
});

import { eq } from "drizzle-orm";
import { z } from "zod";
import { route, json, fail } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { normalizeUrl, uid } from "@/lib/util";
import { NICHES } from "@/lib/niches";
import { logChange } from "@/lib/engine/ops";

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

export const POST = route(async ({ user, business, req }) => {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Проверьте поля");
  const d = parsed.data;
  const db = await getDb();
  const values = {
    ...d,
    siteUrl: normalizeUrl(d.siteUrl),
    services: d.services.filter((s) => s.name),
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

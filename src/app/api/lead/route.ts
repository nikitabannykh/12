import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { uid } from "@/lib/util";

/** Заявка с нашей страницы записи */
export async function POST(req: Request) {
  const d = await req.json().catch(() => ({}));
  const name = String(d.name || "").trim().slice(0, 80);
  const contact = String(d.contact || "").trim().slice(0, 80);
  if (!contact || contact.replace(/\D/g, "").length < 6) return Response.json({ error: "Оставьте телефон, чтобы вам перезвонили" }, { status: 400 });
  const db = await getDb();
  const [b] = await db.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.publicKey, String(d.key || "")));
  if (!b) return Response.json({ error: "Страница не найдена" }, { status: 404 });
  const src = String(d.source || "").toLowerCase();
  await db.insert(schema.leads).values({
    id: uid("l_"),
    businessId: b.id,
    kind: "form",
    visitorId: String(d.vid || "").slice(0, 64) || null,
    name: name || null,
    contact,
    message: String(d.message || "").slice(0, 500) || null,
    source: src.includes("yandex") ? "yandex" : src.includes("vk") ? "vk" : src || null,
    campaignExt: d.campaign && !String(d.campaign).includes("{") ? String(d.campaign).slice(0, 40) : null,
    adExt: d.ad && !String(d.ad).includes("{") ? String(d.ad).slice(0, 40) : null,
  });
  return Response.json({ ok: true });
}

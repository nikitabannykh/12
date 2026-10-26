import { and, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { uid } from "@/lib/util";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: cors });
}

/** Приём обращений от трекера на сайте владельца */
export async function POST(req: Request) {
  try {
    const d = JSON.parse(await req.text());
    const kind = ["form", "phone", "messenger"].includes(d.kind) ? d.kind : "form";
    const db = await getDb();
    const [b] = await db.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.publicKey, String(d.key || "")));
    if (!b) return new Response(null, { status: 204, headers: cors });
    const vid = String(d.vid || "").slice(0, 64) || null;
    // Один человек — одно обращение одного типа за 30 минут
    if (vid) {
      const recent = await db.select({ id: schema.leads.id }).from(schema.leads).where(and(eq(schema.leads.businessId, b.id), eq(schema.leads.visitorId, vid), eq(schema.leads.kind, kind), gte(schema.leads.createdAt, new Date(Date.now() - 30 * 60e3))));
      if (recent.length) return new Response(null, { status: 204, headers: cors });
    }
    const src = String(d.source || "").toLowerCase();
    await db.insert(schema.leads).values({
      id: uid("l_"),
      businessId: b.id,
      kind,
      visitorId: vid,
      name: d.name ? String(d.name).slice(0, 80) : null,
      contact: d.contact ? String(d.contact).slice(0, 80) : null,
      source: src.includes("yandex") ? "yandex" : src.includes("vk") ? "vk" : src || null,
      campaignExt: d.campaign && !String(d.campaign).includes("{") ? String(d.campaign).slice(0, 40) : null,
      adExt: d.ad && !String(d.ad).includes("{") ? String(d.ad).slice(0, 40) : null,
    });
  } catch {
    /* трекер не должен ломать сайт */
  }
  return new Response(null, { status: 204, headers: cors });
}

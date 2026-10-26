import { and, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { uid } from "@/lib/util";
import { attribute, ipKey, signFirstTouch, within } from "@/lib/ratelimit";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const empty = () => new Response(null, { status: 204, headers: cors });

export async function OPTIONS() {
  return empty();
}

/**
 * Приём событий от трекера на сайте владельца.
 *  - kind=visit: первый заход по рекламной ссылке → возвращаем подписанные utm-метки (first touch);
 *  - kind=form|phone|messenger: обращение. Имя и телефон здесь не принимаем и не храним.
 */
export async function POST(req: Request) {
  try {
    const raw = await req.text();
    if (raw.length > 4000) return empty();
    const d = JSON.parse(raw);
    const db = await getDb();
    const [b] = await db.select({ id: schema.businesses.id, publicKey: schema.businesses.publicKey }).from(schema.businesses).where(eq(schema.businesses.publicKey, String(d.key || "").slice(0, 64)));
    if (!b) return empty();

    if (d.kind === "visit") {
      if (!(await within([{ key: ipKey("visit", req), limit: 30, windowSec: 600 }]))) return empty();
      const ft = signFirstTouch(b.publicKey, { source: d.source, campaign: d.campaign, ad: d.ad });
      return Response.json({ ft }, { headers: cors });
    }

    const kind = ["form", "phone", "messenger"].includes(d.kind) ? d.kind : "form";
    // Лимиты: с одного адреса — 20 событий за 10 минут, на бизнес — 300 в час
    const allowed = await within([
      { key: ipKey("t", req), limit: 20, windowSec: 600 },
      { key: `t:biz:${b.id}`, limit: 300, windowSec: 3600 },
    ]);
    if (!allowed) return empty();
    const vid = typeof d.vid === "string" && /^[\w-]{6,64}$/.test(d.vid) ? d.vid : null;
    // Один человек — одно обращение одного типа за 30 минут
    if (vid) {
      const recent = await db.select({ id: schema.leads.id }).from(schema.leads).where(and(eq(schema.leads.businessId, b.id), eq(schema.leads.visitorId, vid), eq(schema.leads.kind, kind), gte(schema.leads.createdAt, new Date(Date.now() - 30 * 60e3))));
      if (recent.length) return empty();
    }
    const a = await attribute(b, d.ft);
    await db.insert(schema.leads).values({
      id: uid("l_"),
      businessId: b.id,
      kind,
      visitorId: vid,
      source: a.source,
      campaignExt: a.campaignExt,
      adExt: a.adExt,
    });
  } catch {
    /* трекер не должен ломать сайт */
  }
  return empty();
}

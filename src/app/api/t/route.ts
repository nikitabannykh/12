import { and, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { uid } from "@/lib/util";
import { attribute, hit, ipKey, signFirstTouch, within } from "@/lib/ratelimit";
import { metrikaIds } from "@/lib/platforms/metrica";
import { eventHost, recordSiteEvent, recordSiteSeen } from "@/lib/engine/site-tracking";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
/** Больше стольких обращений с трекера на бизнес за час — помечаем «похоже на спам» */
const BIZ_SUSPECT_PER_HOUR = 40;
const empty = () => new Response(null, { status: 204, headers: cors });

export async function OPTIONS() {
  return empty();
}

/**
 * Приём событий от трекера на сайте владельца.
 *  - kind=visit: первый заход по рекламной ссылке → возвращаем подписанные utm-метки (first touch);
 *  - kind=ping: сигнал «код стоит на сайте» (раз в сутки на браузер или при проверке ?pz_check=1) — для настроек;
 *  - kind=form|phone|messenger: обращение. Имя и телефон здесь не принимаем и не храним.
 *    via=booking — переход в онлайн-запись (DIKIDI, YCLIENTS…), засчитывается как заявка (form).
 * Последнее событие с сайта владельца запоминаем (lib/engine/site-tracking) — его видно в «Подключении сайта».
 */
export async function POST(req: Request) {
  try {
    const raw = await req.text();
    if (raw.length > 4000) return empty();
    const d = JSON.parse(raw);
    const db = await getDb();
    const [b] = await db.select({ id: schema.businesses.id, publicKey: schema.businesses.publicKey }).from(schema.businesses).where(eq(schema.businesses.publicKey, String(d.key || "").slice(0, 64)));
    if (!b) return empty();

    const host = eventHost(req, d.host);
    if (d.kind === "ping") {
      if (await within([{ key: ipKey("ping", req), limit: 10, windowSec: 600 }, { key: `ping:biz:${b.id}`, limit: 120, windowSec: 3600 }])) {
        await recordSiteSeen(b.id, host, { force: Boolean(d.check), ym: Boolean(d.ym) });
      }
      return empty();
    }

    if (d.kind === "visit") {
      if (!(await within([{ key: ipKey("visit", req), limit: 30, windowSec: 600 }]))) return empty();
      await recordSiteEvent(b.id, "visit", host).catch(() => {});
      const ft = await signFirstTouch(b, { source: d.source, campaign: d.campaign, ad: d.ad });
      return Response.json({ ft }, { headers: cors });
    }

    const kind = ["form", "phone", "messenger"].includes(d.kind) ? d.kind : "form";
    // Трекер всегда присылает id посетителя; без него — не наш трекер, такое обращение не засчитываем
    const vid = typeof d.vid === "string" && /^[\w-]{6,64}$/.test(d.vid) ? d.vid : null;
    if (!vid) return empty();
    // Лимиты: с одного адреса — 20 событий за 10 минут, на бизнес — 300 в час
    const allowed = await within([
      { key: ipKey("t", req), limit: 20, windowSec: 600 },
      { key: `t:biz:${b.id}`, limit: 300, windowSec: 3600 },
    ]);
    if (!allowed) return empty();
    const booking = kind === "form" && d.via === "booking";
    // «Последнее событие с сайта» — и для повторов (владелец проверяет установку, кликая сам)
    await recordSiteEvent(b.id, booking ? "booking" : kind, host).catch(() => {});
    // Один человек — одно обращение одного типа за 30 минут
    const recent = await db.select({ id: schema.leads.id }).from(schema.leads).where(and(eq(schema.leads.businessId, b.id), eq(schema.leads.visitorId, vid), eq(schema.leads.kind, kind), gte(schema.leads.createdAt, new Date(Date.now() - 30 * 60e3))));
    if (recent.length) return empty();
    // Всплеск обращений на бизнес — как в /api/lead: сохраняем, но помечаем «похоже на спам»
    // и не привязываем к объявлению, чтобы накрутка не попала в статистику и решения робота
    const suspect = !(await hit(`t:burst:${b.id}`, BIZ_SUSPECT_PER_HOUR, 3600)).ok;
    const a = suspect ? { source: null, campaignExt: null, adExt: null } : await attribute(b, d.ft);
    const ids = metrikaIds(d);
    await db.insert(schema.leads).values({
      id: uid("l_"),
      businessId: b.id,
      kind: suspect ? "suspect" : kind,
      visitorId: vid,
      source: a.source,
      campaignExt: a.campaignExt,
      adExt: a.adExt,
      metrikaClientId: ids.metrikaClientId,
      yclid: ids.yclid,
    });
  } catch {
    /* трекер не должен ломать сайт */
  }
  return empty();
}

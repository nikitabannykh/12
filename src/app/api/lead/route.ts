import { and, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { uid } from "@/lib/util";
import { verify } from "@/lib/crypto";
import { sameOrigin } from "@/lib/api";
import { attribute, ipKey, within } from "@/lib/ratelimit";
import { formatPhone, notifyLead } from "@/lib/notify";

const bad = (error: string, status = 400) => Response.json({ error }, { status });

/** Минимальное время заполнения формы: быстрее заполняют только боты */
const MIN_FILL_MS = 3000;

/** Телефон → только цифры, российские номера приводим к 7XXXXXXXXXX */
function normalizePhone(v: string): string | null {
  const raw = v.trim();
  if (!raw || raw.length > 30 || !/^[\d\s()+\-.]+$/.test(raw)) return null;
  let d = raw.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("8")) d = "7" + d.slice(1);
  if (d.length === 10 && d.startsWith("9")) d = "7" + d;
  if (d.length < 10 || d.length > 15 || /^(\d)\1+$/.test(d)) return null;
  return d;
}

/** Заявка с нашей страницы записи */
export async function POST(req: Request) {
  // Форма живёт только на нашей странице — запросы с чужих сайтов не принимаем
  if (!sameOrigin(req)) return bad("Заявку можно отправить только со страницы записи.", 403);
  const d = await req.json().catch(() => null);
  if (!d || typeof d !== "object") return bad("Не получилось прочитать заявку — обновите страницу и попробуйте ещё раз.");

  const db = await getDb();
  const [b] = await db.select().from(schema.businesses).where(eq(schema.businesses.publicKey, String(d.key || "").slice(0, 64)));
  if (!b) return bad("Страница не найдена", 404);

  // Ловушка для ботов: невидимое поле заполняют только они. Отвечаем «успешно», чтобы бот не подбирал обход.
  if (typeof d.website === "string" && d.website.trim()) return Response.json({ ok: true });

  // Подписанная метка времени, выданная при открытии страницы
  const ts = verify<{ k: string; t: number }>(typeof d.ts === "string" ? d.ts : null);
  if (!ts || ts.k !== b.publicKey) return bad("Страница устарела. Обновите её и отправьте заявку ещё раз.");
  if (Date.now() - ts.t < MIN_FILL_MS) return bad("Слишком быстро. Проверьте имя и телефон и нажмите «Отправить» ещё раз.");

  const name = typeof d.name === "string" ? d.name.trim().replace(/\s+/g, " ") : "";
  if (name && (name.length > 60 || !/^[\p{L}][\p{L}\s.'’\-]*$/u.test(name))) return bad("Имя — только буквами, например «Анна».");
  const digits = normalizePhone(typeof d.contact === "string" ? d.contact : "");
  if (!digits) return bad("Проверьте номер телефона: например, +7 900 123-45-67.");
  const phone = formatPhone(digits); // единый вид: «+7 900 123-45-67» — так проще и дедупликация, и звонок
  // Услугу принимаем только из списка на странице — свободный текст не храним
  const service = typeof d.message === "string" ? b.services.find((s) => s.name === d.message.trim())?.name ?? null : null;

  // Лимиты: с одного адреса — 5 заявок за 10 минут и 20 в сутки, на бизнес — 60 в час
  const allowed = await within([
    { key: ipKey("lead", req), limit: 5, windowSec: 600 },
    { key: ipKey("lead-day", req), limit: 20, windowSec: 86400 },
    { key: `lead:biz:${b.id}`, limit: 60, windowSec: 3600 },
  ]);
  if (!allowed) return bad("Слишком много заявок подряд. Попробуйте чуть позже или позвоните нам.", 429);

  // Тот же телефон за последние сутки — не дублируем заявку и не беспокоим владельца повторно
  const [dup] = await db
    .select({ id: schema.leads.id })
    .from(schema.leads)
    .where(and(eq(schema.leads.businessId, b.id), eq(schema.leads.contact, phone), gte(schema.leads.createdAt, new Date(Date.now() - 864e5))));
  if (dup) return Response.json({ ok: true, duplicate: true });

  const a = await attribute(b, d.ft);
  const vid = typeof d.vid === "string" && /^[\w-]{6,64}$/.test(d.vid) ? d.vid : null;
  await db.insert(schema.leads).values({
    id: uid("l_"),
    businessId: b.id,
    kind: "form",
    visitorId: vid,
    name: name || null,
    contact: phone,
    message: service,
    source: a.source,
    campaignExt: a.campaignExt,
    adExt: a.adExt,
  });

  // Сразу сообщаем владельцу; ошибка уведомления не должна терять заявку
  try {
    await notifyLead({ businessId: b.id, businessName: b.name, name: name || null, contact: phone, service, source: a.source, adTitle: a.adTitle });
  } catch (e) {
    console.error("notifyLead", e);
  }
  return Response.json({ ok: true });
}

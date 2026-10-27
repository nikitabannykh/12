import { and, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { uid } from "@/lib/util";
import { sameOrigin } from "@/lib/api";
import { attribute, consumeFormToken, formToken, hit, ipKey, readFormToken, within } from "@/lib/ratelimit";
import { formatPhone, notifyLead, notifySuspect } from "@/lib/notify";
import { metrikaIds } from "@/lib/platforms/metrica";
import { demoNow } from "@/lib/platforms/demo";

const bad = (error: string, status = 400) => Response.json({ error }, { status });

/** Минимальное время заполнения формы: быстрее заполняют только боты */
const MIN_FILL_MS = 3000;

/**
 * Телефон → только цифры. Российские номера приводим к 7XXXXXXXXXX и проверяем код (3xx, 4xx, 8xx, 9xx).
 * Иностранный номер принимаем только с «+» и кодом страны. Отсекаем «88888888888», «1234567890» и т. п.
 */
function normalizePhone(v: string): string | null {
  const raw = v.trim();
  if (!raw || raw.length > 30 || !/^[\d\s()+\-.]+$/.test(raw)) return null;
  const plus = raw.startsWith("+");
  let d = raw.replace(/\D/g, "");
  if (!plus && d.length === 11 && d.startsWith("8")) d = "7" + d.slice(1);
  else if (!plus && d.length === 10 && /^[3489]/.test(d)) d = "7" + d;
  let national: string;
  if (d.startsWith("7")) {
    // Россия и Казахстан: ровно 11 цифр, код начинается с 3, 4, 6 (Казахстан), 7 (Казахстан), 8 или 9
    if (d.length !== 11 || !/^7[346789]/.test(d)) return null;
    national = d.slice(1);
  } else {
    if (!plus || d.length < 10 || d.length > 15 || d.startsWith("0")) return null;
    national = d.slice(-9);
  }
  // Номер из одной цифры, 7+ одинаковых цифр подряд в абонентском номере или «лесенка» — не настоящий
  if (/^(\d)\1+$/.test(d) || /^(\d)\1+$/.test(national)) return null;
  if (/(\d)\1{6,}/.test(national.slice(-7))) return null;
  if ("01234567890123456789".includes(national) || "98765432109876543210".includes(national)) return null;
  return d;
}

/** Больше стольких заявок на бизнес за час — всё равно принимаем, но помечаем «похоже на спам» */
const BIZ_SUSPECT_PER_HOUR = 20;

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

  // Одноразовый токен формы, выданный при открытии страницы (срок — 2 часа)
  const ft0 = readFormToken(d.ts, b.publicKey);
  if (!ft0) return Response.json({ error: "Страница устарела — мы её обновили. Нажмите «Отправить» ещё раз.", code: "stale" }, { status: 400 });
  if (Date.now() - ft0.t < MIN_FILL_MS) return bad("Слишком быстро. Проверьте имя и телефон и нажмите «Отправить» ещё раз.");

  const name = typeof d.name === "string" ? d.name.trim().replace(/\s+/g, " ") : "";
  if (name && (name.length > 60 || !/^[\p{L}][\p{L}\s.'’\-]*$/u.test(name))) return bad("Имя — только буквами, например «Анна».");
  const digits = normalizePhone(typeof d.contact === "string" ? d.contact : "");
  if (!digits) return bad("Проверьте номер телефона: например, +7 900 123-45-67.");
  const phone = formatPhone(digits); // единый вид: «+7 900 123-45-67» — так проще и дедупликация, и звонок
  // Услугу принимаем только из списка на странице — свободный текст не храним
  const service = typeof d.message === "string" ? b.services.find((s) => s.name === d.message.trim())?.name ?? null : null;

  // Лимиты с одного адреса (IP берём только из заголовков, которые не подделать): 5 заявок за 10 минут и 20 в сутки.
  // Общего лимита на бизнес нет: иначе кто угодно мог бы забить его и закрыть приём настоящих заявок.
  const allowed = await within([
    { key: ipKey("lead", req), limit: 5, windowSec: 600 },
    { key: ipKey("lead-day", req), limit: 20, windowSec: 86400 },
  ]);
  if (!allowed) return bad("Слишком много заявок подряд. Попробуйте чуть позже или позвоните нам.", 429);
  // Токен — одноразовый: повтор того же запроса не создаст вторую заявку
  if (!(await consumeFormToken(ft0))) return Response.json({ error: "Эта заявка уже отправлена. Чтобы отправить ещё одну, обновите страницу.", code: "used" }, { status: 409 });

  // Демо-бизнес живёт по своим (перематываемым) часам: заявка должна попасть в тот же «день», что и статистика
  const [demoCamp] = await db
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .where(and(eq(schema.campaigns.businessId, b.id), eq(schema.campaigns.platform, "demo")))
    .limit(1);
  const now = demoCamp ? await demoNow({ businessId: b.id }) : new Date();

  // Тот же телефон за последние сутки — не дублируем заявку и не беспокоим владельца повторно
  const [dup] = await db
    .select({ id: schema.leads.id })
    .from(schema.leads)
    .where(and(eq(schema.leads.businessId, b.id), eq(schema.leads.contact, phone), gte(schema.leads.createdAt, new Date(now.getTime() - 864e5))));
  if (dup) return Response.json({ ok: true, duplicate: true });

  // Всплеск заявок на бизнес — подозрительно. Заявку сохраняем (вдруг настоящая), но помечаем,
  // не привязываем к объявлению (чтобы накрутка не влияла на решения робота) и не шлём владельцу каждую.
  const burst = await hit(`lead:biz:${b.id}`, BIZ_SUSPECT_PER_HOUR, 3600);
  const suspect = !burst.ok;
  const a = suspect ? { source: null, campaignExt: null, adExt: null, adTitle: null } : await attribute(b, d.ft);
  const vid = typeof d.vid === "string" && /^[\w-]{6,64}$/.test(d.vid) ? d.vid : null;
  const leadId = uid("l_");
  await db.insert(schema.leads).values({
    id: leadId,
    businessId: b.id,
    kind: suspect ? "suspect" : "form",
    visitorId: vid,
    name: name || null,
    contact: phone,
    message: service,
    source: a.source,
    campaignExt: a.campaignExt,
    adExt: a.adExt,
    ...metrikaIds(d),
    createdAt: now,
  });

  // Сразу сообщаем владельцу; ошибка уведомления не должна терять заявку
  try {
    if (!suspect) await notifyLead({ leadId, businessId: b.id, businessName: b.name, name: name || null, contact: phone, service, source: a.source, adTitle: a.adTitle });
    else if (burst.count === BIZ_SUSPECT_PER_HOUR + 1) await notifySuspect(b.id, b.name, BIZ_SUSPECT_PER_HOUR);
  } catch (e) {
    console.error("notifyLead", e);
  }
  return Response.json({ ok: true });
}

/** Новый токен формы — если страница была открыта дольше 2 часов (форма сама запрашивает его и не теряет введённое) */
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key")?.slice(0, 64) || "";
  if (!(await within([{ key: ipKey("lead-token", req), limit: 30, windowSec: 600 }]))) return bad("Слишком часто. Обновите страницу чуть позже.", 429);
  const db = await getDb();
  const [b] = await db.select({ publicKey: schema.businesses.publicKey }).from(schema.businesses).where(eq(schema.businesses.publicKey, key));
  if (!b) return bad("Страница не найдена", 404);
  return Response.json({ ts: formToken(b.publicKey) }, { headers: { "Cache-Control": "no-store" } });
}

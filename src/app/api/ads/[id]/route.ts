import { and, eq } from "drizzle-orm";
import { route, json, fail, needBusiness } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { act } from "@/lib/engine/ops";
import * as copy from "@/lib/ai/copy";

type AdText = { title: string; title2: string | null; text: string };
const LIMITS: Record<string, { title: number; title2: number; text: number }> = {
  search: { title: 56, title2: 30, text: 81 },
  network: { title: 56, title2: 30, text: 81 },
  vk: { title: 40, title2: 30, text: 90 },
  ...((copy as any).LIMITS ?? {}),
};
const FIELD = { title: "Заголовок", title2: "Второй заголовок", text: "Текст" } as const;
const symbols = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "символ" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "символа" : "символов"}`;

/** Проверяем текст владельца и объясняем, что поправить. Ничего не обрезаем и не переписываем молча. */
function checkAdText(channel: string, v: AdText): string | null {
  const ext = (copy as any).validateAdText;
  if (typeof ext === "function") {
    const r = ext(channel, v);
    if (typeof r === "string" && r) return r;
    if (Array.isArray(r)) {
      if (r.length) return r.map((e: any) => (typeof e === "string" ? e : e?.message ?? "")).filter(Boolean).join(" ");
    } else
    if (r && typeof r === "object") {
      if (typeof r.error === "string" && r.error) return r.error;
      if (Array.isArray(r.errors) && r.errors.length) return r.errors.map((e: any) => (typeof e === "string" ? e : e?.message ?? "")).filter(Boolean).join(" ");
      if (r.ok === false) return "Текст объявления не подходит для площадки — проверьте длину и символы.";
    }
    // Общая проверка из copy.ts отработала — она полнее локальной
    if (!v.title) return "Заголовок не может быть пустым.";
    if (!v.text) return "Текст объявления не может быть пустым.";
    return null;
  }
  // Запасной вариант, если общей проверки нет
  const L = LIMITS[channel] ?? LIMITS.search;
  if (!v.title) return "Заголовок не может быть пустым.";
  if (!v.text) return "Текст объявления не может быть пустым.";
  for (const k of ["title", "title2", "text"] as const) {
    const val = v[k];
    if (!val) continue;
    const max = L[k];
    if (val.length > max) return `${FIELD[k]} длиннее ${max} ${max % 10 === 1 && max % 100 !== 11 ? "символа" : "символов"}: сейчас ${val.length}. Сократите на ${symbols(val.length - max)} — обрезать за вас мы не будем.`;
    const long = val.split(/\s+/).find((w) => w.length > 22);
    if (long) return `${FIELD[k]}: слово «${long}» длиннее 22 символов — площадка такое не примет. Разбейте его или замените.`;
    if (/\p{Extended_Pictographic}/u.test(val)) return `${FIELD[k]}: уберите эмодзи — площадки не пропускают объявления с ними.`;
    if (/[!?]{2,}/.test(val)) return `${FIELD[k]}: несколько «!» или «?» подряд площадка не пропустит — оставьте один знак.`;
    if (/(^|[^\p{L}])(лучш\p{L}*|сам(?:ый|ая|ое|ые|ых|ым|ую)|номер\s?1|№\s?1)(?=$|[^\p{L}])/iu.test(val))
      return `${FIELD[k]}: слова «лучший», «самый», «№ 1» Директ пропускает только с документом-подтверждением. Уберите их или скажите иначе, например «мастера с опытом 10 лет».`;
    const caps = val.split(/[^\p{L}]+/u).find((w) => w.length >= 4 && w === w.toUpperCase() && w !== w.toLowerCase());
    if (caps) return `${FIELD[k]}: слово «${caps}» написано целиком заглавными — площадка такое не пропустит. Напишите обычными буквами.`;
  }
  return null;
}
const clean = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

export const PATCH = route<{ id: string }>(async ({ business, params, req }) => {
  needBusiness(business);
  const db = await getDb();
  const [ad] = await db.select().from(schema.ads).where(and(eq(schema.ads.id, params.id), eq(schema.ads.businessId, business.id)));
  if (!ad) return fail("Объявление не найдено", 404);
  const [camp] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, ad.campaignId));
  const body = await req.json();

  if (body.status === "active" || body.status === "paused") {
    await act(
      { businessId: business.id, actor: "owner", kind: body.status === "active" ? "resume" : "pause", title: body.status === "active" ? `Включили объявление «${ad.title}»` : `Отключили объявление «${ad.title}»`, reason: "Вы изменили это вручную." },
      [{ op: "adStatus", adId: ad.id, status: body.status }],
    );
    return json({ ok: true });
  }

  if (typeof body.title === "string" && typeof body.text === "string") {
    const channel = camp?.channel ?? "search";
    const title = clean(body.title), text = clean(body.text);
    const title2 = channel === "search" ? clean(body.title2) || null : ad.title2;
    const problem = checkAdText(channel, { title, title2, text });
    if (problem) return fail(problem, 422);
    if (title === ad.title && title2 === ad.title2 && text === ad.text) return json({ ok: true, unchanged: true });
    await act(
      { businessId: business.id, actor: "owner", kind: "ad_text", title: `Изменили текст объявления «${ad.title}»`, reason: "Вы поправили текст. Площадка заново проверит объявление — обычно это занимает несколько часов, всё это время работает старая версия.", details: { before: { title: ad.title, title2: ad.title2, text: ad.text }, after: { title, title2, text } } },
      [{ op: "adText", adId: ad.id, title, title2, text }],
    );
    return json({ ok: true });
  }
  return fail("Нечего менять");
});

import "server-only";
import { and, eq, gte, isNotNull, ne } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { Business } from "../db/schema";
import { minMonthlyFor } from "./budget";
import { pausedForBudget } from "./budget-guard";
import { getBalances, LOW_DAYS, TOPUP_URL, balanceText, type Balance } from "./balance";
import { reportNow } from "./report";
import type { Channel } from "../platforms/types";
import { addDays, isoDay, pl } from "../util";

/**
 * «Здоровье рекламы»: чек-лист того, что мешает рекламе работать, с весами и ссылкой «исправить».
 * Балл 0–100 = доля веса выполненных пунктов среди применимых (пункт, который сейчас нельзя проверить, не считается).
 * Критичное (вес 15–20): кабинеты, баланс, счётчик и цель. Важное (10): отметки заявок, организация, модерация, бюджет.
 * Полезное (5): часы работы, свои фото.
 */
export type HealthItem = {
  key: string;
  ok: boolean;
  title: string;
  /** то же, но как задача — показываем, когда пункт не выполнен */
  todo: string;
  /** что не так и почему это важно — показываем, когда пункт не выполнен */
  hint: string;
  fix?: { href: string; label: string; external?: boolean };
  weight: number;
};

export type Health = { score: number; items: HealthItem[]; balances: Balance[] };

export async function healthCheck(b: Business): Promise<Health> {
  const db = await getDb();
  const now = await reportNow(b);
  const accounts = await db.select().from(schema.adAccounts).where(eq(schema.adAccounts.userId, b.userId));
  const camps = (await db.select().from(schema.campaigns).where(eq(schema.campaigns.businessId, b.id))).filter((c) => c.status !== "archived");
  const usedAcc = new Set(camps.map((c) => c.accountId));
  const used = accounts.filter((a) => usedAcc.has(a.id));
  const balances = await getBalances(b);
  const rejected = (await db.select({ id: schema.ads.id }).from(schema.ads).where(and(eq(schema.ads.businessId, b.id), eq(schema.ads.status, "rejected")))).length;
  const ownPhotos = (await db.select({ id: schema.images.id }).from(schema.images).where(and(eq(schema.images.businessId, b.id), eq(schema.images.kind, "photo")))).length;
  // Заявки с телефоном за 14 дней — сколько из них владелец отметил
  const since = new Date(Date.now() - 14 * 864e5);
  const recent = await db
    .select({ status: schema.leads.status })
    .from(schema.leads)
    .where(and(eq(schema.leads.businessId, b.id), ne(schema.leads.kind, "suspect"), isNotNull(schema.leads.contact), gte(schema.leads.createdAt, since)));
  const marked = recent.filter((l) => l.status).length;
  const anyLead = (await db.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.businessId, b.id)).limit(1)).length > 0;
  const spent = camps.length
    ? (await db.select({ cost: schema.statsDaily.cost }).from(schema.statsDaily).where(and(eq(schema.statsDaily.businessId, b.id), gte(schema.statsDaily.day, isoDay(addDays(now, -14)))))).reduce((s, r) => s + r.cost, 0)
    : 0;
  const channels = [...new Set(camps.map((c) => c.channel))] as Channel[];
  const guard = camps.filter((c) => pausedForBudget(c));
  const usesDirect = camps.some((c) => c.platform === "yandex" || c.platform === "demo");

  const items: (HealthItem | null)[] = [];

  // 1. Кабинеты
  const broken = used.filter((a) => a.status !== "ok");
  items.push({
    key: "accounts",
    ok: used.length > 0 && !broken.length,
    title: "Рекламные кабинеты подключены",
    todo: "Восстановите доступ к кабинетам",
    hint: broken.length ? `Нет доступа к ${broken.map((a) => a.login).join(", ")} — робот не может управлять рекламой.` : "Нет подключённых кабинетов.",
    fix: { href: "/app/settings", label: "Подключить заново" },
    weight: 20,
  });

  // 2. Баланс
  const low = balances.filter((x) => x.daysLeft !== null && x.daysLeft <= LOW_DAYS);
  items.push(
    balances.some((x) => x.amount !== null)
      ? {
          key: "balance",
          ok: !low.length,
          title: "Денег в кабинетах хватает",
    todo: low.some((x) => x.daysLeft === 0) ? "Пополните рекламный кабинет — деньги кончились" : "Пополните рекламный кабинет",
          hint: low.length ? low.map(balanceText).join(" ") : "",
          fix: low[0] && TOPUP_URL[low[0].platform] ? { href: TOPUP_URL[low[0].platform], label: "Пополнить", external: true } : undefined,
          weight: 20,
        }
      : null,
  );

  // 3. Счётчик и цель
  const counterOk = Boolean(b.counterId && b.goalIds?.lead);
  if (b.siteUrl) {
    items.push({
      key: "counter",
      ok: counterOk && (anyLead || spent < 1),
      title: "Счётчик и цель на сайте",
    todo: "Проверьте счётчик на сайте",
      hint: !counterOk
        ? "Счётчик Метрики с целью «обращение» не настроен — Директ не может учиться на заявках."
        : "Рекламе есть расход, а обращений с сайта ни одного — похоже, код счётчика не стоит на сайте.",
      fix: { href: "/app/settings#counter", label: "Код счётчика" },
      weight: 15,
    });
  } else if (usesDirect) {
    items.push({
      key: "counter",
      ok: counterOk || camps.every((c) => c.platform === "demo"),
      title: "Счётчик и цель на странице записи",
    todo: "Нет счётчика Метрики",
      hint: "Счётчик Метрики не создан — Директ показывает рекламу по кликам, а не по заявкам. Создадим при следующем запуске в Директе.",
      fix: { href: "/app/settings#counter", label: "Подробнее" },
      weight: 15,
    });
  }

  // 4. Заявки отмечаются
  items.push(
    recent.length
      ? {
          key: "marks",
          ok: marked / recent.length >= 0.5,
          title: "Заявки отмечаются",
    todo: "Отмечайте, чем закончилась заявка",
          hint: `Отмечено ${marked} из ${pl(recent.length, "заявки", "заявок", "заявок")} за 2 недели. Отметка «Записался» — это настоящая стоимость клиента и сигнал для Директа, кого искать.`,
          fix: { href: "/app/stats#leads", label: "Отметить" },
          weight: 10,
        }
      : null,
  );

  // 5. Организация в Яндекс Картах
  items.push({
    key: "org",
    ok: Boolean(b.orgId),
    title: "Организация из Яндекс Карт привязана",
    todo: "Привяжите организацию из Яндекс Карт",
    hint: "Без организации реклама не показывается на Картах, а звонки из объявлений не считаются. Нужна ссылка на карточку в Яндекс Картах.",
    fix: { href: "/app/start#org", label: "Добавить ссылку" },
    weight: 10,
  });

  // 6. Отклонённые объявления
  items.push({
    key: "rejected",
    ok: rejected === 0,
    title: "Все объявления прошли модерацию",
    todo: "Есть отклонённые объявления",
    hint: `${pl(rejected, "объявление не прошло", "объявления не прошли", "объявлений не прошли")} модерацию — робот перепишет их при следующей проверке, или поправьте сами.`,
    fix: { href: "/app/ads", label: "Объявления" },
    weight: 10,
  });

  // 7. Бюджета хватает
  const minMonthly = minMonthlyFor(channels.length ? channels : ["search"]);
  items.push({
    key: "budget",
    ok: !guard.length && b.monthlyBudget >= minMonthly,
    title: "Бюджета хватает на все каналы",
    todo: "Бюджета не хватает на все каналы",
    hint: guard.length ? "Часть каналов стоит: до конца месяца не хватает бюджета." : `Минимум для ваших каналов — ${minMonthly.toLocaleString("ru-RU")} ₽ в месяц.`,
    fix: { href: "/app/settings#budget", label: "Изменить бюджет" },
    weight: 10,
  });

  // 8. Часы работы
  items.push({
    key: "hours",
    ok: Boolean(b.hours?.trim()),
    title: "Часы работы указаны",
    todo: "Укажите часы работы",
    hint: "Без часов работы не создаём визитку в Директе — под объявлением не будет адреса и телефона.",
    fix: { href: "/app/start#hours", label: "Указать" },
    weight: 5,
  });

  // 9. Свои фото
  items.push({
    key: "photos",
    ok: ownPhotos > 0,
    title: "Загружены свои фото",
    todo: "Добавьте свои фото",
    hint: "Сейчас в объявлениях только сгенерированные картинки. Настоящие фото зала и работ обычно кликают чаще.",
    fix: { href: "/app/ads", label: "Объявления" },
    weight: 5,
  });

  const list = items.filter((x): x is HealthItem => x !== null);
  const total = list.reduce((s, x) => s + x.weight, 0);
  const got = list.filter((x) => x.ok).reduce((s, x) => s + x.weight, 0);
  return { score: total ? Math.round((got / total) * 100) : 100, items: list, balances };
}


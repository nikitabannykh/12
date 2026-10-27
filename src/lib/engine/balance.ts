import "server-only";
import { and, eq, gte, inArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { AdAccount, Business } from "../db/schema";
import { decrypt } from "../crypto";
import { clientFor, PLATFORM_NAME } from "../platforms";
import { demoNow } from "../platforms/demo";
import type { VkAds } from "../platforms/vk";
import { addDays, appUrl, errorText, isoDay, pl, rub } from "../util";

/**
 * Баланс рекламных кабинетов: сколько денег осталось и на сколько дней хватит при текущем расходе.
 *  - Директ: в API v5 баланса нет. Остаток общего счёта (единого счёта) отдаёт Live v4:
 *    POST https://api.direct.yandex.ru/live/v4/json/ { method: "AccountManagement", param: { Action: "Get" }, token }
 *    → data.Accounts[].Amount / Currency. https://yandex.ru/dev/direct/doc/dg-v4/ru/live/AccountManagement_Get
 *  - VK Реклама: GET /api/v2/user.json → account.balance (строка с суммой) [проверить на реальном кабинете].
 *  - Демо: остаток моделируем — владелец пополняет кабинет заранее (автопополнение), поэтому в демо деньги
 *    не кончаются и предупреждений о балансе нет.
 * В демо считаем на каждой проверке, у настоящих площадок — не чаще раза в 3 часа.
 * Суммы сравниваем с расходом с НДС (как в статистике). Если площадка отдаёт остаток без НДС,
 * дней получится чуть меньше настоящего — предупредим раньше, а не позже.
 */
export const LOW_DAYS = 3;
const REFRESH_MS = 3 * 3600e3;
const ALERT_EVERY_MS = 20 * 3600e3;

export type Balance = {
  accountId: string;
  platform: string;
  login: string;
  /** остаток, ₽ (null — площадка не отдала: например, в Директе не включён общий счёт) */
  amount: number | null;
  currency: string;
  /** средний расход в день за 7 дней, ₽ */
  dailySpend: number;
  /** на сколько дней хватит (null — расхода нет или остаток неизвестен) */
  daysLeft: number | null;
  at: string;
  note?: string | null;
  demo?: boolean;
};

export const TOPUP_URL: Record<string, string> = {
  yandex: "https://direct.yandex.ru/",
  vk: "https://ads.vk.com/hq/budget",
};
export const CABINET_NAME: Record<string, string> = { yandex: "Директа", vk: "VK Рекламы", demo: "демо-кабинета" };

const V4 = () => process.env.YANDEX_DIRECT_V4_URL || (process.env.YANDEX_DIRECT_SANDBOX === "true" ? "https://api-sandbox.direct.yandex.ru/live/v4/json/" : "https://api.direct.yandex.ru/live/v4/json/");

async function kvGet<T>(key: string): Promise<T | null> {
  const db = await getDb();
  const [r] = await db.select().from(schema.kv).where(eq(schema.kv.key, key));
  return (r?.value as T) ?? null;
}
async function kvSet(key: string, value: unknown) {
  const db = await getDb();
  await db.insert(schema.kv).values({ key, value }).onConflictDoUpdate({ target: schema.kv.key, set: { value, updatedAt: new Date() } });
}

async function yandexBalance(acc: AdAccount): Promise<{ amount: number | null; currency: string; note?: string }> {
  const res = await fetch(V4(), {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ method: "AccountManagement", param: { Action: "Get" }, locale: "ru", token: decrypt(acc.accessToken) }),
    signal: AbortSignal.timeout(15000),
  });
  const j = (await res.json().catch(() => ({}))) as { data?: { Accounts?: { Amount?: number | string; Currency?: string }[] }; error_code?: number; error_str?: string; error_detail?: string };
  if (j.error_code) throw new Error(`Директ: ${j.error_str ?? "ошибка"}${j.error_detail ? ` — ${j.error_detail}` : ""} (код ${j.error_code})`);
  const list = j.data?.Accounts ?? [];
  if (!list.length) return { amount: null, currency: "RUB", note: "В Директе не включён общий счёт — остаток виден только в кабинете" };
  return { amount: list.reduce((s, a) => s + Number(a.Amount ?? 0), 0), currency: list[0].Currency || "RUB" };
}

async function vkBalance(acc: AdAccount): Promise<{ amount: number | null; currency: string; note?: string }> {
  const client = (await clientFor(acc)) as VkAds;
  const u = (await client.user()) as { account?: { balance?: string | number; currency?: string }; balance?: string | number; currency?: string };
  const raw = u?.account?.balance ?? u?.balance;
  const amount = raw === undefined || raw === null || raw === "" ? NaN : Number(raw);
  if (!Number.isFinite(amount)) return { amount: null, currency: "RUB", note: "VK Реклама не отдала остаток — смотрите в кабинете" };
  return { amount, currency: u?.account?.currency ?? u?.currency ?? "RUB" };
}

/**
 * Демо: в кабинете включено автопополнение — как только остатка хватает меньше чем на неделю,
 * владелец докладывает порцию (треть месячного бюджета, но не меньше двух недель расхода).
 * Поэтому остаток всегда больше порога предупреждения: демо не пугает «кончились деньги», которых нет.
 */
export function demoBalance(b: Business, spentTotal: number, dailySpend = 0) {
  const topup = Math.max(3000, Math.round(b.monthlyBudget / 3 / 100) * 100, Math.ceil((dailySpend * 14) / 100) * 100);
  const spent = Math.max(0, spentTotal);
  const reserve = Math.max(dailySpend * 7, (LOW_DAYS + 1) * dailySpend);
  let left = Math.ceil(spent / topup) * topup - spent;
  if (spent <= 0) left = topup;
  // Порция ≥ 14 дней расхода, так что хватает одной-двух итераций
  for (let i = 0; i < 4 && left <= reserve; i++) left += topup;
  return Math.round(left);
}

/** Проверить балансы кабинетов, где у бизнеса есть кампании; сохранить и предупредить владельца в Telegram */
export async function checkBalances(b: Business, opts: { force?: boolean } = {}): Promise<{ balances: Balance[]; errors: string[] }> {
  const db = await getDb();
  const camps = await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, b.id), inArray(schema.campaigns.status, ["active", "paused"])));
  const accIds = [...new Set(camps.map((c) => c.accountId))];
  if (!accIds.length) return { balances: [], errors: [] };
  const accounts = await db.select().from(schema.adAccounts).where(inArray(schema.adAccounts.id, accIds));
  const balances: Balance[] = [];
  const errors: string[] = [];
  for (const acc of accounts) {
    const prev = await kvGet<Balance>(`balance:${acc.id}`);
    const demo = acc.platform === "demo";
    if (!demo && !opts.force && prev && Date.now() - new Date(prev.at).getTime() < REFRESH_MS) {
      balances.push(prev);
      continue;
    }
    try {
      const now = demo ? await demoNow({ accountId: acc.id }) : new Date();
      const mine = camps.filter((c) => c.accountId === acc.id);
      const rows = await db
        .select({ day: schema.statsDaily.day, cost: schema.statsDaily.cost, adId: schema.statsDaily.adId })
        .from(schema.statsDaily)
        .where(and(inArray(schema.statsDaily.campaignId, mine.map((c) => c.id)), demo ? undefined : gte(schema.statsDaily.day, isoDay(addDays(now, -8)))));
      // Строки по объявлениям и итог по кампании («» — без разбивки) не пересекаются: суммируем всё
      const from = isoDay(addDays(now, -7)), to = isoDay(addDays(now, -1));
      const week = rows.filter((r) => String(r.day) >= from && String(r.day) <= to).reduce((s, r) => s + r.cost, 0);
      const dailySpend = week / 7;
      let got: { amount: number | null; currency: string; note?: string };
      if (demo) {
        const total = rows.filter((r) => String(r.day) <= isoDay(now)).reduce((s, r) => s + r.cost, 0);
        got = { amount: demoBalance(b, total, dailySpend), currency: "RUB" };
      } else if (acc.platform === "yandex") got = await yandexBalance(acc);
      else if (acc.platform === "vk") got = await vkBalance(acc);
      else continue;
      const live = mine.some((c) => c.status === "active");
      const daysLeft = got.amount === null ? null : got.amount < 1 && live ? 0 : dailySpend >= 1 ? Math.floor(got.amount / dailySpend) : null;
      const bal: Balance = { accountId: acc.id, platform: acc.platform, login: acc.login, amount: got.amount, currency: got.currency, dailySpend: Math.round(dailySpend), daysLeft, at: new Date().toISOString(), note: got.note ?? null, demo };
      await kvSet(`balance:${acc.id}`, bal);
      balances.push(bal);
      if (!demo && live && daysLeft !== null && daysLeft <= LOW_DAYS) await alertLow(b, bal).catch((e) => errors.push(`предупреждение о балансе: ${errorText(e)}`));
    } catch (e) {
      errors.push(`баланс ${PLATFORM_NAME[acc.platform] ?? acc.platform}: ${errorText(e)}`);
      if (prev) balances.push(prev);
    }
  }
  return { balances, errors };
}

/** Последние известные балансы (без запросов к площадкам) — для «Главного» и «Здоровья рекламы» */
export async function getBalances(b: Business): Promise<Balance[]> {
  const db = await getDb();
  const camps = await db.select({ accountId: schema.campaigns.accountId }).from(schema.campaigns).where(and(eq(schema.campaigns.businessId, b.id), inArray(schema.campaigns.status, ["active", "paused"])));
  const out: Balance[] = [];
  for (const id of [...new Set(camps.map((c) => c.accountId))]) {
    const v = await kvGet<Balance>(`balance:${id}`);
    if (v) out.push(v);
  }
  return out;
}

/** «Деньги в кабинете Директа кончатся через 2 дня — пополните» */
export function balanceText(x: Balance): string {
  const where = x.platform === "demo" ? "в демо-кабинете" : `в кабинете ${CABINET_NAME[x.platform] ?? x.platform}`;
  if (x.daysLeft === 0) return `Деньги ${where} кончились — показы остановлены. Пополните кабинет, и реклама продолжится.`;
  const when = x.daysLeft === 1 ? "завтра" : `через ${pl(x.daysLeft ?? 0, "день", "дня", "дней")}`;
  return `Деньги ${where} кончатся ${when} — пополните. Остаток ${rub(x.amount ?? 0)}, реклама тратит около ${rub(x.dailySpend)} в день.`;
}

async function alertLow(b: Business, x: Balance) {
  const key = `balance:alert:${x.accountId}`;
  const last = await kvGet<{ at: number; days: number | null }>(key);
  // Не чаще раза в ~сутки, но сразу — если стало хуже (например, «2 дня» → «кончились»)
  if (last && Date.now() - last.at < ALERT_EVERY_MS && (last.days ?? 99) <= (x.daysLeft ?? 99)) return;
  const { esc, sendToBusiness, tgConfigured } = await import("../notify");
  if (!tgConfigured()) return;
  const link = TOPUP_URL[x.platform];
  const text = [
    `<b>${x.daysLeft === 0 ? "Кончились деньги" : "Скоро кончатся деньги"}</b> · ${esc(b.name)}${x.demo ? " (демо)" : ""}`,
    "",
    esc(balanceText(x)),
    "",
    link ? `Пополнить: ${link}` : `Подробнее: ${appUrl()}/app`,
  ].join("\n");
  const r = await sendToBusiness(b.id, text);
  if (r.ok) await kvSet(key, { at: Date.now(), days: x.daysLeft });
}

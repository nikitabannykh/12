import "server-only";
import { and, eq, inArray, like } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { Business, Campaign } from "../db/schema";
import { safeFetch } from "../importer/fetch";
import { landingFor } from "./landing";
import { act } from "./ops";
import { patchBudgetMeta } from "./budget-guard";
import { pushInbox } from "./inbox";
import { CHANNEL_NAME } from "../platforms";

/**
 * Сторож сайта: реклама, которая ведёт на неработающий сайт, — выброшенные деньги (100% отказов, ноль обращений).
 * Проверяем адреса, куда ведут включённые кампании. Сайт не открылся два раза подряд (с разницей от 3 минут) —
 * робот ставит такие кампании на паузу и пишет владельцу. Сайт снова открывается — включает их обратно сам.
 * Площадки этого не делают надёжно: мониторинг Директа срабатывает с задержкой, у VK его нет.
 */
type Down = { fails: number; first: string; last: string; why: string; recovered?: string };
const key = (bid: string, url: string) => `sitedown:${bid}:${url.replace(/^https?:\/\//, "").slice(0, 120)}`;
const GAP_MS = 3 * 60_000;

async function kvGet<T>(k: string): Promise<T | null> {
  const db = await getDb();
  const [r] = await db.select().from(schema.kv).where(eq(schema.kv.key, k));
  return (r?.value as T) ?? null;
}
async function kvSet(k: string, v: unknown) {
  const db = await getDb();
  await db.insert(schema.kv).values({ key: k, value: v }).onConflictDoUpdate({ target: schema.kv.key, set: { value: v, updatedAt: new Date() } });
}

/** Открывается ли страница: сеть, таймаут, 5xx, 404/410 — нет. 401/403 бывают у защиты от ботов — считаем, что сайт жив */
export async function siteAlive(url: string): Promise<{ ok: boolean; why: string }> {
  try {
    const r = await safeFetch(url, { timeoutMs: 12_000, maxBytes: 256 * 1024, truncate: true });
    if (r.status >= 500) return { ok: false, why: `сайт отвечает ошибкой ${r.status}` };
    if (r.status === 404 || r.status === 410) return { ok: false, why: "страница не найдена (404)" };
    return { ok: true, why: "" };
  } catch (e) {
    const m = (e as Error).message || "";
    return { ok: false, why: /timeout|таймаут|долго/i.test(m) ? "сайт не отвечает" : /ENOTFOUND|resolve|DNS/i.test(m) ? "адрес сайта не находится (домен не работает)" : "сайт не открывается" };
  }
}

const external = (b: Business, c: Campaign) => {
  const l = landingFor(b, c.channel);
  return l.kind === "site" || l.kind === "link" ? l.url : null;
};

export async function siteGuard(b: Business): Promise<{ paused: number; resumed: number; log: string[] }> {
  const db = await getDb();
  const camps = (await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, b.id), inArray(schema.campaigns.status, ["active", "paused"]))))
    .filter((c) => c.platform !== "demo");
  const byUrl = new Map<string, Campaign[]>();
  for (const c of camps) {
    const meta = (c.meta ?? {}) as { pausedBySite?: string | null };
    const url = external(b, c);
    if (!url) continue;
    // Включённые — проверяем; остановленные сторожем — проверяем, чтобы включить обратно
    if (c.status === "active" || meta.pausedBySite) byUrl.set(url, [...(byUrl.get(url) ?? []), c]);
  }
  const log: string[] = [];
  let paused = 0, resumed = 0;
  for (const [url, list] of byUrl) {
    const k = key(b.id, url);
    const prev = await kvGet<Down>(k);
    // Не дёргаем сайт чаще раза в 3 минуты (проверка статусов идёт часто, пока открыт кабинет)
    if (prev && Date.now() - Date.parse(prev.last) < GAP_MS) continue;
    const r = await siteAlive(url);
    const host = url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!r.ok) {
      const down: Down = { fails: (prev?.fails ?? 0) + 1, first: prev?.fails ? prev.first : new Date().toISOString(), last: new Date().toISOString(), why: r.why };
      await kvSet(k, down);
      const toPause = list.filter((c) => c.status === "active");
      if (down.fails >= 2 && toPause.length) {
        await act(
          {
            businessId: b.id, actor: "robot", kind: "pause",
            title: `Остановили рекламу: сайт ${host} не работает`,
            reason: `Реклама ведёт на ${url}, а ${r.why} — люди кликают и сразу уходят, деньги тратятся впустую. Остановили ${toPause.map((c) => `«${CHANNEL_NAME[c.channel] ?? c.channel}»`).join(", ")}. Как только сайт снова откроется, робот включит рекламу сам. Если сайт починят нескоро — переключите рекламу на страницу записи в «Настройках → Куда ведёт реклама».`,
            details: { siteGuard: true, url },
          },
          toPause.map((c) => ({ op: "campaignStatus" as const, campaignId: c.id, status: "paused" as const })),
        );
        for (const c of toPause) await patchBudgetMeta(c.id, { pausedBy: "robot", pausedBySite: url } as never);
        await pushInbox(b.id, [{ tone: "bad", title: `Сайт ${host} не работает — реклама остановлена`, text: `${r.why[0].toUpperCase()}${r.why.slice(1)}. Деньги не тратим; включим рекламу сами, когда сайт откроется. Или переключите рекламу на страницу записи.`, href: "/app/settings?tab=site#landing" }]);
        paused += toPause.length;
        log.push(`сайт ${host} не работает — остановили ${toPause.length}`);
      }
      continue;
    }
    // Помним, что сайт недавно лежал (неделю): это объясняет отказы в статистике за те дни
    {
      const nowIso = new Date().toISOString();
      await kvSet(k, { why: prev?.why ?? "", first: prev?.first ?? nowIso, fails: 0, last: nowIso, recovered: prev?.fails ? nowIso : prev?.recovered });
    }
    const toResume = list.filter((c) => c.status === "paused" && (c.meta as { pausedBySite?: string | null } | null)?.pausedBySite);
    if (toResume.length) {
      await act(
        { businessId: b.id, actor: "robot", kind: "resume", title: `Сайт ${host} снова работает — включили рекламу`, reason: `Сайт открывается, поэтому робот включил ${toResume.map((c) => `«${CHANNEL_NAME[c.channel] ?? c.channel}»`).join(", ")}, которые останавливал из-за сайта.`, details: { siteGuard: true, url } },
        toResume.map((c) => ({ op: "campaignStatus" as const, campaignId: c.id, status: "active" as const })),
      );
      for (const c of toResume) await patchBudgetMeta(c.id, { pausedBy: null, pausedBySite: null } as never);
      await pushInbox(b.id, [{ tone: "good", title: `Сайт ${host} снова работает — реклама включена`, href: "/app" }]);
      resumed += toResume.length;
      log.push(`сайт ${host} снова работает — включили ${toResume.length}`);
    }
  }
  return { paused, resumed, log };
}


/** Сайт сейчас или недавно не открывался: адрес → причина (для разбора отказов в статистике и уведомлениях) */
export async function siteDownInfo(businessId: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select({ value: schema.kv.value }).from(schema.kv).where(like(schema.kv.key, `sitedown:${businessId}:%`));
  const week = Date.now() - 7 * 86400_000;
  const d = rows.map((r) => r.value as Down).find((x) => x && (x.fails >= 1 || (x.recovered && Date.parse(x.recovered) > week)));
  if (!d) return null;
  return d.fails >= 1 ? d.why : `${d.why}, до ${new Date(d.recovered!).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}`;
}

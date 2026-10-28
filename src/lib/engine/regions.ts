import "server-only";
import { showOf, vkFulltimeFromShow } from "./show";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { CITY_REGIONS } from "../niches";
import { YandexDirect } from "../platforms/yandex";
import { VkAds, type VkBusinessContext } from "../platforms/vk";
import { legalAbout, vkAgeRestriction, vkFulltime, vkRadiusFor } from "../platforms/vk-formats";
import type { Business } from "../db/schema";
import type { PlatformClient } from "../platforms/types";
import { ensureGeo } from "../geo";
import { parseHours } from "./extras";
import { appUrl } from "../util";

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/^г\.?\s*/, "").trim();

async function cached<T>(key: string, ttlDays: number, load: () => Promise<T>): Promise<T> {
  const db = await getDb();
  const [row] = await db.select().from(schema.kv).where(eq(schema.kv.key, key));
  if (row && Date.now() - row.updatedAt.getTime() < ttlDays * 864e5) return row.value as T;
  const value = await load();
  if (row) await db.update(schema.kv).set({ value, updatedAt: new Date() }).where(eq(schema.kv.key, key));
  else await db.insert(schema.kv).values({ key, value });
  return value;
}

export async function yandexRegionIds(city: string, client?: YandexDirect): Promise<number[] | null> {
  const n = norm(city);
  if (CITY_REGIONS[n]) return [CITY_REGIONS[n]];
  if (!client) return null;
  const list = await cached("yandex:georegions", 30, () => client.geoRegions().then((l) => l.filter((r) => ["City", "Village", "Region", "District"].includes(r.type))));
  const exact = list.filter((r) => norm(r.name) === n);
  const pick = exact.find((r) => r.type === "City") ?? exact[0];
  return pick ? [pick.id] : null;
}

export async function vkRegionIds(city: string, client: VkAds): Promise<number[] | null> {
  const n = norm(city);
  const list = await cached("vk:regions", 30, async () => {
    const all: { id: number; name: string; type?: string }[] = [];
    for (let offset = 0; offset < 20000; offset += 250) {
      const j = await client.req("GET", "v2/regions.json", { query: { fields: "id,name,type", limit: 250, offset } });
      const items = j.items ?? [];
      all.push(...items.map((x: any) => ({ id: Number(x.id), name: String(x.name), type: x.type })));
      if (items.length < 250) break;
    }
    return all;
  });
  const exact = list.filter((r) => norm(r.name) === n);
  const pick = exact.find((r) => r.type === "city") ?? exact[0];
  return pick ? [pick.id] : null;
}

/**
 * Регионы показа для площадки.
 * 1) Явный выбор в бизнесе (`businesses.region_ids.yandex / .vk`) — например, районы города, если их задали в настройках.
 * 2) Иначе — город целиком.
 *
 * VK: здесь же готовим данные бизнеса для VkAds (prepareVk: точка с радиусом вокруг адреса, расписание, «о компании»,
 * возрастная метка, пиксель и цель) — launch.ts вызывает regionIdsFor для каждого канала, отдельный вызов не нужен.
 * Если координаты есть, а города нет в справочнике VK, возвращаем [] — vk.ts покажет в радиусе (регионы не нужны).
 *
 * TODO(Директ «рядом с салоном»): у групп ЕПК в API есть только RegionIds; гиперлокальный таргетинг — через
 * геосегменты Яндекс Аудиторий → RetargetingLists → AudienceTargets (отдельный OAuth-доступ к Аудиториям).
 */
export async function regionIdsFor(b: Business, platform: string, client: PlatformClient): Promise<number[]> {
  const own = (b.regionIds ?? {}) as { yandex?: number[]; vk?: number[] };
  const extra = showOf(b).extraRegions ?? [];
  const uniq = (xs: number[]) => [...new Set(xs)];
  if (platform === "yandex") {
    if (own.yandex?.length) return own.yandex;
    const r = await yandexRegionIds(b.city, client as YandexDirect);
    if (!r) throw new Error(`не нашли город «${b.city}» в справочнике Яндекса — уточните название в настройках бизнеса`);
    const more: number[] = [];
    for (const name of extra) more.push(...((await yandexRegionIds(name, client as YandexDirect).catch(() => null)) ?? []));
    return uniq([...r, ...more]);
  }
  if (platform === "vk") {
    const vk = client as VkAds;
    const ctx = await prepareVk(b, vk);
    if (own.vk?.length) return own.vk;
    const r = await vkRegionIds(b.city, vk).catch(() => null);
    const more: number[] = [];
    for (const name of extra) more.push(...((await vkRegionIds(name, vk).catch(() => null)) ?? []));
    if (r) return uniq([...r, ...more]);
    if (ctx.localGeo) return [];
    throw new Error(`не нашли город «${b.city}» в справочнике VK — уточните название в настройках бизнеса`);
  }
  return [213]; // демо
}

// ─── VK: данные бизнеса для таргетингов и баннеров ───────────────────────

/** Синхронная часть контекста VK (без сети): «о компании», возрастная метка, расписание. Для client.useBusiness() в optimizer */
export function vkAdContext(b: Business): VkBusinessContext {
  return {
    legalInfo: legalAbout(b.legalInfo),
    ageRestrictions: vkAgeRestriction(b),
    fulltime: showOf(b).scheduleMode === "always" ? null : vkFulltimeFromShow(showOf(b)) ?? (b.hours ? vkFulltime(parseHours(b.hours).workTime) : null),
  };
}

/**
 * Точка с радиусом вокруг адреса (targetings.geo.local_geo — https://ads.vk.ru/en/doc/api/object/LocalGeoTargeting):
 * visit_type "all" (бывают там обычно или сейчас), loc_type дом+работа, радиус по размеру города (vkRadiusFor).
 * Явно выбранные регионы VK в настройках бизнеса важнее радиуса. Нет координат — null (показ на город).
 * Отключить: VK_LOCAL_GEO=0.
 */
export async function vkLocalGeo(b: Business): Promise<VkBusinessContext["localGeo"]> {
  if (process.env.VK_LOCAL_GEO === "0") return null;
  const s = showOf(b);
  // Владелец выбрал «весь город» или добавил другие города — показываем по регионам, а не в радиусе
  if (s.geoMode === "city" || s.extraRegions?.length) return null;
  const own = (b.regionIds ?? {}) as { vk?: number[] };
  if (own.vk?.length) return null;
  const p = await ensureGeo(b);
  if (!p) return null;
  return {
    visit_type: "all",
    loc_type: ["home", "work"],
    locations: [{ lat: p.lat, lng: p.lng, radius: s.geoMode === "radius" && s.radiusKm ? Math.round(s.radiusKm * 1000) : vkRadiusFor(b.city), label: b.name.slice(0, 100), ...(b.address ? { address: b.address.slice(0, 250) } : {}) }],
  };
}

const pixelKey = (businessId: string) => `vk:pixel:${businessId}`;

/** ID пикселя VK (Top@Mail.ru) бизнеса — для кода на странице записи (vkPixelSnippet) и события заявки (vkReachGoalJs) */
export async function vkPixelCounterId(businessId: string): Promise<number | null> {
  const db = await getDb();
  const [row] = await db.select().from(schema.kv).where(eq(schema.kv.key, pixelKey(businessId)));
  const id = Number((row?.value as { counterId?: number } | undefined)?.counterId);
  return id > 0 ? id : null;
}

/**
 * Пиксель и цель «заявка» для оптимизации VK по заявкам. Пиксель находим/создаём в кабинете (VkAds.ensurePixel) и
 * запоминаем в kv `vk:pixel:<businessId>`; цель — событие пикселя с JS-событием `lead` (VkAds.leadGoal).
 * Нет пикселя или цели — null и предупреждение: кампания пойдёт по переходам (как раньше).
 */
export async function vkLeadGoal(b: Business, client: VkAds, siteUrl?: string, email?: string | null): Promise<{ pricedGoal: VkBusinessContext["pricedGoal"]; note?: string }> {
  if (process.env.VK_PIXEL === "0") return { pricedGoal: null };
  const db = await getDb();
  const url = siteUrl || b.siteUrl || `${appUrl()}/p/${b.publicKey}`;
  const known = await vkPixelCounterId(b.id).catch(() => null);
  const px = await client.ensurePixel({ name: b.name, url, tag: `pz-${b.publicKey}`, known, email: email ?? (await vkPixelEmail(b.id)) });
  if (!px.counterId) return { pricedGoal: null, note: `VK: пиксель не настроен — ${px.note ?? "нет данных"}. Оптимизируем по переходам` };
  if (px.counterId !== known) {
    const value = { counterId: px.counterId, url };
    const [row] = await db.select().from(schema.kv).where(eq(schema.kv.key, pixelKey(b.id)));
    if (row) await db.update(schema.kv).set({ value, updatedAt: new Date() }).where(eq(schema.kv.key, pixelKey(b.id)));
    else await db.insert(schema.kv).values({ key: pixelKey(b.id), value });
  }
  let goal = await client.leadGoal(px.counterId);
  // События «Заявка» нет — создаём его через API (у подтверждённого пикселя VK это разрешает)
  if (!goal && (await client.ensureLeadGoal(px.counterId).catch(() => false))) goal = await client.leadGoal(px.counterId);
  if (!goal) {
    return {
      pricedGoal: null,
      note: `VK: в пикселе ${px.counterId} нет события «Заявка». Создайте его в кабинете VK (Пиксели → Настройки → События → JS-событие «lead»); пока оптимизируем по переходам`,
    };
  }
  return { pricedGoal: goal };
}

/**
 * Всё, что VkAds нужно знать о бизнесе, — и передаёт это клиенту (client.useBusiness). Возвращает контекст и
 * предупреждения (console.warn — их же стоит показать владельцу). Ошибки не бросает.
 */
export async function prepareVk(b: Business, client: VkAds, siteUrl?: string): Promise<VkBusinessContext & { notes: string[] }> {
  const notes: string[] = [];
  const ctx: VkBusinessContext = { ...vkAdContext(b) };
  ctx.localGeo = await vkLocalGeo(b).catch(() => null);
  try {
    const g = await vkLeadGoal(b, client, siteUrl);
    ctx.pricedGoal = g.pricedGoal;
    if (g.note) notes.push(g.note);
  } catch (e) {
    ctx.pricedGoal = null;
    notes.push(`VK: цель «заявка» не настроена (${(e as Error).message}) — оптимизируем по переходам`);
  }
  if (!ctx.legalInfo) notes.push("VK: нет юр. данных (ИП/ООО, ИНН) — блок «о компании» не отправляем");
  for (const n of notes) console.warn(`[vk] ${b.id}: ${n}`);
  client.useBusiness({ ...ctx, notes });
  return { ...ctx, notes };
}

/** Email для пикселя VK, который владелец разрешил использовать (кнопка «Настроить VK за меня») */
export async function vkPixelEmail(businessId: string): Promise<string | null> {
  const db = await getDb();
  const [row] = await db.select().from(schema.kv).where(eq(schema.kv.key, `vkpixelemail:${businessId}`));
  return ((row?.value as { email?: string } | undefined)?.email) ?? null;
}
export async function saveVkPixelEmail(businessId: string, email: string) {
  const db = await getDb();
  const key = `vkpixelemail:${businessId}`;
  await db.insert(schema.kv).values({ key, value: { email, at: new Date().toISOString() } }).onConflictDoUpdate({ target: schema.kv.key, set: { value: { email, at: new Date().toISOString() }, updatedAt: new Date() } });
}

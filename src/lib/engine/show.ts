/**
 * Настройки показа владельца: где (регион), кому (возраст и пол) и когда (дни и часы).
 * Модуль без "server-only": им пользуются и мастер запуска, и страница «Реклама», и движок.
 *
 * Что пусто — решает робот: город из анкеты (во ВКонтакте — радиус вокруг адреса), возраст и пол — по аудиториям
 * ниши, время — по часам работы. Как это применяется на площадках:
 *  - Яндекс Директ: регион — RegionIds групп; время — TimeTargeting кампании; возраст и пол — корректировки ставок
 *    «−100%» для неподходящих (bidmodifiers DemographicsAdjustments), отдельного таргетинга по полу/возрасту в ЕПК нет;
 *  - VK Реклама: регион — регионы или точка с радиусом; возраст, пол и время — таргетинги группы (age, sex, fulltime).
 */
export type ShowSettings = {
  /** auto — город из анкеты (VK — радиус вокруг адреса); city — весь город; radius — радиус вокруг адреса (VK) */
  geoMode?: "auto" | "city" | "radius";
  radiusKm?: number | null;
  /** Ещё города/регионы, где показывать (например, соседний город или «Московская область») */
  extraRegions?: string[];
  ageFrom?: number | null;
  ageTo?: number | null;
  sex?: "any" | "female" | "male" | null;
  /** hours — по часам работы; always — круглосуточно; custom — свои дни и часы */
  scheduleMode?: "hours" | "always" | "custom";
  /** Дни недели 0 = пн … 6 = вс */
  days?: number[];
  hourFrom?: number;
  hourTo?: number;
};

export const DAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
export const AGE_MIN = 18;
export const AGE_MAX = 65;
export const RADIUS_STEPS = [0.5, 1, 2, 3, 5, 7, 10];

const int = (x: unknown, lo: number, hi: number) => {
  const n = Math.round(Number(x));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
};

/** Приводим ввод к допустимому виду (сервер не доверяет клиенту) */
export function sanitizeShow(raw: unknown): ShowSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: ShowSettings = {};
  out.geoMode = r.geoMode === "city" || r.geoMode === "radius" ? r.geoMode : "auto";
  if (out.geoMode === "radius") {
    const km = Number(r.radiusKm);
    out.radiusKm = Number.isFinite(km) ? Math.min(10, Math.max(0.5, Math.round(km * 2) / 2)) : 3;
  }
  out.extraRegions = (Array.isArray(r.extraRegions) ? r.extraRegions : [])
    .map((x) => String(x ?? "").replace(/\s+/g, " ").trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, 10);
  const af = r.ageFrom == null || r.ageFrom === "" ? null : int(r.ageFrom, AGE_MIN, AGE_MAX);
  const at = r.ageTo == null || r.ageTo === "" ? null : int(r.ageTo, AGE_MIN, AGE_MAX);
  out.ageFrom = af;
  out.ageTo = at;
  if (af !== null && at !== null && af > at) { out.ageFrom = at; out.ageTo = af; }
  out.sex = r.sex === "female" || r.sex === "male" || r.sex === "any" ? r.sex : null;
  out.scheduleMode = r.scheduleMode === "always" || r.scheduleMode === "custom" ? r.scheduleMode : "hours";
  if (out.scheduleMode === "custom") {
    const days = (Array.isArray(r.days) ? r.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    out.days = [...new Set(days)].sort();
    if (!out.days.length) out.days = [0, 1, 2, 3, 4, 5, 6];
    const from = int(r.hourFrom, 0, 23) ?? 9;
    let to = int(r.hourTo, 1, 24) ?? 21;
    if (to <= from) to = Math.min(24, from + 1);
    // Часы владельца храним как есть; требование Директа «от 40 часов в будни» учитывает customSchedule
    out.hourFrom = from;
    out.hourTo = to;
  }
  return out;
}

export const showOf = (b: { showSettings?: unknown } | null | undefined): ShowSettings => ((b?.showSettings ?? {}) as ShowSettings);

const hh = (x: number) => `${String(x).padStart(2, "0")}:00`;

export function ageText(from?: number | null, to?: number | null) {
  if (from == null && to == null) return null;
  if (from != null && to != null) return `${from}–${to} лет`;
  if (from != null) return `от ${from} лет`;
  return `до ${to} лет`;
}
export function sexText(sex?: string | null) {
  return sex === "female" ? "женщины" : sex === "male" ? "мужчины" : sex === "any" ? "мужчины и женщины" : null;
}

const daysTextOf = (days: number[]) =>
  days.length === 7 ? "каждый день" : days.length === 5 && days.every((d) => d < 5) ? "по будням" : days.length === 2 && days.every((d) => d >= 5) ? "по выходным" : days.map((d) => DAY_SHORT[d]).join(", ");

/**
 * Расписание «своё»: days/from/to — как выбрал владелец (так идёт ВКонтакте), schedule — строки TimeTargeting Директа.
 * Директ требует хотя бы 40 часов показа в будни: если выбранного мало (только выходные, один день, узкое окно),
 * в Директе минимально раздвигаем часы в будни (а без будних дней — добавляем пн–пт) и объясняем это в warning.
 * Только 0/100 — почасовые корректировки автостратегия не учитывает.
 */
export function customSchedule(s: ShowSettings) {
  const days = s.days?.length ? s.days : [0, 1, 2, 3, 4, 5, 6];
  let from = s.hourFrom ?? 9, to = s.hourTo ?? 21;
  if (to <= from) to = Math.min(24, from + 1);
  const ownWeekdays = days.filter((d) => d < 5);
  // Сначала сохраняем часы владельца и добавляем будние дни, потом — если и пн–пт мало — раздвигаем часы
  const wd = [...ownWeekdays];
  for (let d = 0; d < 5 && wd.length * (to - from) < 40; d++) if (!wd.includes(d)) wd.push(d);
  wd.sort();
  let wf = from, wt = to;
  while ((wt - wf) * wd.length < 40 && (wf > 0 || wt < 24)) {
    if (wt < 24) wt++;
    if ((wt - wf) * wd.length < 40 && wf > 0) wf--;
  }
  const window = (i: number): [number, number] | null => (wd.includes(i) ? [wf, wt] : days.includes(i) ? [from, to] : null);
  const schedule = Array.from({ length: 7 }, (_, i) => {
    const w = window(i);
    return `${i + 1},${Array.from({ length: 24 }, (_, h) => (w && h >= w[0] && h < w[1] ? 100 : 0)).join(",")}`;
  });
  const widened = wd.length !== ownWeekdays.length || wf !== from || wt !== to;
  const warning = widened
    ? `В Яндекс Директе реклама должна идти не меньше 40 часов в будни, поэтому там она будет показываться ${daysTextOf(wd)} с ${hh(wf)} до ${hh(wt)}${days.some((d) => d >= 5) ? ` (в выходные — как вы выбрали)` : ""}. Во ВКонтакте — как вы выбрали.`
    : null;
  return { schedule, days, from, to, note: `Реклама показывается ${daysTextOf(days)} с ${hh(from)} до ${hh(to)}.`, warning };
}

/** Расписание VK (targetings.fulltime): часы показа по дням */
export function vkFulltimeFromShow(s: ShowSettings): Record<string, number[]> | null {
  if (s.scheduleMode !== "custom") return null;
  const c = customSchedule(s);
  const keys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const hours = Array.from({ length: c.to - c.from }, (_, i) => c.from + i);
  return Object.fromEntries(keys.map((k, i) => [k, c.days.includes(i) ? hours : []]));
}

/** Корректировки Директа «пол и возраст»: −100% (BidModifier 0) для тех, кому показывать не нужно */
const DIRECT_AGES: { id: string; from: number; to: number }[] = [
  { id: "AGE_0_17", from: 0, to: 17 },
  { id: "AGE_18_24", from: 18, to: 24 },
  { id: "AGE_25_34", from: 25, to: 34 },
  { id: "AGE_35_44", from: 35, to: 44 },
  { id: "AGE_45_54", from: 45, to: 54 },
  { id: "AGE_55", from: 55, to: 200 },
];
export function directDemographics(s: ShowSettings): { Gender?: "GENDER_MALE" | "GENDER_FEMALE"; Age?: string; BidModifier: number }[] {
  const out: { Gender?: "GENDER_MALE" | "GENDER_FEMALE"; Age?: string; BidModifier: number }[] = [];
  if (s.sex === "female") out.push({ Gender: "GENDER_MALE", BidModifier: 0 });
  if (s.sex === "male") out.push({ Gender: "GENDER_FEMALE", BidModifier: 0 });
  if (s.ageFrom != null || s.ageTo != null) {
    const lo = s.ageFrom ?? 0, hi = s.ageTo ?? 200;
    for (const a of DIRECT_AGES) {
      // Возрастная группа Директа целиком вне выбранного диапазона — не показываем
      if (a.to < lo || a.from > hi) out.push({ Age: a.id, BidModifier: 0 });
    }
  }
  return out;
}

/** Короткие строки «где / кому / когда» для интерфейса */
export function showSummary(s: ShowSettings, b: { city: string; address?: string | null; hasGeo?: boolean }, autoTime: string | null) {
  const extra = s.extraRegions?.length ? ` + ${s.extraRegions.join(", ")}` : "";
  // Координаты адреса не определили — ВКонтакте показывает по всему городу, радиуса нет
  const where =
    b.hasGeo === false && s.geoMode !== "city" ? `${b.city} целиком${extra} (координаты адреса не определили — радиус во ВКонтакте недоступен)`
    : s.geoMode === "radius" ? `в ${String(s.radiusKm ?? 3).replace(".", ",")} км от ${b.address || "адреса"} (ВКонтакте), ${b.city} (Яндекс)${extra}`
    : s.geoMode === "city" ? `${b.city} целиком${extra}`
    : `${b.city}${extra}; во ВКонтакте — рядом с ${b.address || "вами"}`;
  const age = ageText(s.ageFrom, s.ageTo);
  const sex = sexText(s.sex);
  const who = age || sex ? [sex ? sex[0].toUpperCase() + sex.slice(1) : "Мужчины и женщины", age ?? "любого возраста"].join(", ") : "Подбирает робот по аудиториям вашей ниши";
  const when = s.scheduleMode === "always" ? "Круглосуточно" : s.scheduleMode === "custom" ? customSchedule(s).note.replace(/^Реклама показывается /, "").replace(/\.$/, "") : autoTime ? autoTime.replace(/^Реклама показывается /, "").replace(/\.$/, "") : "Круглосуточно (часы работы не указаны)";
  const warning = s.scheduleMode === "custom" ? customSchedule(s).warning : null;
  return { where, who, when, warning, custom: Boolean(age || sex || s.geoMode !== "auto" && s.geoMode || s.extraRegions?.length || (s.scheduleMode && s.scheduleMode !== "hours")) };
}

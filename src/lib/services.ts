/**
 * Услуги с разделами прайса («Маникюр», «Педикюр»): группировка для анкеты и страницы записи,
 * выбор услуг для групп объявлений — по одной из каждого раздела, а не три маникюра подряд.
 * Без серверных зависимостей — используется и в браузере.
 */
import type { Service } from "./db/schema";

export type ServiceGroup<T extends Service = Service> = { category: string; items: { s: T; i: number }[] };

/** Группы в порядке первого появления; услуги без раздела — в группе "" (показываем без заголовка) */
export function groupServices<T extends Service>(list: T[]): ServiceGroup<T>[] {
  const groups: ServiceGroup<T>[] = [];
  list.forEach((s, i) => {
    const c = (s.category ?? "").trim();
    let g = groups.find((x) => x.category === c);
    if (!g) groups.push((g = { category: c, items: [] }));
    g.items.push({ s, i });
  });
  return groups;
}

/** Есть ли смысл показывать разделы: хотя бы два разных */
export const hasCategories = (list: Service[]) => new Set(list.map((s) => (s.category ?? "").trim()).filter(Boolean)).size >= 2;

/**
 * n услуг для групп поиска: по кругу из разделов (первая услуга каждого раздела, затем вторые…),
 * чтобы реклама покрывала и маникюр, и педикюр. Без разделов — первые n, как раньше.
 */
export function spreadServices<T extends Service>(list: T[], n: number): T[] {
  if (!hasCategories(list)) return list.slice(0, n);
  const groups = groupServices(list).map((g) => g.items.map((x) => x.s));
  const out: T[] = [];
  for (let k = 0; out.length < n && groups.some((g) => g.length > k); k++) for (const g of groups) if (g[k] && out.length < n) out.push(g[k]);
  return out;
}

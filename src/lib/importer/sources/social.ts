/**
 * Страницы-визитки и запись: Taplink, VK, YCLIENTS. Только публичный HTML и OpenGraph.
 *
 *  - Taplink: блоки страницы лежат в window.data (тексты, ссылки, мессенджеры, прайс) — читаем их как текст.
 *  - VK: без входа часто отдаёт заглушку для роботов («challenge») — её не обходим, ссылку сохраняем как сайт.
 *  - YCLIENTS: страница записи — приложение без данных в HTML, а API виджета требует ключ партнёра.
 *    Поэтому берём ссылку как «куда записываться» и просим ссылку на Карты или сайт для цен.
 */
import type { Found } from "../types";
import { clean, htmlToText, looseJson, metaTags, titleOf } from "../html";
import { cleanDescription, cleanName, formatPhone, phoneInText, pricesFromText, servicesFromJson, telegramFrom, uniq, whatsappFrom } from "../normalize";
import { fetchPage } from "../fetch";

type O = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export { isTaplink, isVk, isYclients } from "../hosts";

/** window.data Taplink → строки текста и ссылки */
function taplinkBlocks(data: unknown): { lines: string[]; hrefs: string[] } {
  const lines: string[] = [];
  const hrefs: string[] = [];
  const visit = (v: unknown, key: string, depth: number) => {
    if (depth > 12 || v === null || v === undefined) return;
    if (typeof v === "string") {
      if (/^(https?:|tel:|mailto:|whatsapp:|tg:)/i.test(v)) hrefs.push(v);
      else if (/^(text|title|subtitle|name|value|bio|caption|price|description)$/.test(key)) {
        for (const l of htmlToText(v.replace(/<br\s*\/?>/gi, "\n")).split("\n")) if (l.trim()) lines.push(l.trim());
      }
      return;
    }
    if (Array.isArray(v)) return v.forEach((x) => visit(x, key, depth + 1));
    if (typeof v === "object") for (const [k, x] of Object.entries(v as O)) if (!/^(theme|design|styles?|stat|block_id|addon_target)$/.test(k)) visit(x, k, depth + 1);
  };
  visit(data, "", 0);
  return { lines, hrefs };
}

export function parseTaplinkHtml(html: string, url: string): Found {
  const meta = metaTags(html);
  const grab = (name: string) => {
    const m = new RegExp(`window\\.${name}\\s*=\\s*(\\{[\\s\\S]*?\\});\\s*\\n`).exec(html);
    return m ? (looseJson(m[1]) as O | null) : null;
  };
  const account = grab("account");
  const data = grab("data");
  const { lines, hrefs } = taplinkBlocks(data);
  const text = lines.join("\n");
  const fromJson = servicesFromJson([data, account?.products]);
  const services = fromJson.length >= 2 ? fromJson : pricesFromText(text);
  const avatar = (account?.avatar ?? {}) as O;
  const nick = String(account?.nickname ?? "");
  let name = clean(String(avatar.title ?? "")) || cleanName(meta["og:title"] ?? titleOf(html));
  if (name.toLowerCase() === nick.toLowerCase() || /^(taplink|link in bio)/i.test(name)) name = lines.find((l) => l.length >= 3 && l.length <= 60 && !/₽|руб|запис|онлайн/i.test(l)) ?? name;
  const tel = hrefs.find((h) => /^tel:/i.test(h));
  return {
    kind: "taplink",
    url,
    status: lines.length || name ? "ok" : "partial",
    name: name.slice(0, 80),
    phone: formatPhone(tel ? tel.slice(4) : phoneInText(text)),
    whatsapp: hrefs.map(whatsappFrom).find(Boolean) ?? "",
    telegram: hrefs.map(telegramFrom).find(Boolean) ?? "",
    siteUrl: url.replace(/[?#].*$/, ""),
    services,
    servicesStructured: fromJson.length >= 2,
    description: cleanDescription(clean(String(avatar.bio ?? "")) || lines.filter((l) => l.length > 40 && !/₽|руб/.test(l)).slice(0, 2).join(" ")),
    photos: meta["og:image"] ? [meta["og:image"]] : [],
    text,
    links: uniq(hrefs.filter((h) => /yandex\.[a-z.]+\/maps|2gis\.|dikidi\.|yclients\./i.test(h))).slice(0, 3),
  };
}

export async function readTaplink(url: string): Promise<Found> {
  try {
    const page = await fetchPage(url, { timeoutMs: 9000 });
    if (page.status >= 400) return { kind: "taplink", url, status: "error", message: "Страница Taplink не открылась — проверьте ссылку" };
    return parseTaplinkHtml(page.html, url);
  } catch {
    return { kind: "taplink", url, status: "error", message: "Страница Taplink не открылась — проверьте ссылку" };
  }
}

export const isVkWall = (html: string, finalUrl: string) => /challenge\.html|\/login\?|blank\.php/i.test(finalUrl) || /У вас большие запросы|Проверяем, что вы не робот/i.test(html);

export function parseVkHtml(html: string, url: string): Found {
  const meta = metaTags(html);
  const text = htmlToText(html, 20000);
  const name = cleanName(meta["og:title"] ?? titleOf(html)).replace(/\s*\|\s*(ВКонтакте|VK)$/i, "");
  return {
    kind: "vk",
    url,
    status: "ok",
    name,
    siteUrl: url.replace(/[?#].*$/, ""),
    description: cleanDescription(meta["og:description"] ?? meta.description),
    phone: phoneInText(text),
    services: pricesFromText(text),
    photos: meta["og:image"] && !/camera_\d+|deactivated|community_\d+\.png/.test(meta["og:image"]) ? [meta["og:image"]] : [],
    text,
  };
}

export async function readVk(url: string): Promise<Found> {
  const partial = (message: string, status: Found["status"] = "blocked"): Found => ({ kind: "vk", url, status, message, siteUrl: url.replace(/[?#].*$/, "") });
  try {
    const page = await fetchPage(url, { timeoutMs: 9000 });
    if (page.status >= 400 || isVkWall(page.html, page.url)) return partial("VK не показывает страницу без входа — ссылку сохранили, остальное возьмём из других ссылок или заполните вручную");
    const r = parseVkHtml(page.html, url);
    return r.name ? r : partial("VK не показал данные сообщества — заполните недостающее вручную", "partial");
  } catch {
    return partial("Страница VK не открылась — проверьте ссылку", "error");
  }
}

export async function readYclients(url: string): Promise<Found> {
  const base: Found = {
    kind: "yclients",
    url,
    status: "partial",
    siteUrl: url.replace(/[?#].*$/, ""),
    message: "YCLIENTS показывает услуги только внутри виджета записи — ссылку сохранили. Чтобы подтянуть цены, добавьте ссылку на Яндекс Карты или сайт",
  };
  try {
    const page = await fetchPage(url, { timeoutMs: 8000 });
    const meta = metaTags(page.html);
    const name = cleanName(meta["og:title"] || titleOf(page.html));
    const services = servicesFromJson(looseJson(/<script[^>]*id="serverApp-state"[^>]*>([\s\S]*?)<\/script>/.exec(page.html)?.[1] ?? "null"));
    if (services.length) return { ...base, status: "ok", message: undefined, name, services, servicesStructured: true };
    return name && !/^yclients$/i.test(name) ? { ...base, name } : base;
  } catch {
    return base;
  }
}

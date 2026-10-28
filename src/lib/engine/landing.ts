/**
 * Куда ведёт реклама (куда попадает человек после клика): своя страница записи, сайт или любая ссылка —
 * онлайн-запись (YCLIENTS, DIKIDI), Taplink, конкретная страница сайта, WhatsApp или Telegram.
 * Можно задать одну ссылку для всех каналов и свою — для отдельного канала (например, ВКонтакте → Telegram).
 * Модуль без "server-only": им пользуются и интерфейс, и движок.
 */
export type LandingMode = "auto" | "page" | "site" | "link";
export type LandingTarget = { mode: LandingMode; url?: string | null };
export type LandingSettings = LandingTarget & { channels?: Partial<Record<string, LandingTarget>> };
export type LandingBiz = { siteUrl?: string | null; publicKey: string; landing?: unknown };

const APP = () => (typeof process !== "undefined" && process.env.NEXT_PUBLIC_APP_URL) || (typeof window !== "undefined" ? window.location.origin : "https://polny-zal.vercel.app");

export const pageUrl = (b: Pick<LandingBiz, "publicKey">, base = APP()) => `${base.replace(/\/$/, "")}/p/${b.publicKey}`;

/** Ссылка, введённая владельцем: добавляем https://, отбрасываем мусор. null — не ссылка */
export function normalizeUrl(raw: unknown): string | null {
  let s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^@[\w.]{3,}$/.test(s)) s = `https://t.me/${s.slice(1)}`; // @username — Telegram
  if (/^\+?\d[\d\s()-]{9,}$/.test(s)) s = `https://wa.me/${s.replace(/\D/g, "")}`; // номер — WhatsApp
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".") || /\s/.test(s)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function target(raw: unknown): LandingTarget | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const mode = (["auto", "page", "site", "link"] as const).find((m) => m === r.mode) ?? "auto";
  if (mode === "link") {
    const url = normalizeUrl(r.url);
    return url ? { mode, url } : null;
  }
  return { mode };
}

export function sanitizeLanding(raw: unknown): { settings: LandingSettings; error?: string } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const main = target(r);
  if (!main) return { settings: { mode: "auto" }, error: "Проверьте ссылку — она должна открываться в браузере, например https://dikidi.net/123" };
  const channels: Record<string, LandingTarget> = {};
  for (const [ch, v] of Object.entries((r.channels ?? {}) as Record<string, unknown>)) {
    const t = target(v);
    if (!t) return { settings: { mode: "auto" }, error: "Проверьте ссылку для отдельного канала" };
    if (t.mode !== "auto") channels[ch] = t;
  }
  return { settings: { ...main, ...(Object.keys(channels).length ? { channels } : {}) } };
}

export const landingOf = (b: Pick<LandingBiz, "landing">): LandingSettings => ((b.landing ?? { mode: "auto" }) as LandingSettings);

export type Landing = {
  url: string;
  /** page — наша страница записи; site — сайт владельца; link — другая ссылка */
  kind: "page" | "site" | "link";
  /** Заявки считаются автоматически: на нашей странице — всегда, на сайте — с кодом счётчика */
  tracked: "auto" | "counter" | "clicks";
  label: string;
};

function resolve(t: LandingTarget, b: LandingBiz, base?: string): Landing | null {
  if (t.mode === "page") return { url: pageUrl(b, base), kind: "page", tracked: "auto", label: "Страница записи" };
  if (t.mode === "site") return b.siteUrl ? { url: b.siteUrl, kind: "site", tracked: "counter", label: "Сайт" } : null;
  if (t.mode === "link" && t.url) return { url: t.url, kind: "link", tracked: "clicks", label: linkLabel(t.url) };
  return null;
}

/** Куда ведёт реклама в этом канале. Без настроек — как раньше: сайт, если он есть, иначе страница записи */
export function landingFor(b: LandingBiz, channel?: string | null, base?: string): Landing {
  const s = landingOf(b);
  const byChannel = channel ? s.channels?.[channel] ?? s.channels?.[channel.replace(/^retarget_/, "") === "yandex" ? "network" : channel] : null;
  return (byChannel && resolve(byChannel, b, base)) || resolve(s, b, base) ||
    (b.siteUrl ? { url: b.siteUrl, kind: "site", tracked: "counter", label: "Сайт" } : { url: pageUrl(b, base), kind: "page", tracked: "auto", label: "Страница записи" });
}

export function linkLabel(url: string) {
  const h = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } })();
  if (/wa\.me|whatsapp/.test(h)) return "WhatsApp";
  if (/t\.me|telegram/.test(h)) return "Telegram";
  if (/yclients/.test(h)) return "YCLIENTS";
  if (/dikidi/.test(h)) return "DIKIDI";
  if (/taplink/.test(h)) return "Taplink";
  if (/vk\.(com|ru)/.test(h)) return "ВКонтакте";
  return h;
}

/** Мессенджеры и соцсети: Директ такие ссылки обычно не принимает как адрес объявления */
export const isMessenger = (url: string) => /(^|\.)(wa\.me|whatsapp\.com|t\.me|telegram\.me|vk\.com|vk\.ru)$/i.test((() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })());

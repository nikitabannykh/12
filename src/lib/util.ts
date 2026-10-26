import { randomBytes } from "crypto";

export const uid = (prefix = "") => prefix + randomBytes(9).toString("base64url");

export const rub = (n: number, digits = 0) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(Math.round(n * 10 ** digits) / 10 ** digits) + " ₽";

export const num = (n: number) => new Intl.NumberFormat("ru-RU").format(Math.round(n));

export function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export const pl = (n: number, one: string, few: string, many: string) => `${num(n)} ${plural(n, one, few, many)}`;

export function isoDay(d: Date = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

export function startOfWeek(d: Date = new Date()) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const wd = (x.getUTCDay() + 6) % 7; // понедельник = 0
  x.setUTCDate(x.getUTCDate() - wd);
  return x;
}

export function startOfMonth(d: Date = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function daysInMonth(d: Date = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function appUrl() {
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return (process.env.APP_URL || (vercel ? `https://${vercel}` : "http://localhost:3000")).replace(/\/$/, "");
}

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function hostOf(url?: string | null) {
  if (!url) return "";
  try {
    return new URL(url.startsWith("http") ? url : "https://" + url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function normalizeUrl(url?: string | null) {
  if (!url) return null;
  const u = url.trim();
  if (!u) return null;
  return u.startsWith("http") ? u : "https://" + u;
}

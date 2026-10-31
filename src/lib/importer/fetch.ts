/**
 * Безопасная загрузка чужих страниц для автозаполнения.
 *
 * Ссылку присылает пользователь — значит, сервер не должен ходить «куда скажут» (SSRF):
 *  - только http/https, только порты 80/443, без логина и пароля в ссылке;
 *  - адрес хоста проверяется в момент соединения (свой lookup для DNS): частные, локальные,
 *    link-local и служебные сети запрещены — в том числе после редиректа и при подмене DNS (rebinding);
 *  - не больше 3 редиректов, общий таймаут на запрос, ограничение размера ответа (и после распаковки).
 *
 * Обход защиты от роботов не делаем: один честный User-Agent, без ротаций, прокси и капчи.
 */
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import zlib from "node:zlib";
import type { Readable } from "node:stream";

export type FetchErrorCode = "invalid_url" | "blocked_host" | "timeout" | "too_big" | "http" | "network" | "redirects" | "type";

export class FetchError extends Error {
  constructor(public code: FetchErrorCode, message: string, public status?: number) {
    super(message);
  }
}

export type Fetched = { url: string; status: number; contentType: string; body: Buffer; truncated: boolean };

export type FetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  /** Обрезать ответ до maxBytes вместо ошибки (для HTML: начало страницы полезнее, чем ничего) */
  truncate?: boolean;
  maxRedirects?: number;
  accept?: string;
  headers?: Record<string, string>;
  /** Проверка Content-Type до чтения тела */
  expect?: (contentType: string) => boolean;
};

export const BOT_UA = "Mozilla/5.0 (compatible; PolnyZalBot/1.0; +https://polnyzal.ru/bot)";

/** Частные, локальные и служебные адреса — туда не ходим */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local, метаданные облаков
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224 // multicast и зарезервированные
    );
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
    if (s === "::" || s === "::1") return true;
    const mapped = s.match(/^::ffff:(?:0:)?(.+)$/);
    if (mapped) {
      const rest = mapped[1];
      if (net.isIPv4(rest)) return isPrivateIp(rest);
      const g = rest.split(":");
      if (g.length === 2) {
        const hi = parseInt(g[0], 16), lo = parseInt(g[1], 16);
        return isPrivateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
      }
      return true;
    }
    // Развёрнутая запись (0:0:0:0:0:ffff:7f00:1) и IPv4-совместимые ::/96 (::127.0.0.1, ::7f00:1): первые 80 бит — нули.
    // Публичных адресов там нет, а ядро может отправить такой запрос во внутреннюю сеть — блокируем целиком
    {
      const v4tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
      const body = v4tail ? s.slice(0, -v4tail[1].length) + "0:0" : s;
      const [head, tail = ""] = body.split("::");
      const hg = head ? head.split(":") : [], tg = body.includes("::") ? (tail ? tail.split(":") : []) : [];
      const groups = body.includes("::") ? [...hg, ...Array(Math.max(0, 8 - hg.length - tg.length)).fill("0"), ...tg] : hg;
      if (groups.length === 8 && groups.slice(0, 5).every((x) => parseInt(x || "0", 16) === 0)) return true;
    }
    if (/^(fc|fd)/.test(s)) return true; // unique local
    if (/^fe[89ab]/.test(s)) return true; // link-local
    if (/^ff/.test(s)) return true; // multicast
    if (/^64:ff9b:/.test(s) || /^2002:/.test(s) || /^2001:0?db8:/.test(s)) return true; // NAT64, 6to4, документация
    return false;
  }
  return true;
}

const BAD_HOST = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain)$/i;

/** Проверка ссылки до запроса. Возвращает URL или бросает FetchError. */
export function checkUrl(raw: string | URL): URL {
  let u: URL;
  try {
    u = typeof raw === "string" ? new URL(raw) : raw;
  } catch {
    throw new FetchError("invalid_url", "Не похоже на ссылку");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new FetchError("invalid_url", "Нужна ссылка, которая начинается с http:// или https://");
  if (u.username || u.password) throw new FetchError("invalid_url", "Ссылки с логином и паролем не открываем");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host || BAD_HOST.test(host) || !/[.:]/.test(host)) throw new FetchError("blocked_host", "Это внутренний адрес — его открыть нельзя");
  if (net.isIP(host) && isPrivateIp(host)) throw new FetchError("blocked_host", "Это внутренний адрес — его открыть нельзя");
  if (u.port && u.port !== "80" && u.port !== "443") throw new FetchError("blocked_host", "Открываем только обычные сайты (без нестандартных портов)");
  return u;
}

/** DNS с проверкой: если хоть один адрес частный — соединение не открываем */
export const safeLookup = (hostname: string, options: dns.LookupOptions, cb: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void) => {
  dns.lookup(hostname, { all: true, family: options?.family ?? 0 }, (err, addrs) => {
    if (err) return cb(err, "", 4);
    const list = addrs as dns.LookupAddress[];
    if (!list.length) return cb(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }), "", 4);
    if (list.some((a) => isPrivateIp(a.address))) return cb(Object.assign(new Error("Blocked private address"), { code: "EBLOCKED" }), "", 4);
    if (options?.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
};

function once(url: URL, o: Required<Pick<FetchOptions, "timeoutMs" | "maxBytes" | "truncate">> & FetchOptions, deadline: number): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const left = Math.max(500, deadline - Date.now());
    const req = lib.request(
      url,
      {
        method: "GET",
        agent: false,
        lookup: safeLookup as never,
        headers: {
          "User-Agent": BOT_UA,
          Accept: o.accept ?? "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.5",
          "Accept-Encoding": "gzip, deflate, br",
          ...o.headers,
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ status, headers: res.headers, body: Buffer.alloc(0), truncated: false });
        }
        const ct = String(res.headers["content-type"] ?? "");
        if (o.expect && status < 400 && !o.expect(ct)) {
          res.destroy();
          return reject(new FetchError("type", "Неподходящий тип файла", status));
        }
        const len = Number(res.headers["content-length"] ?? 0);
        if (len > o.maxBytes * 4 && !o.truncate) {
          res.destroy();
          return reject(new FetchError("too_big", "Файл слишком большой", status));
        }
        const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
        let stream: Readable = res;
        if (enc.includes("br")) stream = res.pipe(zlib.createBrotliDecompress());
        else if (enc.includes("gzip")) stream = res.pipe(zlib.createGunzip());
        else if (enc.includes("deflate")) stream = res.pipe(zlib.createInflate());
        const chunks: Buffer[] = [];
        let size = 0;
        let done = false;
        const finish = (truncated: boolean) => {
          if (done) return;
          done = true;
          resolve({ status, headers: res.headers, body: Buffer.concat(chunks), truncated });
        };
        stream.on("data", (c: Buffer) => {
          if (done) return;
          size += c.length;
          if (size > o.maxBytes) {
            if (o.truncate) {
              chunks.push(c.subarray(0, c.length - (size - o.maxBytes)));
              finish(true);
            } else {
              done = true;
              reject(new FetchError("too_big", "Файл слишком большой", status));
            }
            res.destroy();
            return;
          }
          chunks.push(c);
        });
        stream.on("end", () => finish(false));
        stream.on("error", (e) => {
          if (!done) {
            done = true;
            reject(new FetchError("network", `Не удалось прочитать ответ: ${e.message}`, status));
          }
        });
      },
    );
    const timer = setTimeout(() => {
      req.destroy(new FetchError("timeout", "Сайт отвечает слишком долго"));
    }, left);
    req.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (e instanceof FetchError) return reject(e);
      if (e.code === "EBLOCKED") return reject(new FetchError("blocked_host", "Это внутренний адрес — его открыть нельзя"));
      if (e.code === "ENOTFOUND" || e.code === "EAI_AGAIN") return reject(new FetchError("network", "Такого сайта нет — проверьте адрес"));
      reject(new FetchError("network", "Не получилось открыть ссылку"));
    });
    req.on("close", () => clearTimeout(timer));
    req.end();
  });
}

/** GET с проверками SSRF, редиректами (≤ 3), таймаутом и лимитом размера */
export async function safeFetch(raw: string, opts: FetchOptions = {}): Promise<Fetched> {
  const o = { timeoutMs: 9000, maxBytes: 3 * 1024 * 1024, truncate: false, maxRedirects: 3, ...opts };
  const deadline = Date.now() + o.timeoutMs;
  let url = checkUrl(raw);
  for (let hop = 0; ; hop++) {
    if (Date.now() > deadline) throw new FetchError("timeout", "Сайт отвечает слишком долго");
    const r = await once(url, o, deadline);
    if (r.status >= 300 && r.status < 400 && r.headers.location) {
      if (hop >= o.maxRedirects) throw new FetchError("redirects", "Слишком много перенаправлений");
      url = checkUrl(new URL(String(r.headers.location), url));
      continue;
    }
    return { url: url.toString(), status: r.status, contentType: String(r.headers["content-type"] ?? ""), body: r.body, truncated: r.truncated };
  }
}

/** Текст ответа с учётом кодировки (старые сайты часто в windows-1251) */
export function decodeText(f: Pick<Fetched, "body" | "contentType">): string {
  let charset = /charset=["']?([\w-]+)/i.exec(f.contentType)?.[1]?.toLowerCase();
  if (!charset) {
    const head = f.body.subarray(0, 4096).toString("latin1");
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase();
  }
  if (charset && /1251|cp-?1251|windows-?1251/.test(charset)) {
    try {
      return new TextDecoder("windows-1251").decode(f.body);
    } catch {
      /* ниже — utf-8 */
    }
  }
  if (charset && /koi8/.test(charset)) {
    try {
      return new TextDecoder("koi8-r").decode(f.body);
    } catch {
      /* utf-8 */
    }
  }
  return f.body.toString("utf8");
}

/** HTML-страница: текст и финальный адрес */
export async function fetchPage(url: string, opts: FetchOptions = {}): Promise<{ url: string; status: number; html: string }> {
  const f = await safeFetch(url, { truncate: true, maxBytes: 3 * 1024 * 1024, ...opts });
  return { url: f.url, status: f.status, html: decodeText(f) };
}

export async function fetchJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<{ status: number; data: T | null }> {
  const f = await safeFetch(url, { accept: "application/json", maxBytes: 2 * 1024 * 1024, ...opts });
  try {
    return { status: f.status, data: JSON.parse(decodeText(f)) as T };
  } catch {
    return { status: f.status, data: null };
  }
}

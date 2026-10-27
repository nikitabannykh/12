import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { appUrl } from "./util";

/**
 * Отправка писем по SMTP (nodemailer).
 *  SMTP_URL — строка подключения: smtps://логин:пароль-приложения@smtp.yandex.ru:465
 *             (спецсимволы в пароле — через encodeURIComponent).
 *             Особое значение json:// — тестовый режим: письма не уходят, а печатаются в лог сервера одной строкой
 *             «[mail:json] {…}» (nodemailer jsonTransport). Удобно для проверки ссылок без почтового сервера.
 *  MAIL_FROM  — отправитель: «Полный зал <robot@домен>». У Яндекса и Mail.ru адрес должен совпадать с логином SMTP.
 *             Пусто → логин из SMTP_URL.
 * Без SMTP_URL письма не отправляются: регистрация работает без подтверждения почты,
 * а восстановление пароля и вход по ссылке недоступны.
 */
export const mailConfigured = () => Boolean(process.env.SMTP_URL?.trim());

/** Локальный запуск: можно печатать ссылки из писем в консоль, если SMTP не настроен */
export const devMail = () => process.env.NODE_ENV !== "production" || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(appUrl());

let cached: { url: string; t: Transporter } | null = null;
function transport(): Transporter {
  const url = process.env.SMTP_URL!.trim();
  if (cached?.url === url) return cached.t;
  const t = url === "json://" ? nodemailer.createTransport({ jsonTransport: true }) : nodemailer.createTransport(url);
  cached = { url, t };
  return t;
}

function fromAddress(): string {
  const from = process.env.MAIL_FROM?.trim();
  if (from) return from;
  try {
    const login = decodeURIComponent(new URL(process.env.SMTP_URL!.trim()).username);
    if (login.includes("@")) return `"Полный зал" <${login}>`;
  } catch {
    /* json:// и прочее */
  }
  return `"Полный зал" <no-reply@${new URL(appUrl()).hostname}>`;
}

export type Mail = { to: string; subject: string; text: string; html: string };

export async function sendMail(m: Mail): Promise<void> {
  if (!mailConfigured()) throw new Error("Почта не настроена (SMTP_URL)");
  const info = await transport().sendMail({ from: fromAddress(), ...m });
  if (process.env.SMTP_URL!.trim() === "json://") console.log("[mail:json]", (info as { message?: string }).message);
}

// --- Шаблоны ---

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(title: string, paragraphs: string[], button?: { href: string; label: string }, after: string[] = []) {
  const p = (t: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.5;color:#1d2045">${esc(t)}</p>`;
  const btn = button
    ? `<p style="margin:22px 0"><a href="${esc(button.href)}" style="display:inline-block;background:#1d2045;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${esc(button.label)}</a></p>
<p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:#6b6f8a">Если кнопка не нажимается, скопируйте ссылку в браузер:<br><a href="${esc(button.href)}" style="color:#1d2045;word-break:break-all">${esc(button.href)}</a></p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f5f4ef;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:28px 20px">
<div style="font-weight:800;font-size:18px;color:#1d2045;margin-bottom:18px">Полный зал</div>
<div style="background:#fff;border-radius:16px;padding:24px;border:1px solid #e7e5dc">
<h1 style="margin:0 0 14px;font-size:20px;color:#1d2045">${esc(title)}</h1>
${paragraphs.map(p).join("\n")}${btn}${after.map(p).join("\n")}
</div></div></body></html>`;
  const text = [title, "", ...paragraphs, ...(button ? ["", `${button.label}: ${button.href}`, ""] : []), ...after].join("\n");
  return { html, text };
}

export function welcomeMail(to: string, verifyUrl: string): Mail {
  return {
    to,
    subject: "Добро пожаловать в «Полный зал»",
    ...layout(
      "Аккаунт создан",
      ["Вы зарегистрировались в «Полном зале» с этой почтой. Подтвердите адрес — тогда через него можно будет восстановить пароль."],
      { href: verifyUrl, label: "Подтвердить почту" },
      ["Если вы не регистрировались, просто не обращайте внимания на это письмо."],
    ),
  };
}

export function resetMail(to: string, url: string): Mail {
  return {
    to,
    subject: "Восстановление пароля — «Полный зал»",
    ...layout(
      "Новый пароль",
      ["Кто-то (надеемся, вы) попросил сменить пароль для входа в «Полный зал». Ссылка действует 1 час и сработает один раз."],
      { href: url, label: "Задать новый пароль" },
      ["Если это были не вы — ничего не делайте, пароль останется прежним."],
    ),
  };
}

export function magicMail(to: string, url: string): Mail {
  return {
    to,
    subject: "Ссылка для входа — «Полный зал»",
    ...layout(
      "Вход по ссылке",
      ["Нажмите кнопку, чтобы войти в «Полный зал». Ссылка действует 15 минут и сработает один раз."],
      { href: url, label: "Войти" },
      ["Если вы не запрашивали вход, просто удалите это письмо."],
    ),
  };
}

export function passwordChangedMail(to: string): Mail {
  return {
    to,
    subject: "Пароль изменён — «Полный зал»",
    ...layout("Пароль изменён", [
      "Пароль для входа в «Полный зал» только что изменили. Все остальные устройства вышли из аккаунта.",
      `Если это были не вы — восстановите пароль: ${appUrl()}/reset`,
    ]),
  };
}

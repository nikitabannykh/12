import type { NextConfig } from "next";

/**
 * Заголовки безопасности. Скриптовый CSP не задаём: Метрика, VK-пиксель и встроенные скрипты Next.js
 * потребовали бы nonce/хешей — от кликджекинга достаточно frame-ancestors.
 * Страница записи /p/* — исключение: её можно встраивать на сайт владельца (iframe), поэтому frame-ancestors *.
 */
const common = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
];

const config: NextConfig = {
  // PGlite (локальная база для разработки) — WASM-пакет, его не нужно бандлить
  serverExternalPackages: ["@electric-sql/pglite", "postgres", "nodemailer"],
  // Шрифты для генерации рекламных картинок читаются с диска — включаем их в серверный бандл
  outputFileTracingIncludes: { "/**": ["./assets/fonts/**"] },
  async headers() {
    return [
      { source: "/((?!p/).*)", headers: [...common, { key: "X-Frame-Options", value: "DENY" }, { key: "Content-Security-Policy", value: "frame-ancestors 'none'" }] },
      { source: "/p/:path*", headers: [...common, { key: "Content-Security-Policy", value: "frame-ancestors *" }] },
    ];
  },
  experimental: {
    serverActions: { bodySizeLimit: "8mb" },
  },
};

export default config;

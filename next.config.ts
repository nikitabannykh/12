import type { NextConfig } from "next";

const config: NextConfig = {
  // PGlite (локальная база для разработки) — WASM-пакет, его не нужно бандлить
  serverExternalPackages: ["@electric-sql/pglite", "postgres", "nodemailer"],
  // Шрифты для генерации рекламных картинок читаются с диска — включаем их в серверный бандл
  outputFileTracingIncludes: { "/**": ["./assets/fonts/**"] },
  experimental: {
    serverActions: { bodySizeLimit: "8mb" },
  },
};

export default config;

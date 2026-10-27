# Полный зал — образ для Yandex Cloud Serverless Containers, виртуальной машины или любого Docker-хоста.
# Сборка:  docker build -t polny-zal .
# Запуск:  docker run -p 8080:8080 --env-file .env polny-zal
# Порт берётся из PORT (Serverless Containers передают его сами), по умолчанию 8080.
# Все данные — в Postgres из DATABASE_URL (картинки тоже); диск контейнера временный.

# Базовый образ можно заменить, если Docker Hub недоступен или упирается в лимиты:
#   docker build --build-arg NODE_IMAGE=mirror.gcr.io/library/node:22-bookworm-slim -t polny-zal .
ARG NODE_IMAGE=node:22-bookworm-slim

# ─── 1. Зависимости ───────────────────────────────────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ─── 2. Сборка ────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Переменные окружения при сборке не нужны: всё читается при запуске
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

# ─── 3. Запуск ────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS run
WORKDIR /app
# PGLITE_DIR — только для пробного запуска без DATABASE_URL: встроенная база во временной папке, данные не сохраняются
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    PGLITE_DIR=/tmp/pglite
COPY --from=build --chown=node:node /app/package.json /app/next.config.ts ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
# Шрифты для рекламных картинок читаются с диска
COPY --from=build --chown=node:node /app/assets ./assets
USER node
EXPOSE 8080
CMD ["sh", "-c", "exec node node_modules/next/dist/bin/next start -p \"${PORT:-8080}\" -H 0.0.0.0"]

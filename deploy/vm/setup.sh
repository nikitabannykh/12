#!/usr/bin/env bash
# Установка «Самохода» на ВМ Yandex Cloud (Ubuntu 24.04). Повторный запуск безопасен.
# Что делает: Docker + Caddy (HTTPS), PostgreSQL на этой же ВМ, секреты из Lockbox → /etc/polny-zal.env, сборка и запуск контейнера,
# перенос базы с Neon при первом запуске (если в Lockbox есть NEON_DATABASE_URL), таймеры: обновление из GitHub,
# робот по расписанию, догрузка новых заявок со старой базы после переезда, бэкап базы в Object Storage раз в сутки.
set -euo pipefail
ROOT=/opt/polny-zal
APP=$ROOT/app
VM=$APP/deploy/vm

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q docker.io caddy git curl jq
systemctl enable --now docker

# Подкачка 2 ГБ: сборка Next.js рядом с базой на ВМ с 4 ГБ памяти
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# База PostgreSQL 17 на этой же ВМ (в Docker, данные — в $ROOT/pgdata). Пароль генерируется здесь и хранится только на ВМ
docker network inspect pz >/dev/null 2>&1 || docker network create pz
if [ ! -f $ROOT/db.env ]; then
  ( umask 077; echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > $ROOT/db.env )
fi
if ! docker ps -a -q -f name=^polny-zal-db$ | grep -q .; then
  docker run -d --name polny-zal-db --restart unless-stopped --network pz \
    --env-file $ROOT/db.env -e POSTGRES_USER=polnyzal -e POSTGRES_DB=polnyzal \
    -v $ROOT/pgdata:/var/lib/postgresql/data --shm-size 256m \
    mirror.gcr.io/library/postgres:17 -c shared_buffers=256MB -c max_connections=50 >/dev/null
fi
for i in $(seq 1 30); do docker exec polny-zal-db pg_isready -U polnyzal >/dev/null 2>&1 && break; sleep 2; done

bash $VM/secrets.sh

# HTTPS: адрес вида 51-250-1-2.sslip.io (без своего домена) или DOMAIN из Lockbox; сертификат Let's Encrypt Caddy выпустит сам
HOST=$(grep -E '^APP_URL=' /etc/polny-zal.env | cut -d= -f2- | sed -E 's#^https?://##; s#/.*$##')
cat > /etc/caddy/Caddyfile <<CADDY
$HOST {
  encode gzip
  header X-Served-By yc-vm
  reverse_proxy 127.0.0.1:8080 {
    header_up X-Real-IP {remote_host}
  }
}
CADDY
systemctl enable caddy
systemctl restart caddy

for u in polny-zal-deploy polny-zal-cron polny-zal-delta polny-zal-backup; do
  install -m 644 $VM/systemd/$u.service /etc/systemd/system/$u.service
  install -m 644 $VM/systemd/$u.timer /etc/systemd/system/$u.timer
done
systemctl daemon-reload

# Первый запуск: сборка, перенос базы, старт. Дальше — по таймерам
bash $VM/deploy.sh
systemctl enable --now polny-zal-deploy.timer polny-zal-cron.timer polny-zal-delta.timer polny-zal-backup.timer
echo "setup done: https://$HOST"

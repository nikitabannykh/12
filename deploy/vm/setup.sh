#!/usr/bin/env bash
# Установка «Самохода» на ВМ Yandex Cloud (Ubuntu 24.04). Повторный запуск безопасен.
# Что делает: Docker + Caddy (HTTPS), секреты из Lockbox → /etc/polny-zal.env, сборка и запуск контейнера,
# перенос базы с Neon при первом запуске (если в Lockbox есть NEON_DATABASE_URL), таймеры: обновление из GitHub,
# робот по расписанию, догрузка новых заявок со старой базы после переезда.
set -euo pipefail
ROOT=/opt/polny-zal
APP=$ROOT/app
VM=$APP/deploy/vm

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q docker.io caddy git curl jq
systemctl enable --now docker

curl -fsSL https://storage.yandexcloud.net/cloud-certs/CA.pem -o $ROOT/yandex-ca.pem

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

for u in polny-zal-deploy polny-zal-cron polny-zal-delta; do
  install -m 644 $VM/systemd/$u.service /etc/systemd/system/$u.service
  install -m 644 $VM/systemd/$u.timer /etc/systemd/system/$u.timer
done
systemctl daemon-reload

# Первый запуск: сборка, перенос базы, старт. Дальше — по таймерам
bash $VM/deploy.sh
systemctl enable --now polny-zal-deploy.timer polny-zal-cron.timer polny-zal-delta.timer
echo "setup done: https://$HOST"

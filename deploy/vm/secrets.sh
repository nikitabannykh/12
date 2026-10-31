#!/usr/bin/env bash
# Секреты из Lockbox → /etc/polny-zal.env (только root). ID секрета — в метаданных ВМ (lockbox-secret-id);
# токен — сервисного аккаунта ВМ через сервис метаданных (роль lockbox.payloadViewer).
set -euo pipefail
MD=http://169.254.169.254/computeMetadata/v1/instance
H='Metadata-Flavor: Google'
SID=$(curl -fsS -H "$H" $MD/attributes/lockbox-secret-id 2>/dev/null || true)
TMP=$(mktemp)
chmod 600 "$TMP"
if [ -n "$SID" ]; then
  TOKEN=$(curl -fsS -H "$H" $MD/service-accounts/default/token | jq -r .access_token)
  curl -fsS -H "Authorization: Bearer $TOKEN" "https://payload.lockbox.api.cloud.yandex.net/lockbox/v1/secrets/$SID/payload" \
    | jq -r '.entries[] | "\(.key)=\(.textValue // "" | gsub("\n"; "\\n"))"' > "$TMP"
fi
# Несекретные настройки (ClientID приложений, каталог) — в метаданных ВМ, ключ app-env: строки KEY=VALUE
curl -fsS -H "$H" $MD/attributes/app-env 2>/dev/null | grep -E '^[A-Z_][A-Z0-9_]*=' | while IFS= read -r line; do
  grep -q "^${line%%=*}=" "$TMP" || echo "$line" >> "$TMP"
done
# APP_SECRET и CRON_SECRET, если их нет в Lockbox, генерируются здесь один раз и с ВМ не уходят
LOCAL=/opt/polny-zal/local.env
if [ ! -f $LOCAL ]; then ( umask 077; { echo "APP_SECRET=$(openssl rand -hex 32)"; echo "CRON_SECRET=$(openssl rand -hex 24)"; } > $LOCAL ); fi
while IFS= read -r line; do grep -q "^${line%%=*}=" "$TMP" || echo "$line" >> "$TMP"; done < $LOCAL
# YandexGPT/ART/Wordstat без API-ключа — IAM-токеном сервисного аккаунта ВМ
grep -q '^YANDEX_CLOUD_API_KEY=' "$TMP" || echo "YANDEX_CLOUD_METADATA_IAM=1" >> "$TMP"
# Адрес сервиса: свой (APP_URL в Lockbox) или технический по публичному IP — https://51-250-1-2.sslip.io
if ! grep -q '^APP_URL=' "$TMP"; then
  IP=$(curl -fsS -H "$H" $MD/network-interfaces/0/access-configs/0/external-ip)
  echo "APP_URL=https://${IP//./-}.sslip.io" >> "$TMP"
fi
grep -q '^LEGACY_ORIGINS=' "$TMP" || echo "LEGACY_ORIGINS=https://polny-zal.vercel.app" >> "$TMP"
grep -q '^TRUSTED_IP_HEADER=' "$TMP" || echo "TRUSTED_IP_HEADER=x-real-ip" >> "$TMP"
# База на этой же ВМ (если DATABASE_URL не задан в Lockbox)
if ! grep -q '^DATABASE_URL=' "$TMP"; then
  PW=$(grep '^POSTGRES_PASSWORD=' /opt/polny-zal/db.env | cut -d= -f2-)
  echo "DATABASE_URL=postgresql://polnyzal:$PW@polny-zal-db:5432/polnyzal" >> "$TMP"
else
  echo "PG_CA_CERT=/ca.pem" >> "$TMP"
fi
install -m 600 "$TMP" /etc/polny-zal.env
rm -f "$TMP"

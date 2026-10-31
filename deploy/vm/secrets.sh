#!/usr/bin/env bash
# Секреты из Lockbox → /etc/polny-zal.env (только root). ID секрета — в метаданных ВМ (lockbox-secret-id);
# токен — сервисного аккаунта ВМ через сервис метаданных (роль lockbox.payloadViewer).
set -euo pipefail
MD=http://169.254.169.254/computeMetadata/v1/instance
H='Metadata-Flavor: Google'
SID=$(curl -fsS -H "$H" $MD/attributes/lockbox-secret-id)
TOKEN=$(curl -fsS -H "$H" $MD/service-accounts/default/token | jq -r .access_token)
TMP=$(mktemp)
chmod 600 "$TMP"
curl -fsS -H "Authorization: Bearer $TOKEN" "https://payload.lockbox.api.cloud.yandex.net/lockbox/v1/secrets/$SID/payload" \
  | jq -r '.entries[] | "\(.key)=\(.textValue // "" | gsub("\n"; "\\n"))"' > "$TMP"
# Адрес сервиса: свой (APP_URL в Lockbox) или технический по публичному IP — https://51-250-1-2.sslip.io
if ! grep -q '^APP_URL=' "$TMP"; then
  IP=$(curl -fsS -H "$H" $MD/network-interfaces/0/access-configs/0/external-ip)
  echo "APP_URL=https://${IP//./-}.sslip.io" >> "$TMP"
fi
grep -q '^LEGACY_ORIGINS=' "$TMP" || echo "LEGACY_ORIGINS=https://polny-zal.vercel.app" >> "$TMP"
grep -q '^TRUSTED_IP_HEADER=' "$TMP" || echo "TRUSTED_IP_HEADER=x-real-ip" >> "$TMP"
echo "PG_CA_CERT=/ca.pem" >> "$TMP"
install -m 600 "$TMP" /etc/polny-zal.env
rm -f "$TMP"

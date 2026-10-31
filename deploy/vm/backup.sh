#!/usr/bin/env bash
# Бэкап базы раз в сутки: pg_dump → gzip → Object Storage (бакет — в метаданных ВМ, ключ backup-bucket).
# Авторизация — IAM-токен сервисного аккаунта ВМ (роль storage.uploader). Хранение — правилом жизненного цикла бакета.
# Последние 3 копии лежат и на диске ВМ: /opt/polny-zal/backups.
set -euo pipefail
ROOT=/opt/polny-zal
MD=http://169.254.169.254/computeMetadata/v1/instance
H='Metadata-Flavor: Google'
mkdir -p $ROOT/backups
chmod 700 $ROOT/backups
F=$ROOT/backups/polnyzal-$(date -u +%Y%m%d-%H%M).sql.gz
docker exec polny-zal-db pg_dump -U polnyzal --no-owner polnyzal | gzip -6 > "$F"
chmod 600 "$F"
ls -1t $ROOT/backups/*.sql.gz | tail -n +4 | xargs -r rm -f
BUCKET=$(curl -fsS -H "$H" $MD/attributes/backup-bucket 2>/dev/null || true)
if [ -z "$BUCKET" ]; then echo "backup: $F (бакет не задан — только на диске)"; exit 0; fi
TOKEN=$(curl -fsS -H "$H" $MD/service-accounts/default/token | jq -r .access_token)
curl -fsS -X PUT -H "X-YaCloud-SubjectToken: $TOKEN" -H "Content-Type: application/gzip" \
  --data-binary @"$F" "https://storage.yandexcloud.net/$BUCKET/db/$(basename "$F")" >/dev/null
echo "backup: $(basename "$F") → $BUCKET ($(du -h "$F" | cut -f1))"

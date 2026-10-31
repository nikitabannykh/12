#!/usr/bin/env bash
# Робот по расписанию. Пока старый адрес (LEGACY_ORIGINS) не переключён на эту ВМ, робот здесь не запускаем:
# иначе два сервиса одновременно управляли бы одними и теми же кампаниями.
set -euo pipefail
set -a; . /etc/polny-zal.env; set +a
OLD=$(echo "${LEGACY_ORIGINS:-}" | cut -d, -f1)
if [ -n "$OLD" ] && ! curl -fsSI --max-time 20 "$OLD/api/health" | grep -qi '^x-served-by: yc-vm'; then
  echo "cron: $OLD ещё работает сам — робот запускается там"; exit 0
fi
curl -fsS --max-time 290 -o /dev/null -w 'cron: HTTP %{http_code}\n' -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:8080/api/cron/run

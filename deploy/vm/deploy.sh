#!/usr/bin/env bash
# Обновление из GitHub (ветка master): собрали образ → при первом запуске перенесли базу → перезапустили контейнер.
# Сборка не удалась — продолжает работать прежняя версия. Запускается таймером раз в 5 минут.
set -euo pipefail
ROOT=/opt/polny-zal
APP=$ROOT/app
exec 9>$ROOT/deploy.lock
flock -n 9 || exit 0
cd $APP
git fetch -q origin master
NEW=$(git rev-parse origin/master)
CUR=$(cat $ROOT/deployed 2>/dev/null || true)
RUNNING=$(docker ps -q -f name=^polny-zal$)
# Секреты перечитываем каждый раз: добавили ключ в Lockbox — через 5 минут он уже в работе
OLDENV=$(sha256sum /etc/polny-zal.env 2>/dev/null | cut -c1-64 || true)
bash $APP/deploy/vm/secrets.sh
NEWENV=$(sha256sum /etc/polny-zal.env | cut -c1-64)
PENDING_MIGRATION=0
[ ! -f $ROOT/migrated ] && grep -q '^NEON_DATABASE_URL=' /etc/polny-zal.env && PENDING_MIGRATION=1
if [ "$NEW" = "$CUR" ] && [ -n "$RUNNING" ] && [ "$OLDENV" = "$NEWENV" ] && [ $PENDING_MIGRATION = 0 ]; then exit 0; fi
git reset -q --hard "$NEW"
# Обновились описания таймеров и служб — ставим новые
for f in $APP/deploy/vm/systemd/*; do
  cmp -s "$f" /etc/systemd/system/$(basename "$f") || { install -m 644 "$f" /etc/systemd/system/; RELOAD=1; }
done
[ "${RELOAD:-0}" = 1 ] && systemctl daemon-reload
if ! docker image inspect polny-zal:"$NEW" >/dev/null 2>&1; then
echo "build $NEW"
docker build -q --build-arg NODE_IMAGE=mirror.gcr.io/library/node:22-bookworm-slim -t polny-zal:"$NEW" . >/dev/null
fi
# Перенос базы (один раз, как только в Lockbox появится NEON_DATABASE_URL): приложение на время останавливаем
if [ ! -f $ROOT/migrated ] && grep -q '^NEON_DATABASE_URL=' /etc/polny-zal.env; then
  docker rm -f polny-zal >/dev/null 2>&1 || true
  bash $APP/deploy/vm/migrate.sh
fi
docker rm -f polny-zal >/dev/null 2>&1 || true
docker run -d --name polny-zal --restart unless-stopped --network pz -p 127.0.0.1:8080:8080 \
  --env-file /etc/polny-zal.env -e APP_VERSION="$NEW" --log-opt max-size=20m --log-opt max-file=5 \
  polny-zal:"$NEW" >/dev/null
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/api/health || true)
  [ "$code" = "200" ] && break
  sleep 2
done
echo "$NEW" > $ROOT/deployed
echo "deployed $NEW (health $code)"
docker image prune -af --filter "until=72h" >/dev/null 2>&1 || true

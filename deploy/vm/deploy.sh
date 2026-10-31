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
if [ "$NEW" = "$CUR" ] && [ -n "$RUNNING" ]; then exit 0; fi
git reset -q --hard "$NEW"
bash $APP/deploy/vm/secrets.sh
echo "build $NEW"
docker build -q --build-arg NODE_IMAGE=mirror.gcr.io/library/node:22-bookworm-slim -t polny-zal:"$NEW" . >/dev/null
[ -f $ROOT/migrated ] || bash $APP/deploy/vm/migrate.sh
docker rm -f polny-zal >/dev/null 2>&1 || true
docker run -d --name polny-zal --restart unless-stopped -p 127.0.0.1:8080:8080 \
  --env-file /etc/polny-zal.env -e APP_VERSION="$NEW" -v $ROOT/yandex-ca.pem:/ca.pem:ro --log-opt max-size=20m --log-opt max-file=5 \
  polny-zal:"$NEW" >/dev/null
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/api/health || true)
  [ "$code" = "200" ] && break
  sleep 2
done
echo "$NEW" > $ROOT/deployed
echo "deployed $NEW (health $code)"
docker image prune -af --filter "until=72h" >/dev/null 2>&1 || true

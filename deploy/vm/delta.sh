#!/usr/bin/env bash
# Пока старый адрес ещё может принимать заявки (до и сразу после переезда), догружаем новые заявки с Neon.
# Только добавление (on conflict do nothing) — ничего не перезаписываем. Через 3 суток после переноса выключается сам.
set -euo pipefail
ROOT=/opt/polny-zal
[ -f $ROOT/migrated ] || exit 0
set -a; . /etc/polny-zal.env; set +a
[ -n "${NEON_DATABASE_URL:-}" ] || exit 0
since=$(stat -c %Y $ROOT/migrated)
if [ $(( $(date +%s) - since )) -gt $((3 * 86400)) ]; then systemctl disable --now polny-zal-delta.timer; exit 0; fi
docker run --rm -e PGSSLROOTCERT=/ca.pem -v $ROOT/yandex-ca.pem:/ca.pem:ro -e SRC="$NEON_DATABASE_URL" -e DST="$DATABASE_URL" \
  mirror.gcr.io/library/postgres:17 sh -c '
  psql -q "$SRC" -c "\copy (select * from leads where created_at > now() - interval '"'"'3 days'"'"') to /tmp/l.csv csv" &&
  psql -q -v ON_ERROR_STOP=1 "$DST" -c "create temp table t (like leads including defaults)" -c "\copy t from /tmp/l.csv csv" \
    -c "insert into leads select * from t on conflict do nothing"'

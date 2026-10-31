#!/usr/bin/env bash
# Однократный перенос базы с Neon в Managed PostgreSQL. Источник — NEON_DATABASE_URL в Lockbox (нет — пропускаем).
# Переносим только в пустую базу: если таблицы уже есть, ничего не трогаем.
set -euo pipefail
ROOT=/opt/polny-zal
set -a; . /etc/polny-zal.env; set +a
# Прошлый перенос не сошёлся — дальше вслепую не идём (нужно разобраться вручную и удалить файл migrate-failed)
if [ -f $ROOT/migrate-failed ]; then echo "migrate: прошлый перенос не удался — см. $ROOT/migrate-failed"; exit 1; fi
trap 'rc=$?; [ $rc -ne 0 ] && date -Is > $ROOT/migrate-failed; exit $rc' EXIT
if [ -z "${NEON_DATABASE_URL:-}" ]; then echo "migrate: NEON_DATABASE_URL нет — начинаем с пустой базы"; touch $ROOT/migrated; exit 0; fi
PG="docker run --rm --network pz -e SRC=$NEON_DATABASE_URL -e DST=$DATABASE_URL mirror.gcr.io/library/postgres:17"
n=$($PG sh -c 'psql "$DST" -tAc "select count(*) from information_schema.tables where table_schema = '"'"'public'"'"'"')
if [ "$n" != "0" ]; then echo "migrate: в новой базе уже $n таблиц — перенос пропускаем"; touch $ROOT/migrated; exit 0; fi
echo "migrate: копируем базу"
# Ошибки вида «schema public already exists» безвредны, поэтому без --exit-on-error; проверяем результат по числу заявок
$PG sh -c 'pg_dump --no-owner --no-acl -Fc "$SRC" -f /tmp/db.dump && pg_restore --no-owner --no-acl -d "$DST" /tmp/db.dump; \
  a=$(psql "$SRC" -tAc "select count(*) from businesses"); b=$(psql "$DST" -tAc "select count(*) from businesses"); \
  echo "migrate: проектов в старой базе $a, в новой $b"; [ "$a" = "$b" ]'
date -Is > $ROOT/migrated
echo "migrate: готово"

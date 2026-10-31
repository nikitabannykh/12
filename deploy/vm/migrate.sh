#!/usr/bin/env bash
# Однократный перенос базы с Neon в Managed PostgreSQL. Источник — NEON_DATABASE_URL в Lockbox (нет — пропускаем).
# Переносим только в пустую базу: если таблицы уже есть, ничего не трогаем.
set -euo pipefail
ROOT=/opt/polny-zal
set -a; . /etc/polny-zal.env; set +a
# С этой же строкой старой базы перенос уже не удался — не повторяем каждые 5 минут; поменяют строку в Lockbox — попробуем снова
SIG=$(printf '%s' "${NEON_DATABASE_URL:-}" | sha256sum | cut -c1-16)
if [ -f $ROOT/migrate-failed ] && [ "$(cat $ROOT/migrate-failed)" = "$SIG" ]; then echo "migrate: с этой строкой NEON_DATABASE_URL перенос уже не удался — проверьте её в Lockbox"; exit 1; fi
trap 'rc=$?; [ $rc -ne 0 ] && echo "$SIG" > $ROOT/migrate-failed; exit $rc' EXIT
# Строки старой базы ещё нет в Lockbox — сервис работает на пустой базе, перенос выполнится, когда её добавят
if [ -z "${NEON_DATABASE_URL:-}" ]; then echo "migrate: NEON_DATABASE_URL нет — переносить пока нечего"; exit 0; fi
PG="docker run --rm --network pz -e SRC=$NEON_DATABASE_URL -e DST=$DATABASE_URL mirror.gcr.io/library/postgres:17"
# Переносим, только если в новой базе ещё нет ни одного проекта (пустые таблицы, созданные самим сервисом, — не в счёт)
has=$($PG sh -c 'psql "$DST" -tAc "select to_regclass('"'"'public.businesses'"'"') is not null"')
n=0
if [ "$has" = "t" ]; then n=$($PG sh -c 'psql "$DST" -tAc "select count(*) from businesses"'); fi
if [ "$n" != "0" ]; then echo "migrate: в новой базе уже $n проектов — перенос пропускаем"; touch $ROOT/migrated; exit 0; fi
$PG sh -c 'psql -q "$DST" -c "drop schema public cascade" -c "create schema public"' 
echo "migrate: копируем базу"
# Ошибки вида «schema public already exists» безвредны, поэтому без --exit-on-error; проверяем результат по числу заявок
$PG sh -c 'pg_dump --no-owner --no-acl -Fc "$SRC" -f /tmp/db.dump && pg_restore --no-owner --no-acl -d "$DST" /tmp/db.dump; \
  a=$(psql "$SRC" -tAc "select count(*) from businesses"); b=$(psql "$DST" -tAc "select count(*) from businesses"); \
  echo "migrate: проектов в старой базе $a, в новой $b"; [ -n "$a" ] && [ "$a" = "$b" ]'
date -Is > $ROOT/migrated
echo "migrate: готово"

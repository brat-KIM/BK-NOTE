#!/usr/bin/env bash
# 로컬 Postgres 16 임시 클러스터를 띄워 supabase/migrations 를 적용하고 DB 계약 테스트를 돌린다.
# (클라우드 작업 환경에서는 *.supabase.co 에 접속할 수 없어서 이렇게 검증한다)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORT="${PGPORT_TEST:-54329}"
DIR="$(mktemp -d /tmp/bknote-pg-XXXX)"
chmod 777 "$DIR"

run_pg() { if [ "$(id -u)" = "0" ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }

cleanup() { run_pg "$PGBIN/pg_ctl -D $DIR/data -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT

run_pg "$PGBIN/initdb -D $DIR/data -U postgres -A trust --locale=C.UTF-8 -E UTF8" >/dev/null
run_pg "$PGBIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR -c listen_addresses=127.0.0.1 -c timezone=UTC' -l $DIR/log -w start" >/dev/null

PSQL="$PGBIN/psql -h 127.0.0.1 -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -c "create database bknote" postgres
$PSQL -f "$ROOT/supabase/test/supabase_stub.sql" bknote
for f in "$ROOT"/supabase/migrations/*.sql; do
  case "$f" in *_cron.sql) echo "skip (pg_cron 없음): $(basename "$f")"; continue;; esac
  $PSQL -f "$f" bknote
done
echo "migrations OK"

export BKNOTE_PG_URL="postgres://postgres@127.0.0.1:$PORT/bknote"
cd "$ROOT/packages/core"
npx vitest run test/pg.contract.test.ts "$@"

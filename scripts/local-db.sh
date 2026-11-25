#!/usr/bin/env bash
# Khởi động PostgreSQL cục bộ tạm thời để chạy test SQL (không cần Docker/Supabase).
# Dùng: scripts/local-db.sh start|stop|reset   -> in ra DATABASE_URL
set -euo pipefail
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DATA="${PGDATA_DIR:-$PWD/.localdb}"
PORT="${PGPORT_LOCAL:-54329}"
AS=""
if [ "$(id -u)" = "0" ]; then   # initdb không chạy bằng root
  AS="runuser -u postgres --"; DATA="${PGDATA_DIR:-/tmp/hoanhao-localdb}"
fi
case "${1:-start}" in
  start)
    if [ ! -d "$DATA" ]; then mkdir -p "$DATA"; [ -n "$AS" ] && chown postgres "$DATA"; $AS "$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust -E UTF8 >/dev/null; fi
    $AS "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp -c timezone=UTC" -l "$DATA/log" status >/dev/null 2>&1 || \
      $AS "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp -c timezone=UTC" -l "$DATA/log" -w start >/dev/null
    echo "postgresql://postgres@127.0.0.1:$PORT/postgres";;
  stop) $AS "$PGBIN/pg_ctl" -D "$DATA" stop -m fast;;
  reset) $AS "$PGBIN/pg_ctl" -D "$DATA" stop -m fast 2>/dev/null || true; rm -rf "$DATA"; "$0" start;;
esac

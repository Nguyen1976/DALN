#!/usr/bin/env bash
# Chạy CLI migration dữ liệu (libs/migrations) — dùng chung cho prod và dev:
#   prod: image daln/db-push (target schema) -> /usr/local/bin/migrate.sh
#   dev : bash docker/migrate.sh <lệnh>   (source bind-mount ở /app)
#
#   migrate.sh up                        chạy migration đang chờ; lỗi -> exit 1
#   migrate.sh status [--pending-count]  trạng thái; có cờ thì chỉ in 1 số nguyên
#   migrate.sh background                backfill dài, chạy tiếp được từ chỗ dừng
#
# Phải chạy từ thư mục gốc backend (WORKDIR /app): ts-node và tsconfig-paths đọc
# tsconfig.json ở thư mục hiện tại.
# Biến: MONGO_HOST (mặc định mongo:27017), MONGO_REPLICA_SET (mặc định rs0).
set -euo pipefail

CLI="libs/migrations/src/cli.ts"
if [ ! -f "${CLI}" ]; then
  echo "[migrate] Không thấy ${CLI} trong $(pwd) — phải chạy từ thư mục gốc backend" >&2
  exit 1
fi

# node + ts-node trực tiếp, không qua npx: không in "npm notice" / gọi registry mỗi
# lần chạy, và SIGTERM (tini khi dừng migrate-background) tới thẳng tiến trình
# migration để nó xong lô đang chạy, ghi checkpoint, nhả lock.
exec node node_modules/ts-node/dist/bin.js --transpile-only -r tsconfig-paths/register "${CLI}" "$@"

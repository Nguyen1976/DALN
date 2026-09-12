#!/usr/bin/env bash
# Đồng bộ collection + index (đặc biệt là UNIQUE) cho mọi service trước khi app chạy.
#
# Idempotency của saga dựa vào unique index (bắt P2002): thiếu index thì message
# trùng bị xử lý hai lần mà không ai hay. Vì vậy bước này lỗi là deploy dừng luôn,
# và cố ý KHÔNG dùng --accept-data-loss.
#
# Năm DB độc lập nhau nên chạy song song: chạy lần lượt mất ~14s ở MỌI lần deploy,
# và compose chờ bước này xong mới đi tiếp.
set -euo pipefail

MONGO_HOST="${MONGO_HOST:-mongo:27017}"

push() {
  local service="$1" db="$2"
  DATABASE_URL="mongodb://${MONGO_HOST}/${db}?replicaSet=rs0" \
    npx prisma db push --skip-generate --schema="apps/${service}/prisma/schema.prisma" 2>&1 |
    while IFS= read -r line || [ -n "${line}" ]; do echo "[db-push ${service}] ${line}"; done
}

pids=()
push user user-service & pids+=($!)
push chat chat-service & pids+=($!)
push notification notification-service & pids+=($!)
push recommendation recommendation-service & pids+=($!)
push saga-orchestrator saga-orchestrator-service & pids+=($!)

failed=0
for pid in "${pids[@]}"; do
  wait "${pid}" || failed=1
done
if [ "${failed}" -ne 0 ]; then
  echo "[db-push] LỖI: có schema không đồng bộ được (xem log phía trên)" >&2
  exit 1
fi
echo "[db-push] Xong"

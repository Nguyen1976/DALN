#!/usr/bin/env bash
# Đồng bộ collection + index (đặc biệt là UNIQUE) cho mọi service trước khi app chạy.
#
# Idempotency của saga dựa vào unique index (bắt P2002): thiếu index thì message
# trùng bị xử lý hai lần mà không ai hay. Vì vậy bước này lỗi là deploy dừng luôn,
# và cố ý KHÔNG dùng --accept-data-loss.
set -euo pipefail

MONGO_HOST="${MONGO_HOST:-mongo:27017}"

push() {
  local service="$1" db="$2"
  echo "[db-push] ${service} -> ${db}"
  DATABASE_URL="mongodb://${MONGO_HOST}/${db}?replicaSet=rs0" \
    npx prisma db push --skip-generate --schema="apps/${service}/prisma/schema.prisma"
}

push user user-service
push chat chat-service
push notification notification-service
push recommendation recommendation-service
push saga-orchestrator saga-orchestrator-service

echo "[db-push] Xong"

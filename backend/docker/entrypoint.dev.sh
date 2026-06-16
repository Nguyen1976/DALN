#!/usr/bin/env bash
# Entrypoint cho môi trường DEV: sinh Prisma client (nếu có) rồi chạy watch mode.
set -e

: "${SERVICE:?Thiếu biến môi trường SERVICE (user|chat|notification|realtime-gateway|recommendation)}"

SCHEMA="apps/${SERVICE}/prisma/schema.prisma"
if [ -f "${SCHEMA}" ]; then
  echo "[entrypoint] Generating Prisma client cho ${SERVICE}..."
  npx prisma generate --schema="${SCHEMA}"
fi

if [ "${SERVICE}" = "recommendation" ] && [ -f "apps/recommendation/prisma/seed.ts" ]; then
  echo "[entrypoint] Seeding interest tags (idempotent)..."
  npx ts-node apps/recommendation/prisma/seed.ts
fi

echo "[entrypoint] Khởi động ${SERVICE} ở chế độ watch (hot-reload)..."
exec npx nest start "${SERVICE}" --watch --preserveWatchOutput

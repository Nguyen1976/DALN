#!/usr/bin/env bash
# Entrypoint cho môi trường PRODUCTION: chạy bản build sẵn trong dist.
set -e

: "${SERVICE:?Thiếu biến môi trường SERVICE (user|chat|notification|realtime-gateway|recommendation|saga-orchestrator)}"

echo "[entrypoint] Khởi động ${SERVICE} (production)..."
exec node "dist/apps/${SERVICE}/main.js"

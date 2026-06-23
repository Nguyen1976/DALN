#!/usr/bin/env bash
# Loại bỏ node_modules không cần cho từng microservice (sau npm prune --omit=dev).
set -euo pipefail

SERVICE="${1:?Thiếu SERVICE (user|chat|notification|realtime-gateway|recommendation|saga-orchestrator)}"

rm_rf() {
  for path in "$@"; do
    rm -rf "node_modules/${path}"
  done
}

echo "[prune-prod-deps] SERVICE=${SERVICE}"

# Prisma CLI + runtime @prisma/* — client đã bundle trong webpack dist; engine .node nằm trong dist.
rm_rf prisma effect typescript
rm -rf node_modules/@prisma node_modules/.prisma

# ML / embedding — chỉ recommendation
if [ "${SERVICE}" != "recommendation" ]; then
  rm_rf onnxruntime-node onnxruntime-web ml-cart sharp
  rm -rf node_modules/@huggingface node_modules/@img
  find node_modules -maxdepth 3 -type d -name 'onnxruntime-common' -prune -exec rm -rf {} + 2>/dev/null || true
fi

# Vector DB — chỉ recommendation
if [ "${SERVICE}" != "recommendation" ]; then
  rm_rf @qdrant/js-client-rest
fi

# Neo4j — không có service prod nào import @app/neo4j
rm_rf neo4j-driver

# R2 / S3 — user + chat
if [ "${SERVICE}" != "user" ] && [ "${SERVICE}" != "chat" ]; then
  rm -rf node_modules/@aws-sdk node_modules/@smithy
fi

# BullMQ — chỉ chat
if [ "${SERVICE}" != "chat" ]; then
  rm_rf bullmq @nestjs/bullmq
fi

# Email — chỉ notification
if [ "${SERVICE}" != "notification" ]; then
  rm_rf @nestjs-modules/mailer nodemailer
fi

echo "[prune-prod-deps] xong"

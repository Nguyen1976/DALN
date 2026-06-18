#!/usr/bin/env bash
# Webpack bundle Prisma resolve engine tại process.cwd()/apps/<SERVICE>/src/generated/.
# Symlink tới engine đã có trong dist (tránh COPY trùng ~50MB).
set -euo pipefail

SERVICE="${1:?Thiếu SERVICE}"

GENERATED_IN_DIST="dist/apps/${SERVICE}/apps/${SERVICE}/src/generated"
LINK_PATH="apps/${SERVICE}/src/generated"

if [ ! -d "${GENERATED_IN_DIST}" ]; then
  echo "[link-prisma] ${SERVICE} không có Prisma generated — bỏ qua"
  exit 0
fi

mkdir -p "apps/${SERVICE}/src"
rm -rf "${LINK_PATH}"
ln -s "/app/${GENERATED_IN_DIST}" "${LINK_PATH}"
echo "[link-prisma] ${LINK_PATH} -> /app/${GENERATED_IN_DIST}"

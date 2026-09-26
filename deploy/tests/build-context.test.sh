#!/usr/bin/env bash
# Hồi quy: sửa lib mà service KHÔNG dùng (hoặc chỉ sửa file test) thì bước build
# nặng của service đó phải ăn cache.
#
#   bash deploy/tests/build-context.test.sh     # vài phút, Docker local
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}/backend"
pass=0
fail=0
is() {
  if [ "$1" = "$2" ]; then echo "  ✅ $3 ($1)"; pass=$((pass + 1)); else echo "  ❌ $3 — mong $2, nhận $1"; fail=$((fail + 1)); fi
}
WORK="$(mktemp -d)"
UNUSED=libs/storage-s3/src/s3-storage.constants.ts
SPEC=libs/common/src/http/http-exception.filter.spec.ts
cp "${UNUSED}" "${WORK}/unused.bak"
cp "${SPEC}" "${WORK}/spec.bak"
cleanup() {
  cp "${WORK}/unused.bak" "${UNUSED}"
  cp "${WORK}/spec.bak" "${SPEC}"
  rm -rf "${WORK}"
}
trap cleanup EXIT

build() { docker buildx build --target build --build-arg SERVICE=saga-orchestrator --progress=plain . 2>&1; }
# "npm run build" có CACHED không (buildkit in "#N CACHED" ngay sau dòng của bước).
build_step_cached() { grep -A1 -E 'RUN npm run build' | grep -q CACHED && echo yes || echo no; }

echo "== chuẩn bị cache"
build >/dev/null || echo "  (build đầu lỗi)"

echo "== sửa lib saga-orchestrator không dùng (storage-s3)"
printf '\n// build-context test\n' >>"${UNUSED}"
is "$(build | build_step_cached)" yes "saga-orchestrator không build lại"

echo "== chỉ sửa một file test trong lib nó CÓ dùng (common) — .dockerignore lo"
cp "${WORK}/unused.bak" "${UNUSED}"
printf '\n// build-context test\n' >>"${SPEC}"
is "$(build | build_step_cached)" yes "sửa *.spec.ts không làm build lại"

echo
echo "TỔNG: ${pass} pass / ${fail} fail"
[ "${fail}" -eq 0 ]

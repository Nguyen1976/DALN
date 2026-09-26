#!/usr/bin/env bash
# Hồi quy cho build tái lập (SOURCE_DATE_EPOCH=0 + rewrite-timestamp, như CI).
#
#   bash deploy/tests/build-reproducibility.test.sh      # ~10 phút, Docker local
#
# 1. db-push (target schema): hai lần build KHÔNG cache phải ra cùng nội dung —
#    nếu không, cache GHA bị miss là db-push/migrate bị tạo lại vô cớ.
# 2. web: timestamp cố định làm ETag/Last-Modified của nginx chỉ còn phụ thuộc
#    kích thước file. Hai bản build khác nhau có index.html cùng kích thước ->
#    trình duyệt gửi lại validator của bản cũ phải nhận 200 kèm bản MỚI, không
#    phải 304 (304 = giữ index.html cũ trỏ tới JS đã xoá = trang trắng).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export DALN_IMAGE_PREFIX="daln-reprotest"
# shellcheck source=../lib/image-tags.sh
source "${ROOT}/deploy/lib/image-tags.sh"

pass=0
fail=0
is() {
  if [ "$1" = "$2" ]; then
    echo "  ✅ $3 ($1)"
    pass=$((pass + 1))
  else
    echo "  ❌ $3 — mong $2, nhận $1"
    fail=$((fail + 1))
  fi
}

WORK="$(mktemp -d)"
LOG="${WORK}/build.log"
cleanup() {
  docker rm -f daln-reprotest-a daln-reprotest-b >/dev/null 2>&1
  for ref in $(docker image ls --filter "reference=${DALN_IMAGE_PREFIX}/*" --format '{{.Repository}}:{{.Tag}}'); do
    docker rmi -f "${ref}" >/dev/null 2>&1
  done
  rm -rf "${WORK}"
}
trap cleanup EXIT

# Build như CI rồi nạp vào Docker local. Driver `docker` không cho
# rewrite-timestamp đi cùng unpack, nên xuất tar rồi `docker load`.
build() { # build <ref> <context> [docker build args...]
  local ref="$1" ctx="$2"
  shift 2
  SOURCE_DATE_EPOCH=0 docker buildx build --no-cache "$@" \
    --output "type=docker,name=${ref},dest=${WORK}/img.tar,rewrite-timestamp=true" \
    "${ctx}" >>"${LOG}" 2>&1 &&
    docker load -i "${WORK}/img.tar" >/dev/null
}

echo "== db-push (target schema) tái lập được"
build "${DALN_IMAGE_PREFIX}/db-push:1" "${ROOT}/backend" --target schema || echo "  (build 1 lỗi, xem ${LOG})"
build "${DALN_IMAGE_PREFIX}/db-push:2" "${ROOT}/backend" --target schema || echo "  (build 2 lỗi, xem ${LOG})"
fp1="$(image_fingerprint "${DALN_IMAGE_PREFIX}/db-push:1" || echo "không-inspect-được-1")"
fp2="$(image_fingerprint "${DALN_IMAGE_PREFIX}/db-push:2" || echo "không-inspect-được-2")"
is "${fp2}" "${fp1}" "hai lần build không cache cùng vân tay"

echo "== web: bản mới không bị validator của bản cũ che mất"
mkdir -p "${WORK}/a" "${WORK}/b"
for x in a b; do
  (cd "${ROOT}/frontend" && tar --exclude node_modules --exclude dist -cf - .) | tar -xf - -C "${WORK}/${x}"
done
printf '\nconsole.debug("build-reproducibility-test-b")\n' >>"${WORK}/b/src/main.tsx"
for x in a b; do
  build "${DALN_IMAGE_PREFIX}/web:${x}" "${WORK}/${x}" \
    --build-arg VITE_API_ROOT=https://x/api --build-arg VITE_SOCKET_URL=https://x ||
    echo "  (build web ${x} lỗi, xem ${LOG})"
done
docker run -d --name daln-reprotest-a -p 18181:80 "${DALN_IMAGE_PREFIX}/web:a" >/dev/null
docker run -d --name daln-reprotest-b -p 18182:80 "${DALN_IMAGE_PREFIX}/web:b" >/dev/null
for i in $(seq 1 20); do
  curl -sf -o /dev/null http://localhost:18181/ && curl -sf -o /dev/null http://localhost:18182/ && break
  sleep 1
done

headers_a="$(curl -sI http://localhost:18181/index.html)"
etag="$(printf '%s' "${headers_a}" | tr -d '\r' | awk -F': ' 'tolower($1)=="etag"{print $2}')"
lastmod="$(printf '%s' "${headers_a}" | tr -d '\r' | awk -F': ' 'tolower($1)=="last-modified"{print $2}')"
entry_a="$(curl -s http://localhost:18181/index.html | grep -oE 'assets/index-[^"]+\.js' | head -n 1)"
entry_b="$(curl -s http://localhost:18182/index.html | grep -oE 'assets/index-[^"]+\.js' | head -n 1)"
[ -n "${entry_a}" ] && [ "${entry_a}" != "${entry_b}" ] && same="khác" || same="GIỐNG"
is "${same}" "khác" "hai bản build trỏ tới entry script khác nhau (${entry_a} / ${entry_b})"

code="$(curl -s -o /dev/null -w '%{http_code}' \
  ${etag:+-H "If-None-Match: ${etag}"} ${lastmod:+-H "If-Modified-Since: ${lastmod}"} \
  http://localhost:18182/index.html)"
is "${code}" 200 "validator của bản A gửi tới bản B -> tải bản mới, không 304"

code_asset="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:18182/${entry_a}")"
echo "  (entry của bản A trên bản B trả ${code_asset} — vì vậy 304 ở trên sẽ thành trang trắng)"

echo
echo "TỔNG: ${pass} pass / ${fail} fail"
[ "${fail}" -eq 0 ]

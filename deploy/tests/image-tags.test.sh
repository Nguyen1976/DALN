#!/usr/bin/env bash
# Test cho deploy/lib/image-tags.sh trên Docker THẬT (local, không đụng prod).
#
#   bash deploy/tests/image-tags.test.sh
#
# Dựng vài image FROM scratch tí hon và container "đã tạo, chưa chạy" mang nhãn
# compose của một project test riêng — đúng trạng thái của db-push/migrate trên
# server (Exited). Dọn sạch khi xong, kể cả khi test đỏ.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export DALN_IMAGE_PREFIX="daln-tagtest"
export DALN_COMPOSE_PROJECT="daln-tagtest-$$"
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
cleanup() {
  for id in $(docker ps -aq --filter "label=com.docker.compose.project=${DALN_COMPOSE_PROJECT}"); do
    docker rm -f "${id}" >/dev/null 2>&1
  done
  for ref in $(docker image ls --filter "reference=${DALN_IMAGE_PREFIX}/*" --format '{{.Repository}}:{{.Tag}}'); do
    docker rmi -f "${ref}" >/dev/null 2>&1
  done
  rm -rf "${WORK}"
}
trap cleanup EXIT

# build <ref> <nội dung>: image FROM scratch chứa đúng một file. Cùng nội dung ->
# cùng thư mục -> cùng file (cả mtime) -> layer giống hệt, nhưng --no-cache nên
# với containerd image store .Id vẫn khác: đúng tình huống vân tay phải xử lý.
build() {
  mkdir -p "${WORK}/$2"
  [ -f "${WORK}/$2/f.txt" ] || printf '%s' "$2" >"${WORK}/$2/f.txt"
  printf 'FROM scratch\nCOPY f.txt /f.txt\n' >"${WORK}/$2/Dockerfile"
  docker build -q --no-cache -t "$1" "${WORK}/$2" >/dev/null
}

# make_container <service> <ref>: container chỉ TẠO, không chạy.
make_container() {
  docker create \
    --label "com.docker.compose.project=${DALN_COMPOSE_PROJECT}" \
    --label "com.docker.compose.service=$1" \
    "$2" /f.txt >/dev/null
}

echo "== image_tag_var"
is "$(image_tag_var user)" DALN_TAG_USER "tên đơn"
is "$(image_tag_var db-push)" DALN_TAG_DB_PUSH "gạch ngang -> gạch dưới"
is "$(image_tag_var saga-orchestrator)" DALN_TAG_SAGA_ORCHESTRATOR "tên dài"

echo "== choose_image_tag"
build daln-tagtest/svc:old a
build daln-tagtest/svc:same a
build daln-tagtest/svc:new b
make_container svc daln-tagtest/svc:old
is "$(choose_image_tag svc svc same)" old "nội dung giống hệt -> giữ tag đang chạy"
is "$(choose_image_tag svc svc new)" new "nội dung khác -> tag mới (cũng là ca rollback)"
is "$(choose_image_tag svc svc old)" old "deploy lại đúng tag đang chạy -> giữ nguyên"
is "$(choose_image_tag svc chua-co-container same)" same "chưa có container -> tag mới"
is "$(choose_image_tag svc svc chua-pull)" chua-pull "image mới không inspect được -> tag mới"

build daln-tagtest/other:x a
make_container svc2 daln-tagtest/other:x
is "$(choose_image_tag svc svc2 same)" same "container chạy image của repo khác -> tag mới"

build daln-tagtest/svc3:old a
make_container svc3 daln-tagtest/svc3:old
build daln-tagtest/svc3:same a
docker rmi -f daln-tagtest/svc3:old >/dev/null 2>&1
is "$(choose_image_tag svc3 svc3 same)" same "image đang chạy không inspect được -> tag mới"

echo "== image_switching"
# So đúng MÃ THOÁT: 0 = đổi image, 1 = không. Một phép `if` sẽ coi "hàm không
# tồn tại" (127) giống hệt "không đổi" và cho xanh giả.
switching() {
  image_switching "$@"
  echo $?
}
is "$(switching svc svc old)" 1 "đang chạy đúng tag đó -> không đổi image"
is "$(switching svc svc new)" 0 "tag khác -> đổi image"
is "$(switching svc chua-co-container new)" 0 "chưa có container -> tạo mới"

echo "== retry"
# Lệnh giả: hỏng N lần đầu rồi mới được. Đếm số lần gọi qua file vì retry chạy
# lệnh trong tiến trình con.
flaky() {
  local n
  n=$(($(cat "${WORK}/calls" 2>/dev/null || echo 0) + 1))
  echo "${n}" >"${WORK}/calls"
  [ "${n}" -gt "$1" ]
}
rm -f "${WORK}/calls"
retry 3 0 flaky 2 >/dev/null 2>&1
is "$?/$(cat "${WORK}/calls")" "0/3" "hỏng 2 lần rồi được -> thành công ở lần 3"
rm -f "${WORK}/calls"
retry 3 0 flaky 5 >/dev/null 2>&1
is "$?/$(cat "${WORK}/calls")" "1/3" "hỏng mãi -> dừng sau đúng 3 lần, trả lỗi"
rm -f "${WORK}/calls"
retry 3 0 flaky 0 >/dev/null 2>&1
is "$?/$(cat "${WORK}/calls")" "0/1" "được ngay -> không thử lại"

echo
echo "TỔNG: ${pass} pass / ${fail} fail"
[ "${fail}" -eq 0 ]

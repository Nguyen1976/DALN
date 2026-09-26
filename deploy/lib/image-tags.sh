# shellcheck shell=bash
# ============================================================================
# Chọn tag image cho từng service lúc deploy.
#
# Mọi image mang tag là SHA của commit, nên nếu compose dùng thẳng SHA mới thì
# chuỗi `image:` của MỌI service đổi ở MỌI lần deploy và `up -d` tạo lại hết —
# kể cả service không đổi một byte. Ở đây: image mới nào giống hệt NỘI DUNG
# image mà container đang chạy thì GIỮ tag đang chạy, compose thấy cấu hình y
# nguyên và không đụng tới container đó.
#
# Viết cho cả bash 3.2 (test chạy trên macOS) lẫn bash 5 (server).
# ============================================================================

DALN_COMPOSE_PROJECT="${DALN_COMPOSE_PROJECT:-daln-prod}"

# Biến tag của một image: user -> DALN_TAG_USER, db-push -> DALN_TAG_DB_PUSH.
# Phải khớp với các biến trong backend/docker-compose.prod.yml.
image_tag_var() {
  printf 'DALN_TAG_%s\n' "$(printf '%s' "$1" | tr '[:lower:]-' '[:upper:]_')"
}

# Vân tay NỘI DUNG của image: layer (diffID) + config. Không dùng .Id — với
# containerd image store (server đang dùng), .Id là digest của index và đổi sau
# mỗi lần build dù nội dung y hệt. Không inspect được thì trả mã lỗi.
image_fingerprint() {
  local out
  out="$(docker image inspect -f '{{json .RootFS.Layers}}{{json .Config}}' "$1" 2>/dev/null)" || return 1
  [ -n "${out}" ] || return 1
  printf '%s' "${out}" | sha256sum | cut -c1-16
}

# Tham chiếu image của container thuộc <service>, kể cả container đã dừng —
# db-push và migrate là one-shot nên lúc deploy chúng luôn ở trạng thái Exited.
# Không có container: chuỗi rỗng. Luôn trả 0 (head đóng pipe sớm là bình thường).
running_image_ref() {
  docker ps -a \
    --filter "label=com.docker.compose.project=${DALN_COMPOSE_PROJECT}" \
    --filter "label=com.docker.compose.service=$1" \
    --format '{{.Image}}' 2>/dev/null | head -n 1 || true
}

# In ra tag nên dùng cho <image> (tìm container qua <service>): tag đang chạy nếu
# image <new_tag> giống hệt nội dung, còn lại <new_tag>.
#
# Mọi chỗ không chắc đều nghiêng về bản mới: không có container, container chạy
# image của repo khác, inspect lỗi. Giữ nhầm tag cũ cho một image ĐÃ đổi là lỗi
# duy nhất không được phép xảy ra — tạo lại thừa một container chỉ tốn vài giây.
choose_image_tag() {
  local image="$1" service="$2" new_tag="$3"
  local repo="${DALN_IMAGE_PREFIX}/${image}"
  local running running_tag new_fp running_fp

  running="$(running_image_ref "${service}")"
  case "${running}" in
    "${repo}:"*) running_tag="${running#"${repo}:"}" ;;
    *)
      printf '%s\n' "${new_tag}"
      return 0
      ;;
  esac

  if new_fp="$(image_fingerprint "${repo}:${new_tag}")" &&
    running_fp="$(image_fingerprint "${running}")" &&
    [ "${new_fp}" = "${running_fp}" ]; then
    printf '%s\n' "${running_tag}"
  else
    printf '%s\n' "${new_tag}"
  fi
}

# Container của <service> có phải đổi sang <image>:<tag> không — tức là lần
# deploy này thật sự thay image của nó. Deploy lại đúng tag đang chạy thì không.
image_switching() {
  [ "$(running_image_ref "$2")" != "${DALN_IMAGE_PREFIX}/$1:$3" ]
}

# retry <số lần> <giây chờ gốc> <lệnh...>: chạy lại lệnh khi hỏng, chờ tăng dần
# (gốc × lần thử). Dùng cho pull: layer lớn tải qua mạng hay bị reset giữa chừng,
# còn containerd giữ phần đã tải xong nên lần sau chỉ tải tiếp phần thiếu.
retry() {
  local times="$1" wait="$2" attempt=1
  shift 2
  while :; do
    "$@" && return 0
    [ "${attempt}" -ge "${times}" ] && return 1
    echo "[retry] lỗi lần ${attempt}/${times}: $*" >&2
    sleep $((wait * attempt))
    attempt=$((attempt + 1))
  done
}

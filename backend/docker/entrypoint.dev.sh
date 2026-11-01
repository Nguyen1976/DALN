#!/usr/bin/env bash
# Entrypoint cho môi trường DEV: sinh Prisma client (nếu có) rồi chạy watch mode.
set -e

: "${SERVICE:?Thiếu biến môi trường SERVICE (user|chat|notification|realtime-gateway|recommendation)}"

SCHEMA="apps/${SERVICE}/prisma/schema.prisma"
if [ -f "${SCHEMA}" ]; then
  # Client sinh vào source đang MOUNT CHUNG giữa các container. Sinh lại khi
  # schema không đổi vẫn ghi file, làm mọi instance khác của service (chat-2,
  # chat-3...) hot-reload theo. Chỉ sinh khi hash schema khác lần trước.
  STAMP="apps/${SERVICE}/src/generated/.schema-sha256"
  HASH=$(sha256sum "${SCHEMA}" | cut -d' ' -f1)
  if [ "$(cat "${STAMP}" 2>/dev/null)" != "${HASH}" ]; then
    echo "[entrypoint] Generating Prisma client cho ${SERVICE}..."
    npx prisma generate --schema="${SCHEMA}"
    echo "${HASH}" > "${STAMP}"
  else
    echo "[entrypoint] Prisma client của ${SERVICE} đã khớp schema, bỏ qua generate"
  fi
fi

echo "[entrypoint] Khởi động ${SERVICE} ở chế độ watch (hot-reload)..."

# Không `exec`: nếu PID 1 là npx/nest CLI thì SIGTERM (docker stop) làm nó thoát
# ngay, container sập và process app (node dist/apps/<service>/main) bị SIGKILL
# trước khi kịp chạy hook tắt máy — chat không nhả partition, BatchWriter không
# flush. Ở đây PID 1 là shell này: nhận SIGTERM thì báo cho process app trước,
# chờ nó tắt xong rồi mới dừng CLI.
app_pids() {
  for dir in /proc/[0-9]*; do
    cmd=$(tr '\0' ' ' < "${dir}/cmdline" 2>/dev/null) || continue
    [[ "${cmd}" == *"dist/apps/${SERVICE}/main"* ]] && echo "${dir#/proc/}"
  done
  return 0
}

shutdown() {
  pids=$(app_pids)
  if [ -n "${pids}" ]; then
    echo "[entrypoint] SIGTERM -> app (${pids//$'\n'/ }), chờ tắt êm..."
    kill -TERM ${pids} 2>/dev/null || true
    for _ in $(seq 1 250); do # tối đa 25s, dưới stop_grace_period của compose
      [ -z "$(app_pids)" ] && break
      sleep 0.1
    done
  fi
  kill -TERM "${cli}" 2>/dev/null || true
  wait "${cli}" 2>/dev/null || true
  exit 0
}

# `set -e` chỉ dành cho bước chuẩn bị ở trên: từ đây một lệnh trả mã khác 0
# (wait bị tín hiệu cắt ngang, app_pids không thấy gì) không được giết PID 1.
set +e
npx nest start "${SERVICE}" --watch --preserveWatchOutput &
cli=$!
trap shutdown TERM INT
wait "${cli}"

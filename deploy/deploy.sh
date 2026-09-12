#!/usr/bin/env bash
# ============================================================================
# Build + chạy toàn bộ ứng dụng trên server từ source hiện tại của repo.
#
# Gọi bởi /usr/local/bin/daln-deploy (CI/CD) sau khi đã reset về đúng commit,
# hoặc chạy tay trên server:  bash deploy/deploy.sh
#
# Chỉ phần có thay đổi mới tốn thời gian:
#   - mỗi image build từ đúng file của nó; image không đổi thì ăn cache BuildKit,
#     vài giây là xong;
#   - `up -d` chỉ tạo lại container có image/cấu hình đổi;
#   - Kong chỉ restart khi một service phía sau nó vừa được tạo lại.
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}/backend"

if [ ! -f .env.production ]; then
  echo "[deploy] Thiếu backend/.env.production (danh sách biến: backend/.env.production.example)" >&2
  exit 1
fi

compose() {
  docker compose -f docker-compose.prod.yml --env-file .env.production "$@"
}

# Label của Kong mang hash này (docker-compose.prod.yml): đổi kong.yml thì compose
# tạo lại Kong. Bind mount một file không tự nạp lại khi git thay file đó.
KONG_CONFIG_SHA="$(sha256sum kong/kong.yml | cut -c1-16)"
export KONG_CONFIG_SHA

image_id() {
  docker image inspect -f '{{.Id}}' "daln/$1:latest" 2>/dev/null || true
}

# "<service> <container id>" của mọi container trong project, kể cả đã dừng.
containers() {
  docker ps -a --filter label=com.docker.compose.project=daln-prod \
    --format '{{.Label "com.docker.compose.service"}} {{.ID}}' | sort
}

echo "[deploy] Commit $(git -C "${ROOT}" log -1 --format='%h %s')"

# Build TUẦN TỰ: máy 4 core / 8GB, build song song 8 image rất dễ OOM.
built=""
for svc in db-push user chat notification realtime-gateway recommendation saga-orchestrator web; do
  echo "[deploy] Build ${svc}"
  started=${SECONDS}
  before="$(image_id "${svc}")"
  compose build "${svc}"
  if [ "$(image_id "${svc}")" != "${before}" ]; then
    built+=" ${svc}"
    echo "[deploy] Build ${svc}: image mới ($((SECONDS - started))s)"
  else
    echo "[deploy] Build ${svc}: không đổi ($((SECONDS - started))s)"
  fi
done

before="$(containers)"
compose up -d --remove-orphans
# Container mang ID mới = vừa được tạo (lại).
recreated="$(comm -13 <(printf '%s\n' "${before}") <(containers) | cut -d' ' -f1 | tr '\n' ' ')"

# Kong cache DNS: service phía sau được tạo lại thì đổi IP, Kong trả 502 cho tới khi
# phân giải lại. Kong vừa được tạo lại thì đã phân giải mới, khỏi restart.
kong="giữ nguyên"
if [[ " ${recreated} " == *" kong "* ]]; then
  kong="tạo lại"
else
  for svc in user chat notification realtime-gateway recommendation; do
    if [[ " ${recreated} " == *" ${svc} "* ]]; then
      compose restart kong
      kong="restart (${svc} vừa được tạo lại)"
      break
    fi
  done
fi

summary() {
  echo "[deploy] ===== Tóm tắt ====="
  echo "[deploy] Image mới :${built:- không có}"
  echo "[deploy] Tạo lại   : ${recreated:-không có}"
  echo "[deploy] Kong      : ${kong}"
  echo "[deploy] Tổng      : ${SECONDS}s"
}

# ---- Smoke check ----
# "<500": Kong đã chạm tới service (401/404 là service trả lời); 502/503 là không tới.
check() {
  local name="$1" url="$2" want="$3" code=""
  for _ in $(seq 1 30); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${url}" || true)"
    if { [ "${want}" = "2xx" ] && [[ "${code}" =~ ^2 ]]; } ||
       { [ "${want}" = "<500" ] && [[ "${code}" =~ ^[1-4] ]]; }; then
      echo "[smoke] OK   ${name} (${code})"
      return 0
    fi
    sleep 3
  done
  echo "[smoke] FAIL ${name}: ${url} -> ${code:-000}" >&2
  return 1
}

failed=0
check web            "http://127.0.0.1/"                                        2xx    || failed=1
check user           "http://127.0.0.1:8000/user/me"                            "<500" || failed=1
check chat           "http://127.0.0.1:8000/chat/"                              "<500" || failed=1
check notification   "http://127.0.0.1:8000/notification/"                      "<500" || failed=1
check recommendation "http://127.0.0.1:8000/recommendation/"                    "<500" || failed=1
check realtime       "http://127.0.0.1:8000/socket.io/?EIO=4&transport=polling" 2xx    || failed=1
check minio          "http://127.0.0.1:9000/minio/health/live"                  2xx    || failed=1

if [ "${failed}" -ne 0 ]; then
  compose ps
  compose logs --tail 80
  summary
  exit 1
fi

docker image prune -f >/dev/null
docker builder prune -f --filter until=168h >/dev/null
summary
echo "[deploy] Xong"

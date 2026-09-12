#!/usr/bin/env bash
# ============================================================================
# Build + chạy toàn bộ ứng dụng trên server từ source hiện tại của repo.
#
# Gọi bởi /usr/local/bin/daln-deploy (CI/CD) sau khi đã reset về đúng commit,
# hoặc chạy tay trên server:  bash deploy/deploy.sh
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

echo "[deploy] Commit $(git -C "${ROOT}" log -1 --format='%h %s')"

# Build TUẦN TỰ: máy 4 core / 8GB, build song song 8 image rất dễ OOM. Image nào
# không đổi thì ăn cache BuildKit, chỉ mất vài giây.
for svc in db-push user chat notification realtime-gateway recommendation saga-orchestrator web; do
  echo "[deploy] Build ${svc}"
  compose build "${svc}"
done

compose up -d --remove-orphans

# Kong cache DNS: container app được tạo lại thì đổi IP, Kong trả 502 cho tới khi
# phân giải lại. Restart cũng nạp lại kong.yml (bind mount không tự reload).
compose restart kong

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
  exit 1
fi

docker image prune -f >/dev/null
docker builder prune -f --filter until=168h >/dev/null
echo "[deploy] Xong"

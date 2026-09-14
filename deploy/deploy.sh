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
#
# Migration dữ liệu (docker-compose.prod.yml: db-push -> migrate -> app):
#   - đếm migration đang chờ bằng image vừa build;
#   - có migration chờ: backup Mongo vào /root/backups/mongo (giữ 7 bản mới nhất)
#     rồi chạy migrate RIÊNG trong lúc app cũ vẫn phục vụ — lỗi thì dừng ở đây;
#   - migrate-background cũ còn chạy thì dừng êm trước (nó giữ lock migrate),
#     `up -d` chạy lại nó sau migrate, làm tiếp từ checkpoint;
#   - `up -d` luôn chạy db-push + migrate trước app (depends_on).
#
# nginx trên host (HTTPS, deploy/nginx/daln.conf): cài lại file cấu hình và `nginx -t`
# TRƯỚC khi đụng tới container, reload (lần đầu: khởi động) sau `up -d`.
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

# Backup Mongo trước khi chạy migration. Chạy tay có thể đổi chỗ bằng DALN_BACKUP_DIR.
BACKUP_DIR="${DALN_BACKUP_DIR:-/root/backups/mongo}"
BACKUP_KEEP=7

# Domain công khai: nginx trên host + chứng chỉ Let's Encrypt (deploy/README.md, HTTPS).
DOMAIN="${DALN_DOMAIN:-nguyen1976.xyz}"

# Dấu vân tay NỘI DUNG của image (layer + config), không phải .Id: với containerd
# image store (server đang dùng), .Id là digest của index và đổi sau mỗi lần build,
# kể cả khi build ăn cache hoàn toàn.
image_id() {
  { docker image inspect -f '{{json .RootFS.Layers}}{{json .Config}}' "daln/$1:latest" 2>/dev/null || true; } |
    sha256sum | cut -c1-16
}

# "<service> <container id>" của mọi container trong project, kể cả đã dừng.
containers() {
  docker ps -a --filter label=com.docker.compose.project=daln-prod \
    --format '{{.Label "com.docker.compose.service"}} {{.ID}}' | sort
}

# Giá trị cho bảng tóm tắt. Khởi tạo từ đầu vì deploy có thể dừng giữa chừng.
built=""
recreated=""
kong="giữ nguyên"
migration="không rõ"
backup="bỏ qua"
nginx_state="chưa tới bước này"

# Số message đang nằm trong daln.dead-letters (tạo bởi docker/rabbitmq-init.sh).
dead_letters() {
  local n
  n="$(docker exec daln-prod-rabbitmq rabbitmqctl -q list_queues name messages 2>/dev/null |
    awk '$1 == "daln.dead-letters" { print $2 }' || true)"
  case "${n}" in
    "" | *[!0-9]*) echo "không rõ" ;;
    0) echo "0" ;;
    *) echo "${n} — CÓ message xử lý lỗi, xem deploy/README.md (Dead-letter)" ;;
  esac
}

summary() {
  echo "[deploy] ===== Tóm tắt ====="
  echo "[deploy] Image mới   :${built:- không có}"
  echo "[deploy] Tạo lại     : ${recreated:-không có}"
  echo "[deploy] Kong        : ${kong}"
  echo "[deploy] nginx       : ${nginx_state}"
  echo "[deploy] Migration   : ${migration}"
  echo "[deploy] Backup      : ${backup}"
  echo "[deploy] Dead-letter : $(dead_letters)"
  echo "[deploy] Tổng        : ${SECONDS}s"
}

# fail <lý do> [service...]: in trạng thái + log (của các service đưa vào, không
# đưa thì tất cả), tóm tắt rồi dừng deploy.
fail() {
  echo "[deploy] LỖI: $1" >&2
  shift
  compose ps -a || true
  compose logs --tail 80 "$@" || true
  summary
  exit 1
}

# Dump toàn bộ Mongo ra file trên host. Dump lỗi hoặc rỗng thì dừng deploy — lúc
# này chưa migration nào chạy, app cũ vẫn nguyên.
backup_mongo() {
  local file size
  file="${BACKUP_DIR}/daln-$(date -u +%Y%m%dT%H%M%SZ)-$(git -C "${ROOT}" rev-parse --short HEAD).archive.gz"
  install -d -m 700 "${BACKUP_DIR}"
  echo "[deploy] Backup Mongo -> ${file}"
  # Ghi ra .partial rồi mới đổi tên: bản dở dang không bao giờ trông như bản tốt
  # và không chiếm chỗ trong số bản được giữ lại.
  if ! (umask 077 && docker exec daln-prod-mongo mongodump --archive --gzip --quiet >"${file}.partial") ||
    [ ! -s "${file}.partial" ]; then
    rm -f "${file}.partial"
    backup="LỖI (dump thất bại hoặc rỗng)"
    fail "backup Mongo thất bại — chưa chạy migration nào" mongo
  fi
  mv "${file}.partial" "${file}"
  size="$(du -h "${file}" | cut -f1)"
  backup="${file} (${size})"
  # Giữ BACKUP_KEEP bản mới nhất. Tên chứa thời điểm UTC -> sắp theo tên = theo thời gian.
  find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'daln-*.archive.gz' | sort -r |
    tail -n "+$((BACKUP_KEEP + 1))" | while IFS= read -r old; do
      rm -f -- "${old}"
      echo "[deploy] Xoá backup cũ: ${old}"
    done
}

echo "[deploy] Commit $(git -C "${ROOT}" log -1 --format='%h %s')"

# Build TUẦN TỰ: máy 4 core / 8GB, build song song 8 image rất dễ OOM.
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

# ---- Migration đang chờ -> backup Mongo ----
# Đếm bằng image db-push vừa build (đã có file migration mới) trên DB đang chạy.
# Không đếm được (Mongo chưa chạy — deploy lần đầu — hoặc lệnh lỗi) = "không rõ":
# không backup.
pending=""
skip=""
if [ "$(docker inspect -f '{{.State.Running}}' daln-prod-mongo 2>/dev/null || true)" != "true" ]; then
  skip="Mongo chưa chạy — deploy lần đầu?"
# </dev/null: `compose run` mặc định gắn stdin, không để nó đọc stdin của deploy.
elif ! out="$(compose run --rm --no-deps -T migrate status --pending-count </dev/null)"; then
  skip="lệnh đếm migration lỗi"
else
  # Chỉ nhận dòng toàn chữ số: log lỡ lọt vào stdout cũng không bị đọc nhầm.
  pending="$(printf '%s\n' "${out}" | tr -d '\r' | grep -E '^[0-9]+$' | tail -n 1 || true)"
  [ -n "${pending}" ] || skip="lệnh đếm migration không in ra số"
fi

if [ -n "${skip}" ]; then
  echo "[deploy] Migration đang chờ: không rõ — ${skip} -> bỏ qua backup"
  backup="bỏ qua (${skip})"
elif [ "${pending}" -eq 0 ]; then
  echo "[deploy] Migration đang chờ: 0"
  migration="không có"
  backup="không cần"
else
  echo "[deploy] Migration đang chờ: ${pending}"
  migration="${pending} chờ chạy"
  backup_mongo
fi

# ---- nginx trên host (HTTPS): kiểm cấu hình TRƯỚC khi đụng tới container ----
# Host đã cài nginx (deploy/README.md, mục HTTPS) thì cài lại site từ repo ở mỗi lần
# deploy. `nginx -t` (cú pháp + đọc được chứng chỉ) lỗi thì trả lại file cũ và dừng ở
# đây, app cũ vẫn chạy nguyên. nginx đang chạy chỉ đọc file mới khi reload sau `up -d`.
if command -v nginx >/dev/null 2>&1; then
  site=/etc/nginx/sites-available/daln.conf
  if [ -f "${site}" ]; then cp -p "${site}" "${site}.prev"; fi
  install -m 644 "${ROOT}/deploy/nginx/daln.conf" "${site}"
  ln -sf "${site}" /etc/nginx/sites-enabled/daln.conf
  rm -f /etc/nginx/sites-enabled/default
  if ! nginx -t; then
    if [ -f "${site}.prev" ]; then mv -f "${site}.prev" "${site}"; else rm -f /etc/nginx/sites-enabled/daln.conf; fi
    nginx_state="LỖI cấu hình (nginx -t) — giữ cấu hình cũ"
    fail "nginx -t thất bại (deploy/nginx/daln.conf hoặc chứng chỉ /etc/letsencrypt) — chưa đụng tới container" web
  fi
  rm -f "${site}.prev"
  nginx_state="cấu hình OK"
else
  nginx_state="không cài"
fi

# ---- Dừng backfill cũ còn chạy ----
# migrate-background của lần deploy trước (backfill dài) còn chạy thì đang giữ
# lock migrate của DB đó: migrate bên dưới sẽ chờ 30s rồi lỗi. Dừng êm (SIGTERM ->
# xong lô đang chạy, ghi checkpoint, nhả lock); `up -d` chạy lại nó sau migrate.
if [ -n "$(compose ps -q --status running migrate-background 2>/dev/null || true)" ]; then
  echo "[deploy] Dừng migrate-background đang chạy (sẽ làm tiếp từ checkpoint)"
  compose stop -t 60 migrate-background || true
fi

# ---- Chạy migrate riêng, trước khi đụng tới app ----
# `up -d` tổng dừng và gỡ container app cần tạo lại TRƯỚC khi chờ migrate (compose
# chỉ chờ depends_on lúc start) -> migrate lỗi ở đó là các app ấy đã sập. Có
# migration chờ (hoặc không đếm được) thì chạy riêng ở đây: lỗi thì dừng, app cũ
# vẫn phục vụ. Đổi lại db-push + migrate chạy thêm một lần ở `up -d` bên dưới
# (lúc đó hết việc, vài giây) — chỉ ở lần deploy có migration.
if [ "${pending}" != "0" ]; then
  echo "[deploy] Chạy migrate trước khi đụng tới app"
  since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if ! compose up -d migrate || [ "$(docker wait daln-prod-migrate 2>/dev/null || true)" != "0" ]; then
    migration="LỖI${pending:+ (${pending} đang chờ)}"
    fail "migrate thất bại — app cũ vẫn chạy nguyên" db-push migrate
  fi
  compose logs --no-log-prefix --since "${since}" migrate || true
  if [ -n "${pending}" ]; then
    migration="${pending} chạy"
  fi
fi

up_ok=1
compose up -d --remove-orphans || up_ok=0
# Container mang ID mới = vừa được tạo (lại).
recreated="$(comm -13 <(printf '%s\n' "${before}") <(containers) | cut -d' ' -f1 | tr '\n' ' ')"
if [ "${up_ok}" -ne 1 ]; then
  # Thường là một bước one-shot lỗi: app chờ db-push / migrate / rabbitmq-init
  # (service_completed_successfully) nên không khởi động.
  if [ "$(docker inspect -f '{{.State.ExitCode}}' daln-prod-migrate 2>/dev/null || true)" != "0" ]; then
    migration="LỖI"
  fi
  fail "compose up thất bại" db-push migrate rabbitmq-init
fi

# Kong cache DNS: service phía sau được tạo lại thì đổi IP, Kong trả 502 cho tới khi
# phân giải lại. Kong vừa được tạo lại thì đã phân giải mới, khỏi restart.
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

# ---- nginx trên host: nạp cấu hình đã kiểm ở trên ----
# Lần đầu (web vừa rời cổng 80 sang 127.0.0.1:8081) thì đây là lúc nginx khởi động.
if [ "${nginx_state}" = "cấu hình OK" ]; then
  systemctl enable --quiet nginx
  if systemctl is-active --quiet nginx; then
    systemctl reload nginx || fail "nginx reload thất bại" web
    nginx_state="reload"
  else
    systemctl restart nginx || fail "nginx không khởi động được" web
    nginx_state="khởi động"
  fi
fi

# ---- Smoke check ----
# "<500": Kong đã chạm tới service (401/404 là service trả lời); 502/503 là không tới.
check() {
  local name="$1" url="$2" want="$3" code=""
  for _ in $(seq 1 30); do
    # --resolve: gọi domain thẳng vào nginx trên máy này, không phụ thuộc DNS.
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 --resolve "${DOMAIN}:443:127.0.0.1" "${url}" || true)"
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
check web            "http://127.0.0.1:8081/"                                   2xx    || failed=1
check user           "http://127.0.0.1:8000/user/me"                            "<500" || failed=1
check chat           "http://127.0.0.1:8000/chat/"                              "<500" || failed=1
check notification   "http://127.0.0.1:8000/notification/"                      "<500" || failed=1
check recommendation "http://127.0.0.1:8000/recommendation/"                    "<500" || failed=1
check realtime       "http://127.0.0.1:8000/socket.io/?EIO=4&transport=polling" 2xx    || failed=1
check minio          "http://127.0.0.1:9000/minio/health/live"                  2xx    || failed=1
# Đúng đường trình duyệt đi: nginx + HTTPS (chỉ khi host đã cài nginx).
if [ "${nginx_state}" != "không cài" ]; then
  check https-web      "https://${DOMAIN}/"                                     2xx    || failed=1
  check https-api      "https://${DOMAIN}/api/user/me"                          "<500" || failed=1
  check https-socket   "https://${DOMAIN}/socket.io/?EIO=4&transport=polling"   2xx    || failed=1
  check https-media    "https://${DOMAIN}/daln-media/"                          "<500" || failed=1
  check http-redirect  "http://127.0.0.1/"                                      "<500" || failed=1
fi

if [ "${failed}" -ne 0 ]; then
  fail "smoke check thất bại"
fi

docker image prune -f >/dev/null
docker builder prune -f --filter until=168h >/dev/null
summary
echo "[deploy] Xong"

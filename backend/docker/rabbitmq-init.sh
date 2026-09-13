#!/bin/sh
# ============================================================================
# Dựng hạ tầng dead-letter của RabbitMQ qua management HTTP API. Idempotent:
# chạy lại bao nhiêu lần cũng được. Service `rabbitmq-init` (docker-compose*.yml)
# chạy script này trong image curlimages/curl (POSIX sh, không có bash) ở mỗi
# lần `compose up`, TRƯỚC khi app (consumer) khởi động:
#
#   exchange daln.dlx           fanout, durable
#   queue    daln.dead-letters  durable, bind vào daln.dlx
#   policy   daln-dlx           mọi queue trừ daln.dead-letters có
#                               dead-letter-exchange = daln.dlx
#
# -> message bị nack/reject không requeue (hoặc hết TTL, tràn max-length) không
#    mất mà nằm lại ở daln.dead-letters để xem và chạy lại (deploy/README.md).
# Các tên trên là HỢP ĐỒNG với code messaging: đổi ở đây phải đổi cả bên đó.
#
# Biến: RABBITMQ_DEFAULT_USER, RABBITMQ_DEFAULT_PASS (bắt buộc)
#       RABBITMQ_API (mặc định http://rabbitmq:15672/api)
# ============================================================================
set -eu

API="${RABBITMQ_API:-http://rabbitmq:15672/api}"
AUTH="${RABBITMQ_DEFAULT_USER:?thiếu RABBITMQ_DEFAULT_USER}:${RABBITMQ_DEFAULT_PASS:?thiếu RABBITMQ_DEFAULT_PASS}"
# vhost mặc định "/" (RABBITMQ_URL của app không chỉ định vhost), đã mã hoá URL.
VHOST="%2F"
RESP="$(mktemp)"

log() { echo "[rabbitmq-init] $*"; }

# Healthcheck của rabbitmq (rabbitmq-diagnostics ping) có thể xanh trước khi
# plugin management mở cổng 15672 -> chờ API trả lời, tối đa 60s.
tries=0
until curl -fsS -o /dev/null -u "${AUTH}" "${API}/overview" 2>/dev/null; do
  tries=$((tries + 1))
  if [ "${tries}" -ge 30 ]; then
    log "LỖI: ${API} không trả lời sau 60s" >&2
    exit 1
  fi
  sleep 2
done

# api <METHOD> <đường dẫn> <JSON>: không phải 2xx thì in body lỗi và dừng.
api() {
  code="$(curl -sS -o "${RESP}" -w '%{http_code}' -u "${AUTH}" -X "$1" \
    -H 'content-type: application/json' --data "$3" "${API}$2")" || code="000"
  case "${code}" in
    2??) log "$1 $2 -> ${code}" ;;
    *)
      log "LỖI: $1 $2 -> ${code}: $(cat "${RESP}")" >&2
      exit 1
      ;;
  esac
}

api PUT "/exchanges/${VHOST}/daln.dlx" \
  '{"type":"fanout","durable":true,"auto_delete":false,"internal":false,"arguments":{}}'

# Queue đã có với cùng thuộc tính -> 204. Khác thuộc tính (vd code khai báo
# daln.dead-letters với arguments khác) -> 400 và bước này dừng: cố ý, để lộ ra.
api PUT "/queues/${VHOST}/daln.dead-letters" \
  '{"durable":true,"auto_delete":false,"arguments":{}}'

# Binding là tập hợp: POST lại binding đã có không sinh bản thứ hai.
api POST "/bindings/${VHOST}/e/daln.dlx/q/daln.dead-letters" \
  '{"routing_key":"","arguments":{}}'

# Loại chính daln.dead-letters ra khỏi policy, nếu không message chết trong đó sẽ
# bị dead-letter vòng lại chính nó. Mỗi queue chỉ chịu MỘT policy (priority cao
# nhất thắng): policy khác khớp cùng queue mà priority > 0 sẽ thay hẳn policy này.
api PUT "/policies/${VHOST}/daln-dlx" \
  '{"pattern":"^(?!daln\\.dead-letters$).*","definition":{"dead-letter-exchange":"daln.dlx"},"apply-to":"queues","priority":0}'

rm -f "${RESP}"
log "Xong"

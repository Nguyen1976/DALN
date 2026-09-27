#!/bin/bash
# Mở tunnel Cloudflare tới gateway dev rồi trỏ webhook của app daln-dev vào đó.
# URL *.trycloudflare.com đổi mỗi lần tunnel khởi động lại, nên chạy lại script
# này sau mỗi lần `docker compose up` lại service rtk-tunnel.
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose --profile rtk up -d rtk-tunnel
url=""
for _ in $(seq 1 30); do
  url=$(docker compose --profile rtk logs rtk-tunnel 2>&1 | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)
  [ -n "$url" ] && break
  sleep 2
done
[ -n "$url" ] || { echo "không lấy được URL tunnel" >&2; exit 1; }
echo "tunnel: $url"
npm run rtk:setup -- --env .env --webhook-url "$url/realtime/rtk-webhook"

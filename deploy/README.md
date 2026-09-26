# Deploy production

Toàn bộ ứng dụng (FE + BE + hạ tầng) chạy trên **một server** bằng Docker Compose:
`backend/docker-compose.prod.yml` (project `daln-prod`). Source nằm ở `/root/workspace/DALN`.

Ra ngoài chỉ có **nginx trên host**: cổng 80 (chuyển sang HTTPS) và 443, domain
`https://nguyen1976.xyz` — xem mục [HTTPS](#https-nginx--certbot).

| Đường dẫn | Chuyển tới (các cổng này chỉ nghe 127.0.0.1) |
|---|---|
| `/` | web — nginx trong container phục vụ bản build Vite (`8081`) |
| `/api/` | Kong — API, bỏ tiền tố `/api` (`8000`) |
| `/socket.io/` | Kong — socket, namespace `/realtime` (`8000`) |
| `/daln-media/` | MinIO — ảnh/tệp: GET công khai, PUT bằng URL ký sẵn (`9000`) |

Mongo, Redis, RabbitMQ, Qdrant, Kong admin và các cổng 3001–3005 **không** mở ra ngoài.

## Luồng CI/CD — `.github/workflows/ci-cd.yml`

- **PR vào `main`**: kiểm tra BE (typecheck + unit test) và FE (lint + build).
- **Merge vào `main`**: kiểm tra xong → Actions SSH vào server bằng key deploy → server kéo
  đúng commit đó (`deploy/remote-entry.sh`) → `deploy/deploy.sh` build lại, chạy, smoke check.
- **Run workflow** (tab Actions): để trống = deploy lại HEAD của `main`; điền SHA đủ 40 ký tự
  của một commit cũ trên `main` = rollback.

Cấu hình trên GitHub: secret `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`; variable `DEPLOY_HOST`.

Key deploy bị khoá bằng forced command: nó chỉ nhận một commit SHA đã nằm trên `main`,
không mở được shell.

## Thứ tự khởi động

`up -d` dựng theo `depends_on`. Các bước one-shot chạy lại ở **mỗi** lần up và đều idempotent:

```
mongo ──> mongo-init ──> db-push ──> migrate ──┬──> app (6 service + worker) ──> Kong
rabbitmq ──> rabbitmq-init ────────────────────┤
minio ──> minio-init ──────────────────────────┘
                              migrate ──> migrate-background   (app KHÔNG chờ)
```

| Bước | Làm gì | Lỗi thì |
|---|---|---|
| `db-push` | `prisma db push`: collection + unique index của 5 DB | app không chạy, deploy dừng |
| `migrate` | `migrate.sh up`: migration dữ liệu đang chờ (`backend/migrations/<service>/`) | app không chạy, deploy dừng |
| `rabbitmq-init` | exchange `daln.dlx`, queue `daln.dead-letters`, policy `daln-dlx` | app không chạy, deploy dừng |
| `migrate-background` | `migrate.sh background`: backfill dài, chạy tiếp được từ chỗ dừng | chỉ hiện trong log của nó, deploy không chờ |

`db-push`, `migrate`, `migrate-background` dùng chung image `daln/db-push` (target `schema`
của `backend/Dockerfile`), chỉ khác entrypoint/command.

## Deploy chỉ làm lại phần có thay đổi

| Sửa ở đâu | Deploy làm gì |
|---|---|
| `backend/apps/<svc>/` | build + tạo lại đúng `<svc>`; restart Kong nếu `<svc>` nằm sau Kong |
| `backend/apps/*/prisma/` | như trên, cộng db-push đồng bộ index |
| `backend/migrations/` | chỉ build lại image `db-push`; có migration chờ thì backup Mongo + chạy migrate trước khi đụng tới app |
| `backend/libs/`, `backend/docker/`, `package*.json`, `tsconfig*.json`, `nest-cli.json`, `Dockerfile` | build lại cả 6 service backend; chỉ service ra image khác mới bị tạo lại |
| `frontend/` | chỉ build + tạo lại `web`, API không gián đoạn |
| `backend/kong/kong.yml` | chỉ tạo lại Kong |
| docs, `backend/scripts/`, `deploy/` | không build lại gì |

Cuối log deploy có bảng tóm tắt: image nào mới, container nào được tạo lại, Kong có
restart không, migration, backup, số message dead-letter, tổng thời gian. Lần đầu sau khi
sửa `Dockerfile` thì build lại tất cả.

Chạy tay `dc up -d` (không qua `deploy.sh`) thì Kong bị tạo lại một lần, vì label
`daln.kong-config` thành `manual`. Vô hại. Nhưng `dc up -d` chạy migrate **không backup**
trước: có migration mới thì dùng `bash ../deploy/deploy.sh`.

## Migration dữ liệu

Trước `up -d`, `deploy.sh`:

1. đếm migration đang chờ bằng image vừa build (`migrate status --pending-count`) trên DB đang chạy;
2. có ≥ 1: backup Mongo (mục dưới);
3. `migrate-background` của lần trước còn chạy thì dừng êm (xong lô đang chạy, ghi checkpoint,
   nhả lock) — nó giữ lock migrate của DB đang backfill, để nguyên thì `migrate` chờ 30s rồi lỗi;
4. có migration chờ: chạy `migrate` **riêng** trong lúc app cũ vẫn phục vụ. Lỗi thì deploy
   dừng ở đây, app cũ vẫn chạy, log `migrate` in ở cuối log deploy;
5. `up -d` như thường (db-push + migrate chạy lại, lúc này không còn gì chờ nên chỉ vài giây;
   `migrate-background` chạy lại sau đó, làm tiếp từ checkpoint).

Vì sao chạy riêng: `up -d` dừng và gỡ container app cần tạo lại **trước** khi chờ migrate
(compose chỉ chờ `depends_on` lúc start). Để migrate lỗi ở bước đó thì các app ấy đã sập.

Mongo chưa chạy (deploy lần đầu) hoặc không đếm được thì `Migration : không rõ` và không backup.
Dòng tóm tắt: `Migration : <n chạy | không có | không rõ | LỖI>`.

Trên server (`dc` là alias ở mục Vận hành):

```bash
dc run --rm --no-deps migrate status                  # migration nào đã / chưa chạy
dc run --rm --no-deps migrate status --pending-count  # chỉ in số đang chờ
dc logs --tail 100 migrate                            # các lần chạy gần nhất
dc logs -f migrate-background                         # tiến độ backfill
dc ps -a migrate-background                           # Exited (0) = xong
dc start migrate-background                           # chạy lại backfill (tiếp từ chỗ dừng)
```

## Backup Mongo

- **Khi nào:** deploy có ≥ 1 migration đang chờ. Dump lỗi hoặc ra file rỗng thì deploy dừng,
  migration chưa chạy.
- **Ở đâu:** `/root/backups/mongo/daln-<UTC>-<sha ngắn>.archive.gz` (thư mục 700, file 600).
  Chạy tay có thể đổi chỗ bằng biến `DALN_BACKUP_DIR`.
- **Giữ:** 7 bản `daln-*.archive.gz` mới nhất; bản cũ hơn tự xoá. File tên khác không bị đụng tới.
- Backup nằm **cùng ổ đĩa** với Mongo: mất server là mất cả hai. Cần giữ lâu thì chép ra ngoài.
- Dump chạy khi app cũ vẫn đang ghi: đủ để quay về trước migration, không phải ảnh chụp
  tức thời tuyệt đối.

```bash
# Backup tay (tên manual-* nên không bị xoay vòng)
docker exec daln-prod-mongo mongodump --archive --gzip \
  > /root/backups/mongo/manual-$(date -u +%Y%m%dT%H%M%SZ).archive.gz
```

### Khôi phục

> **CẢNH BÁO:** `--drop` xoá từng collection có trong backup rồi nạp lại. Mọi thứ ghi sau
> lúc backup **mất hẳn**. Collection sinh ra sau lúc backup (không có trong file) thì vẫn nằm
> nguyên, xoá tay nếu cần. Chưa chắc chắn thì backup tay bản hiện tại trước.

```bash
cd /root/workspace/DALN/backend
# 1. Dừng mọi thứ ghi vào Mongo
dc stop user chat notification realtime-gateway recommendation recommendation-worker \
  saga-orchestrator migrate-background
# 2. Nạp lại
docker exec -i daln-prod-mongo mongorestore --archive --gzip --drop \
  < /root/backups/mongo/daln-<...>.archive.gz
# 3. Deploy commit TRƯỚC migration (Actions → Run workflow + SHA). `dc up -d` với code
#    hiện tại sẽ chạy lại đúng migration vừa gỡ.
```

## Dead-letter (RabbitMQ)

`rabbitmq-init` (`backend/docker/rabbitmq-init.sh`) dựng ở mỗi lần up, trước app:

- exchange `daln.dlx` (fanout, durable) → queue `daln.dead-letters` (durable);
- policy `daln-dlx`: mọi queue trừ `daln.dead-letters` có `dead-letter-exchange = daln.dlx`.

Message bị consumer nack/reject **không requeue** (hoặc hết TTL, tràn max-length) rơi vào
`daln.dead-letters` thay vì mất. Header `x-death` của từng message ghi queue gốc (`queue`),
exchange + routing key gốc, lý do (`reason`: `rejected` / `expired` / `maxlen`) và số lần.
Cuối log deploy có dòng `Dead-letter : <n>`: khác 0 là có message xử lý hỏng.

Mỗi queue chỉ chịu **một** policy (priority cao nhất thắng): thêm policy khác khớp các queue
này thì phải chép `dead-letter-exchange` vào policy đó. Tham số `x-dead-letter-exchange` khai
trong code thì thắng policy.

```bash
cd /root/workspace/DALN/backend
# Đếm
docker exec daln-prod-rabbitmq rabbitmqctl -q list_queues name messages | grep -F daln.dead-letters

# Management API: 15672 không mở ra ngoài -> gọi từ một container curl trong mạng docker
rmq_env() { grep "^$1=" .env.production | cut -d= -f2-; }
rmq() {
  docker run --rm --network daln-prod_backend curlimages/curl:8.22.0 -sS \
    -u "$(rmq_env RABBITMQ_DEFAULT_USER):$(rmq_env RABBITMQ_DEFAULT_PASS)" \
    -H 'content-type: application/json' "$@"
}

# Xem 10 message đầu. ack_requeue_true: trả lại queue, không mất
rmq -X POST http://rabbitmq:15672/api/queues/%2F/daln.dead-letters/get \
  -d '{"count":10,"ackmode":"ack_requeue_true","encoding":"auto"}'
```

**Chạy lại** (sau khi đã sửa lỗi và deploy bản vá). Nếu mọi message cùng một queue gốc
(xem `x-death`), shovel chuyển chúng về đúng queue đó. Nó publish qua default exchange nên
không lan sang consumer khác của topic exchange:

```bash
docker exec daln-prod-rabbitmq rabbitmq-plugins enable rabbitmq_shovel  # bật lại nếu container rabbitmq bị tạo lại
docker exec daln-prod-rabbitmq rabbitmqctl set_parameter shovel daln-replay \
  '{"src-uri":"amqp://","src-queue":"daln.dead-letters","dest-uri":"amqp://","dest-queue":"<queue gốc>","src-delete-after":"queue-length"}'
# Shovel chuyển đúng số message đang có rồi tự xoá. Kiểm tra lại bằng lệnh Đếm.
```

Lẫn nhiều queue gốc: lấy từng message ra (`"ackmode":"ack_requeue_false"`, lưu lại output),
rồi publish về đúng queue:

```bash
rmq -X POST http://rabbitmq:15672/api/exchanges/%2F/amq.default/publish \
  -d '{"routing_key":"<queue gốc>","payload":"<payload>","payload_encoding":"string","properties":{"content_type":"application/json"}}'
```

Bỏ hẳn (đã xem, không cần chạy lại):

```bash
docker exec daln-prod-rabbitmq rabbitmqctl purge_queue daln.dead-letters
```

## HTTPS (nginx + certbot)

- nginx cài thẳng trên host (apt), cấu hình ở `deploy/nginx/daln.conf`. `deploy.sh` cài lại file
  này ở mỗi lần deploy: `nginx -t` **trước** khi đụng tới container (lỗi thì trả lại file cũ và
  dừng, app cũ vẫn chạy), reload sau `up -d`. Muốn đổi cấu hình nginx thì sửa file trong repo.
- Chứng chỉ Let's Encrypt, đăng ký không kèm email. certbot tự gia hạn (systemd
  `certbot.timer`) qua webroot `/var/www/certbot`; hook
  `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx` reload nginx sau khi gia hạn.
- Chứng chỉ hiện mới có `nguyen1976.xyz`: Let's Encrypt chưa tra được CAA của `www` vì
  registry `.xyz` còn trỏ domain tới 4 nameserver AWS cũ và `ns3`/`ns4.matbao.com` (cần đúng
  `ns1`/`ns2.matbao.com`), nên lúc được lúc SERVFAIL. Cũng vì vậy `certbot renew --dry-run`
  đang lỗi, và lần gia hạn thật (từ khoảng 12/11, chứng chỉ hết hạn 12/12/2026) sẽ lỗi nếu
  chưa sửa nameserver. `http://www…` vẫn chuyển về domain gốc; riêng `https://www…` báo sai
  chứng chỉ. DNS ổn thì thêm `www` (không phải dừng gì):
  `certbot certonly --webroot -w /var/www/certbot --cert-name nguyen1976.xyz -d nguyen1976.xyz -d www.nguyen1976.xyz --expand --deploy-hook 'systemctl reload nginx'`
- `http://` và truy cập bằng IP đều chuyển sang `https://nguyen1976.xyz`.

```bash
certbot certificates                 # hạn chứng chỉ
certbot renew --dry-run              # thử gia hạn, không đổi gì
nginx -t && systemctl reload nginx   # nạp lại tay
tail -f /var/log/nginx/error.log
```

## TURN (coturn) — gọi thoại

Gọi thoại 1-1 (WebRTC) cần một máy chủ TURN để nối được khi hai máy ở sau CGNAT/tường
lửa (bản thiết kế: `docs/diagrams/voice-call-turn.html`). coturn cài **thẳng trên host**
bằng apt, **cạnh nginx** (không trong Docker: relay cần hàng trăm cổng UDP, publish qua
Docker đi vòng ufw và chậm với dải lớn). Chứng chỉ Let's Encrypt dùng chung với nginx.

Gateway (`realtime-gateway`) ký mật khẩu TURN ngắn hạn bằng `TURN_SECRET`; coturn tự kiểm
lại bằng **chính** `TURN_SECRET` đó (`use-auth-secret`) — nên **`TURN_SECRET` trong
`backend/.env.production` phải TRÙNG với `static-auth-secret` trong `/etc/turnserver.conf`**.
Không cần đồng bộ tay: `deploy.sh` render `/etc/turnserver.conf` từ
`deploy/coturn/turnserver.conf` (template), thay `TURN_SECRET`/`TURN_REALM`/`TURN_HOST`
bằng giá trị `.env.production` (envsubst) ở **mỗi** lần deploy — sửa cấu hình thì sửa file
template trong repo, đừng sửa `/etc/turnserver.conf` (deploy sau ghi đè).

| Cổng | Giao thức | Để làm gì |
|---|---|---|
| `3478` | UDP, TCP | STUN + TURN, đường chính. URL dùng thẳng IP `TURN_HOST` -> không phụ thuộc DNS |
| `5349` | TCP + TLS | TURN qua TLS (`turns:`) cho mạng chỉ cho ra cổng web; cần domain khớp chứng chỉ |
| `49152–49999` | UDP | Cổng relay: mỗi phiên giữ một cổng (khớp `min-port`/`max-port`) |

### Cài lần đầu

```bash
# 1. Cài coturn
apt-get install -y coturn
# 2. Cho phép systemd chạy service (gói Debian mặc định để TURNSERVER_ENABLED=1;
#    kiểm cho chắc, nếu không có/khác thì đặt lại).
grep -q '^TURNSERVER_ENABLED=1' /etc/default/coturn || \
  sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
# 3. ufw mở cổng TURN + dải relay
ufw allow 3478/udp && ufw allow 3478/tcp && ufw allow 5349/tcp
ufw allow 49152:49999/udp
# 4. certbot deploy-hook: gia hạn chứng chỉ xong thì RESTART coturn (coturn không
#    nạp lại cert khi đang chạy). Hook nằm cùng chỗ hook reload-nginx.
printf '#!/bin/sh\nsystemctl restart coturn\n' \
  > /etc/letsencrypt/renewal-hooks/deploy/reload-coturn
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-coturn
# 5. Deploy: deploy.sh render /etc/turnserver.conf từ template + restart coturn.
#    (Cần TURN_SECRET/TURN_HOST/TURN_REALM/TURN_TLS_HOST trong .env.production trước.)
bash /root/workspace/DALN/deploy/deploy.sh
```

`deploy.sh` bỏ qua bước coturn nếu host chưa cài `turnserver` (`coturn : không cài` trong
tóm tắt), nên cứ deploy code như thường; cài coturn khi nào cần bật gọi thoại. Thiếu
`TURN_SECRET` trong `.env.production` thì cũng bỏ qua và gateway trả **chỉ STUN** (gọi
cùng mạng vẫn chạy). Dòng tóm tắt: `coturn : <restart | không cài | bỏ qua (...) | LỖI ...>`
— coturn hỏng **không** làm dừng deploy (gọi thoại lùi về STUN, app vẫn lên).

### Kiểm tra

```bash
systemctl status coturn                       # service đang chạy?
journalctl -u coturn -n 50                    # log (turnserver.conf đặt `syslog`)
grep static-auth-secret /etc/turnserver.conf  # secret đã render (khớp .env.production)?
ss -lunp | grep 3478                          # đang nghe UDP 3478
# Thử allocate qua TURN (secret là REST secret, coturn tự ký username/credential):
turnutils_uclient -v -y -u anyuser -w "$(grep '^TURN_SECRET=' \
  /root/workspace/DALN/backend/.env.production | cut -d= -f2-)" 109.199.115.126
```

Từ trình duyệt: trang **trickle-ice** (`https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/`)
— nhập `turn:109.199.115.126:3478` + username/credential lấy từ `call.ice_config`, phải
thấy candidate loại `relay`. Trong app: hai điện thoại 4G khác nhà mạng, mở
`chrome://webrtc-internals` sẽ thấy cặp candidate `relay` khi đường thẳng hỏng.

> **Đổi `TURN_SECRET`:** đổi ở `backend/.env.production` rồi deploy lại (config render
> lại + coturn restart). Mật khẩu cũ trình duyệt đang giữ tự hết hạn trong `TURN_TTL`
> giây (mặc định 1 giờ).

## LiveKit (gọi nhóm)

Gọi **nhóm** audio (n-n) đi qua một máy chủ **SFU LiveKit** (bản thiết kế:
`docs/diagrams/group-call-sfu-flow.html`) — mỗi người gửi 1 luồng audio lên server, server
phát lại cho những người còn lại (khác gọi 1-1 P2P dùng coturn). Khác coturn (cài apt trên
host), **LiveKit chạy TRONG Docker Compose** (service `livekit`, `docker-compose.prod.yml`) vì
prod đã dùng compose và dải cổng UDP vừa phải (200 cổng). `deploy.sh` không cần bước riêng cho
LiveKit: `up -d` tự dựng.

Gateway (`realtime-gateway`) ký token cho client bằng `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`
(`livekit-server-sdk`) và verify webhook bằng chính cặp đó. **Cách nạp key vào livekit-server:**
file config `deploy/livekit/livekit.prod.yaml` **KHÔNG** chứa key (bind-mount read-only, không
render); compose truyền env **`LIVEKIT_KEYS="${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}"`** cho
container (livekit-server nạp keys map từ env này). Ràng buộc: `LIVEKIT_API_KEY` trong
`.env.production` **phải TRÙNG** `webhook.api_key` (`daln`) trong `livekit.prod.yaml` — LiveKit
ký webhook bằng key đó rồi tra secret trong keys map.

| Cổng | Giao thức | Publish | Để làm gì |
|---|---|---|---|
| `7880` | TCP (HTTP/WS) | `127.0.0.1:7880` | Tín hiệu WS + HTTP API. Ra ngoài qua **nginx** `/livekit/` (client: `wss://nguyen1976.xyz/livekit`) |
| `7881` | TCP | `0.0.0.0:7881` | RTC qua TCP — dự phòng khi UDP bị chặn (client nối thẳng IP:7881) |
| `50000–50199` | UDP | `0.0.0.0:50000-50199` | Media: mỗi participant giữ vài cổng (khớp `port_range_start/end` trong `livekit.prod.yaml`) |

nginx: `location /livekit/ { proxy_pass http://127.0.0.1:7880/; }` — trailing slash BỎ tiền tố
`/livekit`; header `Upgrade`/`Connection` + `proxy_http_version 1.1` kế thừa từ cấp server (đã có
sẵn cho socket.io). Webhook `POST /livekit/webhook` là NỘI BỘ trong mạng docker
(`http://realtime-gateway:3001/livekit/webhook`), không ra ngoài.

### ufw

Media UDP và RTC/TCP ra thẳng ngoài (WS đã đi qua nginx 443):

```bash
ufw allow 50000:50199/udp   # media
ufw allow 7881/tcp          # RTC qua TCP (dự phòng UDP)
```

> **Lưu ý:** Docker publish cổng chèn iptables riêng, **đi vòng qua ufw** (xem cuối README) —
> nên các cổng livekit publish (`7881`, `50000-50199/udp`) đã ra ngoài ngay khi container chạy.
> Vẫn nên khai báo ufw ở trên cho nhất quán/tài liệu. Cổng `7880` chỉ nghe `127.0.0.1` (qua
> nginx), không cần mở.

### Đổi key/secret

Sinh secret: `openssl rand -hex 32`. Đổi `LIVEKIT_API_SECRET` (và giữ `LIVEKIT_API_KEY=daln`)
trong `backend/.env.production` rồi deploy lại — compose tạo lại cả `livekit` (env `LIVEKIT_KEYS`
đổi) và `realtime-gateway` (đọc cùng biến), hai bên luôn khớp. Token client đang giữ tự hết hạn
(~10 phút).

### Dùng lại coturn làm TURN cho LiveKit (tùy chọn)

Client sau NAT chặt có thể cần TURN để đẩy media lên SFU. Hiện chưa cấu hình (media qua UDP
50000-50199 / TCP 7881 là đủ cho phần lớn mạng). Nếu cần, thêm khối `turn:` vào
`livekit.prod.yaml` trỏ về coturn đang chạy trên host (dùng chung `TURN_SECRET`) — xem tài liệu
LiveKit `rtc.turn_servers`.

### Kiểm tra

```bash
cd /root/workspace/DALN/backend
dc logs -f livekit                              # log server (mục logging: level info)
curl -s http://127.0.0.1:7880/                  # health: trả "OK"
curl -s --resolve nguyen1976.xyz:443:127.0.0.1 \
  https://nguyen1976.xyz/livekit/               # qua nginx (strip /livekit) -> "OK"
ss -lunp | grep -E '5000[0-9]|500[0-9][0-9]'    # đang nghe dải UDP media
```

Từ trình duyệt: mở hội thoại NHÓM, bấm gọi; `chrome://webrtc-internals` phải thấy kết nối tới
`nguyen1976.xyz` (ICE) và candidate `srflx`/`host` của server. Có `livekit-cli` thì
`livekit-cli list-rooms --url wss://nguyen1976.xyz/livekit --api-key daln --api-secret <secret>`
liệt kê phòng đang mở.

## GeoIP — vị trí trên trang "Thiết bị đang đăng nhập"

Service `user` tra vị trí ước tính của IP từ file MaxMind **GeoLite2-City** đặt
ngay trên server, không gọi API ngoài. File không nằm trong git. Thiếu file thì
mọi thứ vẫn chạy; trang chỉ không có vị trí và bản đồ.

```bash
# 1. Máy local: đăng ký tài khoản miễn phí ở maxmind.com → GeoLite → Download
#    Databases → "GeoLite2 City" (GZIP). Giải nén lấy GeoLite2-City.mmdb.
tar -xzf GeoLite2-City_*.tar.gz
ssh root@<SERVER> mkdir -p /root/workspace/DALN/backend/geoip
scp GeoLite2-City_*/GeoLite2-City.mmdb root@<SERVER>:/root/workspace/DALN/backend/geoip/

# 2. Server (alias dc ở mục Vận hành): service chỉ đọc file lúc khởi động.
#    Restart cả kong vì Kong giữ IP upstream cũ trong cache, restart riêng
#    user sẽ nhận 502.
dc restart user kong
dc logs user | grep geoip     # mong thấy "[geoip] đã nạp dữ liệu vị trí"
```

- Đặt file **trước** lần deploy đầu tiên có tính năng này thì bỏ qua bước 2,
  vì deploy đó tạo lại container `user`.
- Cập nhật: MaxMind ra bản mới hằng tuần và điều khoản GeoLite2 yêu cầu dùng
  bản mới. Hiện làm tay bằng cách lặp lại hai bước trên; cron `geoipupdate` là
  việc để sau.
- Dòng ghi công MaxMind và OpenStreetMap đã có sẵn trong panel chi tiết thiết bị.

## Env

- File thật: `/root/workspace/DALN/backend/.env.production` — chỉ nằm trên server (quyền 600),
  không có trong git, CI/CD không đụng tới. Danh sách biến: `backend/.env.production.example`.
- Đổi env: sửa file trên server → Run workflow (hoặc `bash deploy/deploy.sh` ngay trên server).
  Container nào có env đổi sẽ được tạo lại; đổi `VITE_*` thì image web tự build lại.
- `RABBITMQ_DEFAULT_PASS` chỉ áp dụng lúc tạo volume. Đổi về sau phải chạy thêm
  `docker exec daln-prod-rabbitmq rabbitmqctl change_password <user> <pass>`.
- Đổi `JWT_SECRET` thì mọi người bị đăng xuất.

## Vận hành

```bash
cd /root/workspace/DALN/backend
alias dc='docker compose -f docker-compose.prod.yml --env-file .env.production'
dc ps                      # trạng thái các container
dc logs -f chat            # log một service
dc run --rm --no-deps migrate status   # migration đã / chưa chạy
ls -lh /root/backups/mongo # các bản backup Mongo
bash ../deploy/deploy.sh   # deploy tay từ source hiện tại
```

## Setup server lần đầu

```bash
# 1. Swap — build image cần nhiều RAM
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf && sysctl --system

# 2. Firewall — mở 22 trước để không tự khoá mình
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw --force enable

# 3. Source (repo public, không cần key để kéo)
git clone https://github.com/Nguyen1976/DALN.git /root/workspace/DALN

# 4. Env — chép từ máy local lên rồi khoá quyền
#    scp backend/.env.production root@<SERVER>:/root/workspace/DALN/backend/.env.production
chmod 600 /root/workspace/DALN/backend/.env.production

# 5. Forced command cho key deploy
install -m 755 /root/workspace/DALN/deploy/remote-entry.sh /usr/local/bin/daln-deploy
#    rồi thêm public key vào /root/.ssh/authorized_keys theo dạng:
#    restrict,command="/usr/local/bin/daln-deploy" ssh-ed25519 AAAA... github-actions-deploy

# 6. HTTPS — nginx + certbot. Chặn nginx tự khởi động lúc cài: chứng chỉ chưa có thì
#    cấu hình SSL chưa chạy được; deploy kế tiếp sẽ cài cấu hình và bật nginx.
#    policy-rc.d chặn luôn cả certbot.timer, nên phải tự bật timer sau khi cài.
printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d && chmod +x /usr/sbin/policy-rc.d
apt-get install -y nginx certbot; rm -f /usr/sbin/policy-rc.d
systemctl enable --now certbot.timer
rm -f /etc/nginx/sites-enabled/default && install -d -m 755 /var/www/certbot
#    Lấy chứng chỉ bằng standalone (cần cổng 80 trống: nếu container web của bản cũ
#    còn giữ cổng 80 thì `docker stop daln-prod-web` trước, `docker start` lại sau).
certbot certonly --standalone -d nguyen1976.xyz -d www.nguyen1976.xyz \
  --non-interactive --agree-tos --register-unsafely-without-email
#    Sau khi deploy xong (nginx đã chạy): gia hạn qua webroot, xong thì reload nginx.
#    reconfigure chạy thử gia hạn trước và không lưu gì nếu lần thử lỗi (vd DNS SERVFAIL).
#    Khi đó sửa tay /etc/letsencrypt/renewal/nguyen1976.xyz.conf: đổi dòng authenticator
#    thành `authenticator = webroot` + `webroot_path = /var/www/certbot,`, cuối file thêm
#    `[[webroot_map]]` và `nguyen1976.xyz = /var/www/certbot`.
certbot reconfigure --cert-name nguyen1976.xyz --webroot -w /var/www/certbot
install -d /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\nsystemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx
```

Docker publish cổng đi vòng qua ufw, nên compose chỉ publish lên `127.0.0.1` (web 8081,
Kong 8000, MinIO 9000); ra ngoài chỉ có nginx (80/443).

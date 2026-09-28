# Deploy production

Toàn bộ ứng dụng (FE + BE + hạ tầng) chạy trên **một server** bằng Docker Compose:
`backend/docker-compose.prod.yml` (project `daln-prod`). Source nằm ở `/root/workspace/DALN`.

Ra ngoài chỉ có **nginx trên host**: cổng 80 (chuyển sang HTTPS) và 443, domain
`https://nguyen1976.xyz` — xem mục [HTTPS](#https-nginx--certbot). DNS nằm ở Cloudflare và
domain đi qua proxy Cloudflare — xem mục [Cloudflare](#cloudflare).

| Đường dẫn | Chuyển tới (các cổng này chỉ nghe 127.0.0.1) |
|---|---|
| `/` | web — nginx trong container phục vụ bản build Vite (`8081`) |
| `/api/` | Kong — API, bỏ tiền tố `/api` (`8000`) |
| `/socket.io/` | Kong — socket, namespace `/realtime` (`8000`) |
| `/daln-media/` | MinIO — ảnh/tệp: GET công khai, PUT bằng URL ký sẵn (`9000`) |

Mongo, Redis, RabbitMQ, Qdrant, Kong admin và các cổng 3001–3005 **không** mở ra ngoài.

## Luồng CI/CD — `.github/workflows/ci-cd.yml`

- **PR vào `main`**: kiểm tra BE (typecheck + unit test) và FE (lint + build).
- **Merge vào `main`**: kiểm tra và build 8 image chạy cùng lúc (image đẩy lên GHCR theo tag
  SHA) → cả hai xanh thì Actions SSH vào server bằng key deploy → server kéo đúng commit đó
  (`deploy/remote-entry.sh`) → `deploy/deploy.sh` pull image, chạy, smoke check.
- **Merge chỉ đổi tài liệu** (`docs/**`, `*.md`): không chạy gì, không deploy.
- **Run workflow** (tab Actions): để trống = deploy lại HEAD của `main`; điền SHA đủ 40 ký tự
  của một commit cũ trên `main` = rollback. Chỉ chọn commit có lượt CI xanh — commit test đỏ
  vẫn có image trên GHCR (build chạy song song với test) nhưng chưa từng được kiểm.

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

CI build đủ 8 image cho mỗi commit (song song, có cache) và build **tái lập được**
(`SOURCE_DATE_EPOCH=0` + `rewrite-timestamp`): cùng input ra cùng image. Mỗi image có
biến tag riêng trong compose (`DALN_TAG_USER`, `DALN_TAG_DB_PUSH`, …).
`deploy.sh` so nội dung image mới với image container đang chạy
(`deploy/lib/image-tags.sh`): giống hệt thì giữ tag cũ, nên `up -d` không đụng tới
container đó.

| Sửa ở đâu | Container bị tạo lại |
|---|---|
| `backend/apps/<svc>/` | chỉ `<svc>`; restart Kong nếu `<svc>` nằm sau Kong |
| `backend/apps/*/prisma/` | như trên, cộng db-push đồng bộ index |
| `backend/migrations/` | chỉ `db-push`/`migrate`; có migration chờ thì backup Mongo + chạy migrate trước khi đụng tới app |
| `backend/libs/<lib>/` | chỉ các service có bundle chứa đúng file vừa sửa. Barrel `@app/common`, `@app/util` kéo cả lib vào bundle |
| `backend/docker/`, `package*.json`, `tsconfig*.json`, `nest-cli.json`, `Dockerfile` | thường là cả 6 service backend |
| `frontend/` | chỉ `web`, API không gián đoạn |
| `backend/kong/kong.yml` | chỉ Kong |
| docs, `backend/scripts/`, `deploy/` | không container nào |

Cuối log deploy có bảng tóm tắt:
- `Image mới` là các image thật sự đổi;
- `Giữ nguyên` là các image giữ tag cũ, kèm 7 ký tự đầu của tag;
- sau đó là container được tạo lại, Kong, migration, backup, dead-letter, thời gian.

Lần deploy đầu tiên sau khi bật build tái lập, mọi image khác một lần.

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
- Chứng chỉ gồm `nguyen1976.xyz` và `www.nguyen1976.xyz` (thêm `www` ngày 2026-09-27, sau khi
  chuyển DNS sang Cloudflare). Challenge `/.well-known/acme-challenge/` được phục vụ ở cả cổng
  80 lẫn các khối 443, vì Cloudflare có thể đẩy challenge sang https trước khi tới server.
- `http://` và truy cập bằng IP đều chuyển sang `https://nguyen1976.xyz`.

```bash
certbot certificates                 # hạn chứng chỉ
certbot renew --dry-run              # thử gia hạn, không đổi gì
nginx -t && systemctl reload nginx   # nạp lại tay
tail -f /var/log/nginx/error.log
```

## Cloudflare

- Nameserver của domain (đặt ở Mắt Bão) là `adaline.ns.cloudflare.com` + `jaziel.ns.cloudflare.com`;
  mọi bản ghi DNS sửa trên Cloudflare, bản ghi còn lại ở Mắt Bão không còn tác dụng.
- `@` và `www` là bản ghi A tới IP server, bật **proxy (đám mây cam)**; SSL/TLS mode
  **Full (strict)** — Cloudflare nói chuyện với server bằng https và kiểm tra chứng chỉ Let's
  Encrypt ở trên. Đừng để Flexible: nginx sẽ chuyển http sang https mãi (redirect loop).
- Qua proxy, server thấy IP của Cloudflare. `daln.conf` khôi phục IP thật từ header
  `CF-Connecting-IP` (`set_real_ip_from` + `real_ip_header`), chỉ khi kết nối tới từ dải IP
  Cloudflare, và ghi đè `X-Forwarded-For` bằng IP đó. Kong và service không phải đổi gì
  (`trust proxy 2`). Dải IP Cloudflare hiếm khi đổi; khi đổi, cập nhật theo
  <https://www.cloudflare.com/ips-v4> và `/ips-v6`, nếu không phiên đăng nhập sẽ ghi IP Cloudflare.
- Proxy chỉ chuyển HTTP/HTTPS/WebSocket. Media gọi thoại/video không qua server: nó đi
  giữa trình duyệt và hạ tầng RealtimeKit của Cloudflare (mục dưới). Gói Free giới hạn **100 MB** mỗi request (khớp
  `client_max_body_size`) và server phải trả lời trong 100 giây.
- Tắt proxy (đám mây xám) vẫn chạy bình thường, chỉ mất cache ở gần người dùng.

## RealtimeKit — cuộc gọi thoại/video

Mọi cuộc gọi (1-1 và nhóm) chạy trên Cloudflare RealtimeKit; server chỉ cấp
quyền vào phòng qua REST API và nhận webhook — server không chuyển tiếp media và không
mở cổng UDP nào cho cuộc gọi. (Coturn và LiveKit tự host đã gỡ khỏi repo và server từ
2026-09-28.)

- Env trên server (`.env.production`): `REALTIMEKIT_ACCOUNT_ID`, `REALTIMEKIT_APP_ID`
  (app `daln-prod`), `REALTIMEKIT_API_TOKEN` (quyền Realtime Admin).
- Preset (`daln_direct_audio|video`, `daln_group_audio|video`) và webhook tạo/cập nhật
  bằng script, chạy từ máy dev, token prod stream qua SSH (không ghi ra máy):

  ```bash
  ssh root@<server> "grep '^REALTIMEKIT_' /root/workspace/DALN/backend/.env.production" \
    | (cd backend && npm run rtk:setup -- --env-stdin --webhook-url https://nguyen1976.xyz/api/realtime/rtk-webhook)
  ```

- Webhook đi vào `https://nguyen1976.xyz/api/realtime/rtk-webhook` (nginx → Kong
  `/realtime` → gateway), xác thực chữ ký RSA. Nếu sau này bật Bot Fight Mode / WAF
  trên Cloudflare, **bỏ qua đường dẫn này**, nếu không danh sách người trong cuộc
  gọi nhóm sẽ không cập nhật.
- Dev: `npm run rtk:dev-tunnel` (backend) mở tunnel tạm và trỏ webhook của app
  `daln-dev` vào gateway dev. URL đổi mỗi lần tunnel khởi động lại.
- QC: `qc/calls-browser.mjs` (xem qc/README.md).

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
- Dòng ghi công MaxMind và Esri (nguồn tile bản đồ) đã có sẵn trong panel chi tiết thiết bị.

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

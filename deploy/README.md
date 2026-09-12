# Deploy production

Toàn bộ ứng dụng (FE + BE + hạ tầng) chạy trên **một server** bằng Docker Compose:
`backend/docker-compose.prod.yml` (project `daln-prod`). Source nằm ở `/root/workspace/DALN`.

| Cổng | Dịch vụ |
|---|---|
| 80 | web (nginx phục vụ bản build Vite) |
| 8000 | Kong — API + socket (`/realtime`, `/socket.io`) |
| 9000 | MinIO — ảnh/tệp (GET công khai, PUT bằng URL ký sẵn) |

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

## Deploy chỉ làm lại phần có thay đổi

| Sửa ở đâu | Deploy làm gì |
|---|---|
| `backend/apps/<svc>/` | build + tạo lại đúng `<svc>`; restart Kong nếu `<svc>` nằm sau Kong |
| `backend/apps/*/prisma/` | như trên, cộng db-push đồng bộ index |
| `backend/libs/`, `backend/docker/`, `package*.json`, `tsconfig*.json`, `nest-cli.json`, `Dockerfile` | build lại cả 6 service backend; chỉ service ra image khác mới bị tạo lại |
| `frontend/` | chỉ build + tạo lại `web`, API không gián đoạn |
| `backend/kong/kong.yml` | chỉ tạo lại Kong |
| docs, `backend/scripts/`, `deploy/` | không build lại gì |

Cuối log deploy có bảng tóm tắt: image nào mới, container nào được tạo lại, Kong có
restart không, tổng thời gian. Lần đầu sau khi sửa `Dockerfile` thì build lại tất cả.

Chạy tay `dc up -d` (không qua `deploy.sh`) thì Kong bị tạo lại một lần, vì label
`daln.kong-config` thành `manual`. Vô hại.

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
bash ../deploy/deploy.sh   # deploy tay từ source hiện tại
```

## Setup server lần đầu

```bash
# 1. Swap — build image cần nhiều RAM
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf && sysctl --system

# 2. Firewall — mở 22 trước để không tự khoá mình
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 8000/tcp && ufw allow 9000/tcp
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
```

Docker publish cổng đi vòng qua ufw, nên compose chỉ publish đúng 3 cổng ở bảng trên.

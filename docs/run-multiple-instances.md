# Chạy nhiều instance chat / realtime-gateway ở local

Mặc định `docker compose up -d` (trong `backend/`) chạy **1 instance chat** (`daln-chat`) và **1 instance realtime-gateway** (`daln-realtime`). Đủ cho phát triển hằng ngày, nhẹ máy.

Muốn thử hệ thống khi có nhiều instance (chia partition, gateway chết, client nối lại…) thì bật thêm bản sao theo hướng dẫn dưới đây. Không cần sửa code hay `kong.yml`.

## Cơ chế, ngắn gọn

- Các bản sao `chat-2`, `chat-3`, `realtime-gateway-2`, `realtime-gateway-3` đã khai sẵn trong `backend/docker-compose.yml`, gắn **profile `scale`**, nên `docker compose up` thường không bật chúng.
- Mỗi bản sao có alias mạng trùng tên service gốc (`chat`, `realtime-gateway`). DNS của Docker trả về mọi địa chỉ, Kong tự chia tải (`KONG_DNS_VALID_TTL: 5`).
- Chat chia 16 partition qua Redis: instance mới tự nhận phần của mình, instance tắt thì phần của nó chuyển sang instance còn lại. Gateway chia sẻ room và presence qua Redis adapter.
- Bản sao không mở cổng ra host. Cổng 3003 (chat) và 3001 (gateway) trên host luôn trỏ vào instance gốc.

## Bật thêm instance

Tất cả cùng lúc (chat ×3, gateway ×3):

```bash
cd backend
docker compose --profile scale up -d
```

Chỉ một vài bản sao: gọi đích danh service. Gọi tên thì Compose tự bật profile của service đó.

```bash
docker compose up -d chat-2                       # 2 chat, 1 gateway
docker compose up -d realtime-gateway-2           # 1 chat, 2 gateway
docker compose up -d chat-2 realtime-gateway-2    # 2 + 2
```

### Nhiều hơn 3

Tạo `backend/docker-compose.override.yml` (Compose tự đọc file này):

```yaml
services:
  chat-4:
    extends:
      file: docker-compose.yml
      service: chat-2
    container_name: daln-chat-4
  realtime-gateway-4:
    extends:
      file: docker-compose.yml
      service: realtime-gateway-2
    container_name: daln-realtime-4
```

Bản sao mới thừa hưởng profile `scale`, alias và biến môi trường của `chat-2` / `realtime-gateway-2`. Bật bằng `docker compose up -d chat-4`. Mỗi instance là một tiến trình NestJS có hot-reload (khoảng vài trăm MB RAM), nên đừng bật quá sức máy.

## Kiểm tra đang chạy bao nhiêu

```bash
docker ps --format '{{.Names}}' | grep -E 'chat|realtime'

# Kong thấy bao nhiêu địa chỉ
docker exec daln-kong getent hosts realtime-gateway chat

# Ai giữ partition nào: 16 dòng, đếm theo instance
for p in $(seq 0 15); do docker exec daln-redis redis-cli GET chat:lease:p$p; done | sort | uniq -c
```

Với 2 chat, mỗi instance giữ khoảng 8 partition. Giá trị là `<hostname container>-<id ngẫu nhiên>`, và `docker exec daln-chat hostname` cho biết hostname của từng container. Gateway in `socket connected user=... node=<hostname>` trong log, nên `docker logs daln-realtime-2` cho biết socket nào rơi vào đâu.

## Thu về 1 instance (mặc định)

```bash
cd backend
docker compose --profile scale rm -sf chat-2 chat-3 realtime-gateway-2 realtime-gateway-3
```

`rm -s` dừng êm trước khi xoá: chat xả các tin đang xử lý và trả partition. Sau vài giây `daln-chat` giữ đủ 16/16 partition. Kiểm bằng vòng lặp ở trên.

Lưu ý:

- **Chờ khoảng 10 giây** sau khi thêm hoặc bớt instance rồi mới thử. Ngay sau khi xoá bản sao, mình từng thấy tin realtime chưa tới trình duyệt ở lần thử đầu; các lần sau đều đúng. Tab đang mở thì tự nối lại; nếu nghi ngờ thì tải lại trang.
- `docker compose down` **không** dừng container thuộc profile `scale`. Muốn dừng cả chúng thì dùng `docker compose --profile scale down`.
- Nếu có `docker-compose.override.yml`, xoá thêm `chat-4` (và các bản sao khác) theo cùng cách.

## Script QC cần nhiều instance

| Script | Cần |
|---|---|
| `qc/chat-scale-load.mjs`, `qc/chat-scale-browser.mjs` | `--profile scale` (dùng `daln-chat-2`, kill/stop gateway) |
| `qc/seq-concurrency-load.mjs` (B17) | Chạy được với 1 chat; có 2 chat thì mới thử được hai instance cùng cấp `seq` |
| `qc/query-regression-browser.mjs`, `qc/query-profile.mjs` | Chạy với 1 instance là đủ |

Chi tiết thiết kế: `docs/superpowers/specs/2026-10-31-chat-scale-out-design.md`; danh sách kịch bản tải: `qc/README.md`.

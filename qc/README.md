# QC xác thực

Hai bộ kiểm chạy tay, dùng khi sửa bất cứ thứ gì trong luồng đăng nhập / phiên /
thu hồi. Chúng đo trên hệ thống đang chạy thật, nên bắt được những thứ unit test
không thấy — ví dụ lệnh Redis treo vô hạn thay vì lỗi, hay trình duyệt tự xoá
cookie access đúng lúc token hết hạn.

## Chuẩn bị

```bash
cd backend && docker compose up -d      # backend + Redis + Kong
cd frontend && npm run dev              # phải là cổng Kong cho phép: 5173/5174
cd qc && npm install                    # chỉ cần cho bộ browser
cp backend/apps/user/src/geoip/__fixtures__/GeoIP2-City-Test.mmdb backend/geoip/GeoLite2-City.mmdb  # cho session-location (tạo backend/geoip trước), rồi docker restart daln-user daln-kong
```

## Chạy

```bash
./auth-api.sh                    # 20 nhóm, ~92 phép kiểm, không cần trình duyệt
node auth-browser.mjs            # 8 nhóm trên Chrome thật, ảnh lưu ở shots/
node change-password-browser.mjs # 7 nhóm cho hộp thoại đổi mật khẩu
node session-location-browser.mjs # 13 nhóm: IP, vị trí, bản đồ mini, hai mốc thời gian, IPv6 dài
```

Ghi đè được bằng biến môi trường: `API`, `DIRECT`, `APP`, `CHROME_PATH`,
`REDIS_CONTAINER`.

## Những gì bộ QC phủ

| Nhóm | Nội dung |
|---|---|
| Phiên | đăng nhập, path của hai cookie, rotate, cửa sổ ân hạn 30s, replay giết cả phiên |
| Thu hồi | logout, logout mọi nơi, thu hồi theo thiết bị, IDOR giữa hai người dùng |
| Hạ tầng | Redis chết → 503 chứ không 401, và không treo |
| Chống lạm dụng | hạn mức theo IP, khoá tài khoản sau 10 lần sai, OTP hết lượt thử |
| Đầu vào | chính sách mật khẩu (8–64 ký tự, trần 72 byte), OTP chỉ chữ số |
| Hardening | header bảo mật, CORS không phản chiếu Origin lạ |
| Đổi mật khẩu | hai đường xác thực (mật khẩu cũ / OTP), mã dùng một lần, khe gửi lại 60s, tuỳ chọn đá thiết bị khác |
| Trình duyệt | làm mới ngầm ở mốc 15 phút, socket bị ngắt khi thu hồi, UI danh sách thiết bị, hộp thoại đổi mật khẩu |
| Vị trí phiên | IP lúc đăng nhập và IP gần nhất, vị trí GeoIP (DB kiểm thử của MaxMind), bản đồ mini + link Maps, tile lỗi, API cũ trong lúc deploy, 375px + dark mode |

## Hai cái bẫy đã gặp, để không mất thời gian lại

- **Harness tự chặn mình.** Bộ QC gọi đăng nhập nhiều hơn hạn mức thật, nên nó
  tự dọn key `rl:*` trước mỗi nhóm; hạn mức được kiểm riêng ở nhóm cuối.
- **Đừng tin phép đo trước khi tin code.** Ba lần QC báo đỏ thì hai lần là do
  chính phép đo sai: `curl -c` ghi ra jar *mọi* cookie nó đang biết chứ không
  riêng cookie mới, và `page.cookies(url)` lọc theo path nên bỏ sót cookie
  `Path=/user`. Cả hai làm code trông như có bug.

## Cuộc gọi (RealtimeKit)

```bash
node qc/calls-browser.mjs            # dev: tự tạo 3 tài khoản, kết bạn, nhóm
ONLY=direct node qc/calls-browser.mjs
```

Cần: stack dev chạy, Vite ở 5174, `npm run rtk:dev-tunnel` (backend) đã chạy để
webhook tới được gateway, Chrome. Prod: `APP`, `API` trỏ domain thật và
`QC_ACCOUNTS_FILE` là file JSON `{accounts:[{email,password}×3], directId, groupId, groupName}`
(gitignore, không commit).

## Scale-out: nhiều instance chat và nhiều gateway

Spec: `docs/superpowers/specs/2026-10-31-chat-scale-out-design.md`.

```bash
cd backend && docker compose --profile scale up -d   # + chat-2, chat-3, realtime-gateway-2, -3
cd qc && npm install
node chat-scale-load.mjs                     # 7 kịch bản tải, mỗi kịch bản một dòng PASS/FAIL
SCENARIO=crash-chat node chat-scale-load.mjs # một kịch bản
CHECK_ONLY=<runId> node chat-scale-load.mjs  # chạy lại checker trên một lần chạy đã lưu (.scale-runs/)
node chat-scale-browser.mjs                  # trình duyệt thật, ảnh ở shots/scale-*.png
```

| Kịch bản | Sự kiện ở giây 12 | Đạt khi |
|---|---|---|
| `steady` | không có | 0 mất · 0 trùng · 0 đảo |
| `crash-chat` | `docker kill daln-chat-2` | như trên, partition của nó có chủ mới ≤ 10s |
| `stop-chat` | `docker stop daln-chat-2` | như trên, mỗi partition dừng < 1s |
| `add-chat` | bật `chat-3` (`up -d --no-deps`) | như trên, chỉ partition `stickyAssign` chọn mới đổi chủ |
| `kill-gateway` | `docker kill daln-realtime-2` | như trên, client nối lại và gửi lại tin chưa ACK |
| `overload` | memory alarm của RabbitMQ chặn publisher 8s | có `SERVER_BUSY`, sau đó 0 mất · 0 trùng · 0 đảo |
| `queue-full` | `docker pause` cả hai chat + policy `max-length` = 1 trong 12s | broker từ chối (reject-publish) → `SERVER_BUSY`, sau đó 0 mất · 0 trùng · 0 đảo |

Checker đọc thẳng Mongo. **Mất** = đã nhận ACK mà không có trong DB. **Trùng** =
một `clientMessageId` có hơn một bản ghi. **Đảo** = trong cùng (hội thoại, người
gửi), `seq` giảm khi xếp theo `(createdAt, _id)`. Tin từng bị `SERVER_BUSY` được
client gửi lại nên được phép đứng sau, và không tính vào "đảo".

Script tự dọn key `rl:*` trước khi tạo tài khoản (đăng ký bị giới hạn theo IP),
và tự bật/tắt container cho đúng trạng thái đầu của từng kịch bản.

Đối chứng (chứng minh từng cơ chế có tác dụng). Hai công tắc tắt làn / tắt chặn
trùng KHÔNG nằm trong code production; chúng ở dạng patch, chỉ áp khi chạy đối chứng:

```bash
git apply qc/controls/qc-switches.patch          # thêm CHAT_QC_DISABLE_LANES / _DEDUP
cd backend && CHAT_QC_DISABLE_LANES=1 docker compose --profile scale up -d --no-deps chat chat-2 chat-3
cd ../qc && SCENARIO=steady node chat-scale-load.mjs   # kỳ vọng reorder > 0 (cần tin có ảnh, MEDIA_RATIO mặc định 0.15)
git apply -R qc/controls/qc-switches.patch       # gỡ ra, dựng lại chat như bình thường
```

Kết quả đã đo (2026-11-01): tắt làn → `reorder=116`; bật lại → 0. Tắt chặn trùng
+ `crash-chat` ×5 → chưa lần nào tái hiện được tin nhân bản (khe ghi → ack chỉ vài ms).

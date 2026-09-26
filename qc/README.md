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
node session-location-browser.mjs # 12 nhóm: IP, vị trí, bản đồ mini, hai mốc thời gian
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

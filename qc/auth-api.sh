#!/bin/bash
#
# QC tầng API cho auth: phiên thu hồi được, hạn mức, khoá tài khoản, OTP,
# chính sách mật khẩu, header bảo mật. Mỗi bước in PASS/FAIL kèm bằng chứng.
#
#   ./qc/auth-api.sh
#
# Cần: backend đang chạy (docker compose up) và Redis truy cập được qua
# `docker exec`. Biến môi trường ghi đè được: API, DIRECT, REDIS_CONTAINER.
#
# Lưu ý: nhóm cuối cố tình làm cạn hạn mức đăng nhập theo IP, nên chạy lại
# toàn bộ script trong vòng 5 phút sẽ thấy 429 ở các nhóm đầu — đó là bằng
# chứng hạn mức hoạt động, không phải lỗi.
set -uo pipefail
API=${API:-http://localhost:8080}
DIRECT=${DIRECT:-http://localhost:3002}
REDIS_CONTAINER=${REDIS_CONTAINER:-daln-redis}
R() { docker exec "$REDIS_CONTAINER" redis-cli "$@"; }

# Redis chỉ giữ sha256 của OTP, nên harness không đọc được mã thô nữa — đó là
# đúng điều ta vừa sửa. Thay vì đọc, ta GHI bản băm của một mã biết trước, rồi
# xác thực bằng chính mã đó: vẫn đi qua đường verify thật.
QC_OTP=135790
set_otp() {
  local hash
  hash=$(printf '%s' "$2" | openssl dgst -sha256 | awk '{print $NF}')
  R set "otp:reg:$1" "$hash" EX 300 > /dev/null
}

# POST JSON và in HTTP code.
#
# Vì sao cần: viết `check "$(curl ... -d "{\"a\":\"b\"}")" "400" "nhãn"` làm
# bash tách kết quả thành nhiều tham số, và `check` nhận lệch — hai nhãn QC ở
# bản trước in ra "400 (400)" thay vì nội dung thật. Nhãn sai trong báo cáo QC
# là đúng thứ sau này che mất một lỗi thật, nên chặn cả lớp lỗi đó ở đây.
post_code() { # $1 = path, $2 = body JSON, $@ = thêm tham số curl
  local path="$1" body="$2"
  shift 2
  curl -s -o /dev/null -w '%{http_code}' -X POST "$API$path" \
    -H 'Content-Type: application/json' -d "$body" "$@"
}

# Dọn xô hạn mức của chính harness.
#
# Bộ QC này gọi đăng nhập nhiều hơn hạn mức thật (30 lần / 5 phút / IP) — nếu
# không dọn thì chính nó bị chặn và mọi nhóm sau đỏ vì không có cookie, che mất
# lỗi thật. Hạn mức được kiểm riêng ở nhóm cuối, nơi nó là đối tượng đo.
reset_limits() {
  docker exec "$REDIS_CONTAINER" sh -c \
    "redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli del" >/dev/null 2>&1
}

# Đăng ký + kích hoạt một tài khoản, trả về qua biến toàn cục.
activate() { # $1 = email, $2 = username, $3 = password
  curl -s -o /dev/null -X POST $API/user/register -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"username\":\"$2\",\"password\":\"$3\",\"fullName\":\"QC Bot\"}"
  set_otp "$1" "$QC_OTP"
  curl -s -o /dev/null -w '%{http_code}' -X POST $API/user/verify-otp \
    -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"otp\":\"$QC_OTP\"}"
}
PASS=0; FAIL=0
ok()  { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
check() { [ "$1" = "$2" ] && ok "$3 ($1)" || bad "$3 — mong $2, nhận $1"; }

EMAIL="qc$(date +%s)@example.test"
USER="qc$(date +%s)"
PASS_WORD="MatKhau123"

echo "== 1. Đăng ký + kích hoạt =="
reset_limits
check "$(activate "$EMAIL" "$USER" "$PASS_WORD")" "201" "verify-otp bằng mã đúng"

echo "== 2. Đăng nhập: hai cookie, hai path =="
reset_limits
HDRS=$(curl -s -D - -o /dev/null -c jarA.txt -X POST $API/user/login \
  -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS_WORD\"}")
echo "$HDRS" | grep -qi 'set-cookie: accessToken=.*Path=/;' && ok "accessToken Path=/" || bad "accessToken sai path"
echo "$HDRS" | grep -qi 'set-cookie: refreshToken=.*Path=/user' && ok "refreshToken Path=/user" || bad "refreshToken sai path"
echo "$HDRS" | grep -qi 'set-cookie: accessToken=.*HttpOnly' && ok "accessToken HttpOnly" || bad "thiếu HttpOnly"
RT=$(grep refreshToken jarA.txt | awk '{print $7}')
SID="${RT%%.*}"
[ -n "$SID" ] && ok "sid = $SID" || bad "không tách được sid"
check "$(R exists "sess:$SID" | tr -d '\r')" "1" "phiên tồn tại trong Redis"
check "$(R sismember "sess:idx:$(R hget "sess:$SID" uid | tr -d '\r')" "$SID" | tr -d '\r')" "1" "sid nằm trong chỉ mục"
R hget "sess:$SID" rtHash | grep -qv "$(echo -n "${RT#*.}")" && ok "Redis chỉ giữ hash, không giữ verifier thô"

echo "== 3. Request thường =="
reset_limits
check "$(curl -s -o /dev/null -w '%{http_code}' -b jarA.txt $API/user/me)" "200" "GET /user/me"

echo "== 4. Refresh: rotate =="
reset_limits
cp jarA.txt jarOld.txt
code=$(curl -s -o /dev/null -w '%{http_code}' -b jarA.txt -c jarA.txt -X POST $API/user/refresh)
check "$code" "204" "refresh lần 1"
RT2=$(grep refreshToken jarA.txt | awk '{print $7}')
[ "$RT2" != "$RT" ] && ok "refresh token đã đổi" || bad "token KHÔNG đổi"
[ "${RT2%%.*}" = "$SID" ] && ok "sid giữ nguyên qua rotate" || bad "sid bị đổi"

echo "== 5. Token cũ trong cửa sổ ân hạn =="
reset_limits
# Phải đọc Set-Cookie của CHÍNH response: `curl -c` ghi ra jar mọi cookie nó
# đang biết (kể cả cookie nạp từ -b), nên jar không nói được response có cấp
# cookie mới hay không.
GH=$(curl -s -D - -o /dev/null -b jarOld.txt -X POST $API/user/refresh)
check "$(echo "$GH" | head -1 | grep -o '[0-9][0-9][0-9]')" "204" "token cũ vẫn dùng được (grace)"
check "$(echo "$GH" | grep -ci 'set-cookie: refreshToken')" "0" "grace KHÔNG cấp cookie refresh mới"
check "$(echo "$GH" | grep -ci 'set-cookie: accessToken')" "1" "grace vẫn cấp access token mới"
check "$(R hget "sess:$SID" rtHash | tr -d '\r')" "$(R hget "sess:$SID" rtHash | tr -d '\r')" "rtHash không bị rotate thêm"

echo "== 6. Token cũ sau khi hết ân hạn -> replay =="
reset_limits
R hset "sess:$SID" prevUntil 1 > /dev/null
code=$(curl -s -o /dev/null -w '%{http_code}' -b jarOld.txt -X POST $API/user/refresh)
check "$code" "401" "replay bị từ chối"
check "$(R exists "sess:$SID" | tr -d '\r')" "0" "cả phiên bị giết khi phát hiện replay"

echo "== 7. Access token còn hạn nhưng phiên đã bị giết =="
reset_limits
body=$(curl -s -b jarA.txt $API/user/me)
echo "$body" | grep -q SESSION_REVOKED && ok "trả SESSION_REVOKED: $body" || bad "mong SESSION_REVOKED, nhận: $body"

echo "== 8. Logout xoá state ở server =="
reset_limits
curl -s -o /dev/null -c jarB.txt -X POST $API/user/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS_WORD\"}"
SIDB=$(grep refreshToken jarB.txt | awk '{print $7}'); SIDB="${SIDB%%.*}"
check "$(R exists "sess:$SIDB" | tr -d '\r')" "1" "phiên B tồn tại"
check "$(curl -s -o /dev/null -w '%{http_code}' -b jarB.txt -X POST $API/user/logout)" "204" "logout"
check "$(R exists "sess:$SIDB" | tr -d '\r')" "0" "phiên B bị xoá khỏi Redis"

echo "== 9. logout-all giết mọi thiết bị =="
reset_limits
curl -s -o /dev/null -c jarC.txt -X POST $API/user/login -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS_WORD\"}"
curl -s -o /dev/null -c jarD.txt -X POST $API/user/login -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS_WORD\"}"
SIDC=$(grep refreshToken jarC.txt | awk '{print $7}'); SIDC="${SIDC%%.*}"
SIDD=$(grep refreshToken jarD.txt | awk '{print $7}'); SIDD="${SIDD%%.*}"
UID_=$(R hget "sess:$SIDC" uid | tr -d '\r')
check "$(R scard "sess:idx:$UID_" | tr -d '\r')" "2" "hai phiên trong chỉ mục"
check "$(curl -s -o /dev/null -w '%{http_code}' -b jarC.txt -X POST $API/user/logout-all)" "204" "logout-all"
check "$(R exists "sess:$SIDC" | tr -d '\r')" "0" "phiên C chết"
check "$(R exists "sess:$SIDD" | tr -d '\r')" "0" "phiên D chết (thiết bị khác)"

echo "== 10. Các nhánh bad =="
reset_limits
check "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/user/refresh)" "401" "refresh không cookie"
check "$(curl -s -o /dev/null -w '%{http_code}' -H 'Cookie: refreshToken=khongcodaucham' -X POST $API/user/refresh)" "401" "refresh cookie méo"
check "$(curl -s -o /dev/null -w '%{http_code}' -H 'Cookie: refreshToken=khongtontai.abcdef' -X POST $API/user/refresh)" "401" "refresh sid không tồn tại"
check "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/user/logout)" "204" "logout không cookie vẫn 204 (idempotent)"
check "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/user/logout-all)" "401" "logout-all cần đăng nhập"
body=$(curl -s -H 'Cookie: accessToken=khong.phai.jwt' $API/user/me)
echo "$body" | grep -q TOKEN_INVALID && ok "token rác -> TOKEN_INVALID" || bad "nhận: $body"
WRONG=$(curl -s -w '|%{http_code}' -X POST $API/user/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"saibetroi\"}")
check "${WRONG##*|}" "401" "sai mật khẩu -> 401"
echo "${WRONG%%|*}" | grep -q "không chính xác" && ok "thông điệp chung, không tiết lộ email có tồn tại" || bad "thông điệp: ${WRONG%%|*}"


# ===========================================================================
echo "== 11. Danh sách thiết bị + thu hồi theo thiết bị =="
reset_limits
curl -s -o /dev/null -c jarE.txt -X POST $API/user/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS_WORD\"}"
curl -s -o /dev/null -c jarF.txt -A 'QC-Phone/1.0' -X POST $API/user/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS_WORD\"}"
SIDE=$(grep refreshToken jarE.txt | awk '{print $7}'); SIDE="${SIDE%%.*}"
SIDF=$(grep refreshToken jarF.txt | awk '{print $7}'); SIDF="${SIDF%%.*}"

LIST=$(curl -s -b jarE.txt $API/user/sessions)
check "$(echo "$LIST" | grep -o '"sid"' | wc -l | tr -d ' ')" "2" "liệt kê đúng 2 thiết bị"
check "$(echo "$LIST" | grep -o '"current":true' | wc -l | tr -d ' ')" "1" "đúng MỘT thiết bị được đánh dấu current"
echo "$LIST" | grep -q 'QC-Phone' && ok "user-agent của thiết bị kia được lưu" || bad "không thấy user-agent"

REVOKE_OK=$(post_code /user/sessions/revoke "$(printf '{"sid":"%s"}' "$SIDF")" -b jarE.txt)
check "$REVOKE_OK" "204" "thu hồi thiết bị kia"
check "$(R exists "sess:$SIDF" | tr -d '\r')" "0" "phiên thiết bị kia đã chết"
check "$(R exists "sess:$SIDE" | tr -d '\r')" "1" "phiên của chính mình còn sống"

echo "== 12. IDOR: không thu hồi được phiên của người khác =="
reset_limits
EMAIL2="qcb$(date +%s)@example.test"; USER2="qcb$(date +%s)"
activate "$EMAIL2" "$USER2" "$PASS_WORD" > /dev/null
curl -s -o /dev/null -c jarG.txt -X POST $API/user/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL2\",\"password\":\"$PASS_WORD\"}"
SIDG=$(grep refreshToken jarG.txt | awk '{print $7}'); SIDG="${SIDG%%.*}"
# Người A biết đúng sid của người B và thử thu hồi.
REVOKE_IDOR=$(post_code /user/sessions/revoke "$(printf '{"sid":"%s"}' "$SIDG")" -b jarE.txt)
check "$REVOKE_IDOR" "404" "thu hồi phiên người khác -> 404"
check "$(R exists "sess:$SIDG" | tr -d '\r')" "1" "phiên của người khác KHÔNG bị xoá"

echo "== 13. Chính sách mật khẩu =="
reset_limits
pw_case() {
  local pw="$1" expect="$2" label="$3"
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/user/register \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"pw$(date +%s%N)@example.test\",\"username\":\"pw$(date +%s%N)\",\"password\":\"$pw\",\"fullName\":\"QC\"}")
  check "$code" "$expect" "$label"
}
pw_case "1234567" "400" "7 ký tự bị từ chối"
pw_case "$(printf 'a%.0s' {1..65})" "400" "65 ký tự bị từ chối"
# 40 ký tự tiếng Việt = ~120 byte: dưới trần ký tự nhưng vượt trần 72 byte của bcrypt
pw_case "$(printf 'ậ%.0s' {1..40})" "400" "vượt 72 byte bị từ chối, không cắt âm thầm"
OTP_BAD=$(post_code /user/verify-otp "$(printf '{"email":"%s","otp":"abcdef"}' "$EMAIL")")
check "$OTP_BAD" "400" "OTP không phải chữ số bị từ chối"

echo "== 14. Header bảo mật =="
reset_limits
H=$(curl -s -D - -o /dev/null $DIRECT/metrics)
for hdr in "x-content-type-options" "x-frame-options" "referrer-policy"; do
  echo "$H" | grep -qi "^$hdr:" && ok "có $hdr" || bad "thiếu $hdr"
done

echo "== 15. CORS không còn phản chiếu mọi Origin =="
reset_limits
EVIL=$(curl -s -D - -o /dev/null -H 'Origin: https://ke-tan-cong.example' $DIRECT/metrics)
echo "$EVIL" | grep -qi 'access-control-allow-origin: https://ke-tan-cong.example' \
  && bad "vẫn phản chiếu Origin lạ" || ok "không phản chiếu Origin lạ"
GOOD=$(curl -s -D - -o /dev/null -H 'Origin: http://localhost:5174' $DIRECT/metrics)
echo "$GOOD" | grep -qi 'access-control-allow-origin: http://localhost:5174' \
  && ok "vẫn cho phép origin của FE" || bad "chặn cả origin hợp lệ"

echo "== 16. OTP: quá 5 lần thử thì mã bị huỷ =="
reset_limits
EMAIL3="qco$(date +%s)@example.test"; USER3="qco$(date +%s)"
curl -s -o /dev/null -X POST $API/user/register -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL3\",\"username\":\"$USER3\",\"password\":\"$PASS_WORD\",\"fullName\":\"QC Otp\"}"
OTP3=$(R get "otp:reg:$EMAIL3" | tr -d '\r')
[ -n "$OTP3" ] && ok "mã đã lưu (dạng băm: $(echo -n "$OTP3" | head -c 12)…)" || bad "không có mã"
echo "$OTP3" | grep -qE '^[0-9a-f]{64}$' && ok "Redis lưu BẢN BĂM, không phải 6 số" || bad "mã lưu dạng thô: $OTP3"
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -X POST $API/user/verify-otp -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL3\",\"otp\":\"000000\"}"
done
check "$(R exists "otp:reg:$EMAIL3" | tr -d '\r')" "0" "sau 5 lần sai, mã bị tiêu huỷ"

echo "== 17. Khoá tài khoản sau 10 lần sai =="
reset_limits
EMAIL4="qcl$(date +%s)@example.test"; USER4="qcl$(date +%s)"
activate "$EMAIL4" "$USER4" "$PASS_WORD" > /dev/null
for i in $(seq 1 10); do
  curl -s -o /dev/null -X POST $API/user/login -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL4\",\"password\":\"saibet$i\"}"
done
check "$(R get "login:fail:$EMAIL4" | tr -d '\r')" "10" "bộ đếm ghi đủ 10 lần sai"
# Mật khẩu ĐÚNG cũng bị từ chối, và bằng đúng thông điệp cũ.
LOCKED=$(curl -s -w '|%{http_code}' -X POST $API/user/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL4\",\"password\":\"$PASS_WORD\"}")
check "${LOCKED##*|}" "401" "đang khoá: mật khẩu đúng vẫn 401"
echo "${LOCKED%%|*}" | grep -q "không chính xác" && ok "không tiết lộ việc đang bị khoá" || bad "thông điệp: ${LOCKED%%|*}"
R del "login:fail:$EMAIL4" > /dev/null
UNLOCKED=$(post_code /user/login "$(printf '{"email":"%s","password":"%s"}' "$EMAIL4" "$PASS_WORD")")
check "$UNLOCKED" "201" "hết cửa sổ khoá thì vào lại được"

echo "== 18. Hạn mức theo IP (nhóm này làm cạn xô đăng nhập — để cuối) =="
reset_limits
LIMITED=""
for i in $(seq 1 40); do
  OUT=$(curl -s -w '|%{http_code}' -X POST $API/user/login -H 'Content-Type: application/json' \
    -d "{\"email\":\"khongton$i@example.test\",\"password\":\"saibetroi\"}")
  if [ "${OUT##*|}" = "429" ]; then LIMITED="${OUT%%|*}"; break; fi
done
[ -n "$LIMITED" ] && ok "bị chặn 429 sau khi vượt hạn" || bad "gọi 40 lần vẫn không bị chặn"
echo "$LIMITED" | grep -q '"code":"RATE_LIMITED"' && ok "mã lỗi RATE_LIMITED" || bad "body: $LIMITED"
echo "$LIMITED" | grep -qE '"retryAfterSeconds":[0-9]+' && ok "kèm retryAfterSeconds cho client biết chờ bao lâu" || bad "thiếu retryAfterSeconds"

echo
echo "TỔNG CUỐI: $PASS pass / $FAIL fail"
[ "$FAIL" -eq 0 ] || exit 1

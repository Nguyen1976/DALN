# Vị trí và thời gian của phiên đăng nhập — bản thiết kế

**Ngày:** 2026-09-26 · **Trạng thái:** đã duyệt thiết kế, chờ duyệt spec

Trang "Phiên đăng nhập" (`/settings/account`) hiện ghép hai mốc khác nhau vào
một dòng: IP **lúc đăng nhập** cạnh thời điểm **refresh gần nhất**, nên dễ bị
đọc thành "thiết bị này đang ở IP đó". Tài liệu này thêm IP gần nhất, vị trí
ước tính từ IP, bản đồ mini, và hai mốc thời gian rõ nghĩa.

Mục đích của trang không đổi: giúp người dùng **nhận ra một phiên lạ** để quyết
định có đăng xuất nó không. Tiêu chí thành công là nhận ra nhanh và **không báo
động giả**, và tiêu chí này chi phối mọi lựa chọn hiển thị bên dưới.

---

## 1. Phạm vi

**Trong phạm vi**

- Giữ IP lần đầu đăng nhập. Thêm IP gần nhất, cập nhật ở mỗi lần refresh.
- Vị trí ước tính cho cả hai IP, tra từ file MaxMind GeoLite2 đặt trên server.
- Mỗi dòng thiết bị bấm để mở panel chi tiết, trong đó có bản đồ mini và link
  Google Maps.
- "Hoạt động gần nhất" dạng tương đối; "Đăng nhập lần đầu" dạng ngày giờ.

**Ngoài phạm vi** — cố ý, không phải bỏ sót

- Last Active chính xác tới từng request. Đã chốt đo theo refresh, lệch tối đa
  15 phút (xem [§9.2](#92-last-active-và-ip-gần-nhất-lệch-tối-đa-15-phút)).
  Nâng cấp về sau: `AuthGuard` ghi `lastSeenAt` có throttle bằng `SET NX EX 60`.
- Hoạt động chỉ qua socket.
- Tên địa danh tiếng Việt. GeoLite2 không có bản `vi`, nên hiển thị
  "Hanoi, Vietnam".
- Tự động cập nhật file GeoLite2 (cron `geoipupdate`) — để sau.
- Cảnh báo tự động khi một phiên đổi quốc gia hoặc ASN.
- Lịch sử IP. Chỉ giữ hai mốc: đầu tiên và gần nhất.

---

## 2. Nền tảng sẵn có được tái dùng

| Thứ có sẵn | Ở đâu | Dùng vào việc gì |
|---|---|---|
| Hash `sess:<sid>` với `ip`, `ua`, `createdAt`, `lastSeenAt` | `libs/common/src/auth/session.store.ts` | Thêm một field `lastIp` |
| `ROTATE_SCRIPT` — đã ghi `lastSeenAt` ở nhánh rotate và nhánh ân hạn | cùng file | Ghi `lastIp` ở đúng hai chỗ đó |
| `@Ip()` + `trust proxy 2` + nginx `X-Forwarded-For` | `user-http.controller.ts`, `apps/user/src/main.ts`, `deploy/nginx/daln.conf` | IP client thật, như `login` đang lấy |
| `formatRelativeTime`, `formatFullDateTime` | `frontend/src/utils/formatDateTime.ts` | Tooltip và mẫu cho hàm mới |
| `describeThisDevice(ua)` | `frontend/src/pages/Settings/Account.tsx` | Tên và icon thiết bị |
| File dữ liệu ngoài git, đọc qua `path.join(process.cwd(), …)` | `gb-ranker.service.ts` (`gb.json`) | Cách đặt đường dẫn file GeoLite2 |

**Không** đổi schema MongoDB. **Không** đụng `AuthGuard`. Trong `libs/common` chỉ
sửa `session.store.ts`, nên cả 6 image sẽ rebuild một lần — chấp nhận được.

---

## 3. Luồng

```
Đăng nhập
  login(@Ip) ── create(uid, { userAgent, ip })
                  └─ HSET ip=<ip>  lastIp=<ip>  createdAt  lastSeenAt

Refresh — bị động: chỉ chạy khi một request HTTP nhận 401 sau khi access token 15' hết hạn
  POST /user/refresh (@Ip) ── refreshSession(cookie, { ip }) ── consume(cookie, { ip })
                                                                 └─ Lua rotated | grace:
                                                                    HSET lastSeenAt, lastIp (nếu ip khác rỗng)

Xem trang
  GET /user/sessions ── listOwnSessions
                          ├─ sessions.listSessions(uid)   → ip, lastIp, createdAt, lastSeenAt, ua
                          └─ geoIp.lookup(ip), geoIp.lookup(lastIp)
                                                          → location, lastLocation
```

Client **không** refresh theo lịch
(`frontend/src/utils/authorizeAxios.ts`, interceptor 401). Hệ quả:
`lastIp` và `lastSeenAt` lệch tối đa 15 phút so với request HTTP thật gần nhất.
Tab để mở mà không gửi request nào thì không được cập nhật.

---

## 4. Mô hình dữ liệu — Redis

`sess:<sid>` (hash) chỉ thêm một field:

| Field | Ghi khi nào | Ghi chú |
|---|---|---|
| `ip` | `create()` | IP lúc đăng nhập. **Không bao giờ bị ghi lại.** |
| `lastIp` **(mới)** | `create()` ghi bằng `ip`. Lua ghi ở nhánh `rotated` và `grace`, nếu `ARGV[6]` khác rỗng | Nhánh `replayed` **không** ghi: đó là token bị đánh cắp, IP của kẻ cắp không được đè lên, và phiên cũng bị giết ngay sau đó |

Khi đọc: `lastIp || ip || null`. Phiên tạo trước lúc deploy chưa có `lastIp`,
nên không cần migrate.

Thay đổi trong Lua (hai nhánh, cùng một mẫu):

```lua
-- ARGV[6] = IP của request refresh ('' nếu không có)
if rtHash == ARGV[1] then
  redis.call('HSET', KEYS[1], 'rtHash', ARGV[2], 'prevHash', rtHash,
             'prevUntil', now + tonumber(ARGV[4]), 'lastSeenAt', now)
  if ARGV[6] ~= '' then redis.call('HSET', KEYS[1], 'lastIp', ARGV[6]) end
  ...
```

Chữ ký: `consume(cookieValue, meta: { ip?: string | null } = {})`. `logout` gọi
không kèm meta, và phiên cũng bị xoá ngay sau đó.

---

## 5. Hợp đồng API

### 5.1 `POST /user/refresh`

Không đổi gì với client. Server đọc thêm `@Ip()`.

### 5.2 `GET /user/sessions` — chỉ **thêm** field

Không xoá, không đổi tên field nào: trong lúc deploy vẫn có người dùng đang cầm
bundle frontend cũ.

```ts
interface GeoLocation {
  city: string | null        // null khi dữ liệu chỉ biết tới quốc gia
  country: string | null
  latitude: number
  longitude: number
  accuracyRadiusKm: number
}

interface SessionListItem {
  sid: string
  current: boolean
  createdAt: number          // ms — "Đăng nhập lần đầu"
  lastSeenAt: number         // ms — "Hoạt động gần nhất"
  userAgent: string | null
  ip: string | null          // IP lúc đăng nhập (như cũ)
  lastIp: string | null      // mới
  location: GeoLocation | null      // mới — của ip
  lastLocation: GeoLocation | null  // mới — của lastIp
}
```

Ví dụ:

```json
{
  "sid": "q3L…", "current": false,
  "createdAt": 1789434720000, "lastSeenAt": 1790391900000,
  "userAgent": "Mozilla/5.0 (Macintosh; …) Chrome/140",
  "ip": "81.2.69.142", "lastIp": "89.160.20.112",
  "location":     { "city": "London",    "country": "United Kingdom", "latitude": 51.5142, "longitude": -0.0931, "accuracyRadiusKm": 10 },
  "lastLocation": { "city": "Linköping", "country": "Sweden",         "latitude": 58.4167, "longitude": 15.6167, "accuracyRadiusKm": 76 }
}
```

---

## 6. `GeoIpService`

**Vị trí:** `apps/user/src/geoip/geoip.service.ts`, là provider của `UserModule`.
Chỉ app `user` dùng nó. Đặt vào `libs/common` sẽ kéo `maxmind` vào cả 6 image.

**File dữ liệu:** lấy từ `GEOIP_DB_PATH`, mặc định là
`path.join(process.cwd(), 'geoip/GeoLite2-City.mmdb')`. Ở prod đường dẫn đó là
`/app/geoip/…`, ở dev là `backend/geoip/…`.

**Hành vi**

- `onModuleInit`: `maxmind.open<CityResponse>(path)`. Lỗi (thiếu file, file
  hỏng) thì `logger.warn` **một lần** kèm đường dẫn, rồi `reader = null`.
- `lookup(ip: string | null): GeoLocation | null`
  - trả `null` khi `ip` rỗng hoặc chưa có `reader`;
  - bọc `reader.get(ip)` trong `try/catch`, lỗi thì trả `null`;
  - bản ghi không có `location` thì trả `null`;
  - `city = city.names.en ?? null`;
    `country = country.names.en ?? registered_country.names.en ?? null`.
- Service **không bao giờ ném lỗi**: trang Thiết bị không được chết vì GeoIP.
- Không cần cache vì mỗi lần tra chỉ vài micro giây.

**Đã kiểm với `maxmind` 5.0.7 (MIT, JS thuần, phụ thuộc `mmdb-lib` và `tiny-lru`)
trên fixture:**

- dạng `::ffff:1.2.3.4` tự được xử lý;
- `127.0.0.1`, `172.22.0.1`, `::1` và `"not-an-ip"` trả `null`, không ném lỗi;
- file không tồn tại thì `open()` ném `ENOENT`.

`prune-prod-deps.sh` dùng danh sách chặn nên không xoá `maxmind`.
`check-externals.js` sẽ làm build fail nếu module này thiếu lúc chạy.

---

## 7. Giao diện

### 7.1 `SessionRow` (mới) — dùng cho mọi dòng thiết bị

- Vùng icon + tên + dòng mô tả là **một nút toggle** (`aria-expanded`,
  `aria-controls`). Nút *Đăng xuất* nằm cạnh nút toggle, không lồng bên trong,
  vì HTML không cho lồng button.
- **Thiết bị này:** dòng mô tả giữ nguyên "Thiết bị này · Đang hoạt động". Hàng
  hiện ngay từ UA của trình duyệt như hiện tại, và bấm mở được khi danh sách
  phiên (`current: true`) đã tải xong. Danh sách không có phiên `current` thì
  hàng này không mở được.
- **Thiết bị khác:** `<place(lastLocation) ?? lastIp ?? "IP không rõ"> · hoạt
  động <formatLastActive(lastSeenAt)>`.

### 7.2 Panel chi tiết

```
┌─────────────────────────────────────────────┐
│          [ bản đồ mini — xem §7.3 ]         │
└─────────────────────────────────────────────┘
Ước tính từ IP · bán kính ~76 km      Mở trên Google Maps ↗
Đăng nhập lần đầu    15/09/2026 lúc 08:12 · London, United Kingdom · IP 81.2.69.142
Hoạt động gần nhất   3 giờ trước · Linköping, Sweden · IP 89.160.20.112
Dữ liệu vị trí: GeoLite2 (MaxMind) · Bản đồ © Esri
```

- Bản đồ, bán kính trong nhãn và link Maps đều lấy từ **cùng một** vị trí:
  `lastLocation`, tức là thiết bị đang ở đâu. Cố ý **không** lùi về `location`:
  khi IP gần nhất không tra được, vẽ nơi đăng nhập cũ là nói sai rằng thiết bị
  vẫn ở đó. Server đã tính `lastLocation` theo `lastIp || ip`, nên phiên chưa
  đổi IP vẫn có bản đồ. (Sửa sau review cuối, 2026-09-26.)
- Nếu `location` và `lastLocation` đều `null` thì bỏ bản đồ, link và dòng ghi
  công, hiện "Không xác định được vị trí". Hai dòng thời gian và IP vẫn giữ.
- Một IP không có vị trí thì phần vị trí của dòng đó bị bỏ, IP vẫn hiện.
- `place(loc)`: có `city` thì `"city, country"`, không có thì `"country"`.

### 7.3 `SessionMiniMap` (mới) — tile tĩnh, không dùng thư viện

- **Khung** cố định 320×160 (`max-w-full`), `overflow-hidden`, điểm cần hiển
  thị luôn nằm giữa khung.
- **Zoom** chọn theo bán kính, để vòng tròn luôn to khoảng 24–48 px:

  ```
  mpp(z)  = 156543.03392 · cos(lat) / 2^z          // mét trên mỗi pixel
  z       = clamp(floor(log2(156543.03392 · cos(lat) · 48 / (radiusKm · 1000))), 2, 13)
  rPx     = radiusKm · 1000 / mpp(z)
  ```

  Kiểm tay: London (10 km) → z=8, vòng ~26 px. Bhutan (534 km, chỉ biết quốc
  gia) → z=3, vòng ~31 px phủ cả nước. Đây là cách **hiện đúng độ bất định**
  thay vì một pin trông chính xác mà thật ra không.
- **Tile:** điểm chiếu ra pixel toàn cầu `(px, py)` ở zoom z (Web Mercator).
  Dải tile cần tải là `floor((px ± 160)/256)` × `floor((py ± 80)/256)`,
  thường 4–6 tile. `x` lấy modulo `2^z`, `y` bị kẹp vào `[0, 2^z − 1]`. Mỗi tile
  là một `<img>` lấy từ Esri World Street Map,
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}`
  (hàng `y` đứng trước cột `x`), đặt tuyệt đối theo `tx·256 − px`.
- **Vì sao Esri, không phải OpenStreetMap** (đổi lúc QC, 2026-09-26): trên mạng
  của máy dev ở Việt Nam, kết nối TLS tới `tile.openstreetmap.org` và
  `www.openstreetmap.org` bị reset ngay ở bước Client Hello, kể cả ngoài sandbox.
  Người dùng trên mạng đó sẽ không bao giờ thấy bản đồ. CARTO vẫn trả 200 nhưng
  ảnh là "API KEY REQUIRED". OSM France tải được nhưng ghi nhãn tiếng Pháp. Esri
  tải được, không cần key, nhãn tiếng Anh, cùng lưới Web Mercator.
- **Vòng tròn:** đỏ, nền đỏ trong suốt, có chấm nhỏ ở tâm.
- Tile nào `onError` thì ẩn cả khối bản đồ; chữ vẫn còn.
- Ở dark mode, tile được giảm sáng bằng CSS `filter`.
- **Google Maps:**
  `https://www.google.com/maps/@?api=1&map_action=map&center={lat},{lon}&zoom={z}`.
  Link mở vùng xung quanh với cùng mức zoom, không cắm pin.
  Dùng `target="_blank" rel="noopener noreferrer"`.

Mọi phép tính nằm trong `frontend/src/utils/geo.ts`, là hàm thuần:
`zoomForRadius`, `project`, `tileRange`, `googleMapsUrl`, `formatPlace`.

### 7.4 Định dạng thời gian — `formatDateTime.ts`

- `formatLastActive(ms)`: dưới 60 giây là `vừa xong`; dưới 1 giờ là
  `N phút trước`; dưới 24 giờ là `N giờ trước`; dưới 7 ngày là `N ngày trước`;
  từ 7 ngày trở đi là `dd/mm/yyyy`. Hàm trả chữ thường; panel tự viết hoa chữ
  đầu khi giá trị đứng đầu dòng.
- `formatSignInDate(ms)`: `15/09/2026 lúc 08:12`.
- Tooltip (`title`) của cả hai mốc dùng `formatFullDateTime` đã có.
- **Không sửa `formatRelativeTime`**: thông báo, chat và lời mời kết bạn đang
  dùng nó.

---

## 8. Deploy

- `backend/docker-compose.prod.yml`, service `user`: thêm
  `volumes: [ "./geoip:/app/geoip:ro" ]`. Dev không cần sửa gì: compose dev đã
  mount `./:/app`.
- `backend/.gitignore`: thêm `geoip/`.
- `deploy/README.md`: thêm mục **GeoIP**:
  1. Đăng ký tài khoản MaxMind (miễn phí), tải `GeoLite2-City.mmdb`.
  2. `scp` file vào `/root/workspace/DALN/backend/geoip/` **trước khi merge**.
     Lần deploy mang tính năng này tạo lại container `user`, nên sẽ đọc được
     file ngay.
  3. Mỗi lần cập nhật file sau này:
     `docker compose -p daln-prod restart user kong`. Cần restart cả Kong vì
     Kong giữ IP upstream cũ trong cache.
- **Merge không phụ thuộc file này.** Thiếu file thì prod vẫn có IP lần đầu, IP
  gần nhất và hai mốc thời gian, chỉ không có vị trí và bản đồ.
- Thêm `maxmind` làm dependency sẽ đổi `package-lock`, nên cả 6 image rebuild.

---

## 9. Rủi ro đã biết

### 9.1 GeoIP ở Việt Nam kém chính xác

Nhà mạng thường khai báo cả dải IP về trung tâm Hà Nội hoặc TP.HCM. Mạng 4G
qua CGNAT có thể nhảy tỉnh giữa hai lần refresh. Cách giảm thiểu: vòng tròn
theo `accuracy_radius` thay vì pin, zoom tự lùi ra khi dữ liệu mơ hồ, nhãn
"Ước tính từ IP", và link Maps không cắm pin. Bản đồ vẫn có thể sai; thiết kế
chỉ đảm bảo nó **không trông chắc chắn hơn dữ liệu thật**.

### 9.2 Last Active và IP gần nhất lệch tối đa 15 phút

Đã chốt. Hai giá trị này đo theo refresh bị động, không theo từng request, và
hoạt động chỉ qua socket không được tính. Nâng cấp được về sau mà không phải
bỏ phần nào (xem §1).

### 9.3 Vị trí lúc đăng nhập được tra bằng dữ liệu hiện tại

Việc tra diễn ra lúc đọc, nên nếu dải IP đổi chủ trong vòng 30 ngày tuổi của
phiên thì vị trí lúc đăng nhập sẽ lệch. Hiếm gặp; đánh đổi này để Redis không
phải lưu vị trí và các phiên cũ có vị trí ngay khi deploy.

### 9.4 Nhà cung cấp tile thấy vùng xem

Trình duyệt tải tile trực tiếp từ Esri, nên Esri biết IP của người xem và vùng
bản đồ họ xem, tức là vị trí ước tính **của chính họ**. Tile chỉ tải khi mở
panel. Không gửi IP của phiên. Rủi ro thấp; ghi lại vì lý do chọn GeoIP local
là giữ IP trong hệ thống.

### 9.5 Điều khoản GeoLite2

Phải có dòng ghi công (đã đặt ở panel). Điều khoản cũng yêu cầu dùng bản dữ
liệu mới, nên cron `geoipupdate` không nên để quá lâu.

---

## 10. Kiểm thử

**Fixture:** `GeoIP2-City-Test.mmdb` (22 KB) lấy từ `maxmind/MaxMind-DB`
(Apache-2.0/MIT), đặt tại
`backend/apps/user/src/geoip/__fixtures__/GeoIP2-City-Test.mmdb`. Test và QC dev
đều không cần tài khoản MaxMind. Các IP đã xác minh:

| IP | Kết quả |
|---|---|
| `81.2.69.142` | London, United Kingdom — 51.5142, −0.0931, r=10 km |
| `89.160.20.112` | Linköping, Sweden — 58.4167, 15.6167, r=76 km |
| `175.16.199.0` | Changchun, China — 43.88, 125.3228, r=100 km |
| `67.43.156.0` | city `null`, Bhutan — 27.5, 90.5, r=534 km |
| `127.0.0.1`, `172.22.0.1`, `::1`, `not-an-ip` | `null` |

**Jest — backend**

- `session.store.redis.spec.ts` (Redis thật, tự skip khi không có Redis):
  - `create` ghi `lastIp = ip`;
  - `rotated` và `grace` cập nhật `lastIp` nhưng giữ nguyên `ip`;
  - `ARGV[6]` rỗng không đè IP cũ;
  - `replayed` không ghi `lastIp`.
- `session.store.spec.ts`: `listSessions` trả `lastIp`; hash thiếu `lastIp` thì
  trả `ip`.
- `geoip.service.spec.ts` (mới): bốn IP có vị trí ở bảng trên ra đúng; IP
  private và chuỗi rác trả `null`; đường dẫn không tồn tại thì `lookup` trả
  `null` và không ném lỗi.
- `user.service.session.spec.ts`:
  - `listOwnSessions` gắn `location` và `lastLocation`;
  - GeoIP trả `null` thì các field khác không đổi;
  - `refreshSession` truyền IP xuống `consume`.

**QC dev bằng Puppeteer — `qc/session-location-browser.mjs` (mới)**

Chuẩn bị: copy fixture vào `backend/geoip/GeoLite2-City.mmdb` (đã gitignore),
rồi restart container `user`.

1. Thiết bị B đăng nhập với `X-Forwarded-For: 81.2.69.142`. Thiết bị A thấy
   dòng B ghi "London, United Kingdom · hoạt động vừa xong".
2. Mở panel của B: có bản đồ, vòng tròn ở giữa khung, link Maps có đúng
   `center` và `zoom`, "Đăng nhập lần đầu" có ngày hôm nay.
3. B refresh với `X-Forwarded-For: 89.160.20.112`. Panel của B: "Hoạt động gần
   nhất" là Linköping, "Đăng nhập lần đầu" **vẫn** là London.
4. Phiên có IP `67.43.156.0`: vòng tròn lớn, zoom lùi ra, chỉ ghi "Bhutan".
5. Phiên có IP private: không có bản đồ, hiện "Không xác định được vị trí".
6. Dark mode và bề rộng 375 px, kèm ảnh chụp làm bằng chứng.

Header XFF đã đi qua được ít nhất một đường vào: Redis dev có sẵn một phiên
mang IP public. Đường đi qua trình duyệt sẽ được xác minh khi QC.

---

## 11. Danh sách tệp

**Backend**

| Tệp | Thay đổi |
|---|---|
| `libs/common/src/auth/session.store.ts` | `lastIp`, `ARGV[6]` trong Lua, `consume(…, meta)`, `SessionSummary.lastIp` |
| `libs/common/src/auth/session.store.spec.ts` | test đọc `lastIp` và fallback về `ip` |
| `libs/common/src/auth/session.store.redis.spec.ts` | ma trận `lastIp` trên Redis thật |
| `apps/user/src/geoip/geoip.service.ts` | **mới** |
| `apps/user/src/geoip/geoip.service.spec.ts` | **mới** |
| `apps/user/src/geoip/__fixtures__/GeoIP2-City-Test.mmdb` | **mới** — fixture |
| `apps/user/src/user.module.ts` | đăng ký `GeoIpService` |
| `apps/user/src/domain/user.domain.ts` | `GeoLocation`; thêm field vào `SessionListItem` |
| `apps/user/src/user.service.ts` | `refreshSession(cookie, meta)`; `listOwnSessions` tra vị trí |
| `apps/user/src/user.service.session.spec.ts` | test như §10 |
| `apps/user/src/http/user-http.controller.ts` | `refresh` lấy `@Ip()` |
| `package.json`, `package-lock.json` | `maxmind` |
| `docker-compose.prod.yml` | volume `./geoip` cho `user` |
| `.gitignore` | `geoip/` |

**Frontend**

| Tệp | Thay đổi |
|---|---|
| `src/apis/user.ts` | `GeoLocation`; thêm field vào `UserSession` |
| `src/utils/formatDateTime.ts` | `formatLastActive`, `formatSignInDate` |
| `src/utils/geo.ts` | **mới** |
| `src/pages/Settings/SessionRow.tsx` | **mới** |
| `src/pages/Settings/SessionMiniMap.tsx` | **mới** |
| `src/pages/Settings/Account.tsx` | dùng `SessionRow` cho cả thiết bị này và thiết bị khác |

**Deploy và QC**

| Tệp | Thay đổi |
|---|---|
| `deploy/README.md` | mục GeoIP |
| `qc/session-location-browser.mjs` | **mới** |

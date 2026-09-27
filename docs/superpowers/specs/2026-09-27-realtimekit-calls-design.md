# Chuyển cuộc gọi thoại/video sang Cloudflare RealtimeKit — bản thiết kế

**Ngày:** 2026-09-27 · **Trạng thái:** đã duyệt thiết kế (4 phần), chờ duyệt spec

Hiện nay media của cuộc gọi chạy trên hạ tầng tự host:

- **Gọi 1-1:** WebRTC P2P, gateway chuyển tiếp SDP/ICE. Khi không nối thẳng được thì đi vòng qua **coturn** trên server.
- **Gọi nhóm:** SFU **LiveKit** trên server, cộng coturn làm TURN cho client LiveKit.

Server đặt ở châu Âu, nên mọi cuộc gọi phải relay hoặc đi qua SFU đều vòng VN → châu Âu → VN.

Tài liệu này thay toàn bộ lõi media bằng **Cloudflare RealtimeKit**: SFU và TURN của Cloudflare đặt gần người dùng, cộng REST API quản lý phòng và webhook.

Tiêu chí thành công:

- Mọi chức năng gọi trong [§7](#7-danh-sách-chức-năng-phải-giữ-nguyên) hoạt động như trước. QC tự động chứng minh điều đó trên dev và trên prod.
- Coturn và LiveKit được gỡ khỏi server sau khi bản mới chạy ổn.

Cần tách bạch hai phần:

- **Logic nghiệp vụ cuộc gọi giữ nguyên:** đổ chuông, bận, claim nhiều tab, quyền, thời lượng, nhật ký trong chat.
- **Chỉ đổi:** cách hai bên nối media với nhau.

---

## 1. Phạm vi

**Trong phạm vi**

- Gọi 1-1 và gọi nhóm (thoại, video) đều qua RealtimeKit. Cuộc gọi 1-1 là một phòng 2 người, không còn nhánh P2P.
- `RealtimeKitService` trong realtime-gateway, gồm: REST API, ánh xạ hội thoại ↔ phòng, thu hồi token.
- Webhook RealtimeKit thay webhook LiveKit.
- Hai hook frontend mới (`useDirectCall`, `useGroupCall` trên `useRtkRoom`). Chúng giữ nguyên dạng dữ liệu trả về, nên các màn hình không đổi.
- Script tạo preset và webhook (`rtk:setup`) và script tunnel webhook cho dev (`rtk:dev-tunnel`).
- Bộ QC trình duyệt cho cuộc gọi (`qc/calls-browser.mjs`). Hiện repo chưa có bộ nào.
- 3 tài khoản QA trên prod (đã được người dùng đồng ý).
- PR 2, dọn hạ tầng cũ. Chỉ làm sau khi người dùng xác nhận ([§9](#9-triển-khai)).

**Ngoài phạm vi** — cố ý, không phải bỏ sót

- Chia sẻ màn hình, ghi hình, chép lời, chat trong cuộc gọi. App hiện không có các tính năng này, và preset tắt chúng.
- Hiển thị "Đang kết nối lại…" khi rớt mạng. Hiện tại không có. SDK tự kết nối lại; thất bại hẳn thì xử lý như bây giờ.
- Nhiều instance gateway. Bộ đếm giờ vẫn nằm trong tiến trình, như bộ đếm 35 giây hiện tại.
- Thông báo cuộc gọi nhỡ khi người nhận offline (Web Push).
- Gỡ `agora-rtc-sdk-ng`. Đây là dependency chết, không liên quan, để lần khác.

---

## 2. Hiện trạng (tóm tắt, dùng khi viết plan)

- **Gateway:** `backend/apps/realtime-gateway/src/realtime/realtime.gateway.ts`
  - Sự kiện 1-1 ở dòng 586–990: `call.ice_config`, `incoming_call`, `accepted`, `rejected`, `ended`, `ice_candidate`, `media_state`.
  - Sự kiện nhóm ở dòng 996–1300.
  - `applyLivekitWebhook` ở dòng 1307; bộ đếm 35 giây ở dòng 1415–1460.
- **Store (Redis):**
  - `call-session.store.ts`: `call:<id>`, `callaccept:<id>`, latch `end()`.
  - `call-busy.store.ts`: `callbusy:<user>`.
  - `group-call.store.ts`: `groupcall:<conv>`, `:participants`, `:seen`, `groupcall:call:<id>`; `finish()` là latch.
- **LiveKit:**
  - `livekit-token.ts`.
  - Webhook `POST /livekit/webhook`: `realtime-gateway.controller.ts`, raw body trong `main.ts:17`.
  - Env `LIVEKIT_*`.
- **TURN:** `turn-credentials.ts`, env `TURN_*`.
- **Nhật ký:**
  - 1-1 đi qua RabbitMQ `realtime.events` / `call.ended`, tới `MessageService.recordCallOutcome`.
  - Nhóm đi qua HTTP nội bộ `POST /chat/internal/group-call-log`.
  - **Không đổi.**
- **Frontend:**
  - Media: `hooks/useWebRTC.ts` (1-1), `hooks/useGroupCall.ts` (livekit-client).
  - Màn hình: `VoiceCallModal`, `GroupCallModal` (gồm `GroupCallVideoTile`), `PrejoinModal`, `IncomingCallManager`, `CallProvider`, `CallLogMessage`, `useGroupCallDiscovery`, sidebar "Đang gọi…".
- **Hạ tầng:**
  - LiveKit là container trong compose (dev và prod).
  - Coturn: container ở dev; cài bằng apt trên host ở prod, `deploy.sh` render config.
  - nginx có `location /livekit/`.

---

## 3. Kiến trúc mới

```
Trình duyệt ──socket.io──▶ realtime-gateway (nghiệp vụ: chuông, bận, quyền, log)
     │                          │  REST (Bearer REALTIMEKIT_API_TOKEN)
     │                          ▼
     │                  Cloudflare RealtimeKit API ── webhook ──▶ /api/realtime/rtk-webhook
     │                                                            (nginx → Kong /realtime → gateway)
     └──media (authToken)──▶ Cloudflare SFU/TURN gần người dùng ◀── người còn lại
```

**Nguyên tắc:**

- Gateway là nơi duy nhất cấp `authToken`, và chỉ cấp sau khi đã kiểm tra quyền như hiện nay.
- Webhook là nguồn sự thật về việc ai đang có mặt trong phòng của **cuộc gọi nhóm**, như LiveKit hiện nay.
- Vòng đời cuộc gọi 1-1 vẫn chạy bằng các sự kiện socket.

---

## 4. Backend

### 4.1 `RealtimeKitService` (`realtime/realtimekit.service.ts`)

- **Base URL:** `https://api.cloudflare.com/client/v4/accounts/${REALTIMEKIT_ACCOUNT_ID}/realtime/kit/${REALTIMEKIT_APP_ID}`.
- **Timeout:** 8 giây mỗi request (AbortController). Lỗi, timeout hoặc 5xx sinh ra `RealtimeKitUnavailableError`.

| Hàm | Làm gì |
|---|---|
| `isConfigured()` | Kiểm tra đủ 3 biến `REALTIMEKIT_*` |
| `ensureMeeting(conversationId)` | Đọc `rtk:meeting:<conv>`. Chưa có thì `POST /meetings {title: conv_<id>}` rồi ghi `rtk:meeting:<conv>` và `rtk:conv:<meetingId>` (không TTL). Tạo phòng đồng thời thì dùng `SET NX`, bên thua đọc lại phòng của bên thắng |
| `addParticipant(meetingId, {userId, name, preset})` | `POST /meetings/{id}/participants {custom_participant_id: userId, name, preset_name}`, trả về `{participantId, authToken}` |
| `revoke(meetingId, participantIds[])` | Kick có chọn lọc (`POST /active-session/kick {participant_ids}`), rồi `DELETE` từng người. Lỗi chỉ ghi log, không ném ra |

- **Phòng bị vô hiệu hoá hoặc không tồn tại** (API trả 404, hoặc phòng ở trạng thái `INACTIVE`) khi `addParticipant`: xoá ánh xạ, `ensureMeeting` lại, thử lại **một lần**.
- **Mỗi hội thoại một phòng, dùng lại mãi:** RealtimeKit không cho xoá phòng, và mỗi phòng chỉ có một phiên chạy. Luật hiện tại cũng là mỗi hội thoại chỉ có một cuộc gọi.
- **Thu hồi token có chọn lọc, không `kick-all`:** tránh đá nhầm người của cuộc gọi kế tiếp trên cùng hội thoại, khi thao tác dọn dẹp chạy trễ.
- **Preset theo loại cuộc gọi:**

| Loại cuộc gọi | Preset |
|---|---|
| 1-1 thoại | `daln_direct_audio` |
| 1-1 video | `daln_direct_video` |
| nhóm thoại | `daln_group_audio` |
| nhóm video | `daln_group_video` |

  Có preset "audio" riêng để giữ quy tắc hiện tại: cuộc gọi thoại **không được** phát video (LiveKit đang cấp `canPublishSources: [MICROPHONE]`). Không dùng kiểu phòng "Voice", vì với kiểu đó bật camera sẽ không hoạt động.

### 4.2 Giao thức 1-1

Mọi payload do client gửi đều có thêm `v: 2`. Nếu thiếu `v`, hoặc có `offer`/`answer`, server trả ack `{ok:false, code:'CLIENT_OUTDATED'}`; trường hợp này là tab chạy JS cũ.

| Sự kiện | Payload → xử lý | Ack |
|---|---|---|
| `call.incoming_call` | `{v, conversationId, callType}`. Các bước:<ol><li>Kiểm tra `fetchCallPeer`, khoá bận người gọi, kiểm tra người nhận có bận không, `create` phiên — **y như cũ**.</li><li>Gọi `ensureMeeting` và `addParticipant(caller)`.</li><li>Nếu API lỗi: nhả khoá bận, xoá phiên, trả `MEDIA_UNAVAILABLE`.</li><li>Lưu `meetingId` và `participantIds` vào phiên `call:<id>`.</li><li>Gửi cho người nhận `{callId, callerId, conversationId, callType}`.</li></ol> | `{ok, callId, calleeId, callType, authToken}` |
| `call.accepted` | `{v, callId}`. Các bước:<ol><li>`loadCallSession`, kiểm tra chỉ người nhận được nhận, `claimAccept`, khoá bận, `markConnected`, gửi `call.claimed` sang các tab khác — **y như cũ**.</li><li>Gọi `addParticipant(callee)`; lỗi thì trả `MEDIA_UNAVAILABLE`.</li><li>Gửi cho người gọi `{callId, answererId}`.</li></ol> | `{ok, callId, authToken}` |
| `call.rejected`, `call.ended` | Như cũ: tính kết quả cuộc gọi đúng một lần qua latch `end()`, nhả khoá bận. **Thêm:** `revoke(meetingId, participantIds)` | như cũ |
| `call.ice_config`, `call.ice_candidate`, `call.media_state` | **Bỏ** | — |

- **Client:**
  - Người gọi vào phòng ngay khi nhận ack, và đứng một mình trong lúc chuông reo.
  - Người nhận vào phòng sau khi ack `accepted`.
  - Coi là "đã kết nối" khi mỗi bên thấy người kia trong `participants.joined` (so theo `customParticipantId`).
  - Sau khi nhận cuộc gọi, quá **15 giây** chưa thấy bên kia, hoặc không vào được phòng: gửi `call.ended {reason:'unreachable'}`. Đây là watchdog hiện tại.
- **Tab crash lúc đang đổ chuông** (không có `call.ended`): phiên hết hạn theo TTL như hiện nay. Người tham gia RealtimeKit của người gọi còn lại trong phòng của hội thoại DIRECT đó. Chấp nhận được: chỉ chính hai thành viên của hội thoại mới có token vào phòng này, nên không ai được thêm quyền.

### 4.3 Giao thức nhóm

| Sự kiện | Thay đổi so với hiện tại | Ack |
|---|---|---|
| `group_call.start` | Payload có `{v}`. Sau `getOrCreate`: gọi `ensureMeeting(conv)` và `addParticipant(starter, preset theo callType của phòng)`, rồi ghi vào `groupcall:<conv>:rtk` (HASH userId → participantId, TTL 12 giờ như các key khác). Lỗi API thì trả `MEDIA_UNAVAILABLE`, và xoá phiên nếu phiên vừa được tạo | `{ok, callId, roomName, callType, authToken}` (bỏ `url`, `token`, `iceServers`) |
| `group_call.accept` | Payload có `{v}`. Sau bước kiểm tra lại quyền thành viên: `addParticipant`, ghi vào `:rtk` | `{ok, callType, authToken}` |
| `decline`, `leave`, `query_state` | Không đổi | không đổi |
| Hết 35 giây không ai tham gia (`cancelGroupIfEmpty`) | **Thêm:** `revoke` mọi participant trong `:rtk` | — |

`isLivekitConfigured` / `LIVEKIT_UNCONFIGURED` được thay bằng `isConfigured` / `MEDIA_UNCONFIGURED`.

### 4.4 Webhook `POST /realtime/rtk-webhook`

- **Route và đường vào:**
  - Route nằm trên gateway, nhận raw body (giới hạn 256 KB, cùng cơ chế với route LiveKit).
  - URL công khai: `https://nguyen1976.xyz/api/realtime/rtk-webhook`. nginx bỏ tiền tố `/api` rồi chuyển cho Kong. Kong có route `realtime-route` với `paths: /realtime` và `strip_path: false`, nên request tới gateway ở đúng `/realtime/rtk-webhook`. **Không phải sửa nginx hay Kong.**
- **Xác thực chữ ký:**
  - Header `rtk-signature` là chữ ký RSA-SHA256 (base64) trên raw body.
  - Khoá công khai lấy từ `https://api.realtime.cloudflare.com/.well-known/webhooks.json` (`data.publicKey`), cache 1 giờ. Nếu xác thực sai, tải lại khoá **một lần** rồi thử lại.
  - Vẫn sai thì trả **401**.
- **Chống xử lý lặp:** `SET NX rtk:webhook:<rtk-uuid> EX 86400`. Đã gặp uuid đó thì trả 200 và không làm gì.
- **Tìm cuộc gọi:** `meeting.id` → `rtk:conv:<meetingId>` → conversationId → `groupCallStore.getByConversationId`. Không tìm thấy thì trả 200 và bỏ qua. Trường hợp này gồm: phòng của cuộc gọi 1-1 (vòng đời 1-1 chạy bằng socket), phòng lạ, và cuộc gọi đã `finish`.
- **Mã trả về:**
  - Lỗi xử lý nội bộ trả **500**, để Cloudflare gửi lại.
  - Mọi trường hợp khác trả **200**.

| Sự kiện | Xử lý (tương đương LiveKit) |
|---|---|
| `meeting.participantJoined` | `addParticipant(userId = participant.customParticipantId)`, huỷ bộ đếm 35 giây, huỷ bộ đếm phòng trống nếu đang chạy, phát `group_call.state` |
| `meeting.participantLeft` | `removeParticipant`, phát `state`. Không nhả khoá bận (giống hiện tại). Nếu danh sách người trong phòng trống thì bắt đầu **bộ đếm phòng trống 15 giây** |
| hết 15 giây vẫn trống, **hoặc** `meeting.ended` | `finishGroupCall(conv)` ([§4.5](#45-kết-thúc-cuộc-gọi-nhóm)) |
| `meeting.started` | bỏ qua |

### 4.5 Kết thúc cuộc gọi nhóm

`finishGroupCall` thay nhánh `room_finished`. Chỉ chạy **một lần**, nhờ latch `finish()`:

1. `postGroupCallLog`, như cũ.
2. Nhả khoá bận cho mọi người trong `seen`.
3. Phát `group_call.ended`.
4. `revoke(meetingId, mọi participant trong :rtk)`.

**Vì sao chờ 15 giây:** RealtimeKit chỉ tự đóng phiên sau ít nhất 60 giây kể từ khi phòng trống, trong khi LiveKit hiện đang dùng 20 giây. Khoảng chờ 15 giây đủ để ai đó rớt mạng rồi vào lại, mà không làm dấu "Đang gọi…" và nhật ký cuộc gọi bị trễ.

### 4.6 Biến môi trường

- `REALTIMEKIT_ACCOUNT_ID`, `REALTIMEKIT_APP_ID`, `REALTIMEKIT_API_TOKEN`: **đã có** trong `backend/.env` (dev, app `daln-dev`) và `.env.production` trên server (app `daln-prod`).
  - Prod: compose truyền cả file vào container qua `x-app` / `env_file`, nên không phải sửa compose.
  - Thêm 3 biến này vào `.env.production.example` (để trống).
- `REALTIMEKIT_API_BASE` (tuỳ chọn): chỉ dùng trong test.
- `LIVEKIT_*`, `TURN_*`, `STUN_URLS`: **không còn được đọc** sau PR 1. Chúng chỉ bị xoá khỏi file env ở PR 2.

### 4.7 Code bị bỏ ở PR 1

- `livekit-token.ts`, `turn-credentials.ts` và spec của hai file này.
- Handler webhook LiveKit và raw body cho `/livekit/webhook`.
- Các handler `call.ice_config`, `call.ice_candidate`, `call.media_state` và hằng số sự kiện tương ứng.
- Dependency `livekit-server-sdk`.

---

## 5. Frontend

### 5.1 `useRtkRoom(authToken, {audio, video})`

Hook chung bọc `@cloudflare/realtimekit` (Core SDK 2.x, không dùng UI Kit).

- **Vào/rời phòng:** `RealtimeKitClient.init({authToken, defaults:{audio, video}})`, `join()`, `leave()`. Dọn dẹp khi unmount.
- **Danh sách người tham gia:**
  - Dựng từ `participants.joined` và `meeting.self`.
  - Cập nhật theo các sự kiện `participantJoined`/`Left`, `videoUpdate`, `audioUpdate`, `activeSpeaker`.
  - Dạng dữ liệu y như `useGroupCall` đang trả: `{identity: customParticipantId, name, isLocal, isSpeaking, isMuted, isCameraEnabled, videoTrack}`.
- **Âm thanh:** SDK không tự phát tiếng. Hook gắn `audioTrack` của từng người khác vào `<audio autoplay>` ẩn (dùng `srcObject = new MediaStream([track])`), như cách đang làm với LiveKit. Nếu trình duyệt chặn phát (`autoplayError`) thì hiện nút "Bật âm thanh".
- **Điều khiển:**
  - mic: `enableAudio` / `disableAudio`;
  - camera: `enableVideo` / `disableVideo`;
  - đổi camera: `getVideoDevices()` rồi `setDevice(camera kế tiếp)`.
- **Mất kết nối hẳn** (`roomLeft` với state `failed`/`disconnected`): gọi callback `onFailed`.

### 5.2 `useDirectCall` (thay `useWebRTC`) và `useGroupCall` (viết lại)

- **`useDirectCall`:**
  - Giữ nguyên các trạng thái, các hàm (`startCall`, `acceptCall(callId, {withCamera})`, `endCall`, `toggleMute`, `toggleCamera`, `switchCamera`) và các lớp lỗi (`CallSetupError`, `MicrophoneTimeoutError`).
  - `localStream` / `remoteStream` được dựng thành `MediaStream` từ track của SDK, nên `VoiceCallModal` không đổi.
  - Trạng thái camera/mic của bên kia lấy từ SDK, thay cho `call.media_state`.
- **`useGroupCall`:** giữ nguyên giao diện hook. Chỉ đổi đầu vào: nhận `authToken` thay cho `url + token + iceServers`.
- **Màn hình:** `VoiceCallModal`, `GroupCallModal`, `GroupCallVideoTile`, `PrejoinModal`, `IncomingCallManager`, `CallProvider`, `CallLogMessage`, `ChatWindow` (banner), `ChatSidebar` chỉ sửa ở chỗ bắt buộc:
  - bỏ tham số `offer`/`answer`/`iceServers`;
  - gửi `v: 2`;
  - xử lý listener `media_state`;
  - thêm thông báo cho `CLIENT_OUTDATED` ("Ứng dụng vừa được cập nhật, vui lòng tải lại trang") và `MEDIA_UNAVAILABLE` ("Không thể bắt đầu cuộc gọi, thử lại sau").
- **Giữ nguyên cách hiển thị video:** `object-contain`, lật gương video của chính mình, và deps `[track, showVideo]` của tile.
- **Thư viện:**
  - thêm `@cloudflare/realtimekit`, bỏ `livekit-client`;
  - phần media của cuộc gọi được **lazy load** (`import()` động khi bắt đầu hoặc nhận cuộc gọi), để bundle chính không nặng thêm khoảng 170 KB gzip.

---

## 6. Preset, webhook và công cụ

### 6.1 `npm run rtk:setup` (`backend/scripts/realtimekit-setup.ts`)

Chạy lại nhiều lần vẫn an toàn: preset đã có thì cập nhật cho khớp, webhook đã có thì sửa URL và danh sách event cho khớp.

| Preset | `view_type` | Video | Simulcast | `max_video_streams` | Quyền phát |
|---|---|---|---|---|---|
| `daln_direct_video` | GROUP_CALL | `hd`, 30 fps | tắt | 1 / 1 | audio + video |
| `daln_direct_audio` | GROUP_CALL | — | tắt | 1 / 1 (xem ghi chú) | chỉ audio (video `NOT_ALLOWED`) |
| `daln_group_video` | GROUP_CALL | `vga`, 24 fps | **bật** | 9 máy tính / 6 điện thoại | audio + video |
| `daln_group_audio` | GROUP_CALL | — | — | 9 / 6 (xem ghi chú) | chỉ audio |

Ghi chú: preset thoại dùng cùng `max_video_streams` với preset video tương ứng, vì SDK chỉ đăng ký nghe `max_video_streams + 4` người (để 0 sẽ cắt tiếng từ người thứ 5). Preset thoại vẫn không phát được video vì video `NOT_ALLOWED`.

Quyền chung cho cả 4 preset:

- `waiting_room_type: SKIP`.
- Screenshare `NOT_ALLOWED`.
- Tắt chat, polls, plugins, ghi hình, livestream.
- `kick_participant: false`, `pin_participant: false`. Ghim trong app là tính năng ở phía client, không cần quyền này.
- `show_participant_list: true`.

Webhook: tên `daln`, các event `meeting.started`, `meeting.ended`, `meeting.participantJoined`, `meeting.participantLeft`.

**Cách chạy:**

- **Dev:** đọc `backend/.env`.
- **Prod:** env được stream từ server qua SSH (`ssh … grep '^REALTIMEKIT_' .env.production | npm run rtk:setup -- --env-stdin --webhook-url https://nguyen1976.xyz/api/realtime/rtk-webhook`), nên token prod không bao giờ được ghi ra máy dev.

### 6.2 `npm run rtk:dev-tunnel`

- Chạy service `rtk-tunnel` (image `cloudflare/cloudflared`, compose profile `rtk`, `tunnel --url http://realtime-gateway:3001`). Không phải cài gì trên máy.
- Script đọc URL `*.trycloudflare.com` từ log của service, rồi chạy `rtk:setup` với `--webhook-url <url>/realtime/rtk-webhook` cho app `daln-dev`.

---

## 7. Danh sách chức năng phải giữ nguyên

Đây là tiêu chí nghiệm thu. Mỗi mục có ít nhất một kiểm tra trong `qc/calls-browser.mjs`. Riêng C5 (4G thật) kiểm bằng tay.

**Gọi 1-1**

1. Nút "Gọi thoại" / "Gọi video" ở header. Video thì qua màn hình xem trước (tắt camera ở đó thì cuộc gọi thành gọi thoại).
2. Người nhận thấy màn hình "Cuộc gọi đến..." và nghe nhạc chuông lặp. Vòng tiến độ 30 giây.
3. Cuộc gọi video đến có 2 lựa chọn: "Nhận cuộc gọi video" (kèm camera) và "Nhận chỉ âm thanh". Cuộc gọi thoại có "Chấp nhận cuộc gọi".
4. Trạng thái bên gọi: "Đang gọi...", "Đang kết nối...", rồi đồng hồ mm:ss.
5. Hai bên nghe được nhau. Với video: thấy hình của nhau, video của mình lật gương, hiển thị `object-contain`.
6. Tắt/bật micro. Bên kia thấy nhãn "{tên} đã tắt micro".
7. Tắt/bật camera. Bên kia thấy avatar khi camera tắt, và thấy video trở lại khi bật, không bị khung hình đứng.
8. "Đổi camera" (khi có từ 2 camera).
9. Từ chối: bên gọi thấy "Cuộc gọi bị từ chối". Nhật ký ghi "Bị từ chối".
10. Không ai nhận sau 30 giây: bên gọi thấy "Người dùng bận" rồi tự đóng sau 2,5 giây. Nhật ký ghi "Cuộc gọi nhỡ".
11. Người gọi hoặc người nhận đang trong cuộc gọi khác: báo lỗi bận (`BUSY` / `CALLEE_BUSY`).
12. Nhiều tab: một tab nhận thì các tab khác ngừng đổ chuông (`call.claimed`).
13. Không nối được: sau 15 giây hiện "Không kết nối được", tự đóng. Nhật ký ghi "Không kết nối được".
14. Kết thúc: nhật ký ghi "Cuộc gọi thoại/video", thời lượng "X phút Y giây", và nút "Gọi lại" hoạt động.
15. Thu nhỏ cuộc gọi, chuyển trang, rồi "Mở lại cuộc gọi": cuộc gọi vẫn tiếp tục.

**Gọi nhóm**

16. Nút "Gọi nhóm" / "Gọi video nhóm". Chỉ hội thoại GROUP mới có. Người ngoài nhóm nhận `NOT_MEMBER`.
17. Thành viên thấy "{người gọi} đang mời bạn vào cuộc gọi [video ]nhóm...", có nhạc chuông. Có các nút "Tham gia cuộc gọi nhóm" (kèm camera), "Tham gia chỉ âm thanh", "Từ chối cuộc gọi nhóm".
18. Ba người nghe được nhau. Với video: lưới tự co giãn (1 / 2 / 2–3 cột), viền sáng quanh người đang nói.
19. Ghim một người lên màn hình chính, bỏ ghim. Người được ghim rời phòng thì giao diện trở về lưới.
20. Huy hiệu "Đã tắt micro" và nhãn "(Bạn)". Với cuộc gọi thoại: danh sách "Đang nói" / "Đang nghe".
21. Bật camera lại thì hình hiện lại ngay (lỗi đã sửa ở PR #30).
22. Banner "Đang có cuộc gọi [video ]nhóm" với nút "Tham gia" cho thành viên chưa vào. Dấu "Đang gọi…" trong sidebar.
23. Rời cuộc gọi: những người còn lại thấy danh sách cập nhật.
24. Người cuối cùng rời: sau khoảng 15 giây phát `group_call.ended`, banner và dấu "Đang gọi…" biến mất, nhật ký ghi "Cuộc gọi [video ]nhóm", kèm thời lượng và nút "Tham gia lại".
25. Bắt đầu mà không ai tham gia trong 35 giây: cuộc gọi tự huỷ.
26. Thu nhỏ: thanh "{trạng thái} · N người", nút "Mở lại cuộc gọi nhóm".
27. Cuộc gọi thoại (1-1 hoặc nhóm) không phát được video. Preset audio chặn việc này.

**Chung**

28. Tab chạy JS cũ nhận `CLIENT_OUTDATED` kèm lời nhắc tải lại trang.
29. API Cloudflare lỗi: toast "Không thể bắt đầu cuộc gọi", không kẹt khoá bận.
30. Sau khi cuộc gọi kết thúc, token cũ không vào lại được phòng (đã `revoke`).

---

## 8. Kiểm thử

**Unit (Jest, backend):**

- Viết lại các bộ test cuộc gọi trong `realtime.gateway.spec.ts`:
  - 1-1: quyền, bận hai phía, chỉ người nhận được nhận, claim, kết quả cuộc gọi ghi một lần, `CLIENT_OUTDATED`, `MEDIA_UNAVAILABLE` có nhả khoá bận.
  - Nhóm: `NOT_MEMBER`, `NOT_GROUP`, kiểm tra lại thành viên, bộ đếm 35 giây, bộ đếm phòng trống 15 giây, `finish` chạy một lần qua cả 2 đường, revoke.
- `realtimekit.service.spec.ts` (giả lập `fetch`): tạo phòng rồi dùng lại, `SET NX` khi tạo đồng thời, tạo lại khi 404/INACTIVE, timeout, revoke không ném lỗi.
- `rtk-webhook.spec.ts`: chữ ký đúng/sai (cặp khoá RSA sinh trong test), tải lại khoá khi xác thực sai, trùng `rtk-uuid`, phòng lạ, mã 500 khi lỗi nội bộ.

**QC trình duyệt (`qc/calls-browser.mjs`, Puppeteer):**

- Mỗi tài khoản chạy trong một trình duyệt riêng, với cờ `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`.
- Kiểm theo [§7](#7-danh-sách-chức-năng-phải-giữ-nguyên):
  - Video: `videoWidth > 0` và `currentTime` tăng.
  - Audio: `AnalyserNode` trên stream của người khác đo được âm thanh khác im lặng (thiết bị giả phát tiếng bíp).
  - Nhật ký cuộc gọi: đọc qua API tin nhắn.
- Môi trường chạy:
  - **Dev:** tài khoản tự tạo.
  - **Prod:** 3 tài khoản QA `qa.call1..3` và một nhóm chat riêng cho chúng, tạo bằng luồng đăng ký thật. Nếu luồng đăng ký bắt xác minh email mà không nhận được mail, sẽ hỏi người dùng trước khi đánh dấu tài khoản đã xác minh trực tiếp trong DB. Thông tin đăng nhập nằm trong `qc/.env.prod` (gitignore).

---

## 9. Triển khai

**PR 1 — chuyển code**

- Nội dung: backend, frontend, script, bộ QC, tài liệu.
- Trước khi merge:
  - chạy `rtk:setup` cho app prod;
  - dev phải đạt QC đủ [§7](#7-danh-sách-chức-năng-phải-giữ-nguyên);
  - backend phải xanh (typecheck, test).
- Merge → deploy → chạy QC trên prod bằng các tài khoản QA → người dùng gọi thử thật từ điện thoại (4G và wifi).
- Coturn, container LiveKit và các biến `TURN_*` / `LIVEKIT_*` **vẫn giữ trên server**. Có sự cố thì rollback bằng "Run workflow" với SHA trước PR 1 (image có sẵn trên GHCR).

**PR 2 — dọn dẹp** (sau vài ngày chạy ổn, **hỏi người dùng trước**)

- Bỏ trong repo:
  - service `livekit` trong compose dev/prod, `deploy/livekit/`;
  - service `coturn` trong compose dev, `deploy/coturn/`, bước coturn trong `deploy.sh`;
  - `location /livekit/` trong nginx;
  - các biến env cũ trong file example;
  - các mục TURN/LiveKit trong README.
- Trên server:
  - `apt remove coturn`;
  - bỏ hook `restart-coturn` của certbot;
  - xoá các biến env cũ;
  - `ufw delete` cho 3478, 5349, 49152–49999/udp, 50000/udp, 7881/tcp.

---

## 10. Rủi ro

| Rủi ro | Cách xử lý |
|---|---|
| API Cloudflare lỗi hoặc chậm khi bắt đầu cuộc gọi | Timeout 8 giây, trả `MEDIA_UNAVAILABLE`, nhả khoá bận, xoá phiên vừa tạo |
| Webhook không tới | Bộ đếm 35 giây và 15 giây vẫn kết thúc cuộc gọi. Khoá bận có TTL 4 giờ như hiện tại |
| Webhook bị chặn nếu sau này bật Bot Fight Mode / WAF | README ghi rõ: bỏ qua đường dẫn `/api/realtime/rtk-webhook` |
| Trình duyệt chặn tự phát âm thanh | Âm thanh chỉ bắt đầu sau khi người dùng đã bấm gọi hoặc nhận. Nếu vẫn gặp `autoplayError` thì hiện nút "Bật âm thanh" |
| Tab JS cũ | `CLIENT_OUTDATED` ([§4.2](#42-giao-thức-1-1)) |
| Giá khi RealtimeKit tính phí (GA) | $0,002 mỗi người mỗi phút (có video), $0,0005 (chỉ âm thanh). Ví dụ: 1.000 phút gọi 1-1 video mỗi tháng tốn khoảng $4 |
| SDK 2.x mới ra (2.0.0 ra ngày 2026-06-18, có thay đổi phá vỡ tương thích) | Ghim đúng phiên bản trong `package.json` |

---

## 11. Giả định cần kiểm chứng ở bước đầu của plan

Tài liệu không nói rõ các điểm dưới đây. Task đầu tiên của plan là một probe thật trên app `daln-dev` để xác nhận chúng. Nếu probe cho kết quả khác, thiết kế sẽ được chỉnh lại và báo cho người dùng trước khi code tiếp.

1. `POST /presets` có bắt buộc trường `ui.design_tokens` không.
2. `addParticipant` với cùng `custom_participant_id` hai lần: trả lỗi, hay tạo người tham gia thứ hai? Nhiều tab của cùng một người cần mỗi tab một participant riêng.
3. `DELETE` participant có đá người đó khỏi phiên đang chạy không. Thiết kế đã gọi `kick` có chọn lọc trước, để không phụ thuộc vào câu trả lời.
4. Tên trường thật trong payload webhook (`participant.customParticipantId`, `meeting.id`), và độ trễ của `participantLeft` khi đóng tab đột ngột.
5. Preset với video `NOT_ALLOWED`: `enableVideo()` ở client bị từ chối rõ ràng, hay chỉ im lặng không có tác dụng.
6. Khi `defaults.video: false`, sau đó gọi `enableVideo()` giữa cuộc gọi, video có được phát ra không mà không cần join lại.

### 11.1 Kết quả probe (2026-09-27, app daln-dev)

| Giả định | Kết quả thật | Hệ quả cho code |
|---|---|---|
| Thêm participant trả `data.id`, `data.token` | Đúng: 201, có `data.id` và `data.token` (JWT, `exp` sau 100 ngày) | Dùng như thiết kế |
| Trùng `custom_participant_id` | 201, trả **cùng** participant (cùng `participantId` trong JWT), cấp token mới | Không ảnh hưởng: id luôn kèm hậu tố ngẫu nhiên nên không bao giờ trùng |
| Phòng lạ → 404 | Đúng: 404 `Meeting … not found` | `addParticipant` thử lại khi gặp 404 |
| Phòng INACTIVE → mã gì | 201: vẫn thêm được người tham gia | Không đổi code: gateway không bao giờ vô hiệu hoá phòng. Chặn vào phòng ở phòng INACTIVE (nếu có) nằm ở bước join, không ảnh hưởng luồng |
| Kick khi không có phiên | 200, `participants: []` | `revoke` chạy bình thường |
| Xoá participant | 200 | `revoke` dùng như thiết kế |
| `ui` bắt buộc khi tạo preset | **Có**: thiếu `ui` thì 400 (`ui` required). Các quyền `accept_waiting_requests`, `can_accept_production_requests`, `can_edit_display_name`… cũng bắt buộc | `rtk:setup` luôn gửi đủ `permissions` và `ui` |
| Định dạng `publicKey` | PEM (`-----BEGIN PUBLIC KEY-----…`) | `toPem()` giữ nguyên PEM, vẫn xử lý base64 trần để phòng |
| `GET /webhooks` khi chưa có webhook | **404** `Webhook not found` (không phải mảng rỗng) | `rtk:setup` coi 404 ở `GET /webhooks` là danh sách rỗng |
| Preset có `config.media.video.simulcast` | Có (preset mặc định: `{quality:'hd', frame_rate:24, simulcast:true}`) | Giữ trường `simulcast` như thiết kế |

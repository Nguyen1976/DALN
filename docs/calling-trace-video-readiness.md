# Trace gọi thoại hiện tại và chuẩn bị gọi video

Ngày kiểm tra: 2026-09-15. Nguồn: code frontend/backend và cấu hình triển khai trong repository. Đây là trace tĩnh, kèm chạy test hiện có; chưa xác nhận chất lượng media giữa hai thiết bị thật hoặc môi trường production. Không thay đổi logic ứng dụng.

## 1. Kết luận kiến trúc

| Phần | Gọi 1-1 | Gọi nhóm n-n |
|---|---|---|
| Hội thoại | DIRECT | Frontend chọn GROUP |
| Điều phối ứng dụng | Socket.IO `/realtime`, event `call.*` | Socket.IO `/realtime`, event `group_call.*` |
| Media | WebRTC P2P, relay coturn khi cần | LiveKit SFU; mỗi client kết nối phòng, không tự nối tới từng người |
| SDK/API frontend | `RTCPeerConnection`, `getUserMedia` | `livekit-client`, `Room` |
| Phân quyền | Gateway hỏi chat service lấy peer hợp lệ | Gateway hỏi chat service lấy thành viên |
| Trạng thái server | Redis theo callId | Redis theo conversationId và con trỏ callId |
| Lịch sử | Event RabbitMQ tới chat service | Webhook LiveKit rồi HTTP tới chat service |
| Video hiện tại | Chưa bắt camera, chưa render video | Chưa publish/render camera |

Nút video trong `frontend/src/components/ChatWindow/index.tsx` có icon và nhãn nhưng **không có onClick**; bị ẩn dưới breakpoint `sm`. Dependency Agora có trong package.json nhưng không tìm thấy sử dụng trong `frontend/src`; luồng gọi hiện tại không dùng Agora.

## 2. Điểm vào và phạm vi sống của cuộc gọi

- `frontend/src/App.tsx`: gắn `IncomingCallManager` khi có user; nhận cuộc gọi đến trên phạm vi ứng dụng.
- `frontend/src/components/ChatWindow/index.tsx`: nút điện thoại gọi `onVoiceCall`.
- `frontend/src/pages/Chat/index.tsx`: `handleVoiceCall` kiểm loại hội thoại. GROUP gửi `group_call.start`, nhận token rồi mở `GroupCallModal`; còn lại mở `VoiceCallModal` outgoing.
- Cuộc gọi đi lưu trong state của ChatPage. Cuộc gọi đến lưu riêng trong IncomingCallManager. Chưa có một coordinator chung giữ duy nhất một phiên cho toàn ứng dụng.
- Modal unmount sẽ dọn media. Riêng 1-1, cleanup khi unmount không tự gửi `call.ended`; cần chú ý khi rời trang chat, refresh hoặc đóng tab.

## 3. Luồng 1-1 thành công

1. ChatPage mở `VoiceCallModal`; effect outgoing gọi `useWebRTC.startCall(conversationId)` một lần cho instance modal.
2. `acquireLocalAudio()` gọi `navigator.mediaDevices.getUserMedia({ audio: true })`; timeout lấy micro 15 giây.
3. Hook xin ICE qua ack `call.ice_config`. Gateway gọi `buildIceConfig(userId)` trong `turn-credentials.ts`. Có TURN thì cấp credential HMAC-SHA1 ngắn hạn; mặc định TTL 3600 giây. Frontend cache theo TTL, trừ 60 giây. Timeout ack 5 giây hoặc thiếu cấu hình thì dùng hai STUN Google.
4. Hook tạo `RTCPeerConnection({ iceServers })`, add các local track, tạo SDP offer và setLocalDescription.
5. Frontend gửi `call.incoming_call { conversationId, offer }`; chờ ack tối đa 5 giây. Không gửi targetUserId.
6. `RealtimeGateway.handleIncomingCall` lấy caller từ socket đã xác thực, gọi HTTP internal `/chat/internal/call-peer`, có `x-internal-token`. Chat kiểm hội thoại tồn tại, là DIRECT, người gọi là thành viên ACTIVE và còn peer ACTIVE.
7. Gateway tạo UUID callId, lưu `call:<callId>` với status ringing, TTL 60 giây; phát incoming tới room `user:<calleeId>`. Ack cho caller có callId.
8. `IncomingCallManager` nhận offer và mở modal incoming. Người nhận bấm nghe: hook lưu callId, lấy micro, tạo peer connection, setRemoteDescription(offer), tạo answer và gửi `call.accepted { callId, answer }`.
9. Gateway kiểm session và chỉ callee được accept, đánh dấu connected với thời gian server, gia hạn TTL 4 giờ, relay answer tới caller.
10. Caller setRemoteDescription(answer). Hai bên trao đổi `call.ice_candidate { callId, candidate }` qua gateway. Local candidate sinh trước ack được đệm; remote candidate tới trước remote description cũng được đệm.
11. `ontrack` đặt remoteStream; modal gắn vào audio element rồi gọi play. UI chỉ chuyển connected và bắt đầu đếm giờ khi connectionState/iceConnectionState kết nối thành công.
12. Media chạy trực tiếp giữa hai trình duyệt nếu ICE chọn được đường P2P; khi cần relay thì đi qua coturn. Socket.IO và chat service không vận chuyển audio.

### Trạng thái và kết thúc

- Các trạng thái hook: idle, calling, ringing, connecting, connected, ended, rejected, no_answer, unreachable. Trong thực tế incoming dùng idle để hiển thị chuông; `ringing` có trong type nhưng chưa được set trong hook.
- Chuông 1-1: 30 giây. Caller hết thời gian gửi ended với reason no_answer; incoming hết thời gian chỉ cleanup/đóng modal.
- Connecting quá 15 giây hoặc ICE failed: ended với reason unreachable. Disconnected được chờ phục hồi 5 giây.
- Mute: đảo `audioTrack.enabled`; không có event mute riêng tới peer.
- Reject: gateway relay cho caller và DEL session; chỉ lần DEL thành công mới ghi kết quả.
- End: gateway suy peer/conversation từ session, relay ended, DEL session để chống hai bên ghi trùng; phát RabbitMQ `CALL_ENDED` tới chat subscriber.
- Chat `MessageService.recordCallOutcome` kiểm lại thành viên, tạo tin TEXT `isSystem: true`, cập nhật hội thoại và publish đồng bộ realtime. Nội dung hiện hardcode “Cuộc gọi thoại…”.
- **Hai mốc thời gian khác nhau:** UI tính từ lúc ICE connected; lịch sử server tính từ lúc callee gửi answer. Vì vậy thời lượng lịch sử có thể dài hơn thời gian UI.

## 4. Luồng nhóm n-n thành công

1. ChatPage gửi `group_call.start { conversationId }`.
2. Gateway gọi `/chat/internal/call-members` kiểm quyền; lấy danh sách ACTIVE. Tạo roomName ổn định `conv_<conversationId>` và ký JWT LiveKit theo identity=userId, name=username, TTL 10 phút.
3. `GroupCallStore.getOrCreate` đọc phiên hiện có hoặc tạo mới: `groupcall:<conversationId>` và `groupcall:call:<callId>`, TTL 12 giờ. Phiên chứa startedBy, startedAt, members snapshot, participants và seen.
4. Gateway phát `group_call.incoming` tới các thành viên khác; ack cho caller `{ ok, callId, roomName, url, token }`. Bấm start khi phòng đang mở trả phiên đó và vẫn phát lại chuông tới người khác.
5. Caller mở `GroupCallModal`; `useGroupCall` tạo `new Room()`, `room.connect(url, token)`, rồi `setMicrophoneEnabled(true)`.
6. Người nhận nghe chuông trong IncomingCallManager; bấm accept gửi `group_call.accept { callId }`. Gateway kiểm membership theo snapshot của session và cấp token vào cùng phòng. Người nhận cũng connect và bật micro.
7. LiveKit quản lý SDP/ICE và phân phối audio; gateway ứng dụng không relay SDP/ICE của nhóm. Mỗi người publish lên SFU; các người còn lại subscribe.
8. Hook xử lý TrackSubscribed chỉ cho audio: attach audio element vào container ẩn. SDK participant events cập nhật tên, local/remote, speaking và muted.
9. LiveKit gửi webhook `/livekit/webhook`, body raw; controller verify bằng WebhookReceiver và Authorization. `participant_joined/left` cập nhật Redis rồi gateway phát `group_call.state` tới members.
10. GroupCallModal gộp roster gateway với participant từ SDK; SDK được ưu tiên cho speaking/mute. Đồng hồ của mỗi người bắt đầu sau khi connect và bật micro thành công.
11. Leave: client disconnect LiveKit, gửi `group_call.leave { callId }`, gateway bỏ participant lạc quan. Webhook participant_left đồng bộ lại. Decline chỉ phát state, không đóng phòng hoặc lưu danh sách declined.
12. Khi phòng đóng, webhook room_finished: gateway tính duration từ lúc start tới lúc nhận webhook, participantCount=seen.length; gọi HTTP `/chat/internal/group-call-log`, phát ended tới members và xóa phiên Redis.

### Cấu hình media nhóm

- Dev: `deploy/livekit/livekit.dev.yaml`, room empty/departure timeout 5 giây, node_ip 127.0.0.1; phục vụ trình duyệt trên host, không phù hợp để thử trực tiếp từ điện thoại/máy khác nếu chưa chỉnh network.
- Prod: `deploy/livekit/livekit.prod.yaml`, empty/departure timeout 20 giây; WebSocket qua nginx `/livekit/` tới 7880; RTC TCP 7881 và UDP mux 50000 public trực tiếp theo compose.
- Comment vẫn nhắc dải UDP 50000-50199 nhưng cấu hình thực tế dùng `udp_port: 50000` và publish một cổng. Khi kiểm hạ tầng cần đọc giá trị thực thay vì comment.
- Coturn cho 1-1 và ICE của LiveKit là hai cấu hình riêng. Hook nhóm không gọi `call.ice_config`; chưa thấy cấu hình TURN của LiveKit trong hai YAML này.
- Thời lượng lịch sử nhóm gồm thời gian trước người đầu connect và khoảng chờ đóng phòng sau người cuối leave; không tương đương thời lượng media của mỗi người.

## 5. Các khoảng trống cần xử lý trước hoặc cùng đợt video

Các mục sau là quan sát từ code; các tình huống race chưa được tái hiện bằng nhiều client thật.

| Mức ưu tiên | Phát hiện | Hệ quả / hướng xử lý |
|---|---|---|
| Cao | Chat getCallMembers không trả type; gateway chỉ chặn NOT_GROUP khi response có type | Client tự gửi group_call.start cho DIRECT vẫn được cấp phòng. Trả type và kiểm GROUP bắt buộc ở server. Test hiện có cũng cho phép getCallMembers trả DIRECT. |
| Cao | Không có busy lock/coordinator chung; signaling phát tới tất cả socket của user | Nhiều modal/cuộc gọi hoặc nhiều tab cùng accept có thể tranh phiên. Chốt busy phía server và chọn socket thắng accept; coordinator toàn ứng dụng. |
| Cao | getOrCreate và cập nhật participants dùng read-modify-write Redis không atomic | Start đồng thời có thể sinh nhiều callId; webhook đồng thời có thể mất roster/seen. Dùng thao tác atomic/transaction hoặc lock thích hợp. |
| Cao | Phiên nhóm được tạo trước connect; nếu không ai connect, có thể không có room_finished | Session/chuông có thể còn tới TTL. Cần deadline cho phiên pending và xử lý join thất bại. UI chuông nhóm dùng duration cho avatar nhưng chưa có timer tự decline/đóng. |
| Cao | Snapshot members dùng lại khi accept; không hỏi quyền hiện tại | Người đã bị loại vẫn có thể xin token từ phiên cũ. Revalidate quyền và xét thu hồi participant/token theo nghiệp vụ. |
| Cao | Group token canPublish=true, không có canPublishSources | Server chưa enforce audio-only; client khác có thể publish camera dù UI không hỗ trợ. Chốt nguồn microphone/camera theo chính sách video. |
| Cao | Group room_finished không có khóa chống xử lý trùng; kết quả postGroupCallLog bị bỏ qua; controller trả 200 cả lỗi xử lý | Nguy cơ mất log khi chat lỗi, hoặc log trùng khi event xử lý đồng thời. Dùng callId/eventId để idempotent và bảo đảm retry/outbox. |
| Vừa | Frontend accept 1-1 không xử lý ack; chưa chặn accept lại bằng chuyển trạng thái atomic | Cần xử lý session hết hạn/accept ở tab khác và tránh ghi lại phiên vừa ended. |
| Vừa | isSameCall của modal 1-1 chấp nhận mọi callId khi ref chưa có | Có cửa sổ nhận candidate/ended của phiên khác lúc đang setup hoặc chưa accept. Gắn callId incoming từ đầu và filter chặt. |
| Vừa | getUserMedia dùng Promise.race nhưng không stop stream resolve sau timeout | Quyền được cấp muộn có thể để track sống ngoài state; cần cleanup kết quả media muộn và hủy setup theo generation/session. |
| Vừa | Cleanup khi unmount 1-1 không emit ended; disconnect socket không xử lý call session | Peer/lịch sử có thể chờ timeout hoặc mất kết quả nếu tab bị đóng. Thiết kế recovery/end khi client biến mất. |
| Vừa | Backend không kiểm online callee trong handleIncomingCall | Type frontend có CALLEE_OFFLINE nhưng backend hiện không trả mã này; offline dẫn tới chờ chuông rồi missed. |
| Vừa | useGroupCall bắt lỗi connect/micro chung và chỉ set error; chưa tự rời phòng trong catch | Có thể đã vào phòng nhưng micro thất bại; cần phân loại lỗi và chọn giữ chế độ nghe hoặc disconnect rõ ràng. |
| Vừa | Chưa xử lý trạng thái reconnecting/reconnected trên UI nhóm; 1-1 chưa có ICE restart/renegotiation | Bổ sung recovery và trạng thái kết nối trước khi video tăng yêu cầu băng thông. |

Tài liệu `docs/voice-call-webrtc-1-1.md` có mô tả cũ “gateway chỉ relay, không lưu call state”. Code hiện đã lưu session Redis và phân quyền qua chat service; nên dùng trace này làm mốc khi triển khai.

## 6. Phương án mở rộng video

Đề xuất cho đợt đầu: mở rộng hai transport đang có — video 1-1 tiếp tục P2P/TURN, video nhóm tiếp tục LiveKit. Phạm vi thay đổi nhỏ hơn việc chuyển toàn bộ 1-1 sang SFU. Nếu muốn đồng nhất transport lâu dài, có thể đánh giá chuyển 1-1 sang LiveKit trong một đợt riêng với thay đổi token, room lifecycle và chi phí media.

### Hợp đồng chung

- Thêm callType `audio | video` vào start/incoming, server session, ack nhóm và payload log. Server validate giá trị; payload cũ thiếu callType mặc định audio để giữ tương thích.
- CallType mô tả cuộc gọi được khởi tạo; cameraEnabled là trạng thái từng người, không đổi callType thành audio khi một người tắt camera.
- Chốt hành vi khi camera bị từ chối: cho tiếp tục bằng audio nếu người dùng chọn, đồng thời giữ nguyên trạng thái signaling đúng phiên.
- Đợt đầu khởi tạo video ngay từ đầu; nâng cấp cuộc gọi audio đang chạy lên video cần hợp đồng đồng ý/renegotiation riêng.
- Giữ nguyên kết quả completed/rejected/missed/unreachable; đổi nội dung log theo callType. Hiện log chỉ là text, chưa có dữ liệu cấu trúc hỗ trợ nút gọi lại/phân tích callId.

### Video 1-1

- `useWebRTC`: thay acquireLocalAudio bằng acquireLocalMedia(callType), yêu cầu audio và camera trước createOffer; addTrack hiện đã duyệt getTracks nên có thể dùng lại khi stream có cả hai loại track.
- Đảm bảo bên nhận acquire cùng loại media; offer/answer hiện relay được SDP có video, nhưng cần callType rõ ràng để UI xin quyền và hiển thị đúng.
- Thêm trạng thái camera và sender video; hiển thị remote video cùng local preview muted/playsInline. Tránh phát audio hai lần nếu remote stream vừa gắn video vừa gắn audio element.
- Đổi camera dùng sender.replaceTrack với track cùng kind; khi thay đổi cần negotiation thì phải xử lý rõ. Hook hiện không có onnegotiationneeded hoặc kênh renegotiation.
- Nếu cho bật camera sau khi khởi tạo audio-only, cần negotiate video trước bằng transceiver hoặc xây dựng renegotiation; không chỉ gọi thêm getUserMedia.
- Cleanup phải stop toàn bộ camera/micro và track thay thế; loại kết quả setup muộn sau khi cuộc gọi đã kết thúc.

### Video nhóm

- `useGroupCall`: sau room.connect, bật camera theo callType bằng `room.localParticipant.setCameraEnabled(true)`.
- Mở rộng model participant/publication: videoTrack, cameraEnabled; xử lý attach/detach video cho remote và local preview. Hiện handler chỉ attach audio, nên bật camera đơn thuần chưa tạo hình ảnh trên UI.
- Phân biệt source camera với microphone; screen share chưa nằm trong phạm vi mặc định.
- Token grant cho phép microphone/camera theo chính sách; không cần viết lại signaling SDP/ICE phía gateway.
- `GroupCallModal`: grid video responsive, avatar khi tắt camera, mute badge, trạng thái mạng, chọn camera và audio playback recovery.
- Đánh giá adaptiveStream/dynacast/simulcast và giới hạn số ô video active sau khi đo tải; Room hiện dùng mặc định, adaptiveStream/dynacast đang false trong SDK cài tại máy.
- Chốt một room audio/video chung cho hội thoại hay room riêng. Đề xuất giữ một phiên mỗi hội thoại; nếu phòng audio đang mở và người khác bấm video thì phải có hành vi rõ ràng, không tự ghi đè callType của phiên.

Tham khảo API đã đối chiếu: [LiveKit camera/microphone](https://docs.livekit.io/transport/media/publish/), [MDN replaceTrack và giới hạn negotiation](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpSender/replaceTrack). SDK đang cài cũng có setCameraEnabled và canPublishSources; cần kiểm tra theo phiên bản trong lockfile khi triển khai.

## 7. Thứ tự triển khai và kiểm chứng

1. Sửa quyền GROUP, busy/multi-tab, quản lý phiên atomic và cleanup pending; làm rõ retry/idempotency log.
2. Thêm callType xuyên frontend, signaling, Redis và chat log; nối nút video.
3. Triển khai video 1-1 từ lúc bắt đầu gọi, camera mute/switch và media cleanup.
4. Triển khai video nhóm trên Room hiện có, quản lý publication và grid video.
5. Kiểm chứng trên hai profile độc lập cho 1-1 và ít nhất ba profile cho nhóm; không chỉ hai tab cùng cookie.

Các tình huống cần test: accept/reject/missed/cancel; camera bị từ chối nhưng micro có quyền; thiếu camera; người gọi hủy trong khi đang xin quyền; caller/callee offline; gọi đồng thời; hai tab cùng accept; người bị loại khỏi nhóm; start/join/leave đồng thời; webhook duplicate/out-of-order; chat service lỗi khi ghi log; refresh/rời route; reconnect; audio hoạt động khi camera tắt; chuyển camera; Safari/mobile playsInline/autoplay; P2P và TURN relay trên hai mạng khác nhau; nhóm từ LAN/mobile với cấu hình ICE LiveKit phù hợp.

Đã chạy 7 test suite hiện có: realtime.gateway, group-call.store, livekit-token, turn-credentials, conversation.service.call-peer, conversation.service.call-members và message.service.group-call-log. Kết quả **54/54 test pass**. Các test này kiểm logic/mock, không chứng minh video/media/network thực tế và không bao phủ hết các race nêu trên.

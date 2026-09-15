# Ngữ cảnh server media DALN

Kiểm tra SSH chỉ đọc ngày 2026-09-15 tại 109.199.115.126. Không thay đổi cấu hình, restart/deploy dịch vụ hoặc chạy benchmark. Không lưu thông tin đăng nhập/secret vào tài liệu.

## Đã xác nhận

| Thành phần | Quan sát trực tiếp |
|---|---|
| VPS | Ubuntu 24.04.5 LTS; 4 logical CPU; RAM 7941 MiB, available khoảng 5288 MiB lúc kiểm tra; swap 4 GiB |
| Tải tại thời điểm kiểm tra | Load average 0.56 / 0.61 / 0.62; đây là snapshot, không phải khả năng chịu tải video |
| Disk | Root 96 GiB, dùng 58 GiB, còn khoảng 39 GiB |
| Coturn | Dịch vụ systemd active và enabled, chạy trên host |
| TURN listeners | Public UDP/TCP 3478; TLS TCP 5349; cấu hình realm nguyen1976.xyz, external-ip 109.199.115.126 |
| TURN relay | UDP 49152–49999; user-quota=12, total-quota=1200; không có max-bps/bps-capacity trong các dòng cấu hình active đã kiểm |
| TURN auth | use-auth-secret; secret gateway đã so sánh khớp secret coturn, chỉ xuất boolean kết quả |
| TURN policy | no-tcp-relay; chặn multicast và các dải private/loopback. no-tcp-relay không đồng nghĩa tắt listener TCP/TLS giữa client và TURN |
| LiveKit | Container daln-prod-livekit, image livekit/livekit-server:v1.7; running, restart count 0 lúc kiểm tra |
| SFU ports | API 127.0.0.1:7880; RTC public TCP 7881 và UDP mux 50000 |
| LiveKit URL | Gateway cấu hình wss://nguyen1976.xyz/livekit; nginx proxy /livekit/ vào 127.0.0.1:7880 |
| LiveKit auth | LIVEKIT_API_KEY=daln; secret gateway đã so sánh khớp LIVEKIT_KEYS container, chỉ xuất boolean |
| LiveKit room | empty_timeout=20, departure_timeout=20; node_ip=109.199.115.126, use_external_ip=false |
| LiveKit webhook | http://realtime-gateway:3001/livekit/webhook trong network Docker; cấu hình api_key=daln |
| SFU TURN | Không có mục turn trong YAML production được mount đang kiểm tra; gateway nhóm hiện chưa cung cấp cấu hình TURN như hook 1-1 |
| Firewall host | UFW active, cho phép 3478 UDP/TCP, 5349 TCP, relay UDP 49152–49999, UDP 50000–50199, TCP 7881, HTTP/HTTPS và SSH |
| Dịch vụ cùng máy | Web, Kong, realtime, chat, user, notification, recommendation/worker, saga, MongoDB, Redis, RabbitMQ, Qdrant, MinIO và LiveKit |

## Kiểm tra kết nối

- Từ máy làm việc gửi một STUN Binding Request tới public UDP 3478: nhận Binding Success Response, đúng transaction ID.
- Từ máy làm việc kết nối TLS tới IP với SNI nguyen1976.xyz: cổng 5349 verify chứng chỉ thành công (TLS 1.2), cổng 443 thành công (TLS 1.3). Chứng chỉ hết hạn 2026-12-12 11:15:30 GMT tại thời điểm kiểm tra.
- HTTP API LiveKit trên localhost 7880 trả 200.
- Chưa kiểm TURN Allocate/authenticated relay end-to-end, SFU room join từ ngoài, signed webhook delivery thực tế hoặc chất lượng media giữa các thiết bị.
- Các port listener/UFW không chứng minh toàn bộ đường truyền external hoạt động; chưa kiểm firewall upstream của nhà cung cấp.

## Điều chỉnh thiết kế video

1. Dùng lại coturn host cho 1-1 audio/video; không cần thêm TURN server chỉ vì thêm camera. Giữ cơ chế credential ngắn hạn của gateway.
2. Giữ LiveKit SFU trên cùng VPS cho nhóm v1. Không coi các kết quả snapshot là bảo đảm 9 người video hoặc số phòng đồng thời; 9 người/phòng trong thiết kế vẫn là giới hạn sản phẩm đề xuất, cần benchmark xác nhận.
3. TURN của nhóm phải kiểm/cấu hình riêng; client nhóm chưa lấy call.ice_config. TCP 7881 là fallback tới SFU, không tương đương TURN TLS 5349 khi mạng chỉ cho một số cổng outbound.
4. Nếu tận dụng coturn chung cho SFU, kiểm candidate public, authentication, relay tới SFU trên cùng host và chính sách denied-peer-ip. Không mở private ranges chỉ để xử lý thử kết nối.
5. Coturn và LiveKit dùng dải/cổng khác nhau nên cấu hình hiện không xung đột relay port. LiveKit thực tế mux trên UDP 50000; dải firewall 50000–50199 rộng hơn port đang dùng.
6. Cả TURN relay và SFU đều tiêu thụ egress VPS khi có video; SFU chuyển media cho nhiều subscriber. Đo bandwidth/loss/CPU khi gọi, giữ audio ưu tiên, hạn chế resolution và số tile active. Quota coturn là giới hạn allocations, không phải số cuộc gọi video có thể phục vụ.
7. Benchmark cần theo dõi cả backend/DB vì dùng chung VPS; cân nhắc tách SFU/TURN khi tài nguyên hoặc chất lượng media ảnh hưởng chat, thay vì migration transport toàn bộ ngay từ đầu.

Các đường dẫn remote chỉ để đối chiếu: /etc/turnserver.conf, /root/workspace/DALN/deploy/livekit/livekit.prod.yaml và /etc/nginx/sites-enabled. Không ghi password hoặc secret vào tài liệu/code.

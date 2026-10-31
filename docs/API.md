> **Cập nhật:** Hợp đồng đăng ký/đăng nhập username, email tùy chọn, proof-of-work và chọn ghế nằm ở [SINGLE_GAME.md](SINGLE_GAME.md). Chơi game/Admin không bị chặn bởi xác minh email.

> V12 bổ sung `/character/appearance`, `/character/move`, `/character/return` và đường đi trong snapshot; xem [hợp đồng và trạng thái V12](CHANGELOG_V12.md).

# API thực thi hiện tại

Cùng origin, prefix `/api`; JSON, `Cache-Control: no-store`, `X-Request-Id`. POST của trình duyệt cần `Origin=APP_ORIGIN`, `X-Temple-Request: 1`, `Content-Type: application/json`. Token phiên chỉ ở cookie HttpOnly. Lỗi `{code,error}`; 400 dữ liệu sai, 401 phiên/mật khẩu/chữ ký sai, 403 quyền/xác minh/MFA, 409 xung đột, 429 cooldown/rate limit, 503 dịch vụ chưa sẵn sàng.

| API                                                           | Ý nghĩa                                                                          |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------ |
| GET `/health/live`, `/health/ready`                           | Live; readiness kiểm tra DB/Redis/worker                                         |
| POST `/auth/register`                                         | `{username,dharmaName,password,email?,challenge}`; 201, `{user}`                 |
| POST `/auth/login`                                            | `{username,password}` (hỗ trợ email cũ); xoay phiên cũ của trình duyệt           |
| POST `/auth/logout`                                           | `{}`; thu hồi phiên hiện tại và rời phòng                                        |
| GET `/me`                                                     | `{user:null}` hoặc `{id,name,role,verified,coins,equipped,accessory,inventory}`  |
| POST `/auth/resend-verification`                              | `{}`; cần đăng nhập                                                              |
| POST `/auth/verify-email`                                     | `{token}`; token một lần, hạn 24h                                                |
| POST `/auth/forgot-password`                                  | `{email}`; phản hồi chung                                                        |
| POST `/auth/reset-password`                                   | `{token,password}`; hạn 30 phút, đổi mật khẩu và thu hồi mọi phiên               |
| GET `/catalog`                                                | Catalog áo, giá do server quyết định                                             |
| POST `/wardrobe/buy`                                          | `{outfitId,requestKey:UUID}`; không nhận giá/số dư client                        |
| POST `/wardrobe/equip`                                        | `{outfitId,accessory:'none'                                                      | 'beads'                                                  | 'lotus'}`; cần sở hữu áo |
| GET `/room`                                                   | Snapshot công khai: config/version/counts/36 ghế và nhân vật; không email/mã băm |
| GET `/room/me`, `/waitlist/me`                                | Trạng thái chỗ/hàng chờ của mình; `/room/me` có nghi lễ hiện tại                 |
| POST `/room/join`                                             | `{requestKey:UUID}`; không cần email xác minh, ACTIVE hoặc WAITING               |
| POST `/room/leave`, `/waitlist/cancel`                        | `{}`; rời và mời người chờ tiếp                                                  |
| POST `/waitlist/accept`                                       | `{}`; chấp nhận INVITED chưa hết hạn                                             |
| POST `/room/heartbeat`                                        | `{}`; gia hạn disconnect deadline, không hồi sinh ghế hết hạn                    |
| POST `/actions/bow`, `/actions/prostrate`, `/actions/incense` | `{requestKey:UUID}`; server quyết định trạng thái/cooldown                       |
| GET `/live/status`, `/live/recent`                            | Phân biệt mock/bridge sẵn sàng với TikTok thật                                   |
| POST `/integrations/live/events`                              | Hợp đồng bridge có HMAC; xem LIVE.md, không phải TikTok API chính thức           |
| GET `/admin/mfa/status`                                       | ADMIN: required=false, active=true; OPERATOR/MODERATOR: trạng thái phiên MFA     |
| POST `/admin/mfa/enroll`, `/admin/mfa/verify`                 | Enrollment riêng; verify `{code}`; mã không dùng lại                             |
| GET `/admin/dashboard`                                        | ADMIN đã đăng nhập; OPERATOR cần phiên MFA còn hạn                               |
| GET `/admin/config`, `/admin/audit`                           | Chỉ ADMIN đã đăng nhập; không cần MFA                                            |
| POST `/admin/config/draft`                                    | `{config,expectedId:string                                                       | null}`; optimistic draft ID                              |
| POST `/admin/config/publish`, `/admin/config/rollback`        | `{id:string}`; tạo revision mới và outbox                                        |
| POST `/admin/room/status`                                     | `{status:'open'                                                                  | 'closed'}`; ADMIN, không kick người cũ khi đóng nhận mới |
| POST `/admin/room/kick`                                       | `{userId,reason}`; ADMIN, có audit                                               |
| POST `/admin/live/mock`                                       | ADMIN đã đăng nhập hoặc OPERATOR + MFA; provider luôn mock                       |
| POST `/admin/tts/skip`                                        | `{id:UUID}`; ADMIN đã đăng nhập hoặc OPERATOR + MFA                              |
| POST `/admin/broadcast/token`                                 | Token scoped 30 phút, khác quyền quản trị                                        |
| POST `/broadcast/claim`, `/broadcast/complete`                | Header `X-Broadcast-Token`, claim một consumer; complete `{id}`                  |
| GET `/broadcast/audio/:id`, `/broadcast/state/:id`            | Cùng token broadcast còn hạn                                                     |

Socket.IO chỉ WebSocket, Origin chính xác. Event `temple.event` có `eventId`, `sequence`, `kind`, `payload`, `serverTime`. Outbox có thể giao lại; client không suy diễn trạng thái từ chuỗi event, luôn lấy snapshot khi thông báo/reconnect và có polling dự phòng. Không có socket client-side để sửa ghế/xu hoặc giả quà.

Mở rộng LIVE: GET `/api/admin/live/analytics`, POST `/api/admin/ceremonies/test` (ADMIN đã đăng nhập hoặc OPERATOR + MFA; diễn tập giới hạn 3/phút, có audit). Snapshot `/api/room` có `effect`, `ceremony`, `nextCeremony`; `experience.changed` báo đổi trạng thái. Cấu hình `config.live` nằm trong API nháp/xuất bản hiện có: mapping hiệu ứng, giọng, TTS bật/tắt, tên nhân vật, duck volume, lịch bật/tắt và chu kỳ 10–15 phút. Không có endpoint test công khai hoặc việc tự cấp ghế qua sự kiện LIVE.

`room_entries` là bảng canonical duy nhất cho ACTIVE/WAITING/INVITED/hết phiên; partial unique index áp dụng xuyên cả ghế và hàng chờ, tránh lỗi đồng thời ở hai bảng độc lập. INVITED giữ ghế và được tính vào occupancy. Ràng buộc FK/seat range 1..72 (sức chứa mặc định 36) và khóa hàng phòng serialize cấp ghế. `commands` lưu idempotency cho join/nghi lễ: replay sau khi đã rời không tạo lượt tham gia mới. Migration SQL có checksum, không sửa migration đã áp dụng.

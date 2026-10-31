# Đối chiếu V8 và kế hoạch triển khai

Ngày: 31/10/2026. Đối chiếu hai tài liệu đính kèm với source `main` hiện tại. Tài liệu bàn giao là đặc tả mục tiêu, không phải bằng chứng tính năng đã chạy. Giữ React/Vite + Express/PostgreSQL/Redis/BullMQ hiện có; chưa chuyển Next/Nest vì việc đó không cần cho nghiệp vụ bổ sung và sẽ mở rộng rủi ro migration.

| Nhóm                                | Trước thay đổi                | Sau thay đổi và bằng chứng                                                                                                                                                   |
| ----------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Username, pháp danh, email tùy chọn | Đã có                         | Giữ nguyên, HTTP/e2e hồi quy                                                                                                                                                 |
| Một màn hình, 36 ghế miễn phí/FIFO  | Đã có                         | Giữ nguyên, 100 join đồng thời; tải 36 active + 500 waiting                                                                                                                  |
| Xu theo phút                        | Chưa có                       | Thêm cursor PostgreSQL, ledger nguồn duy nhất, cap 240/ngày giờ Việt Nam, không cộng lại khi reconcile lặp                                                                   |
| Công đức riêng xu                   | Chưa có                       | Thêm số dư và ledger theo action ID, chỉ thưởng khi hoàn tất trong thời hạn ghế                                                                                              |
| Hồi chiêu/nghi lễ                   | Một phần, mặc định cũ         | Mặc định 60/180/300 giây; 2/4/5 giây; cooldown tính started_at                                                                                                               |
| Tủ đồ                               | Đã có, catalog trong code     | Giữ atomic buy/equip; thêm ledger chi; tên/giá 4 mẫu sẵn có chỉnh được trong CMS                                                                                             |
| 8 chấm                              | Chưa có                       | Mở tuần tự 4 cặp 200/500/1000/2000, giá CMS, số dư khóa transaction, chấm theo đầu nhân vật                                                                                  |
| Xếp hạng                            | Chưa có                       | Snapshot 300 giây, Merit và quà LIVE riêng, hạng cá nhân cùng snapshot                                                                                                       |
| Sảnh chờ                            | Chỉ số người/vị trí           | Thêm tối đa 18 avatar SVG trong cùng UI, vẫn một hàng chờ DB                                                                                                                 |
| Chat                                | Chưa có                       | Overlay, một Socket.IO connection, subscribe riêng, lịch sử 50 tin/cache Redis, PostgreSQL retention 30 ngày                                                                 |
| Kiểm duyệt                          | Chưa có                       | Reject/pending/approve, normalize tiếng Việt, nhận diện một số né từ, report, mute riêng, MFA Moderator, ngoại lệ nguyên câu, kháng nghị và audit                            |
| Nhật ký/lời nguyện/tìm người        | Chưa có                       | Popup tải khi mở; chọn câu mẫu CMS; tìm pháp danh và đánh dấu ghế                                                                                                            |
| Ngày/đêm/eco                        | Một phần                      | Ánh sáng giờ Việt Nam/override CMS, desktop 60/mobile 30/eco 20 FPS; chưa có tự đo FPS và giảm resolution động                                                               |
| Thiền chung                         | Đã có scheduler, mặc định tắt | Giữ lịch và quyền bật/tắt trong CMS, chưa tự bật cấu hình đang lưu                                                                                                           |
| Audio                               | Bản thu riêng trên máy        | Thêm import nhiều file, phiên bản immutable, nghe thử, mapping 11 cue + kinh, nút bật audio; chưa có 11 file gốc để gán/kiểm nghe đủ cue                                     |
| Blessings                           | Một mẫu/TTS tùy chọn          | Thêm import thư viện JSON, gán voice static đo ≤10s, tránh 5 mẫu gần nhất nếu đủ mẫu, text fallback, broadcaster ducking; chưa có bộ 48 câu/audio gốc                        |
| TikTok                              | Mock + webhook có chữ ký      | Giữ adapter hiện có, không xác nhận TikTok thật; quà không thay đổi ví/ghế/chấm                                                                                              |
| CMS đầy đủ                          | Một phần                      | Mở rộng kinh tế, giá, chat, audio, blessings; chưa có upload sprite/atlas/background/logo, toàn bộ playlist/content editor, ban/suspend game UI và dashboard giám sát đầy đủ |
| Hiệu năng                           | Chưa có benchmark V8          | Thêm script đo ngắn cục bộ; chưa có soak test production, đo FPS thiết bị thật hay kiểm toán bảo mật độc lập                                                                 |

## Thứ tự và phần tiếp tục

- P0: migration bổ sung và bảo toàn dữ liệu, kinh tế/nghi lễ trước; không sửa checksum migration 001–003. Đã backup local trước khi apply.
- P1: chat/sảnh chờ, moderation và e2e không làm mất canvas/ghế; tích hợp asset audio gốc khi có file.
- P2: mở rộng nội dung CMS còn thiếu, sprite và cảnh dựa trên asset có quyền; adaptive rendering/camera focus và đồ họa hoàn chỉnh. Không coi UI sảnh SVG hiện tại là bản art cuối.
- P3: import bộ 48 lời chúc/voice gốc, nghe kiểm từng cue; TikTok thật cần connector được cấp quyền. Không tự sinh hoặc giả nhận asset từ tài liệu.
- P4: benchmark dài hạn, remote/TLS, monitoring host, load worker, thiết bị mobile thật, accessibility đầy đủ và triển khai production riêng.

## Giới hạn cần giữ rõ

Cập nhật `012_reward_progress.sql`: phần phút hợp lệ được giữ qua các lượt cùng ngày, chốt theo ngày Việt Nam; xem [bản hoàn thiện](ECONOMY_AUDIO_FOLLOWUP.md). Không hồi tố giờ tu trước migration. Ledger mở đầu bảo toàn số dư hiện có; lịch sử trước V8 vẫn ở bảng purchases. Snapshot Tri Ân hiện thống kê quà, ghi rõ provider/mock, không có tỷ giá Coins nếu nguồn không cung cấp.

Bộ lọc chat là baseline theo quy tắc và moderation thủ công, không bảo đảm phát hiện mọi biến thể ngôn ngữ. Chưa có room private `user:{id}` hoặc phân tách room waitlist; chưa triển khai moderation model/ban tự động. Moderator chỉ có endpoint moderation riêng; Operator giữ quyền LIVE. Kiểm thử không thay thế kiểm toán trước public.

Các gói ZIP âm thanh, V2, 48 lời chúc V6 và hai ảnh tham chiếu không nằm trong hai tệp nhận được. Không thể nghiệm thu nội dung/đồ họa/âm thanh gốc khi chưa có chúng. Hai tài liệu không phải phê duyệt triển khai thanh toán/quyên góp thật hoặc quyền truy cập TikTok.

## Cập nhật tiếp V9

Phần cửa hàng/catalog, upload ảnh vật phẩm, bàn tọa, kiểu chấm và các lớp atlas đã được bổ sung trong [CHANGELOG_V9.md](CHANGELOG_V9.md). Các nhận xét “catalog chỉ 4 mẫu” ở bảng trên mô tả trạng thái kết thúc V8, không phải trạng thái sau V9. Các phần còn thiếu ngoài cửa hàng vẫn giữ nguyên phạm vi ghi nhận.

## Cập nhật tiếp V11

NPC trang trí, số liệu minh bạch và khả năng chuyển sang 72 ghế đã được thêm trong [CHANGELOG_V11.md](CHANGELOG_V11.md). Phòng đang chạy giữ sức chứa 36 cho đến khi Admin chọn/xuất bản sơ đồ mới lúc phòng trống. NPC không thay đổi các luật FIFO hoặc kinh tế.

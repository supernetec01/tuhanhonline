# Kiểm tra và nâng cấp — 30/10/2026

## Mốc ban đầu

Lint/typecheck/build và 7 test SQLite cũ đạt. Nhưng chỉ chứng minh auth/tủ áo thử nghiệm, không kiểm chứng game multiplayer. Ghế mẫu/nghi lễ chỉ nằm trong React; chưa có FIFO, worker, LIVE, xác minh email hoặc reset mật khẩu. Không gọi các phần đó là tính năng hoạt động.

## Lỗi và thiếu sót đã xử lý

| Vấn đề                                                           | Cách xử lý / bằng chứng                                                                                                     |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Có thể ngồi và làm nghi lễ chỉ bằng state trình duyệt            | API xác thực, email đã xác minh, chỗ/cooldown/queue do PostgreSQL quyết định                                                |
| Không có ghế/hàng chờ thật, nguy cơ cấp vượt/trùng               | Khóa hàng phòng, partial unique indexes, một bảng membership xuyên trạng thái; test 100 HTTP join: 36 ACTIVE, 64 WAITING    |
| Chưa giữ ghế cho lời mời, có thể chen hàng                       | INVITED giữ ghế, expires/accept trong transaction, cấp cho người WAITING sớm nhất                                           |
| Không có timeout/worker sống lại                                 | BullMQ tick và state persistent; test khởi động/dừng/khởi động lại tiến trình worker thật                                   |
| Mật khẩu reset có thể để lại phiên cũ                            | Token một lần, expiry, đổi hash và xóa mọi phiên trong transaction; chặn login đang bay dùng hash cũ để tạo phiên sau reset |
| Tủ áo chỉ đổi màu                                                | Bảy lớp SVG độc lập, đường cắt/hoa văn riêng, xem trước/sau và phụ kiện được lưu/đồng bộ                                    |
| Khách bị nhận là chủ ghế trống khi cả hai ID đều undefined       | Kiểm tra có player + user ID trước so sánh; browser kiểm tra guest và phòng trống                                           |
| SQL nghi lễ suy luận sai kiểu duration parameter                 | Cast integer tường minh; test action/cooldown/incense FIFO qua HTTP                                                         |
| CMS coi khác thứ tự JSONB là thay sơ đồ                          | Chuẩn hóa cả hai layout bằng schema trước so sánh; test xuất bản nội dung khi có người, vẫn chặn đổi sức chứa               |
| Lỗi request có thể mất sau khi đổi busy                          | Giữ modal effect theo modal và đọc busy qua ref; không xóa lỗi theo busy                                                    |
| Không có kiểm soát Admin                                         | Role phía server, TOTP MFA, phiên 15 phút và chống dùng lại mã                                                              |
| Quà trùng/streak có thể cộng sai hoặc đọc nhiều lần              | Unique source ID, delta tích lũy, gộp pending TTS; 1→5 tổng 5, không đổi occupancy                                          |
| Ai cũng có thể giả sự kiện provider hoặc dùng broadcast controls | Mock yêu cầu role+MFA; webhook HMAC + timestamp; broadcast token scoped có hạn                                              |

## Cách kiểm chứng

`pnpm test` dùng schema PostgreSQL và prefix Redis tạm riêng, có HTTP thật, kiểm tra invariants, cookie/token, quyền/MFA, CMS, chữ ký webhook, TTS mock, outbox/socket và worker process. `pnpm test:browser` chạy Chromium desktop/mobile từ đăng ký/verify đến scene realtime, thay đồ, Admin và mock broadcast. Kết quả cuối cùng được báo đúng theo lần chạy; không lấy formatter hoặc PID thay cho functional tests.

Chưa kiểm thử dịch vụ TikTok/AI/SMTP thật, OBS thật, Safari hoặc tải 500–2000 kết nối. Không có bằng chứng production an toàn/chịu tải nếu chưa hoàn tất [PLAN.md](PLAN.md). Không có script thanh toán hoặc quà thật; người dùng đã chọn mô phỏng trước.

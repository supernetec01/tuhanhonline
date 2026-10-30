# Ưu tiên và hướng nâng cấp

## Đã triển khai trong đợt kiểm tra này

Nâng trực tiếp React/Vite/Express đang chạy: PostgreSQL migrations + partial indexes, FIFO/36 chỗ, cooldown/queue nghi lễ, Redis/BullMQ/outbox/realtime; tủ áo nhiều lớp và phụ kiện; email verify/reset; Admin RBAC/MFA, CMS cấu hình có version/audit; MockLiveAdapter, webhook bridge có chữ ký, TTS queue/text fallback và broadcast 9:16 có token.

Giữ nguyên yêu cầu mới nhất: **có tủ áo, không ưu tiên chỗ theo xu/trang phục/quà**. Mô phỏng trước vì chưa có provider/giọng AI thật.

## Phải làm trước public

1. **Vận hành & bảo mật**: domain/HTTPS, reverse proxy chỉ tin header từ proxy được cấu hình, SMTP thật, backup PostgreSQL/cache/key MFA riêng và thử khôi phục, cảnh báo lỗi/heartbeat, quản lý phiên/khôi phục MFA, xuất/xóa dữ liệu và chính sách lưu giữ. Edge rate limit/WAF chống tải bất thường; kiểm toán độc lập. Chưa có bảo đảm tuyệt đối an toàn.
2. **Kiểm thử mở rộng**: test 36 người cùng thao tác lâu dài, 500–1000 socket/người chờ, đo p95/reconnect/TTS backlog, Safari/iOS, máy yếu, mất Redis/DB, khôi phục backup. 100 HTTP join đồng thời không chứng minh khả năng 1000 người online. VPS 4 vCPU/8 GB chỉ là cấu hình lập kế hoạch.
3. **CMS còn thiếu**: media upload kiểm MIME/signature/dung lượng, quyền asset nháp, quét/tối ưu WebP/atlas, playlist kinh có quyền, editor sprite/animation, duyệt nội dung, thông kê/ban-unban UI. Hiện chỉ chỉnh nội dung/timing/layout/nháp/xuất bản/rollback và điều khiển LIVE cơ bản. Thêm optimistic base-published revision và merge nếu nhiều người quản trị chỉnh song song.
4. **Đồ họa**: giữ hợp đồng lớp `shadow/body/robe/outer-robe/head/accessory/hands`; thuê/vẽ bộ art gốc cùng khung tọa độ/anchor. Xuất atlas/WebP cho các pose ngồi/vái/lạy/đi/cầm hương; tách mask/occlusion giữa tay, tà áo và phụ kiện. Màn hình người chơi đã chuyển sang Phaser; tiếp theo thay texture SVG bằng atlas/pose đi–đứng và tối ưu pathfinding. Chưa cần 3D.
5. **TikTok/giọng AI thật**: chọn provider có quyền, kiểm chứng nguồn ID/streak/reconnect trên LIVE thật; nối bridge vào contract HMAC. Cấp key TTS an toàn, duyệt giọng Việt và chi phí, test ducking khi có nhạc được cấp phép. Chưa dùng thư viện không chính thức/cookie người dùng để giả khả năng kết nối.
6. **Kiến trúc**: khi cần, chuyển module hiện có sang monorepo Next/Nest và ORM/Prisma, giữ nguyên API/SQL invariants/test hành vi. Trước scale nhiều instance cần connection limits socket, rate limit proxy đúng, shared media/cache/KMS và giám sát. Không thay framework chỉ để ghi hoàn tất stack mà chưa chạy lại các kiểm thử.
7. **Thương mại nếu bổ sung**: catalog qua Admin, sổ xu/giao dịch có đối soát, cổng thanh toán/webhook ký số, hoàn tiền, chống gian lận. Hiện xu ảo thử nghiệm, chưa nhận tiền thật.

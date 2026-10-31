# Tu Hành Online

Game **Phaser 2D** mở trực tiếp trên `/`, tài khoản **username + pháp danh + mật khẩu**, email khôi phục tùy chọn; với **36 chỗ thật, FIFO, nghi lễ do server quản lý**, tủ áo nhiều lớp, khôi phục mật khẩu qua email tùy chọn, Admin dùng phiên đăng nhập mật khẩu và tương tác LIVE mô phỏng.

Đã mở rộng ba hiệu ứng LIVE có hàng chờ, thời khắc bình an 60 giây có lịch, mapping/giọng/âm lượng trong CMS, tên nhân vật và số người chờ trên broadcast. Xem [phạm vi và giới hạn của đợt mở rộng](docs/EXPANSION.md).

## Phát triển trong cloud

Đang chạy trên Windows? Xem [cách tải bản mới từ GitHub và chạy lại](docs/WINDOWS_UPDATE.md).

Node **24.19.0**, pnpm **11.25.0**, Docker Compose; Chromium `/usr/bin/chromium` cho kiểm thử giao diện.

```bash
cd /workspace/tuhanhonline
pnpm install --frozen-lockfile
pnpm setup:local
docker --host=unix:///var/run/docker.sock compose up -d --wait
pnpm db:migrate
pnpm dev
```

`setup:local` tạo mật khẩu DB ngẫu nhiên trong `.data/db-password` và `.env` với quyền 0600; **không ghi đè** tệp hiện có, không in bí mật. Lệnh ứng dụng tự đọc `.env`. Cổng mặc định 3000; `APP_ORIGIN` phải khớp chính xác origin trình duyệt. Trong cloud, giữ proxy/CA và dùng Docker daemon cục bộ theo hướng dẫn runtime; nếu sandbox chặn socket, dùng luồng cấp quyền chạy lệnh được hỗ trợ.

`pnpm dev` khởi động API, Vite, Socket.IO và worker phát triển cùng tiến trình. Production chạy `pnpm start` và **tiến trình riêng** `pnpm worker`; API production không tự chạy worker. Readiness `/api/health/ready` kiểm tra PostgreSQL, Redis và heartbeat worker; trả 503 khi chưa đủ dịch vụ. Không coi PID/cổng mở là đã sẵn sàng.

PostgreSQL/Redis bind dữ liệu vào `.data/postgres`, `.data/redis`, giữ cùng workspace; phải khởi động container sau khi khôi phục môi trường. Không xóa/chmod tùy tiện các thư mục DB thuộc UID container. Mật khẩu DB, khóa mã hóa MFA `.data/mfa-key`, thư thử nghiệm và cache TTS đều bị Git bỏ qua. Dữ liệu SQLite cũ vẫn giữ nguyên; lần nâng cấp này đã nhập tài khoản/tủ áo/lịch sử mua sang PostgreSQL. `pnpm db:import-legacy` chỉ được chạy khi bảng users đích trống, không tự merge/ghi đè. Các phiên cũ không được chuyển: đăng nhập lại bằng email cũ hoặc username đã được migration cấp.

## NPC Thiền Định V11

NPC có nhãn hệ thống lấp ghế trống và tự nhường cho người thật; không giữ ghế hoặc nhận thưởng. Admin có chế độ lấp đầy/50%/tắt và lựa chọn sơ đồ 72 vị trí khi phòng trống; phòng hiện có giữ 36 chỗ đến khi đổi cấu hình. Game và màn hình phát sóng hiển thị riêng người thật/NPC. Xem [changelog V11](docs/CHANGELOG_V11.md).

## Âm thanh Thiền Tĩnh V2

Đã chuẩn bị Audio Manager chung, crossfade, mixer từng nhóm, ducking voice và import 14 cue qua Admin. Hiện chỉ nhận manifest/hướng dẫn, **chưa có 14 OGG gốc**, nên chưa thay bộ âm thực tế. Xem [trạng thái và hướng dẫn audio V2](docs/AUDIO_THIEN_TINH_V2.md).

## Cửa hàng V9

Mở **Bảo Các** trong game: pháp phục, 10 bàn tọa/đài sen, kiểu chấm, phụ kiện và khung pháp danh. Xem thử trực tiếp tại ghế, mua bằng xu và trang bị riêng từng lớp; Admin có catalog và upload PNG/WebP. Xem [changelog V9](docs/CHANGELOG_V9.md) cho migration, API và kiểm thử.

## Nâng cấp V8

Đã bổ sung kinh tế theo phút, Merit riêng, 8 chấm, chat kiểm duyệt/kháng nghị, các popup và media static. Xem [changelog V8](docs/CHANGELOG_V8.md) và [đối chiếu các phần còn thiếu](docs/IMPLEMENTATION_PLAN.md); chưa hoàn tất toàn bộ đặc tả. Import audio cần `ffprobe`/`ffmpeg`, bản thu phải có quyền sử dụng.

## Những chức năng hiện có

- 36 ghế A1–F6. Một tài khoản chỉ có một trạng thái chờ/được mời/đang ngồi. Lời mời giữ ghế, hạn mặc định 60 giây; phiên 30 phút; mất heartbeat giữ tối đa khoảng 120 giây từ heartbeat cuối. Người đến sau không vượt người chờ trước.
- Vái/lạy có cooldown ở server; dâng hương tuần tự FIFO, một người một lượt. Worker dựng lại trạng thái từ DB khi khởi động lại, không giữ hàng chờ chỉ trong RAM.
- Socket.IO là kênh **chỉ đọc** báo thay đổi; client lấy snapshot mới khi reconnect và poll dự phòng. Khách xem không chiếm ghế. Không còn nhân vật giả làm người chơi.
- Tủ áo có lớp thân/áo/áo khoác/đầu/phụ kiện/tay/bóng; mỗi áo có đường cắt/hoa văn riêng, xem trước/sau. Chuỗi hạt/hoa sen là phụ kiện miễn phí. Áo và phụ kiện đang mặc lưu server, đồng bộ đến người xem.
- Đăng ký nhận 300 xu ảo một lần, mua/mặc theo quyền sở hữu, transaction và khóa idempotency. Không nạp tiền thật; không ảnh hưởng ghế/hàng chờ. Catalog và giá quản lý qua CMS V9; giữ nguyên ID và đồ V8 đã sở hữu.
- Không cần xác minh email để ngồi; đăng ký tự đăng nhập và có proof-of-work/honeypot; đặt lại mật khẩu qua token ngắn hạn một lần và thu hồi mọi phiên cũ. Argon2id; cookie HttpOnly/SameSite Strict, Secure/`__Host-` khi production; chỉ lưu mã băm token; rate limit dùng Redis, kiểm tra Origin + header trước yêu cầu ghi.
- `/admin`: RBAC phía server; ADMIN vào trực tiếp bằng phiên đăng nhập mật khẩu, không cần Authenticator. OPERATOR/MODERATOR vẫn cần phiên TOTP MFA 15 phút, chống dùng lại mã. Chỉnh nội dung/timing/sơ đồ ghế, nháp/xem trước/xuất bản/khôi phục, audit. Đổi layout/sức chứa phải chờ phòng hết người giữ chỗ. OPERATOR chỉ có tác vụ LIVE được cấp, không xuất bản cấu hình.
- MockLiveAdapter, webhook ký số cho **bridge do mình kiểm soát**, chống trùng/streak, gộp lời chúc cùng người gửi trong 10 giây, giới hạn hàng chờ; broadcast 9:16 có token 30 phút. Chi tiết tại [docs/LIVE.md](docs/LIVE.md).

## Email và Admin

Mặc định `MAIL_MODE=file`: email ghi vào `.data/mail-outbox` riêng trên máy phát triển; **không có API công khai đọc hộp thư này**. Người phát triển mở thư của tài khoản thử mình tạo và dùng liên kết xác minh/reset. Đây không phải gửi email ra Internet. Production bắt buộc HTTPS; SMTP chỉ cần cho email khôi phục/xác minh tùy chọn. Chưa kiểm thử SMTP thật.

Sau khi tự đăng ký tài khoản của mình:

```bash
pnpm admin:promote username_cua_ban
```

Lệnh chỉ nâng quyền tài khoản đã tồn tại, ghi audit; không có admin/mật khẩu mặc định. Đăng nhập tại web bằng mật khẩu rồi vào `/admin`; ADMIN không phải thiết lập hoặc nhập mã Authenticator, kể cả tài khoản đã bật MFA trước đây. OPERATOR/MODERATOR tiếp tục dùng MFA; khóa TOTP được mã hóa AES-256-GCM trong DB, bảo vệ và backup riêng `.data/mfa-key`. Không đưa khóa TOTP vào ảnh chụp/chat. Xem [hướng dẫn truy cập Admin](docs/ADMIN_ACCESS.md).

## Kiểm thử

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
# Máy chủ pnpm dev đang chạy, MAIL_MODE=file, chỉ localhost:
pnpm test:browser
```

`test` chạy HTTP thật với PostgreSQL/Redis, tạo schema `test_<uuid>` và prefix Redis riêng, dọn đúng dữ liệu thử; không flush DB Redis chung. Bao gồm 100 yêu cầu join đồng thời và khởi động lại **tiến trình BullMQ worker thật**. Đây không phải benchmark 500–2000 kết nối.

`test:browser` dùng Chromium và tự chạy server/schema PostgreSQL/Redis/cache riêng để kiểm Phaser, username không email, chọn ghế, tủ áo, nghi lễ, 36 ghế đầy + FIFO/lời mời trên mobile, popup âm thanh/tài khoản và Admin đăng nhập mật khẩu không cần MFA. Không cần khởi động dev trước; không chỉnh dữ liệu phát triển. Ảnh ở `test-results/`. AI audio, TikTok thật, Safari/iOS và SMTP thật chưa kiểm chứng. Xem [SINGLE_GAME.md](docs/SINGLE_GAME.md) cho migration, API mới và Windows.

## Phạm vi chưa hoàn tất

Đây là nâng cấp trực tiếp **React/Vite + Express + PostgreSQL/Redis/Socket.IO/BullMQ**, chưa chuyển Next/Nest/Prisma như kiến trúc đề xuất trong tài liệu cũ. Không phải toàn bộ CMS đã mô tả: chưa có quy trình kiểm duyệt nội dung media, biên tập spritesheet/playlist, thống kê đầy đủ hoặc ban/unban UI; upload audio và ảnh vật phẩm đã có. Chưa có audio kinh được cấp phép, EXP, thanh toán, kết nối TikTok thật hoặc giọng AI đã kiểm thử với dịch vụ.

Trước public còn cần triển khai TLS/reverse proxy, SMTP, backup/restore drill, quản lý khóa, giám sát, DDoS/WAF, kiểm toán bảo mật, quy trình dữ liệu cá nhân và test tải/thiết bị. Không hệ thống nào bảo đảm tuyệt đối không bị tấn công. [Báo cáo kiểm tra và hướng nâng cấp](docs/REVIEW.md), [API](docs/API.md), [kế hoạch](docs/PLAN.md).

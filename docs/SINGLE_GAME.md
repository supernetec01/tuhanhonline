# Single Game Screen và tài khoản username

## Phạm vi thay đổi

Sửa trực tiếp dự án cũ. `/` mở game **Phaser 3.90 Canvas** với cảnh SVG nguyên bản mới: gỗ trầm/đỏ sẫm/vàng đồng, tượng Phật có tỷ lệ và nét mặt nghiêm trang hơn, bệ sen/áo/tường khám tượng chi tiết hơn. 36 đệm chia 6 hàng, 3+3 hai bên lối đi, tăng kích thước theo phối cảnh. `/admin` giữ riêng; broadcast dùng cùng ảnh chánh điện, renderer broadcast hiện vẫn là SVG/DOM.

Các chức năng người chơi đều là popup trên `/`: login/register, tài khoản, tủ áo, âm thanh, hàng chờ và lời mời. Không có trang hồ sơ/đăng nhập riêng. Canvas có vùng bấm và 36 nút đệm tương ứng cho bàn phím/trình đọc màn hình. Đệm đang giữ/tắt/đã có người không thể chọn. Đổi kích thước dùng FIT, không kéo méo ảnh. Điện thoại dùng viewport dọc 1000×1600 và bố cục nền/ghế riêng, vẫn là 36 seat ID của server; xoay ngang không mất chỗ. Tôn trọng giảm chuyển động.

Chọn đệm khi chưa đăng nhập mở đăng ký; đăng ký thành công tự đăng nhập và gửi yêu cầu ghế. Chọn “Vào chánh điện” khi đầy chuyển thẳng sang hàng chờ. Client chỉ vẽ nhân vật sau snapshot của server; không tạo ghế giả/nhân vật mẫu. Nếu ghế vừa bị người khác lấy trong khi đăng ký, tài khoản vẫn được tạo và game báo chọn lại. Backend luôn giữ FIFO: ghế được dành cho người chờ trước khi xét yêu cầu mới.

## Migration và dữ liệu cũ

`003_username_accounts.sql` cho email nullable và thêm username chuẩn hóa + unique index không phân biệt hoa/thường. Người dùng cũ có username `u_` + 20 ký tự từ UUID; ID, mật khẩu băm, pháp danh, áo/xu, phiên, quyền Admin/MFA đều giữ nguyên. Có thể tiếp tục đăng nhập bằng email cũ rồi xem username trong popup tài khoản. Cột `users.name` vẫn lưu pháp danh để không phá dữ liệu/API cũ; API mới trả `dharmaName` và alias `name`.

## Hợp đồng Auth mới

- GET `/api/auth/challenge`: `{id,nonce,difficulty:3}`, Redis TTL 5 phút và giới hạn IP. Proof là số nguyên `solution` sao cho SHA-256(`nonce + ':' + solution`) bắt đầu bằng `000` (12 bit). Challenge gắn IP, dùng một lần, không tắt rate limit.
- POST `/api/auth/register`: `{username,dharmaName,password,email?,website?:'',challenge:{id,solution}}`. Username 3–24 chữ ASCII/số/`_`, chuẩn hóa lowercase; pháp danh 2–32 ký tự Unicode; mật khẩu 12–128 ký tự. Email để trống hoặc bỏ hẳn. `website` là honeypot phải trống. Tạo user, áo mặc định và cookie phiên tự đăng nhập; không gửi thư xác minh bắt buộc.
- POST `/api/auth/login`: `{username,password}`; `username` có thể là email tài khoản cũ. Body cũ `{email,password}` vẫn được hỗ trợ cho tương thích, không cho truyền cả hai.
- `/api/me`: thêm `username`, `dharmaName`, `hasRecoveryEmail`. Không trả email hoặc password hash. Chơi game/nghi lễ/nhận lời mời không cần `verified_at`.
- Email verify/resend còn là tùy chọn bảo vệ email khôi phục; không phải điều kiện vào phòng. Khôi phục bằng email vẫn dùng token một lần, expiry và thu hồi mọi phiên khi đổi mật khẩu. Production chưa cấu hình SMTP thì API recovery báo chưa sẵn sàng, không giả vờ gửi thư. Không có email thì chưa thể tự khôi phục tài khoản; UI thông báo rõ.
- Admin vẫn cần role và TOTP MFA, không yêu cầu email. CLI `pnpm admin:promote <username-hoặc-email>` chỉ nâng quyền user đã tồn tại, có audit. Không tạo admin mặc định.
- POST `/api/room/join`: `{requestKey,seatId?:1..36}`. `seatId` chỉ là yêu cầu ghế trống, không cho chuyển ghế của người khác/chen hàng. Trả `SLOT_OCCUPIED` khi ghế bị giữ/tắt mà phòng còn chỗ khác; nếu hết chỗ trả WAITING. Idempotency vẫn trả kết quả cũ khi retry.

Giữ Argon2id, secure/HttpOnly/SameSite cookie, Origin/custom-header CSRF, Redis rate limit, SQL tham số hóa, MFA. Proof-of-work và honeypot là lớp chống bot nhẹ, không thay thế WAF/CAPTCHA khi có tấn công phân tán.

## Kiểm thử và cách chạy

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm dev
```

Trên Windows PowerShell bị chặn `.ps1`, dùng `pnpm.cmd` hoặc `corepack.cmd pnpm@11.25.0` và đứng đúng thư mục có package.json/compose.yaml.

`pnpm test` kiểm API/DB, gồm đăng ký không email, login tức thì, chống trùng username, chống bot/replay, chọn ghế và 100 join đồng thời. `pnpm test:browser` tự tạo schema PostgreSQL/prefix Redis/queue/cache Vite riêng, chạy server local riêng cổng 3010 (đổi qua `BROWSER_TEST_PORT`), diễn tập 36 người + người thứ 37 trên điện thoại, popup FIFO và nhận lời mời. Không sửa published config/tài khoản ở DB phát triển nữa. Có thể chạy độc lập với `pnpm dev`; cổng test phải đang trống. Kết thúc dọn đúng schema và dữ liệu test. Ảnh ở `test-results/`.

Chưa có kinh được cấp phép, UI cho chọn bản thu riêng trên thiết bị; không upload/phát công khai. TikTok/AI vẫn mock theo lựa chọn trước. Phaser tải riêng theo route người chơi; chưa đo FPS Safari/iOS, chưa thay bộ chibi bằng sprite đi/đứng riêng hoặc model 3D. Hình tham khảo chỉ dùng để định hướng, không sao chép ảnh TikTok/ảnh báo chí.

# Hoàn thiện xu, đồ lễ và âm thanh trên main hiện tại

Bản này tiếp tục từ `4d59799` (V8–V11) trên GitHub, giữ cửa hàng nhiều lớp, chat, NPC và quyền Admin của bản đó. Phòng mặc định vẫn 36 chỗ; khả năng Admin chọn sơ đồ 72 có sẵn từ V11 không bị xóa hoặc tự bật. Không tạo dự án mới, không thay bộ mixer Web Audio hoặc hệ thống media đang hoạt động bằng một bản thứ hai.

## Thay đổi

- Migration `012_reward_progress.sql` chỉ thêm `coin_progress`; giữ tài khoản, ví, đồ, ledger, session và ghế. Phần phút hợp lệ còn lẻ được giữ giữa các lượt cùng ngày. Qua nửa đêm Việt Nam, tách từng ngày; phần lẻ của ngày cũ không chuyển thành xu ngày mới. Cả khi hết kết nối dưới 60 giây vẫn chốt phần thời gian hợp lệ. Không cộng thời gian WAITING/INVITED, quá hạn kết nối hoặc bị ban.
- Khóa phòng và transaction serialize việc chốt con trỏ/phần lẻ/ledger/số dư. Một phần phút chỉ được chốt một lần dù nhiều worker. Heartbeat chốt trước khi gia hạn; rời phòng chốt trước khi kết thúc. Khi Admin xuất bản/rollback giới hạn xu, chốt thời gian đã qua theo chính sách cũ. Giữ mặc định 1 phút = 1 xu, tối đa 240 xu/ngày và số xu khởi đầu hiện tại của V8; không đổi quà LIVE thành xu, không ưu tiên ghế.
- Chuông chào thực sự kết thúc trước khi nguồn nhạc nền đầu tiên bắt đầu. AudioContext vẫn chỉ được tạo/resume sau gesture; popup không tạo manager mới. Bật từ nút trong game, popup hay broadcast đều dùng cùng luồng. Chuông chào chỉ phát một lần mỗi manager; không phát lại khi resume.
- Skip lời chúc hoặc đóng màn hình dừng được cả chuông mở đầu, kể cả khi file đang tải. Chỉ hạ nền/phát âm mở đầu khi có voice static/AI hoặc giọng thiết bị, không giả đọc với chế độ mock bằng chữ. Mức nền được khôi phục bằng mức mới nhất trong mixer hiện tại.
- Lớp đồ lễ riêng có mâm quả, bánh lễ, hoa sen, lư hương/khói và thùng công đức chỉ để trang trí. Cấu hình `decorations` cho phép bật/tắt từng loại, dịch vị trí và đổi tỉ lệ nhóm trong Admin, qua nháp/xuất bản/rollback. Cả game và broadcast dùng cùng lớp; không có nút nhận tiền.
- `dotLayout` chỉnh vị trí ngang/dọc, kích thước/khoảng cách chấm. Áp dụng vào Phaser, avatar tài khoản và preview cửa hàng/Admin; màu/kiểu chấm tiếp tục qua catalog V9 hiện tại. Không thêm hệ thống mua chấm thứ hai: 4 cặp giá mặc định 200/500/1000/2000 xu vẫn do API hiện có xử lý.
- Refresh sau giao dịch chờ lượt tải đang chạy rồi lấy trạng thái mới, tránh ví/đồ mới bị che bởi snapshot cũ. Admin cập nhật cấu hình theo state mới nhất, tránh mất sửa đổi khác khi một upload hoàn tất chậm.

## Bộ âm thanh thực tế

Bản dán của người dùng nhắc **11 âm thanh V1**, nhưng không có ZIP/file OGG hay URL tải thực. Main mới có tài liệu và manifest **14 âm thanh Thiền Tĩnh V2**, cũng chưa có các file gốc. Chưa nhập bản thu gốc hoặc nghiệm thu chất lượng nghe; fixture của tests không phải âm thanh sản phẩm.

Không xóa đường tích hợp V1: các cue `click`, `chant` và các cue nghi lễ dùng chung vẫn hoạt động. Khi nhận ZIP gốc, đọc README/manifest của chính bộ đó, tải/gán từng cue ở Admin hoặc dùng importer V2 khi đúng đủ 14 file V2; nghe thử rồi lưu nháp/xuất bản. Xem [hướng dẫn âm thanh hiện tại](AUDIO_THIEN_TINH_V2.md). Upload dùng OGG/MP3, đo duration bằng ffprobe, asset có phiên bản, được backup cùng thư mục `.data/assets` và DB; không cần sửa code để thay file.

TTS/TikTok vẫn mock mặc định. Có đường voice static và adapter AI hiện tại; chưa có credential hoặc kiểm thử provider thật. Browser tests chỉ giải mã fixture riêng và chạy voice static của schema test. Cần bộ gốc, Safari/iOS/Android thật và OBS/TikTok LIVE Studio để nghiệm thu nghe/phát thực tế.

## Cập nhật trên Windows

Trong thư mục dự án, dừng tiến trình dev cũ; mở Docker Desktop rồi chạy:

```powershell
git pull
corepack.cmd pnpm@11.25.0 install --frozen-lockfile
docker compose up -d --wait
corepack.cmd pnpm@11.25.0 db:migrate
corepack.cmd pnpm@11.25.0 dev
```

Node 24 và FFmpeg/ffprobe cần sẵn trong PATH để upload/kiểm thử audio. Xem [WINDOWS_UPDATE.md](WINDOWS_UPDATE.md). Người vận hành production cần backup DB + `.data/assets`/key riêng và khởi động lại API lẫn worker sau migration.

## Kiểm tra

Đã chạy thành công migration, lint, typecheck và build trên bản tích hợp. `pnpm test`: **56/56 đạt**. `pnpm test:browser`: đạt trên Chromium desktop/mobile, gồm cửa hàng/NPC/FIFO và voice static/ducking. Readiness của server local: DB/Redis/worker đều sẵn sàng. Kiểm trực quan bổ sung xác nhận lớp đồ lễ khớp Canvas FIT trên desktop/mobile/broadcast, không có lỗi JavaScript. Các schema/Redis namespace/media fixture của tests độc lập với dữ liệu phát triển. Hồi quy mới kiểm tra phút lẻ qua lượt ghế, hết grace, nửa đêm Việt Nam, nhiều tick đồng thời, chốt giới hạn trước publish, thứ tự chuông/nhạc và AbortSignal của chuông mở đầu. Các bài V8/V9/V11 sẵn có tiếp tục chạy.

Còn cảnh báo chunk Phaser lớn và annotation Zod khi build, không phải lỗi build. Media gốc, giọng AI/TikTok thật, chất lượng trên thiết bị thực và kiểm toán/tải production chưa được nghiệm thu bằng các bài test này.

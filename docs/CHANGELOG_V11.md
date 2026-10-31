# V11 — NPC Thiền Định nhường ghế

Triển khai trên dự án hiện tại; giữ dữ liệu và các thay đổi V8/V9/audio. NPC là đối tượng đồ họa có nhãn **NPC hệ thống**, không được tính là người đang tu thật.

## Hoạt động

- Client Phaser dựng NPC tại ghế đang bật và không có người thật hoặc lời mời giữ chỗ. NPC không xuất hiện trong `seat.player`; không tạo user, session, heartbeat, reservation, hàng chờ, ritual action hoặc sự kiện Socket.IO cho NPC.
- NPC không có ví, Merit, inventory, level, quà LIVE, chat hoặc xếp hạng. Không gọi API hành động/ngồi ghế hoặc tham gia hàng chờ dâng hương. Cơ chế một lượt dâng hương thật hiện có được giữ nguyên; V11 không tự tăng số trạm.
- Người thật đăng ký được ghế có NPC theo cùng transaction/FIFO cũ. NPC fade 400 ms (Admin 300–500 ms); các lớp nhân vật thật được hiển thị sau fade để không chồng hình. Nhận ghế trên server không phải chờ hoạt ảnh.
- Khi server xác nhận ghế đã giải phóng, NPC chờ 4 giây (Admin 3–5 giây) rồi xuất hiện. Nếu ghế đang có lời mời FIFO, giữ reconnect grace hoặc người thật nhận lại, NPC tiếp tục bị loại khỏi ghế đó. Không tự suy đoán rằng mất socket đồng nghĩa ghế đã trống.
- Vái 2 giây theo nhóm 2 NPC ở mức nhẹ/4 ở mức trung bình, lạy 4 giây theo nhóm 1/2; phần lớn thời gian ngồi yên hoặc thở nhẹ. Lịch chỉ chạy ở client, không có âm thanh hoặc thưởng. NPC không đi ra khỏi chỗ hay chặn lối dâng hương.

## Admin

Trong `/admin`, đăng nhập tài khoản ADMIN rồi mở mục **Nhân vật thiền định NPC · V11** (không cần MFA theo [quy tắc truy cập hiện tại](ADMIN_ACCESS.md)):

1. **Tự động lấp ghế trống**: tối đa số ghế trống, chịu giới hạn maxCount.
2. **Lấp 50% ghế trống**: lấy phần nguyên của 50% số ghế đang trống rồi áp maxCount. Chọn cách hiểu này để khi phòng đông vẫn giảm NPC; không tính 50% của toàn bộ sức chứa.
3. **Tắt NPC**.

Có maxCount 0–72, chuyển động tĩnh/nhẹ/trung bình, fade và thời gian quay lại. Cấu hình cũ chưa có mục npc dùng mặc định fill / max 72 / chuyển động nhẹ. Dùng luồng nháp → xem trước cấu hình → xuất bản/rollback và audit hiện có. Đổi chế độ NPC không cần đuổi người đang tu.

NPC luôn dùng bộ áo xám/nâu/lam và bồ đoàn mộc riêng trong atlas, không có chấm hoặc đài sen cao cấp. Không cấp quyền sở hữu đồ này vào inventory. Định danh texture của NPC không phải tài khoản người chơi.

## Sức chứa 36 / 72

V11 nhắc đến 72 vị trí, trong khi dữ liệu đang chạy là 36. Migration `011_virtual_npc_capacity.sql` chỉ mở rộng bảng ghế thật đến ID 72 và bổ sung G1–L6. Giữ ID/code A1–F6 và mọi reservation cũ; không tự đẩy người chơi khỏi ghế, không reset ví hay phiên.

**Phòng hiện có vẫn giữ 36 chỗ.** Trong Admin chọn **Dùng sơ đồ 72 vị trí**, lưu nháp và xuất bản khi không còn ACTIVE/INVITED. Guard hiện có chặn thay sơ đồ/sức chứa lúc đang có người giữ ghế. Sơ đồ mới 12 hàng × 6 vị trí, chung lối giữa; có thể chỉnh tọa độ trong CMS. Cấu hình cũ 36 ghế được đọc bằng cách bổ sung 36 vị trí tắt; không buộc ghi lại các revision cũ. Trở lại sơ đồ 36 cũng phải chờ phòng trống.

Đã backup DB local `.data/backups/pre-v11.dump` trước migration. Chạy lại `pnpm db:migrate` dùng cơ chế checksum/migration hiện có.

## Chỉ số và phát sóng

- `activeCount`: chỉ người thật ACTIVE.
- `reservedCount`: lời mời INVITED đang giữ ghế.
- `occupied`: ACTIVE + INVITED để giữ tương thích các endpoint cũ.
- `available`: số ghế thật còn trống, không trừ NPC.
- `npcTargetCount`: số NPC theo chính sách tại snapshot; không phải người online.

Game hiển thị người thật/sức chứa, số NPC trên client, số chờ và chỗ đăng ký riêng. NPC đang fade nhường ghế không còn tính vào số NPC đang thiền. Trong khoảng chờ trở lại, số NPC trên máy có thể thấp hơn target của server.

Màn hình `/broadcast/main` dùng cùng Phaser renderer, atlas và quy tắc NPC với game, ở chế độ chỉ xem/khung dọc. Nhờ đó đồ V9 và NPC không cần một bộ render riêng cho OBS. Không có ghế đăng ký từ màn hình broadcast. Bảng LIVE vẫn phân biệt số người thật/NPC/chỗ còn trống.

## Hiệu năng và kết nối

- Dùng chung atlas và các Image/Text nhẹ; không sinh ảnh cho từng NPC hoặc từng tổ hợp trang phục. Không fetch thêm ảnh cho từng NPC.
- NPC tĩnh được cache trạng thái vẽ, không đặt lại các thuộc tính hình mỗi frame khi giá trị không đổi. Chuyển động trang trí lấy mẫu khoảng 8 FPS mức nhẹ/12,5 FPS mức trung bình; người thật giữ timeline/FPS của game.
- Eco, giảm chuyển động hoặc viewport mobile có CPU/RAM báo thấp chuyển NPC sang tĩnh. Không thay chỉ số FPS của người thật vì số NPC.
- Một Socket.IO connection trong vòng đời màn hình. Đăng nhập/đăng xuất cập nhật ref dữ liệu thay vì tạo lại socket; cleanup đóng engine thuộc màn hình. NPC không tạo kết nối hoặc heartbeat riêng. Kiểm thử đếm socket đang OPEN trong tài liệu hiện tại; không nhầm các lần handshake qua refresh/StrictMode với kết nối đồng thời.

## Xác thực

`pnpm test`: 49 tests, gồm các kiểm thử V8/V9/audio và 8 nhóm V11. Bao gồm 0/1/36/72 người thật, không tạo dữ liệu bot, hai người tranh cùng ghế 72, FIFO/lời mời hết hạn, mode/max/disabled/invited, fade không chồng hình, trễ xuất hiện lại, chế độ tĩnh và nhóm animation nhỏ. Có restart API bằng tiến trình Node mới với schema/Redis namespace tách biệt, xác nhận ghế ACTIVE/INVITED còn nguyên; các kiểm thử restart BullMQ thật trước đó vẫn chạy.

Chromium desktop/mobile: đăng ký ghế đang có NPC; mất NPC sau nhận ghế; 72 NPC khi phòng trống, 36 NPC khi 36 người thật, 0 NPC khi 72 người thật; NPC quay lại sau giải phóng; chọn lại ghế, refresh, ba chế độ Admin và một socket đang mở. Có kiểm tra mobile mô phỏng CPU 2 luồng dùng 72 NPC tĩnh và không tràn ngang. Hồi quy cửa hàng, chat, audio, Admin MFA, mock broadcast tiếp tục chạy. Ảnh local: `test-results/npc-v11-72.png`, `npc-v11-36-humans.png`, `npc-v11-mobile.png`, `broadcast.png`.

`pnpm lint`, `pnpm typecheck`, `pnpm build`; cảnh báo chunk Phaser và annotation Zod của dependency vẫn còn. Không thêm dependency hoặc đổi lockfile. Chưa đo FPS/GPU/RAM trên điện thoại yếu thật hoặc bắt hình/âm trong TikTok LIVE Studio/OBS thực tế. Không dùng e2e headless để cam kết hiệu năng thiết bị hay tải production.

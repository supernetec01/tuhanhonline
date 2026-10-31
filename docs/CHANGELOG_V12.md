# V12 — Nhân vật, di chuyển và hai trạm dâng hương

Nâng cấp trực tiếp main sau `0dfa5c9`, giữ Single Game Screen, backend PostgreSQL/Redis, tủ áo, xu, công đức, NPC và audio hiện có. Phòng hiện tại vẫn **36 chỗ**. Admin có thể chọn sơ đồ 72 khi phòng trống; migration không tự chuyển sức chứa.

## Nhân vật và giao diện

- Bộ vector gốc nam/nữ, cùng rig đầu/thân/hai tay/hai chân, bốn hướng trước/sau/trái/phải. Chọn khi đăng ký hoặc đổi trong tài khoản. Đứng, đi bộ tám bước, ngồi/đứng dậy 0,5 giây, vái, lạy, cầm hương và thắp hương dùng chung pose/atlas phần rời 256 px.
- Giữ ID/quyền sở hữu trang phục, đài sen, phụ kiện, khung pháp danh và tám chấm. Pháp phục tô vào thân/tay/chân thay vì che toàn bộ cơ thể. Ảnh pháp phục upload cũ được cắt vào thân; muốn có hoa văn riêng đúng cả bốn hướng cần bộ garment được vẽ tương ứng.
- Giảm tỷ lệ chuẩn theo chiều sâu trên sơ đồ 36/72, giữ tọa độ và ID ghế. Chỉ scale chuẩn cũ được migration thay đổi; scale tự chỉnh được giữ. Depth theo chân, bồ đoàn ở ghế cũ khi người đi lại, phụ kiện đi theo người.
- Zoom giới hạn 1–2,5; nhấn người hoặc dùng tìm người để xem gần, **Theo tôi** theo vị trí của mình, **Toàn cảnh** đặt lại. Ẩn bớt tên khi xa; tên/chấm hiện theo lựa chọn và mức zoom. Đồ lễ nay cùng camera Phaser với nhân vật trên game/broadcast.
- **Đi dạo** rồi click/tap điểm sáng trên lối đi; **Về ghế** yêu cầu server lập đường trở về. Có countdown giữ ghế và trạng thái nghi thức ngay trong màn hình chơi.

## Nguồn dữ liệu và chống giả di chuyển

`room_entries` tiếp tục là nơi giữ ghế duy nhất. Navigation graph dùng các lối giữa, lối bên, nhánh ra ghế, hàng chờ và trạm A/B. Loại cạnh xuyên bồ đoàn hoặc chân người đứng; chọn đường vòng khi có thể. Các đường đang di chuyển được kiểm tra giao cắt theo thời gian và chờ để tránh nhau. Lối bị chặn trả `409 PATH_BUSY`, không dịch chuyển tức thì.

Server lưu waypoint, thời điểm bắt đầu/kết thúc và trạng thái vào DB, client chỉ nội suy. Không gửi vị trí mỗi frame, không nhận tọa độ/tốc độ hay thông báo “đã ngồi” từ client. Khóa phòng và transaction giữ việc cấp ghế/FIFO/tính thưởng nguyên tử; idempotency key không thể reset deadline hoặc nhân đôi yêu cầu.

Giữ thiết kế Socket.IO **chỉ đọc** hiện có. Lệnh qua HTTP cùng origin/cookie/CSRF; outbox `temple.event` báo thay đổi để lấy snapshot, có reconnect/poll dự phòng. Không mở thêm socket command song song với API.

| API                              | Body và hành vi                                                                                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST `/api/auth/register`        | Thêm `appearanceType: 'male' \| 'female'`, mặc định male; username/pháp danh/mật khẩu, email tùy chọn, anti-bot và tự đăng nhập giữ nguyên                                 |
| POST `/api/character/appearance` | `{appearanceType}`; chỉ đổi nhân vật của tài khoản đang đăng nhập                                                                                                          |
| POST `/api/character/move`       | `{nodeId, requestKey: UUID}`; chỉ node sàn hợp lệ trong snapshot, 30 yêu cầu/phút/tài khoản                                                                                |
| POST `/api/character/return`     | `{requestKey: UUID}`; chỉ server lập đường về đúng ghế, cùng giới hạn di chuyển                                                                                            |
| GET `/api/room`                  | Thêm `navigation`, `appearance_type`, `character_state`, `position_node`, waypoint/timestamp, deadline, phase/slot/station của nghi thức; không công khai bí mật tài khoản |

## Giữ ghế và phần thưởng

- Tự rời ghế bắt đầu deadline **180 giây**, không đổi qua reconnect, heartbeat, bước đi tiếp hay replay request. Các trạng thái `WALKING_AWAY`, `STANDING`, `RETURNING` không tích xu. Chỉ về đúng ghế và hoàn tất ngồi trước deadline mới xóa hạn. Hết hạn trả ghế cho FIFO; request cũ không phục hồi lượt đã mất.
- Mất kết nối vẫn chịu grace hiện tại, mặc định 120 giây; nghi thức không bỏ qua grace/kick/ban.
- Đăng ký dâng hương vào FIFO toàn cục, một request đang hoạt động/người. `INCENSE_PENDING` ngồi tại ghế; chỉ **8 người được gọi xếp hàng vật lý** mặc định, Admin chọn 8–12. Đi đến điểm chờ, tiến lên, đến A/B, thắp, trở về là các phase riêng.
- Hai trạm không cho chen lượt; bắt đầu thắp sau khi tới trạm, đúng **5 giây**, cộng **10 công đức một lần** khi hoàn tất hợp lệ. Cooldown **300 giây từ lúc bắt đầu thắp**, không từ lúc bấm đăng ký. Không đổi quà LIVE thành tiền hoặc quyền nhận ghế.
- Người được gọi được bảo vệ hạn phiên theo cấu hình 3–10 phút, mặc định 10, gán một lần; không reset mỗi lần tiến hàng. Trở về hết bảo vệ, phiên thường đã hết thì nhường ghế. Khi worker xử lý muộn, phần thưởng chỉ chốt đến thời điểm thực sự về ghế hoặc hạn bảo vệ/grace, không chốt thừa tới lúc worker thức dậy.
- Admin không đổi policy di chuyển khi còn người đi lại/làm nghi thức; layout/capacity vẫn phải đợi hết người giữ ghế. V12 cố định 5 giây/300 giây; tắt movement mới dùng nghi thức legacy một trạm.

## Migration và cập nhật

`013_character_movement.sql` bổ sung ngoại hình, trạng thái/đường đi/deadline và lệnh idempotent; thêm phase/slot/station vào `ritual_actions`. Nghi thức legacy đang chạy được tiếp tục ở A, request đang chờ chuyển thành pending. Không tạo lại users, wallet hoặc inventory, không sửa checksum migration cũ.

Đã backup DB cloud trước migration bằng `pg_dump -Fc` vào `.data/backups/pre-v12-20261031.dump` (quyền 0600, không đưa lên GitHub), áp dụng 013 và đối chiếu tài khoản/ví/inventory trước/sau: **7 users, 840 xu, 49 inventory, 0 session, 4 lịch sử room entry**, capacity **36** được giữ nguyên. Đây là dữ liệu cloud; DB Windows của bạn vẫn nằm trên máy bạn.

Dừng server/worker trước cập nhật, backup DB và giữ `.env`, `.data/assets`, các key riêng. Trong PowerShell tại đúng thư mục:

```powershell
cd "E:\Tu hanh online\tuhanhonline"
git pull --ff-only origin main
corepack.cmd pnpm@11.25.0 install --frozen-lockfile
docker compose up -d --wait
corepack.cmd pnpm@11.25.0 db:migrate
corepack.cmd pnpm@11.25.0 dev
```

Mở `http://localhost:3000`, Ctrl+F5. Cài mới cần chạy `corepack.cmd pnpm@11.25.0 setup:local` trước Compose/migration; không chạy setup lại để thay DB cũ. Production cần khởi động lại cả API và worker sau migration. Xem [Windows](WINDOWS_UPDATE.md).

## Kiểm chứng và giới hạn

Ngày 31/10/2026, đã chạy migration, `pnpm lint`, `pnpm typecheck`, `pnpm build`: đạt. Build còn cảnh báo chunk Phaser khoảng 1,21 MB và annotation trong thư viện Zod; không có lỗi compile. `pnpm test`: **67/67 đạt**, bao gồm:

- 100 yêu cầu nhận ghế đồng thời, tranh ghế/FIFO, restart BullMQ worker, bảo mật tài khoản và chức năng V8–V11. Nhóm test API legacy chủ động tắt movement để tiếp tục kiểm đường tương thích; nhóm V12 chạy mặc định bật.
- Nam/nữ/bốn hướng với mọi áo tích hợp, các pose không mất chi, tỷ lệ đầu và khoảng cách hàng 36/72.
- Từ chối node/tốc độ giả, đích đã có người, đường vòng tránh người đứng, request lặp và reconnect không reset 180 giây, dừng xu khi đi dạo, server hoàn tất ngồi, hết hạn cấp ghế cho FIFO.
- 72 người đăng ký dâng hương: hai trạm cùng chạy, hàng vật lý không vượt tám, FIFO bắt đầu đúng thứ tự, 720 công đức/72 giao dịch và không cộng lại. Đây là mô phỏng dịch timestamp trong schema riêng, không phải 72 người chơi thật hay benchmark mạng. Lượt cuối: 73 vòng tick, 11,9 giây chạy test, RSS tiến trình Node khoảng 280 MiB; không phải tổng RAM của PostgreSQL/Redis/hệ thống.
- Bảo vệ phiên gần hết hạn, disconnect hủy nghi thức, worker xử lý muộn không tính xu thừa, nâng migration từ 001–012 giữ mật khẩu/ví/inventory và tiếp tục request legacy.

`pnpm test:browser`: đạt luồng Phaser/Admin/tủ áo/audio/FIFO/NPC. `pnpm test:browser:v12`: đạt đăng ký nữ không email, đi/về thực tế, reload giữ deadline, ngưng xu, tới trạm/thắp **đúng 5 giây theo thời gian thực**/nhận một lần 10 công đức/tự ngồi lại, 72 nhân vật, camera và viewport mobile, không lỗi JS/console/HTTP. Các runner tạo schema, Redis prefix, cache và server riêng rồi dọn dữ liệu thử.

Số đo cuối trên **Chromium headless của cloud**, năm mẫu FPS mỗi viewport, dừng renderer desktop trước khi đo mobile:

| Số đo                              | Kết quả                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------- |
| Mở trang đến Phaser/atlas sẵn sàng | 3,82 giây, gồm tải trang/API/Vite; không chỉ thời gian tải ảnh          |
| Rig atlas RGBA chưa nén            | 22 MiB; không phải dung lượng tải mạng hoặc tổng bộ nhớ GPU             |
| Từ nhấn đi đến HTTP hoàn tất       | 370 ms                                                                  |
| Từ nhấn đi đến event WebSocket     | 1.032 ms, gồm nhịp worker/outbox; không phải RTT                        |
| 72 người, viewport desktop         | 34,9 FPS trung bình; JS heap khoảng 36,4 MiB                            |
| CPU renderer desktop               | TaskDuration/wall-time 0,993, gần một core bận; không phải CPU toàn máy |
| 72 người, giả lập mobile 390×844   | 22,9 FPS trung bình; JS heap khoảng 41,4 MiB                            |

Hiệu năng mobile còn cần cải thiện và xác minh máy thật. Ưu tiên tiếp theo: giảm lệnh cập nhật rig khi pose không đổi, bake người ngồi ở xa thành một frame, gộp texture/giảm alpha layers, đo bằng GPU trên Android/iOS, rồi điều chỉnh chế độ tiết kiệm. Các file ảnh/JSON trong `test-results` là artifact riêng, không phải dữ liệu người chơi thật; `test-results/v12-browser-metrics.json` và `v12-server-metrics.json` được tạo lại khi chạy kiểm thử.

Chưa có ZIP/OGG V1 hoặc V2 gốc; không đưa fixture thử nghiệm thành âm thanh sản phẩm. Upload/preview/mixer/ducking và mock LIVE có sẵn được giữ. TikTok thật và giọng AI provider thật vẫn chưa có dịch vụ/credential để nghiệm thu; hiện tiếp tục mô phỏng theo lựa chọn của bạn.

Navigation hiện dùng topology của chánh điện chuẩn. Layout Admin tự vẽ cần kiểm tra lại lối đi; chưa có trình biên tập navigation/obstacle trực quan. Atlas/pose gốc này chưa thay thế công đoạn họa sĩ hoàn thiện spritesheet hoa văn nhiều hướng. Cần thử iOS/Android thật, OBS và tải nhiều kết nối trước khi public; số đo Chromium headless không đại diện thiết bị thật.

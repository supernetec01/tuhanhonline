# V9 — Bảo Các Thanh Liên

Thực hiện trên source hiện có, giữ nguyên thay đổi V8 và dữ liệu người chơi. Tài liệu V9 đính kèm có hai mức khởi đầu (6 và 10 bàn tọa); chọn **10** theo yêu cầu bàn giao tối thiểu ở mục 9. Không tải hoặc sao chép hình thương mại được liên kết trong tài liệu: các hình mặc định là SVG vẽ bằng mã trong dự án; Admin có thể thay bằng ảnh có quyền sử dụng.

## Chức năng

- Cửa hàng popup **Bảo Các Thanh Liên**, ba nhóm Pháp phục / Bàn tọa–Đài sen / Trang trí. Bộ lọc Tủ đồ chỉ hiện vật phẩm sở hữu. Hiển thị giá, mô tả, độ hiếm và thời gian tích xu ước tính từ số dư hiện tại, thời lượng tu mỗi ngày và trần xu từ CMS.
- **6 pháp phục mới**, sáu kiểu dáng và màu bậc 1–6: Phàm Phục (miễn phí), Thanh Tịnh (150), Nâu Thiền Hành (450), Kim Liên (1.000), Bạch Liên (2.000), Thanh Liên Ngọc (4.000). Giữ thêm cả 4 áo V8 cùng inventory/giá đã lưu.
- **10 bàn tọa**: Mộc (0), Hoa Văn (150), Trúc (300), Sen Hồng (500), Bạch Liên (1.000), Đăng Hoa (1.500), Kim Liên (2.000), Tử Liên (2.500), Ngọc Liên (3.500), Cửu Liên (5.000). Có kiểu đệm, thêu, lá trúc và sen nhiều lớp. Bậc cao mở nhẹ một lần khi vào ghế/đổi đài; tắt khi giảm chuyển động/eco.
- **5 kiểu chấm**: nâu (0), vàng nhạt (100), cánh sen (250), ngọc trắng (450), ánh kim dịu (800). Đổi kiểu không mở chấm; quy tắc tối đa 8 chấm và 4 cặp mở khóa V8 giữ nguyên.
- **4 phụ kiện trả xu**: chuỗi hạt trầm (200), đèn hoa sen (500), kinh sách bên tọa (300), lư hương mini (700); tùy chọn không phụ kiện miễn phí. **3 khung trả xu** trúc/sen/gỗ và khung mặc định miễn phí. Tổng 30 định nghĩa mới gồm các tùy chọn mặc định, 34 vật phẩm khi tính 4 áo V8.
- Xem trước mặt sau/mặt trước và phối nhiều slot cục bộ; **Ngắm tại ghế** ẩn popup tạm thời để xem nhân vật trong chánh điện, quay lại vẫn giữ phối đồ. Đóng hoặc hủy hoàn nguyên preview. Mua không tự trang bị; có nút Mặc / dùng ngay. Người khác chỉ nhìn thấy trang bị được server xác nhận.

## Dữ liệu và giao dịch

Migration `009_v9_store.sql` bổ sung `users.cosmetics`, `store_commands` và `shop_assets`, cấp các vật phẩm khởi đầu cho tài khoản cũ. Không tạo ví hoặc inventory song song; dùng `users.coins`, `inventory`, `purchases` và `coin_ledger` hiện có. Giữ các ID áo cũ, không reset ghế/hàng chờ, Merit hoặc chấm.

Mua dùng transaction và khóa theo cùng thứ tự room → user, giá lấy từ cấu hình đang xuất bản. Ghi khóa idempotency cả khi đã sở hữu; không trừ lần hai khi retry hoặc mua đồng thời. Key không được dùng sang vật phẩm khác hoặc qua endpoint V8. `expectedPrice` chỉ để từ chối báo giá cũ, không phải giá để server trừ ví. Không nhận tham số thưởng/giảm cooldown/ưu tiên.

Ngừng bán không thu hồi quyền sở hữu/trang bị. CMS không cho đổi loại của ID đã xuất bản hoặc xóa vật phẩm đã có người sở hữu; dùng ngừng bán thay thế. Inventory được giữ nguyên kể cả rollback bị chặn để tránh mất vật phẩm. Lịch sử lưu trong purchases/ledger; UI trả 100 giao dịch gần nhất của tài khoản.

## CMS và hình ảnh

Admin + MFA quản lý tên/mô tả, giá, màu/viền, bậc hiếm, kiểu hình, ảnh, mở/ngừng bán và thứ tự. Có xem trước và nhân bản mẫu để mở rộng catalog đến 100 định nghĩa. Áo V8 cũng có thể tùy biến đầy đủ trong catalog V9, ghi đè metadata mà vẫn giữ ID và ownership. Luồng nháp/xuất bản/rollback và audit hiện có tiếp tục áp dụng.

Upload ảnh tĩnh **PNG/WebP**, tối đa 1.5 MB, 1–1024px; ffprobe kiểm định dạng, kích thước và một frame. Không nhận SVG tùy ý, ảnh động hoặc URL bên ngoài. Mỗi upload là file UUID mới + checksum/metadata/audit; không ghi đè file cũ. Ảnh nháp chỉ Admin MFA xem được; chỉ ảnh được tham chiếu trong catalog xuất bản mới qua endpoint công khai. Lưu/backup `.data/shop-assets` cùng DB, không đưa vào Git. Kích thước ảnh và tên MIME lấy từ kiểm tra server.

Cấu hình catalog phải phù hợp schema. Endpoint nháp có giới hạn 128 KB sau xác thực quyền/MFA; các API gameplay vẫn giữ payload limit nhỏ. V8 Media Editor vẫn có mục tên/giá 4 áo cũ; nếu đã có override V9, override V9 được ưu tiên.

## Render và hiệu năng

Client tạo **một texture atlas** từ các lớp vật phẩm; không tạo texture cho mọi tổ hợp áo × bàn tọa × phụ kiện × chấm. Phaser dùng riêng ảnh áo, bàn tọa, phụ kiện, chấm và khung tên. Các sprite dùng chung atlas, thay frame khi đổi đồ; vẫn dùng clock/timeline nghi lễ của server. Bàn tọa và đồ đặt bên cạnh giữ tọa độ ghế; chuỗi hạt theo người khi dâng hương. Vùng bấm và sơ đồ 36 ghế không đổi.

Catalog tải riêng từ `/api/store` khi mở game hoặc configVersion đổi; không gửi lại toàn bộ catalog trong snapshot phòng. Atlas chỉ tái tạo khi hình/màu/kiểu/ID đổi, không khi xem thử, mua, trang bị hoặc thay giá. Không có vòng phát sáng liên tục hoặc particles cho đài sen. FPS mặc định và eco của V8 được giữ.

## API bổ sung

| Đường dẫn                         | Quyền                     | Chức năng                              |
| --------------------------------- | ------------------------- | -------------------------------------- |
| GET `/api/store`                  | Công khai                 | Catalog đang xuất bản, title, trần xu  |
| POST `/api/store/buy`             | Đăng nhập + Origin/header | `{itemId, requestKey, expectedPrice?}` |
| POST `/api/store/equip`           | Đăng nhập + Origin/header | `{itemId}`, slot do server xác định    |
| GET `/api/store/history`          | Đăng nhập                 | 100 giao dịch gần nhất của chính mình  |
| POST `/api/admin/store/assets`    | Admin MFA                 | `{data}` base64 PNG/WebP               |
| GET `/api/admin/store/assets/:id` | Admin MFA                 | Xem ảnh đang chuẩn bị                  |
| GET `/api/store/assets/:id`       | Công khai                 | Chỉ ảnh thuộc catalog đã xuất bản      |

## Xác thực và giới hạn

`pnpm db:migrate` đã chạy sau backup local `.data/backups/pre-v9.dump`; môi trường test dùng schema/Redis namespace riêng. Test suite gồm **35 HTTP integration tests** (29 cũ + 6 nhóm V9): đếm catalog, giả giá, mua lặp/đồng thời, idempotency qua V8/V9, giữ timeline/ghế, không tăng Merit/chấm, ownership sau ngừng bán, CMS legacy và ảnh có phiên bản. Chromium desktop/mobile còn kiểm tra atlas tải thật, xem thử bàn tọa không sửa DB, mua/trang bị kiểu chấm, ngắm tại ghế và không thay canvas khi đóng/mở cửa hàng. Có ảnh ở `test-results/store-v9.png`, `store-v9-seat-preview.png`.

Build vẫn có cảnh báo chunk Phaser lớn và annotation Zod từ dependency. Không đổi dependency hoặc lockfile. Kiểm tra tải ngắn dùng script benchmark có sẵn, kết quả riêng `.data/benchmark-v9.json`; không phải soak test, cam kết production hay đo FPS thiết bị thật. Hình mặc định là vector cách điệu; không phải bộ spritesheet minh họa hoàn thiện từ các liên kết tham chiếu.

Lần đo ngắn sau tối ưu snapshot (31/10/2026, chạy cùng lúc build/e2e trên 5 CPU): 36 active + 500 waiting + 1.000 viewer sockets; 100 API room requests p95 172.6 ms, 100 gift mock ingest p95 293.7 ms, fanout 1.000 socket p95 39 ms. Chat: 60 HTTP 200 và 40 HTTP 429 theo rate limit IP. RSS process cuối phép đo khoảng 290 MiB; CPU process user 4.44s/system 1.29s trong khoảng 8.97s. Điều kiện đo khác lần V8, không đủ kết luận không có suy giảm hiệu năng hoặc cam kết tải public. Chưa đo FPS mobile vật lý.

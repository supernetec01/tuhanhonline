# Thiền Tĩnh V2 — tích hợp và trạng thái

## Trạng thái bàn giao

Đã nhận `audio-manifest.json` và `README_CHO_CODEX.md`; lưu bản trong `docs/audio/thien-tinh-v2/`. **Chưa nhận ZIP hoặc 14 file OGG gốc.** Kiểm tra workspace và thư viện DB: 0 asset audio, 0 binding đang xuất bản. Chưa thay bằng file giả, chưa nhập hoặc kiểm nghe nội dung V2 gốc. Không coi các fixture kiểm thử là asset sản phẩm.

Phần code đã chuẩn bị: Audio Manager chung cho game/broadcaster, mixer CMS, luồng import 14 file, mapping sự kiện và kiểm thử. Chưa thể nghiệm thu phát bộ V2 thực tế cho đến khi có file gốc.

## Phát âm trên client

`TempleAudioManager` dùng Web Audio; chỉ tạo/resume AudioContext sau thao tác người dùng qua nút **Vào chánh điện và bật âm thanh**. Mute và âm lượng từng nhóm lưu trên thiết bị, không lưu quyền autoplay qua lần tải trang. Nếu trình duyệt suspend context, có nút tiếp tục; không âm thầm tạo context khác.

Nhạc chánh điện/sảnh chờ dùng chung manager sống cùng màn hình game. Chat, cửa hàng, tủ đồ, bảng xếp hạng không sở hữu audio và không khởi động lại nhạc. WAITING/INVITED dùng nền sảnh; ACTIVE/guest dùng nền chánh điện. Đổi nền crossfade mặc định 2 giây. Trong chuyển tiếp có hai source chồng ngắn để crossfade, không có hai ambient phát độc lập lâu dài.

Tại mép vòng lặp, overlap-add phần cuối/đầu 2 giây được thực hiện một lần trên buffer, sau đó dùng `AudioBufferSourceNode.loop`. Cách này không phụ thuộc JavaScript timer mỗi vòng. Với file 90 giây, chu kỳ hiệu dụng sau chồng 2 giây khoảng 88 giây. Cần kiểm nghe bản gốc khi nhập. Thời gian crossfade thực tế bị giới hạn tối đa 1/4 file đối với fixture/file rất ngắn.

File chỉ tải/giải mã khi được chọn để phát, không tải cả 14 file lúc vào game. Cache decode tối đa 8 mục/48 MB; các source đang phát giữ buffer của riêng mình. Tối đa 2 hiệu ứng đang tải hoặc phát, dedupe event ID, nhận xu/mõ tối đa một lần/5 giây. Không phát lại lịch sử xu của tài khoản khi vừa đăng nhập. Bản thu riêng do người chơi chọn thay nền tự động đến khi họ chọn dùng lại nền phòng; không upload bản riêng.

## Âm lượng

| Nhóm                    | Mặc định |
| ----------------------- | -------- |
| Chánh điện              | 16%      |
| Sảnh chờ                | 13%      |
| Nghi lễ/chuông thiền/mõ | 30%      |
| UI/nhận ghế/mua/xu      | 22%      |
| Voice                   | 85%      |

Khi voice phát, ambient còn **25% mức người chơi đang chọn**. Ví dụ 16% → 4%; khi kết thúc, lỗi hoặc hủy voice, phục hồi mức mới nhất kể cả người chơi kéo volume trong lúc đọc. Voice static được kiểm duration server và client ≤10 giây; dùng cùng mixer trên màn hình OBS. Chuông mở đầu chạy trước voice, giới hạn chờ 2 giây. Native speech của thiết bị vẫn là tùy chọn fallback, không phải voice AI hay giọng V2 gốc.

`config.audioMix` quản lý volumes, duckFactor, crossfadeSeconds, maxEffects và bật nhận xu/mõ. Mặc định tắt âm xu/mõ để tránh gây phiền; Admin bật khi cần. `config.live.duckVolume` được giữ để đọc cấu hình V1 cũ, không còn là điều khiển mixer; dùng audioMix.duckFactor. Mute áp dụng toàn bộ nhóm; tạm dừng nhạc chỉ dừng ambient, không thay trạng thái game.

## Mapping V2

| File OGG                          | Cue               | Thời điểm                                                    |
| --------------------------------- | ----------------- | ------------------------------------------------------------ |
| ambient_chanh_dien_thien_tinh_90s | background        | Guest/người tu, loop                                         |
| ambient_sanh_cho_an_nhien_90s     | waitingBackground | Người chờ/được mời, loop                                     |
| chuong_chao_nhe                   | welcome           | Bật âm thanh sau gesture                                     |
| chuong_tinh_tam                   | meditation        | Có phiên thiền chung                                         |
| mo_nhe                            | woodblock         | Vái/lạy, tùy chọn, không lặp                                 |
| vai                               | bow               | Server xác nhận bắt đầu vái                                  |
| lay                               | prostrate         | Server xác nhận bắt đầu lạy                                  |
| dang_huong                        | incense           | Server xác nhận COMPLETED, không phát lúc queue/start/cancel |
| nhan_ghe                          | seat              | Nhận ghế ACTIVE                                              |
| den_luot                          | invitation        | Chuyển sang INVITED                                          |
| mua_vat_pham                      | purchase          | Mua thành công tại cửa hàng V8/V9                            |
| tich_xu                           | coin              | Ledger phút có nguồn mới, gộp/throttle                       |
| loi_chuc_mo_dau                   | blessing          | Trước voice trên broadcaster                                 |
| roi_phong                         | leave             | Rời phòng/đăng xuất                                          |

Các cue V1 `click` và `chant` vẫn đọc được; mapping cũ được giữ cho đến khi có bản thay thế xuất bản. Snapshot `/api/room/me` bổ sung completedAction và coinReward để hiệu ứng theo xác nhận server; không tin số xu hoặc action do client tự cộng.

## Admin và import

Admin + MFA: import audio có phiên bản, nghe thử, thay file theo từng sự kiện, chọn volume nhóm/crossfade/duck và xem trước; lưu nháp → xuất bản → rollback theo CMS hiện có. Mọi thay file tạo asset UUID và checksum mới. Ẩn/khôi phục trong thư viện có audit và giữ file để bảo toàn lịch sử/rollback. Ẩn không tự ngừng binding đang xuất bản; muốn ngừng phát, bỏ gán cue rồi xuất bản. Preview thư viện chỉ phát một bản thử tại một thời điểm.

Bộ V2 có thể nhập qua chọn đủ 14 OGG đã giải nén trong Admin. Thiếu/sai tên file thì không upload; nếu lỗi giữa chừng, mapping không đổi, các phiên bản đã upload trước lỗi vẫn trong thư viện để xử lý tiếp. Không tự xuất bản bằng thao tác chọn file.

CLI có preflight toàn bộ bộ pack (tên/role, path nằm trong thư mục pack, OGG Opus audio-only, size và duration) trước khi ghi:

```bash
cd /workspace/tuhanhonline
node --env-file-if-exists=.env --import tsx scripts/import-audio-v2.ts \
  --directory /path/to/extracted-pack --actor admin_username
```

Thư mục pack chứa `assets/*.ogg` như manifest. Dùng tài khoản ADMIN đã có; CLI không tạo/nâng quyền tài khoản. Có thể bỏ --actor nếu chỉ có đúng một ADMIN. Giữ bản nháp hiện có và các binding V1 không trùng cue; gán 14 cue V2, khuyến nghị volumes từ manifest, lưu thành nháp. Kiểm nghe tại Admin rồi xuất bản.

Migration `010_audio_library.sql` thêm archive timestamp và index completion; đã backup `.data/backups/pre-audio-v2.dump` trước khi chạy trên môi trường hiện tại. File upload giữ ở `.data/assets`, cần backup cùng DB. Endpoint file đã xuất bản có immutable cache headers; backend chỉ kiểm metadata khi upload và phục vụ byte file, không render/giải mã hay chạy vòng nhạc trên VPS.

## Xác thực và giới hạn

- `pnpm test`: 41 tests, gồm hồi quy game/V9, 4 kiểm thử manager/DSP và các kiểm thử CMS/importer V2. Importer thiếu file không ghi dữ liệu; đủ 14 fixture chỉ tạo nháp, giữ nguyên cấu hình đang xuất bản.
- Chromium desktop/mobile emulation phát **OGG Opus fixture tạo trong thư mục/schema riêng**: không request audio trước gesture; loop native không restart khi mở/đóng chat/cửa hàng; chuyển nền WAITING → INVITED → ACTIVE; mute còn sau reload; voice static qua mixer, duck 16% → 4% rồi phục hồi 16%. Có kiểm thử suspend/resume AudioContext bằng API, không tạo lại loop.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`; cảnh báo chunk Phaser/annotation Zod từ dependency vẫn còn.
- Chưa nghe 14 bản gốc trên headphone/loa nhỏ, chưa xác nhận crossfade thực tế của pack 90 giây. Chưa thử Safari iOS, Android thật, khóa màn hình/tab ẩn dài hạn hay bắt âm OBS thực tế; emulation Chromium không thay thế các kiểm tra này. Trình duyệt không hỗ trợ decode OGG/Opus hiển thị lỗi và vẫn giữ game hoạt động; chưa cung cấp MP3/AAC fallback vì chưa có nguồn âm gốc để chuyển mã.

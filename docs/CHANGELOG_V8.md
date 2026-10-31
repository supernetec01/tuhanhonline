# Thay đổi V8 — 31/10/2026

Triển khai trực tiếp trên dự án hiện có, chưa phải hoàn tất toàn bộ đặc tả V8. Xem [đối chiếu và giới hạn](IMPLEMENTATION_PLAN.md).

- Migration 004–008 bổ sung ví công đức, ledger xu/công đức chống sửa/xóa, cursor thời gian tu, chấm, xếp hạng, chat/kháng nghị và media. Không xóa/reset dữ liệu cũ; migration 004 chỉ thay các giá trị cooldown/duration đúng bằng mặc định cũ, giữ override khác.
- Xu 1/phút đủ điều kiện ghế, cap ngày mặc định 240 theo Asia/Bangkok; completion Merit mặc định 1/3/10, khóa nguồn action chống nhân đôi; số dư cá nhân đồng bộ cùng room snapshot.
- Dâng hương FIFO 5 giây, hồi chiêu 300 giây từ started_at; Vái 60 giây, Lạy 180 giây. Phần thưởng của action được chốt lúc yêu cầu.
- Mở 8 chấm theo cặp tuần tự, không âm ví, retry idempotent, hiển thị theo đầu avatar; giá và tên 4 mẫu áo chỉnh được trong CMS.
- Popup chat, nhật ký, lời nguyện mẫu, xếp hạng và tìm người; sảnh hiển thị tối đa 18 avatar; ánh sáng ngày/đêm và eco FPS.
- Chat duyệt trước hiển thị, rate limit IP/user, no HTML/link, pending/rejected, report, mute, role Moderator + MFA, kháng nghị/gỡ mute và audit; mute không đổi ghế/ví. Chỉ socket subscribe chat nhận thông báo; cache 50 tin, DB giữ 30 ngày. Đóng/mở chat giữ nguyên canvas.
- Admin import OGG/MP3 nhiều file, tối đa 2.5 MB/file; ffprobe đo duration và kiểm audio-only; voice ≤10s, SFX ≤60s, music ≤10 phút. Phiên bản mới không ghi đè file cũ. Chỉ mapping xuất bản mới được truy cập công khai; audio voice qua quyền broadcaster.
- Import JSON lời chúc `{id,text,audioId:null}`, gán voice đo thời lượng; chọn tránh 5 mẫu gần nhất khi đủ thư viện. File static qua broadcaster, một voice, timeout 10 giây, duck/restore. Giữ tương thích TTS tùy chọn cũ; template V8 không có file dùng chữ. Chưa import 48 câu/audio vì thiếu gói gốc.

## Xác thực

- HTTP integration: 29 tests, gồm các kiểm tra cũ và 6 nhóm V8 (xu/cap/reconcile, Merit/cooldown, chấm concurrent/retry, moderation/kháng nghị/cache, prayer/ranking, media 11s bị từ chối + static audio + ledger bất biến).
- Chromium e2e desktop/mobile: giữ 36 ghế, đăng ký không email, mua/mặc đồ, nghi lễ, FIFO/full room, Admin MFA/publish, mock broadcast; bổ sung mở/gửi/đóng chat và kiểm tra canvas không bị tạo lại, ghế không mất, popup nhật ký tải dữ liệu.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`. Build có cảnh báo chunk Phaser lớn và annotation trong dependency Zod; không sửa dependency/lockfile.
- Migration chạy trên local DB sau backup `.data/backups/pre-v8.dump`; dữ liệu test trong schema riêng, không sửa tài khoản phát triển.

## Đo tải cục bộ

Chạy `node --env-file-if-exists=.env --import tsx scripts/benchmark-v8.ts` từ root repo. Tạo schema và Redis namespace riêng rồi dọn; kết quả local `.data/benchmark-v8.json`.

Lần đo 31/10/2026: 5 CPU khả dụng; 36 active, 500 waiting, 1.000 viewer sockets; 100 API room requests p95 90.0 ms; 100 gift mock ingest p95 180.9 ms; fanout 1.000 socket p95 32 ms. 100 chat send attempts: 60 HTTP 200, 40 HTTP 429 do giới hạn IP. RSS process tại cuối phép đo khoảng 297 MiB, CPU process user 3.50s/system 1.05s, phép đo khoảng 6.94s. Không phải CPU/RAM peak host, benchmark bền vững hay hiệu năng production/thiết bị thật. Không đo FPS mobile, mạng xa, worker throughput hoặc TLS/CDN.

## Vận hành

Cần Node 24, pnpm 11.25.0, PostgreSQL/Redis, Chromium, ffmpeg và ffprobe. Sau cập nhật chạy `pnpm db:migrate`, khởi động lại `pnpm dev`; readiness `/api/health/ready` phải xác nhận database/redis/worker. Dữ liệu audio `.data/assets` phải được giữ/backup cùng DB và MFA key. Không đưa `.env`, password, MFA key hay backup vào Git. Muốn phục hồi bản trước migration, dừng ứng dụng và phục hồi backup vào DB mới để kiểm tra trước; không rollback bằng cách xóa cột/bảng có dữ liệu.

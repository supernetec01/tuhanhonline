# Kế hoạch mở rộng LIVE

Tái sử dụng LiveService/MockLiveAdapter, HMAC, dedup/streak, TTS/cache, CMS version/audit, RoomService và FIFO hiện có. Không tạo lại dự án; renderer hiện là SVG/CSS, chưa phải Phaser.

Triển khai thêm migration độc lập: effect_jobs FIFO/TTL, ceremony_runs và lịch bền vững. Ba hiệu ứng nguyên bản: sen, đèn và khói. Cấu hình mapping/thời lượng/tên/giọng/lịch trong cùng nháp/xuất bản/rollback. Scheduler không cấp ghế, không sửa cooldown; người có nghi lễ riêng hoàn tất trước khi tham gia hiệu ứng chung. Giới hạn TTS chờ 60 giây, quá tải chuyển sang chữ/hiệu ứng. Analytics chỉ đo DB của ứng dụng, không suy đoán lượt xem TikTok.

Nghiệm thu: quà trùng không tạo thêm job; nhiều quà phát hiệu ứng lần lượt; worker restart giữ lịch; phiên thiền miễn phí 60 giây đúng các pha; publish/rollback thay đổi cấu hình; snapshot/reconnect giữ trạng thái; quyền test endpoint và giới hạn đầu vào; mọi test 36 chỗ cũ tiếp tục đạt. Mock rehearsal và browser kiểm chứng overlay/broadcast; chưa chứng minh TikTok/TTS/nhạc/OBS thật.

## Kết quả triển khai

- Migration `002_live_experience.sql`: effect_jobs, ceremony_runs, ceremony_clock và giọng của từng TTS job. Không sửa migration cũ.
- Admin → Nội dung & cấu hình → Hiệu ứng LIVE: mapping mã quà sang sen/đèn/khói, bật/tắt, thời lượng 2–8 giây, hiện tên; bật TTS/chọn giọng, âm lượng ducking; lịch 10–15 phút. Dùng chung nháp/xuất bản/rollback. Mặc định lịch tự động tắt; có nút diễn tập 60 giây bảo vệ bởi role/MFA/audit/rate limit.
- Hiệu ứng một lượt mỗi lần, tối đa 30 pending, bỏ qua khi chờ quá 60 giây. Lượt dâng hương di chuyển theo lối giữa; nhân vật có tên cấu hình được trên cả web và broadcast. Hoạt ảnh vẫn SVG/CSS, chưa có sprite đi/đứng vẽ riêng.
- Các pha thiền 0–10/10–25/25–40/40–55/55–60 tính từ server timestamp để reconnect đúng giai đoạn. Nghi lễ riêng có ưu tiên; không thay đổi ghế, xu hoặc cooldown. Trong phiên chung không claim thêm lời chúc quà. Lời chúc chung hiện bằng chữ ở chế độ mock, chưa có bản thu/giọng AI chung được kiểm chứng.
- TTS chờ tối đa 60 giây, budget số lượt theo khoảng cách đọc; quá tải vẫn có lời cảm ơn/hiệu ứng. Từng job giữ giọng tại thời điểm nhận để cache và phát không đổi sau publish.
- BroadcastAudioManager duck/khôi phục âm lượng; người vận hành có thể chọn file audio mình có quyền sử dụng ngay trên máy phát. Không upload/phân phối file, chưa phải CMS thư viện audio; chưa đo trên OBS/audio mixer phần cứng.
- `/api/admin/live/analytics` chỉ trả số sự kiện/quà, TTS lỗi/fallback/p95 chờ phát, effect backlog và số phiên chung. `tiktok_viewers=null`; không tự tính lượt xem/thời lượng xem từ dữ liệu game.

Giới hạn: chưa có nhiều template/category CRUD, media CMS/playlist tập trung hoặc API riêng đầy đủ như mọi endpoint gợi ý. Cấu hình hiệu ứng/lịch dùng API revision chung thay vì hai luồng publish khác nhau. Voice Coral/Onyx chỉ là lựa chọn adapter, không bảo đảm giới tính/chất giọng tiếng Việt. Các tài sản ảnh ngoài trong tài liệu không được đưa vào sản phẩm.

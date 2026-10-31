# TU HÀNH ONLINE — BỘ ÂM THANH THIỀN TĨNH V2

## Mục đích

Bộ 14 file âm thanh gốc tổng hợp dành cho chánh điện, sảnh chờ và hiệu ứng tối giản. Không chứa lời tụng kinh hoặc nhạc thương mại. Âm thanh nền không có nhịp trống; dùng drone và tiếng chuông thưa, nhẹ.

## Tích hợp

1. Copy `assets/*.ogg` vào thư mục public audio của dự án hoặc object storage/CDN.
2. Đọc `audio-manifest.json`; dùng duy nhất một ambient loop phát trên browser ở một thời điểm (chánh điện hoặc sảnh chờ).
3. Phải có nút **Vào chánh điện & bật âm thanh** bởi autoplay có tiếng bị nhiều trình duyệt chặn nếu chưa tương tác. Lưu tùy chọn mute và volume. Không giả vờ âm thanh tự bật được ở mọi browser.
4. Crossfade ambient 2 giây ở mép vòng lặp; pre-load trước file tiếp theo. Bản phát đầu tiên nên thử trong điều kiện loa nhỏ.
5. Không phát tiếng công đức/xu nếu quá dày; gộp nhiều thay đổi liên tiếp. Giới hạn max 2 effects cùng lúc.
6. Khi phát voice chúc phúc ở máy livestream, giảm ambient xuống 25% rồi khôi phục sau voice. Giới hạn mỗi clip voice <=10 giây.
7. Người chơi chờ và đang tu dùng cùng một audio manager, tránh tạo lại audio khi popup chat mở/đóng.
8. Mọi file và volume/sự kiện gắn file phải sửa được qua Admin CMS, versioning và preview; backend KHÔNG giải mã/stream render nhạc.
9. Tối ưu: cache headers, preload 1 ambient + SFX quan trọng; đừng tải 14 files lập tức trên di động.
10. Test trên Chrome, Safari iOS, Android, tab ẩn, reconnect, phát LIVE qua OBS và thử nghe bằng headphone.

## Sơ đồ gắn sự kiện

- ambient_chanh_dien_thien_tinh_90s: nền chánh điện
- ambient_sanh_cho_an_nhien_90s: nền sảnh chờ
- chuong_chao_nhe: khi vào phòng/bật audio
- chuong_tinh_tam: mở đầu phiên thiền tập thể
- mo_nhe: tiếng mõ nhẹ theo nghi thức, không phát dồn dập
- vai: hành động vái
- lay: hành động lạy
- dang_huong: hoàn tất dâng hương
- nhan_ghe: nhận ghế thành công
- den_luot: lời mời hàng chờ
- mua_vat_pham: mua item thành công
- tich_xu: nhận xu (có thể tắt mặc định)
- loi_chuc_mo_dau: trước voice cảm ơn
- roi_phong: rời tu

## Gợi ý cho Codex

Inspect source, không viết lại project. Thay audio V1 bằng V2, giữ mapping backward compatible, thêm audio manager chung với lazy loading, âm lượng tự chỉnh và mute, Admin CRUD bản audio, test playback/loop.

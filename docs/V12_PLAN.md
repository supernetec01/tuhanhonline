# V12 — Kế hoạch triển khai

Nâng cấp source hiện tại, giữ room_entries là nơi cấp ghế duy nhất, không tạo bảng reservation song song. Giữ tài khoản, ví, đồ sở hữu, API authentication và audio V2. Đồ họa vector/rig gốc, không lấy asset Sansa.

1. Chibi có 4 chi/nam-nữ/4 hướng, rig dùng chung, atlas phần rời và các lớp đồ. Sơ đồ chuẩn 36/72 có khoảng cách hàng tốt hơn, depth theo chân, zoom/theo nhân vật.
2. Navigation graph cố định theo sơ đồ ghế; server xác nhận node/đường/tốc độ và đặt timestamp. Lưu mốc di chuyển, không gửi tọa độ mỗi frame. Tránh vị trí đang đứng và xung đột thời gian trên đường; client chỉ nội suy.
3. Tự rời ghế: deadline 180 giây giữ nguyên qua reconnect, dừng xu; chỉ server hoàn tất trở về/ngồi mới xóa deadline. Hết hạn giải phóng ghế cho FIFO.
4. Hàng dâng hương toàn cục, hai trạm A/B, tối đa 8–12 người được gọi lên; người còn lại ngồi chờ. Đi/chờ/thắp 5 giây/trở về là các trạng thái riêng; 10 công đức một lần, cooldown 300 giây từ bắt đầu thắp.
5. Người được gọi được bảo vệ hạn phiên tối đa 10 phút (Admin chỉnh trong giới hạn); vẫn chịu mất kết nối, kick/ban. Người chưa được gọi vẫn chịu hạn phiên thường. Trở về hết bảo vệ; không gia hạn vô hạn.
6. Migration bổ sung, backup trước apply; kiểm API đồng thời, deadline, FIFO 72 người/hai trạm, tái khởi động, xu/công đức và art/atlas. Kiểm trình duyệt desktop/mobile và đo hiệu năng trong môi trường kiểm thử; không coi giả lập là thiết bị thật.

Lưu kết quả và giới hạn thực tế sau kiểm thử. Không coi tài liệu/ảnh tham khảo hoặc file không được đính kèm là asset đã có.

# Truy cập Admin bằng mật khẩu

Theo yêu cầu ngày 31/10/2026, tài khoản có role **ADMIN** dùng phiên đăng nhập mật khẩu hiện tại để vào `/admin` và gọi API quản trị, không phải nhập mã Authenticator. Quy tắc áp dụng cả development và production, cả tài khoản chưa thiết lập MFA hoặc đã thiết lập trước đây. Các tài liệu V8/V9 ghi Admin + MFA mô tả quy tắc trước thay đổi này.

## Chạy trên Windows

Sau khi cập nhật mã nguồn, dừng server bằng Ctrl+C rồi chạy lại:

```powershell
cd D:\AI\tuhanhonline
pnpm.cmd dev
```

Đăng nhập tài khoản tại `http://localhost:3000`, sau đó mở `http://localhost:3000/admin`. Nếu vẫn thấy giao diện cũ, tải lại trang bằng Ctrl+F5. Không cần xóa dữ liệu, đăng ký lại hoặc migration riêng cho thay đổi này.

Nếu chưa có quyền, đăng ký tài khoản trong game, sau đó mở PowerShell thứ hai và cấp quyền cho đúng tên đăng nhập:

```powershell
cd D:\AI\tuhanhonline
pnpm.cmd admin:promote ten_dang_nhap
```

Không có tài khoản/mật khẩu Admin mặc định. Lệnh chỉ nâng quyền tài khoản có sẵn; mật khẩu vẫn là mật khẩu tài khoản trong game.

## Kiểm tra quyền

- API lấy role mới nhất từ DB trên từng yêu cầu; không tin role gửi từ trình duyệt.
- Chưa đăng nhập, phiên hết hạn/đã thu hồi hoặc tài khoản bị khóa: không được truy cập.
- USER không được gọi API quản trị; hạ quyền ADMIN có hiệu lực ngay trên yêu cầu tiếp theo.
- OPERATOR/MODERATOR giữ cơ chế MFA 15 phút và phạm vi quyền riêng; không được xuất bản cấu hình ADMIN.
- Cookie HttpOnly/SameSite, xoay phiên, kiểm tra Origin/header chống CSRF, rate limit và audit tiếp tục áp dụng. Phiên ADMIN hết hạn cùng phiên tài khoản (24 giờ), không dùng hạn MFA 15 phút.
- Dữ liệu MFA cũ được giữ để tương thích các vai trò được ủy quyền; ADMIN không cần đọc/giải mã secret cũ khi vào trang hoặc thao tác CMS.

## Xác thực thay đổi

Kiểm thử API bao gồm đăng nhập đúng/sai mật khẩu, quyền ADMIN khi chưa MFA và khi MFA cũ đã hết hạn, USER bị chặn, hạ quyền/khóa/đăng xuất thu hồi truy cập, OPERATOR/MODERATOR vẫn cần MFA, chống dùng lại mã và CMS draft/publish/rollback. Kiểm thử Chromium xác nhận USER không vào được, ADMIN mở trang và tải lại mà không có bước Authenticator, sau đó xuất bản cấu hình và sử dụng các tính năng hiện có.

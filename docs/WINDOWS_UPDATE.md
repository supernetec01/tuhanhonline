# Cập nhật từ GitHub và chạy lại trên Windows

`git pull` tải mã mới từ GitHub về máy; `git push` đưa commit trên máy lên GitHub.

## Cập nhật dự án đang có

1. Tại cửa sổ đang chạy game, nhấn **Ctrl+C** để dừng server. Mở Docker Desktop và chờ Docker Engine chạy.
2. Trong PowerShell, kiểm tra thư mục và trạng thái mã nguồn:

```powershell
cd "E:\Tu hanh online\tuhanhonline"
git status
```

Nếu có thay đổi mã nguồn của riêng bạn, lưu chúng trước khi pull; có thể dùng `git stash push -u -m "Windows changes before update"`. Lệnh stash cất thay đổi local, không xóa chúng; khi cần khôi phục dùng `git stash apply` và xử lý xung đột nếu có. `.env` và `.data` đã được Git bỏ qua, không bị stash mặc định hoặc pull ghi đè.

3. Tải nhánh main và chạy lần lượt từng lệnh; nếu có lỗi, dừng tại lệnh đó:

```powershell
git pull --ff-only origin main
corepack.cmd pnpm@11.25.0 install --frozen-lockfile
docker compose up -d --wait
corepack.cmd pnpm@11.25.0 db:migrate
corepack.cmd pnpm@11.25.0 dev
```

`--ff-only` dừng nếu lịch sử local đã phân nhánh; không tự ghi đè commit local. Không dùng `git reset --hard`, xóa `.data` hoặc tạo lại DB để xử lý lỗi cập nhật.

4. Giữ PowerShell chạy server mở. Mở game tại `http://localhost:3000`, trang quản trị tại `http://localhost:3000/admin`. Nhấn **Ctrl+F5** nếu trình duyệt còn giao diện cũ.

Tài khoản, mật khẩu, xu, tủ đồ và cấu hình đang có nằm trong DB local; cập nhật mã nguồn và chạy migrations không tạo lại các tài khoản đó. Tài khoản ADMIN vào trực tiếp sau khi đăng nhập mật khẩu, không cần Authenticator. Nếu chưa có quyền, đăng ký tài khoản trong game rồi dùng PowerShell thứ hai:

```powershell
cd "E:\Tu hanh online\tuhanhonline"
corepack.cmd pnpm@11.25.0 admin:promote ten_dang_nhap_cua_ban
```

## Nếu chưa có bản clone Git

Nếu `git status` báo `not a git repository`, thư mục hiện tại có thể được giải nén từ ZIP. Giữ nguyên thư mục cũ; clone vào thư mục mới để tránh mất dữ liệu:

```powershell
cd "E:\Tu hanh online"
git clone https://github.com/supernetec01/tuhanhonline.git tuhanhonline-github
cd .\tuhanhonline-github
corepack.cmd pnpm@11.25.0 install --frozen-lockfile
```

Nếu muốn dùng lại dữ liệu cũ, cần dừng server/container của bản cũ và chuyển nguyên `.env` cùng `.data` sang bản mới trước khi khởi động. Không chạy đồng thời hai bản dùng chung cổng hoặc cùng dữ liệu PostgreSQL. Không sao chép thư mục PostgreSQL khi container còn chạy.

Nếu cài mới hoàn toàn, không có dữ liệu cũ cần dùng lại:

```powershell
corepack.cmd pnpm@11.25.0 setup:local
docker compose up -d --wait
corepack.cmd pnpm@11.25.0 db:migrate
corepack.cmd pnpm@11.25.0 dev
```

## Yêu cầu công cụ

- Node.js 24.13 trở lên trong nhánh 24; pnpm 11.25.0.
- Git for Windows và Docker Desktop (Linux containers/WSL 2).
- Dùng `corepack.cmd pnpm@11.25.0` trong PowerShell để tránh lỗi chặn script `.ps1` và ghim đúng phiên bản. Luôn chạy trong thư mục có `package.json`, không chạy tại `C:\Windows\system32`.
- Bộ 14 file OGG Thiền Tĩnh V2 gốc chưa được cung cấp; repository có manifest, hướng dẫn và công cụ import. Xem [AUDIO_THIEN_TINH_V2.md](AUDIO_THIEN_TINH_V2.md).

# Hoàn Hảo Football CRM

Web app quản lý Học viện Bóng đá Hoàn Hảo (Quy Nhơn, Phú Yên, Phù Mỹ). Kế hoạch & trạng thái: [PLAN.md](PLAN.md).

## Chạy cục bộ (dữ liệu giả)

```bash
npm install
npm run db:local                         # khởi động PostgreSQL tạm (cổng 54329), in ra URL
cp .env.example .env.local               # DATABASE_URL=postgresql://postgres@127.0.0.1:54329/hoanhao_dev
DATABASE_URL=postgresql://postgres@127.0.0.1:54329/hoanhao_dev npm run db:reset   # migrations + seed demo
npm run dev                              # http://localhost:3000 → chọn tài khoản demo
```

## Kiểm tra

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

`npm test` tạo database tạm cho mỗi file test, chạy toàn bộ migrations và gọi RPC dưới role `authenticated` với JWT claims của từng người dùng (không dùng service role). Đặt `TEST_DATABASE_URL` để dùng Postgres có sẵn.

## Supabase

Migrations nằm trong `supabase/migrations` (dùng được với `supabase db push`). File `supabase/tests/bootstrap_local.sql` chỉ để giả lập `auth.uid()`/roles khi test cục bộ — **không chạy trên Supabase**. Đăng nhập thật dùng Supabase Auth (email + mã/link, không mật khẩu) — xem mục dưới. Chế độ chọn danh tính DEV chỉ dùng khi phát triển (tự tắt khi `NODE_ENV=production`).

### Cấu hình đăng nhập (Supabase Auth)

1. Biến môi trường (xem `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (khóa công khai), `APP_URL` (địa chỉ app, VD `https://crm.example.vn`), `DATABASE_URL` (chỉ phía server). **Không** dùng service role key trong app.
2. Supabase Dashboard → Authentication:
   - Providers: bật **Email**, tắt đăng nhập mật khẩu nếu không dùng; giữ **Confirm email** bật.
   - URL Configuration: Site URL = `APP_URL`; Redirect URLs thêm `APP_URL/auth/callback`.
   - Email Templates → Magic Link: thêm `{{ .Token }}` để email có mã 6 số (người dùng có thể nhập mã hoặc bấm link).
   - Cấu hình SMTP riêng trước khi dùng thật (SMTP mặc định của Supabase giới hạn rất ít email/giờ).
3. Tạo SUPER_ADMIN đầu tiên (một lần, bằng SQL Editor với quyền quản trị): `insert into user_invitations (email, full_name, kind, role) values ('<email>', '<Họ tên>', 'STAFF', 'SUPER_ADMIN');` rồi người đó đăng nhập bằng email này.
4. Sau đó mời người khác trong app: **Người dùng & lời mời** (`/admin/users`). Quản lý chi nhánh mời HLV/kế toán/CSKH cho chi nhánh mình; quản lý/CSKH mời phụ huynh cho từng học viên. Lời mời hết hạn sau 14 ngày, thu hồi được.

Ai đăng nhập được bằng email nhưng chưa được mời sẽ không có profile/vai trò, nên không thấy dữ liệu nào.

## Chưa làm

Xem [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md): care cases & cảnh báo có dedupe (test 4), tài chính/kho/lương (Phase 3), import thật (Phase 4), đăng nhập bằng số điện thoại (cần nhà cung cấp SMS), e2e.

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

Migrations nằm trong `supabase/migrations` (dùng được với `supabase db push`). File `supabase/tests/bootstrap_local.sql` chỉ để giả lập `auth.uid()`/roles khi test cục bộ — **không chạy trên Supabase**. Đăng nhập Supabase Auth chưa được nối; bản này dùng chế độ chọn danh tính DEV (tự tắt khi `NODE_ENV=production`).

## Chưa làm

Xem [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md): care cases & cảnh báo có dedupe (test 4), tài chính/kho/lương (Phase 3), import thật (Phase 4), Supabase Auth thật, e2e.

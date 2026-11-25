# Bản xem thử (demo) công khai

Mục đích: cho người ngoài xem giao diện mà **không cần đăng nhập** và **không đụng tới dữ liệu thật**.

## Cách hoạt động
- Một project Vercel riêng (ví dụ `hoanhao-demo`) chạy cùng code, với biến môi trường `DEMO_MODE=1`.
- Database là một project Supabase **riêng**, chỉ chứa dữ liệu giả (sinh từ `npm run db:reset`).
- Trang đăng nhập hiện danh sách vai trò demo (Admin, Quản lý, HLV, Kế toán, CSKH, Phụ huynh) để chọn.
- Thanh vàng "BẢN XEM THỬ" luôn hiện trên đầu trang.

## Hàng rào an toàn
1. `DEMO_MODE=1` bị từ chối nếu có `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (bản thật luôn có).
2. Database phải có bảng `public.hh_demo_marker`; bảng này chỉ được tạo bởi file dữ liệu demo. Trỏ nhầm vào DB thật -> app dừng.
3. Chỉ chọn được các tài khoản có tên chứa "Demo".

## Biến môi trường của project demo
| Biến | Giá trị |
|---|---|
| `DEMO_MODE` | `1` |
| `DATABASE_URL` | Transaction pooler (cổng 6543) của project Supabase **demo** |

Không đặt `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `APP_URL`.

## Tạo / làm mới dữ liệu demo
```bash
DATABASE_URL=postgresql://postgres@127.0.0.1:54329/hoanhao_dev npm run db:reset
pg_dump "$DATABASE_URL" --data-only --schema=public --inserts --rows-per-insert=200 \
  --exclude-table-data=public.policy_settings --exclude-table-data=public.audit_logs > demo_data.sql
```
Trong SQL Editor của project demo: chạy lần lượt các file `supabase/migrations/*.sql`, sau đó chạy file dữ liệu
(đầu file thêm `create table public.hh_demo_marker ...` và `set local session_replication_role = replica;`).

Người xem có thể sửa dữ liệu demo; muốn làm sạch thì xóa project demo và làm lại các bước trên.

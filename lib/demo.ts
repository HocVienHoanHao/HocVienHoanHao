/**
 * Chế độ DEMO công khai: chạy trên một database RIÊNG chỉ có dữ liệu giả, người xem chọn vai trò để xem thử, không cần đăng nhập.
 * Bảo vệ 2 lớp để không bao giờ bật nhầm trên hệ thống thật:
 *  1. DEMO_MODE=1 bị từ chối nếu có cấu hình Supabase Auth (bản thật luôn có).
 *  2. Database phải có bảng đánh dấu public.hh_demo_marker (chỉ tạo trong DB demo) — kiểm tra ở lib/db.ts.
 */
export function demoMode(): boolean {
  if (process.env.DEMO_MODE !== "1") return false;
  if (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error("DEMO_MODE=1 không được dùng chung với cấu hình Supabase Auth (bản thật)");
  }
  return true;
}

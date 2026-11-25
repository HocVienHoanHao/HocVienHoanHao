# Threat model (MVP)

| Mối đe dọa | Biện pháp hiện có | Còn thiếu |
|---|---|---|
| Phụ huynh đọc dữ liệu con người khác (IDOR, đoán ID/URL) | RLS trên mọi bảng + `FORCE ROW LEVEL SECURITY`; RPC tiến độ kiểm tra `can_view_enrollment`; chỉ liên kết guardian đã duyệt và guardian đã xác minh mới có hiệu lực (test 5) | Kiểm thử bằng JWT Supabase thật trên môi trường test |
| Leo quyền bằng claim giả | Vai trò lấy từ `branch_memberships`/`coach_assignments`/`guardian_students`, không từ JWT claim hay input (test) | |
| Sửa số dư/ngày dự kiến từ client | Không có quyền INSERT/UPDATE `session_ledger`, `entitlements`, `attendance`; helper nội bộ bị revoke; ledger append-only | Job reconcile khi có cache (chưa cần vì không cache) |
| Trừ buổi hai lần (double submit, race) | `idempotency_key` unique, unique `(session, student)`, khóa advisory theo học viên, so sánh net ledger trước khi ghi | |
| HLV xem tài chính/chi nhánh khác | HLV chỉ thấy lớp được phân công còn hiệu lực + membership đúng chi nhánh; không thấy ledger, hóa đơn | |
| Rò rỉ ghi chú nội bộ | `notes.visibility`; phụ huynh chỉ đọc PARENT đã `shared_at` | |
| Lộ PII trong git/log/fixtures | Seed giả lập, `is_synthetic`; `.env*` bị gitignore; không có credentials trong code | Quét secret trong CI |
| Đồng hồ giả để xác nhận buổi tương lai | `app.clock_override` chỉ superuser ghi được (dùng cho test) | Đảm bảo bảng trống ở production (checklist Phase 4) |
| Chế độ chọn danh tính DEV bị bật ở production | Chỉ hoạt động khi `NODE_ENV !== "production"` và `DEV_IDENTITY_SWITCHER=1` | Thay bằng Supabase Auth trước khi deploy |
| File đính kèm lộ qua URL công khai | Chưa có upload (Phase 3) | Bucket private + signed URL ngắn hạn |

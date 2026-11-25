# Checklist nghiệm thu (mục 11)

Trạng thái: ✅ có test tự động đạt · 🟡 một phần · ⬜ chưa làm. Lệnh: `npm run test:db`.

## Test 1 — quota
- ✅ Gói 36, 30 buổi có mặt đã xác nhận → còn 6 (`progress.test.ts`)
- ✅ Vào buổi 7 không trừ 6 buổi trước (`ledger_rls.test.ts`, `progress.test.ts`)
- ✅ Gói 8 buổi/tháng × 2 tháng = 16

## Test 2 — sửa điểm danh
- ✅ PRESENT → ABSENT_EXCUSED hoàn 1 buổi bằng REVERSAL; gửi lại hai lần không trừ thêm
- ✅ Buổi hủy, chưa điểm danh, học thử, buổi chưa tổ chức không trừ
- ✅ Hết quota không âm (PENDING_NO_ENTITLEMENT)

## Test 3 — bảo lưu
- ✅ Chuyển 6 giữ tổng 6 (không 12); dùng 2 còn 4; không tạo hóa đơn/doanh thu
- ✅ Nhiều quyền học song song theo FIFO; đổi chi nhánh cần quyền hai phía/SUPER_ADMIN

## Test 4 — cảnh báo & care case
- ✅ Còn 3/1/0 → đúng một thông báo mỗi mốc/gói/người nhận (dedupe key enrollment/ngưỡng/version/người nhận); gói mới → cảnh báo mới; opt-out không nhận (`care.test.ts`)
- ✅ Hai buổi vắng không phép liên tiếp đã xác nhận → care case; 3 buổi → ưu tiên cao; có mặt kết thúc chuỗi; buổi chưa điểm danh không bị coi vắng; job chạy lặp không trùng
- ✅ HLV chỉ thấy việc được giao; phụ huynh không thấy care case/ghi chú liên hệ
- ⬜ Kênh ngoài (email/push/Zalo) — chưa cấu hình, chỉ in-app

## Test 5 — phân quyền
- ✅ Phụ huynh A không đọc/đổi dữ liệu con phụ huynh B (kể cả đoán ID), không thấy note nội bộ, không thấy danh sách lớp
- ✅ HLV QN không thấy lớp PM; HLV PM không điểm danh lớp QN; kế toán QN không thấy hóa đơn PM; admin thấy toàn bộ
- ✅ Claim role giả trong JWT không có tác dụng; anon không đọc được
- 🟡 Test bằng role `authenticated` + JWT claims trên Postgres thật; chưa chạy với token Supabase Auth thật
- ⬜ File private / signed URL (chưa có upload)

## Test 6 — tài chính
- ⬜ Phase 3

## Test 7 — import, UI, CI
- ⬜ Import idempotent/review (có schema staging, chưa có luồng)
- 🟡 UI mobile 360px/desktop, định dạng dd/MM/yyyy và VND
- ⬜ CI typecheck/lint/build/unit/integration/e2e

## Test 8 — tiến độ theo ngày
- ✅ Lớp 30/36 tại ngày chốt; học viên vào muộn 24 PRESENT/36, còn 12
- ✅ Ngày chốt trước buổi 30 cho số thấp hơn; không dùng ngày nhập thay ngày tập
- ✅ Mốc 12/24/36 trả đúng actual_date; buổi chưa xác nhận không tính
- ✅ Nghỉ bị trừ theo policy → present và charged khác nhau, báo cả hai
- ✅ Chưa có dữ liệu điểm danh → "Chưa đủ dữ liệu" (null), không phải 0

## Test 9 — dự báo
- ✅ Lịch 6 buổi như ví dụ → lớp kết thúc 09/12/2026
- ✅ Còn 12 nhưng có 6 lịch → không bịa ngày hết gói
- ✅ Hủy buổi / thêm buổi bù → tính lại; buổi bù không đếm hai lần
- ✅ Lịch cá nhân 2 buổi/tuần, gói 4 tháng (4 mốc), quyền bảo lưu sang khóa sau, ngày chốt quá khứ, nhiều buổi cùng ngày, mốc đã đạt, buổi hôm nay chờ xác nhận, nghỉ có phép
- ✅ Lịch lặp chỉ khi được duyệt, gắn nhãn "Ước tính theo lịch lặp"
- ✅ Ngày dự kiến đổi không làm đổi hạn hóa đơn
- ✅ Phân quyền view/RPC tiến độ
- ⬜ Export tiến độ theo quyền và ngày chốt (route CSV đang làm cùng UI)

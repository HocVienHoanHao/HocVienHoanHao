# Module Lesson Progress & Course Forecast (mục 5.1)

Mã nguồn: `supabase/migrations/20261125000400_progress_forecast.sql` (đọc), `...0300_ledger_attendance_rpc.sql` (ghi). Test: `tests/db/progress.test.ts`, `tests/db/ledger_rls.test.ts`.

## API (Supabase RPC, chỉ đọc, có kiểm tra quyền)

| Hàm | Trả về |
|---|---|
| `class_progress(class_id, as_of_date)` | buổi đã tổ chức/kế hoạch/còn lại, ngày buổi gần nhất, tháng học hiện tại, mốc 12/24/36 (ngày thực tế hoặc dự kiến), dự kiến kết thúc khóa + ngày kết thúc kế hoạch, buổi chờ xác nhận, cảnh báo vượt kế hoạch/chưa xác nhận |
| `course_progress(course_id, as_of_date)` | tiến độ **từng lớp** + số lớp đã hoàn thành (không cộng buổi nhiều lớp) |
| `student_progress(enrollment_id, as_of_date)` | buổi lớp đã tổ chức (toàn khóa và từ khi vào), có mặt, nghỉ có phép/không phép, học thử, chưa điểm danh, đã trừ, đã cấp, đã chuyển đi, còn lại, bảo lưu đang có, ngày học gần nhất, cập nhật lúc, mốc học thực tế (theo PRESENT) và mốc hết quyền (theo đã trừ), dự kiến hết gói, dự kiến hết quyền, hạn hiệu lực, cảnh báo gia hạn 3/1/0, hạn hóa đơn (trường riêng), trạng thái dữ liệu |
| `student_progress_list(as_of, branch, course, class)` | danh sách theo phạm vi quyền (phụ huynh chỉ nhận con mình) |

Ghi dữ liệu chỉ qua: `confirm_enrollment`, `confirm_session`, `cancel_session`, `schedule_makeup_session`, `record_attendance`, `transfer_carryover`, `approve_leave`.

## Thuật toán

1. **Đếm đến ngày chốt**: buổi `completed` có ngày thực tế (giờ VN) ≤ ngày chốt, sắp theo `actual_start` rồi `id`. Buổi thứ *k* cho ngày đạt mốc *k*.
2. **Lịch tương lai đủ điều kiện**: buổi không hủy của lớp có ngày > ngày chốt (+ buổi hôm nay chưa xác nhận nếu ngày chốt = hôm nay), lọc theo thứ trong tuần của lịch cá nhân, trong khoảng `start_date` → hạn quyền học. Dự báo học thực tế bỏ mọi ngày nghỉ đã duyệt; dự báo hết quyền chỉ bỏ ngày nghỉ không trừ buổi.
3. **Mốc chưa đạt**: `remaining = target − progress`; ngày dự kiến = phần tử thứ `remaining` của lịch tương lai. Không đủ phần tử → `INSUFFICIENT_SCHEDULE` ("Chưa đủ lịch để dự báo"), ngày = null.
4. **Lịch lặp** (chỉ khi policy `forecast.recurring_estimate` được duyệt và khóa có ngày kết thúc): nối thêm các ngày theo thứ trong tuần của lớp sau buổi cuối cùng đã tạo, tới ngày kết thúc khóa; trạng thái `ESTIMATED_RECURRING` ("Ước tính theo lịch lặp").
5. **Hết quyền học**: số dư 0 → `EXHAUSTED` + ngày lượt trừ cuối; số dư N → buổi đủ điều kiện thứ N.
6. Không có phép cộng 30/60/90 ngày ở bất kỳ đâu. Không ghi ngày dự kiến vào bảng; hạn hóa đơn không bị thay đổi.

## Ví dụ mục 5.1 (đã kiểm thử)

Ngày chốt 25/11/2026, lớp 30/36; lịch còn 27/11, 30/11, 02/12, 04/12, 07/12, 09/12 → lớp dự kiến kết thúc **09/12/2026**. Học viên vào buổi 7: có mặt 24, trừ 24, còn 12 → "Chưa đủ lịch để dự báo" ngày hết gói (cần 12 buổi, chỉ có 6). Mốc 24 của học viên = ngày buổi có mặt thứ 24 (25/11/2026) lấy từ điểm danh thực tế.

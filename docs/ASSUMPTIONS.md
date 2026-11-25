# Giả định đang dùng (cần xác nhận)

1. **Ngày nghiệp vụ** là ngày theo giờ Việt Nam (Asia/Ho_Chi_Minh) của `actual_start` (buổi đã tổ chức) hoặc `scheduled_start` (buổi chưa tổ chức). Không dùng ngày nhập điểm danh.
2. **Buổi được đếm** cho lớp = session `completed` có ngày thực tế ≤ ngày chốt. Buổi `scheduled` đã qua ngày mà chưa xác nhận → không đếm, gắn cảnh báo "chưa xác nhận", dự báo "chưa đáng tin cậy".
3. **Buổi hôm nay** chưa xác nhận (khi ngày chốt = hôm nay) được đưa vào lịch dự kiến với cờ "chờ xác nhận", không tính là đã học.
4. **Ngày chốt quá khứ**: dữ liệu đếm dùng bản ghi hiện tại đã xác nhận (có thể thay đổi nếu sửa điểm danh sau đó). Lịch tương lai = các buổi có ngày sau ngày chốt theo dữ liệu hiện tại (gồm cả buổi đã tổ chức sau ngày chốt). Snapshot "đúng như đã biết lúc đó" cần dùng audit log — chưa làm.
5. **Đã trừ tại ngày chốt** = tổng CONSUME/REVERSAL có `effective_date` (ngày tập) ≤ ngày chốt. Bút toán đảo dùng ngày của bút toán gốc.
6. **Quyền học được cấp** từ lúc xác nhận đăng ký (ngày nhỏ hơn giữa ngày bắt đầu và ngày xác nhận). Đăng ký nháp/hóa đơn nháp không cấp quyền.
7. **Học viên vào muộn**: tiến độ cá nhân tính từ `start_date`; không kế thừa số buổi lớp đã tổ chức; không trừ buổi trước `start_date`.
8. **Mốc tháng học** của lớp lấy từ `classes.monthly_session_targets` (mặc định 12/24/36) và tổng kế hoạch `planned_session_count`; của học viên lấy từ snapshot mốc của gói lúc đăng ký. Gói theo lượt không có mốc.
9. **Lịch cá nhân** (gói 1/2 buổi/tuần) = các thứ trong tuần học viên đăng ký (`schedule_weekdays`); chỉ buổi lớp rơi vào các thứ đó mới đủ điều kiện dự báo.
10. **Bảo lưu** chuyển bằng cặp TRANSFER_OUT/TRANSFER_IN, quyền bảo lưu có ưu tiên dùng trước theo FIFO (hạn sớm nhất → ngày cấp → ưu tiên). Dự báo của bảo lưu chỉ dùng lịch của lớp ở khóa mới đã có.
11. **Hết quota** khi điểm danh có mặt: ghi `PENDING_NO_ENTITLEMENT`, không trừ âm; cần quản lý xử lý.
12. **Dữ liệu điểm danh** chỉ được coi là đầy đủ cho lớp từ `classes.attendance_tracked_from`. Nếu học viên bắt đầu trước mốc này (hoặc lớp chưa có mốc) → các chỉ số cá nhân trả `null` ("Chưa đủ dữ liệu"), không hiển thị 0.
13. **HLV** được phân công qua `coach_assignments` còn hiệu lực hôm nay và phải có membership COACH tại chi nhánh của lớp.
14. Dữ liệu demo/test hoàn toàn giả (tên "HV Demo 01", không SĐT), đánh dấu `is_synthetic = true`.

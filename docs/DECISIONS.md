# Quyết định nghiệp vụ cần chủ học viện duyệt

Hệ thống đang chạy theo **giá trị đề xuất** (cột "Mặc định hiện tại"). Các chính sách lưu trong `policy_settings` có version; chỉ bản `APPROVED` mới có hiệu lực, thay đổi sau này không ảnh hưởng đăng ký cũ (snapshot `policy_version`).

| # | Quyết định | Mặc định hiện tại | Ảnh hưởng |
|---|---|---|---|
| D1 | Trạng thái nào bị trừ buổi | ✅ **Đã duyệt 25/11/2026**: học viên nghỉ thì không bảo lưu. Có mặt, nghỉ có phép, nghỉ không phép đều trừ buổi; học thử không trừ. Trường hợp đặc biệt quản lý làm việc riêng với phụ huynh rồi duyệt đơn nghỉ "không trừ buổi" (ghi audit) | "Đã học" có thể ≠ "đã trừ" (hệ thống báo cả hai). Migration `20261125000700` |
| D2 | Hạn hiệu lực quyền học (gói 1/2/3 tháng) | Không hết hạn (valid_until trống) | Cảnh báo "quyền hết hạn trước khi dùng hết"; dự báo bỏ các buổi sau hạn |
| D3 | Bảo lưu cuối khóa | ✅ **Đã duyệt 25/11/2026**: số buổi còn lại khi hết khóa được chuyển sang khóa tiếp theo, bằng cặp TRANSFER_OUT/TRANSFER_IN (một transfer_id), thao tác ở trang Đăng ký & bảo lưu | Buổi bảo lưu **chỉ dùng trong khóa kế tiếp** (đã duyệt): hạn = ngày kết thúc khóa đích, không chuyển ngược, không chuyển tiếp lần hai sang khóa khác (migration `20261125000800`). Không bao giờ vừa giữ vừa cộng |
| D4 | Bảo lưu khi đổi chi nhánh | Cần quyền quản lý cả hai chi nhánh hoặc SUPER_ADMIN | Ai được duyệt chuyển quyền học liên chi nhánh |
| D5 | Gói 2 buổi/tuần và 1 buổi/tuần: số buổi/tháng | 8 và 4 buổi/tháng (mốc 8/16/24, 4/8/12) — chưa xác nhận | Mốc tháng học của các gói này |
| D6 | Cho phép "Ước tính theo lịch lặp" khi chưa tạo đủ buổi tương lai | Tắt → hiển thị "Chưa đủ lịch để dự báo" | Nếu bật: dùng lịch T2/T4/T6 của lớp đến ngày kết thúc khóa, gắn nhãn ước tính |
| D7 | Nhắc gia hạn dựa trên ngày hết quyền dự kiến | Nhắc khi còn 3/1/0 buổi (theo ledger), kèm ngày dự kiến | Không tự tạo hóa đơn, không đổi hạn hóa đơn |
| D8 | Học bù ở lớp khác cùng chi nhánh | Được, khi quản lý/HLV chọn đúng đăng ký phân bổ | Tiến độ tính vào đăng ký được phân bổ, không trừ trùng |
| D9 | Điểm danh lịch sử K1–K3 Quy Nhơn | Chưa có bảng điểm danh gốc → hiển thị "Chưa đủ dữ liệu" | Có thể nhập số dư đầu kỳ (ADJUST) sau khi đối chiếu, ghi rõ nguồn |
| D10 | Phụ huynh xin nghỉ qua app | Bật theo từng liên kết (can_request_leave), quản lý duyệt | Buổi trong đơn nghỉ đã duyệt được bỏ qua khi dự báo mốc học; đơn vẫn trừ buổi trừ khi là ngoại lệ (D1) |
| D11 | Phụ huynh xem hóa đơn | Bật theo từng liên kết (can_view_finance) | |
| D12 | Kế toán: doanh thu trả trước, phương pháp giá vốn kho, cash vs accrual | Chưa chọn; MVP gọi là "giá trị ghi nhận/hợp đồng" | Báo cáo Phase 3 |
| D13 | Lưu trữ, backup, consent dữ liệu trẻ em, retention | Chưa có | Bắt buộc trước production |
| D14 | Múi giờ/locale của Google Sheet nguồn (đang là America/Los_Angeles, en_US) | Ngày import đưa vào review, không tự sửa | Import Phase 4 |

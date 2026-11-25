# PLAN — Hoàn Hảo Football CRM

Đặc tả nguồn: `Hoan_Hao_Football_CRM_Claude_Code_v1.1.md` (25/11/2026), thay thế v1.0. Giữ nguyên toàn bộ module tài chính, thu chi, nhân sự, kho, chăm sóc khách hàng và phân quyền; bổ sung module **Lesson Progress & Course Forecast** (mục 5.1, test 8–9) cho cả QN/PY/PM.

Tài liệu liên quan: [Giả định](docs/ASSUMPTIONS.md) · [ERD](docs/ERD.md) · [Quyết định cần chủ học viện duyệt](docs/DECISIONS.md) · [Checklist nghiệm thu](docs/ACCEPTANCE.md) · [Threat model](docs/THREAT_MODEL.md) · [Module tiến độ](docs/PROGRESS_MODULE.md)

## Kiến trúc

- Next.js (App Router) + TypeScript strict + Tailwind CSS; giao diện tiếng Việt, mobile-first.
- Supabase PostgreSQL + Auth + RLS. Logic nghiệp vụ nhạy cảm (ledger quyền học, tiến độ, dự báo) nằm trong **SQL function SECURITY DEFINER có kiểm tra quyền** → một nguồn sự thật cho web, app phụ huynh, export.
- Client không bao giờ ghi trực tiếp `attendance`, `session_ledger`, `entitlements`, trạng thái đăng ký/buổi; chỉ qua RPC.
- Ngày dự kiến và số dư **không lưu**; luôn tính từ dữ liệu xác nhận khi đọc → tự động tính lại sau mọi thay đổi điểm danh/lịch/hủy/bù/chuyển lớp/mua gói/bảo lưu, không cần cache invalidation trong MVP.
- Test DB chạy trên PostgreSQL thật (local hoặc CI service), gọi RPC với role `authenticated` + JWT claims của từng người dùng (không dùng service role).

## Phase và trạng thái

| Phase | Nội dung | Trạng thái |
|---|---|---|
| 0 | PLAN, giả định, ERD, threat model, danh sách quyết định | ✅ Bản nháp, chờ duyệt quyết định |
| 1 | Auth/RLS, branches, students, guardians, courses/classes, import staging (schema), dashboard skeleton, dữ liệu giả | 🟡 Schema + RLS + test xong; UI skeleton đang dựng; Supabase Auth thật chưa nối (đang dùng chọn danh tính DEV) |
| 2 | Plans/enrollments, sessions/attendance, ledger, bảo lưu, **tiến độ & dự báo (5.1)**, care cases, thông báo in-app, cổng phụ huynh | 🟡 Ledger, bảo lưu, tiến độ/dự báo, care cases + thông báo in-app (test 4) xong có test; còn: xin nghỉ từ app phụ huynh, CRUD đăng ký/lịch |
| 3 | Hóa đơn/phiếu thu/phân bổ, phiếu chi, tạm ứng, báo cáo tài chính, đối soát; kho; lương | ⬜ Chỉ có khung bảng `invoices`/`invoice_items` (để kiểm tra hạn hóa đơn độc lập với dự báo) |
| 4 | Import thật sau duyệt, e2e, checklist production, backup, runbook | ⬜ |

Lưu ý thứ tự: đặc tả đặt tiến độ (5.1) ở Phase 2; người dùng yêu cầu ưu tiên module này nên schema/RPC tiến độ và ledger được làm ngay cùng Phase 1. Các module tài chính/kho/lương/CRM vẫn giữ nguyên phạm vi và làm theo thứ tự Phase 3.

## Việc tiếp theo

1. Chủ học viện duyệt các quyết định trong [DECISIONS.md](docs/DECISIONS.md) (đặc biệt D1 trừ buổi nghỉ, D3 bảo lưu, D6 lịch lặp).
2. Nối Supabase Auth thật (magic link/OTP), lời mời phụ huynh + duyệt liên kết.
3. Hoàn thiện UI quản lý CRUD Phase 1, màn hình import preview/dry-run.
4. Phase 2 còn lại: job định kỳ `run_care_job` (scheduler), sửa/hủy đăng ký, liên kết phụ huynh từ màn quản lý. (Đã xong: tạo học viên, đăng ký gói, sinh lịch/hủy/bù/dời buổi, chuyển bảo lưu, duyệt xin nghỉ, phụ huynh xin nghỉ.)
5. CI GitHub Actions: typecheck, lint, build, test DB với service postgres.

## Không làm trong MVP (theo đặc tả)

App native, đồng bộ hai chiều Google Sheets, thông báo push/email/Zalo thật (chỉ in-app), tự động gia hạn/thu tiền, deploy production.

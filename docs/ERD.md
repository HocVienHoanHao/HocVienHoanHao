# ERD (đã triển khai trong `supabase/migrations`)

Bảng Phase 3 (receipts, expenses, advances, inventory, payroll, care_cases, notifications) giữ nguyên theo đặc tả mục 4 và sẽ được thêm ở migration riêng; hiện chỉ có khung `invoices`/`invoice_items`.

```mermaid
erDiagram
  branches ||--o{ branch_memberships : "có"
  profiles ||--o{ branch_memberships : "vai trò"
  branches ||--o{ venues : ""
  branches ||--o{ courses : ""
  courses ||--o{ classes : ""
  venues ||--o{ classes : ""
  classes ||--o{ coach_assignments : ""
  profiles ||--o{ coach_assignments : "HLV"
  branches ||--o{ students : "chi nhánh gốc"
  guardians ||--o{ guardian_students : ""
  students ||--o{ guardian_students : ""
  profiles |o--o| guardians : "tài khoản PH"
  branches ||--o{ plans : ""
  students ||--o{ enrollments : ""
  classes ||--o{ enrollments : ""
  plans ||--o{ enrollments : "snapshot quota/mốc/giá"
  classes ||--o{ sessions : "buổi tập thật"
  sessions |o--o| sessions : "buổi bù thay buổi hủy"
  sessions ||--o{ attendance : ""
  students ||--o{ attendance : ""
  enrollments ||--o{ attendance : "phân bổ"
  enrollments ||--o{ entitlements : "PURCHASE / CARRYOVER"
  entitlements ||--o{ session_ledger : "GRANT/CONSUME/REVERSAL/TRANSFER"
  attendance |o--o{ session_ledger : ""
  students ||--o{ student_leaves : "nghỉ đã biết trước"
  students ||--o{ notes : "INTERNAL / PARENT"
  students ||--o{ invoices : ""
  invoices ||--o{ invoice_items : ""
  import_batches ||--o{ import_rows : ""

  sessions {
    uuid id PK
    uuid class_id FK
    timestamptz scheduled_start
    timestamptz actual_start
    enum status "scheduled|completed|cancelled"
    timestamptz completed_at
    uuid replacement_for_session_id
  }
  attendance {
    uuid session_id FK
    uuid student_id FK
    uuid enrollment_id FK
    enum status
    timestamptz confirmed_at
    enum charge_decision
  }
  session_ledger {
    uuid entitlement_id FK
    enum event_type
    int signed_delta
    date effective_date "ngày tập thực tế"
    text idempotency_key UK
    uuid source_entry_id
    uuid transfer_id
  }
  enrollments {
    date start_date
    int snapshot_quota
    int_arr snapshot_milestones
    int_arr schedule_weekdays
    enum status
  }
  classes {
    int planned_session_count
    int_arr monthly_session_targets
    jsonb schedule
    date attendance_tracked_from
  }
```

## Ràng buộc chính

- Composite FK đảm bảo `enrollments.(class, course, branch)` và `sessions.(class, course)` khớp nhau.
- `attendance` unique `(session_id, student_id)`; `session_ledger.idempotency_key` unique; ledger append-only (trigger chặn UPDATE/DELETE).
- Một buổi hủy có tối đa một buổi bù còn hiệu lực; buổi bù chỉ xác nhận được khi buổi gốc đã hủy.
- `completed` bắt buộc có `actual_start` và `completed_at`; `cancelled` bắt buộc có lý do.
- `STOPPED` bắt buộc có lý do và người xác nhận.
- Số dư quyền học = tổng `signed_delta` của ledger (không lưu cache).

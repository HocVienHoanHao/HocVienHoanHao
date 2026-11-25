-- Hoàn Hảo Football CRM — core schema (Phase 1 + nền tảng Phase 2 cho tiến độ buổi học)
-- Quy ước: PK uuid, timestamptz, tiền bigint VND, ngày date. Múi giờ nghiệp vụ Asia/Ho_Chi_Minh.

create extension if not exists pgcrypto;

create schema if not exists app;      -- hàm nội bộ (không expose qua API)

-- ---------------------------------------------------------------- enums
create type public.app_role as enum
  ('SUPER_ADMIN','BRANCH_MANAGER','ACCOUNTANT','COACH','CARE_STAFF','PARENT');
create type public.student_status as enum
  ('LEAD','ACTIVE','PAUSED','ON_HOLD','COMPLETED','STOPPED','UNKNOWN');
create type public.enrollment_status as enum
  ('DRAFT','CONFIRMED','COMPLETED','TRANSFERRED','CANCELLED');
create type public.session_status as enum ('scheduled','completed','cancelled');
create type public.attendance_status as enum
  ('PRESENT','ABSENT_EXCUSED','ABSENT_UNEXCUSED','TRIAL','NOT_MARKED');
create type public.charge_status as enum
  ('NOT_CHARGEABLE','CHARGED','PENDING_NO_ENTITLEMENT');
create type public.ledger_event as enum
  ('GRANT','CONSUME','REVERSAL','TRANSFER_OUT','TRANSFER_IN','ADJUST','EXPIRE');
create type public.entitlement_source as enum ('PURCHASE','CARRYOVER','ADJUST');
create type public.entitlement_state as enum ('ACTIVE','EXHAUSTED','EXPIRED','TRANSFERRED');
create type public.billing_type as enum ('PACKAGE','PER_SESSION');
create type public.note_visibility as enum ('INTERNAL','PARENT');
create type public.leave_status as enum ('REQUESTED','APPROVED','REJECTED','CANCELLED');

-- ---------------------------------------------------------------- helpers
create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- Ngày nghiệp vụ (VN) của một timestamptz
create or replace function app.vn_date(ts timestamptz) returns date
language sql immutable as $$ select (ts at time zone 'Asia/Ho_Chi_Minh')::date $$;

-- Đồng hồ hệ thống. Bảng override chỉ superuser ghi được (dùng cho test có ngày cố định,
-- ví dụ ngày chốt 25/11/2026); production để trống -> now().
create table app.clock_override (
  singleton boolean primary key default true check (singleton),
  fixed_at timestamptz not null
);
revoke all on app.clock_override from public;

create or replace function app.clock_now() returns timestamptz
language sql stable security definer set search_path = app, pg_temp as $$
  select coalesce((select fixed_at from app.clock_override), now())
$$;

create or replace function app.vn_today() returns date
language sql stable as $$ select (app.clock_now() at time zone 'Asia/Ho_Chi_Minh')::date $$;

-- ---------------------------------------------------------------- org
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_]{2,10}$'),
  name text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key,                       -- = auth.users.id
  full_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.branch_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  branch_id uuid references public.branches(id),   -- null chỉ cho SUPER_ADMIN
  role public.app_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint membership_branch_required
    check ((role = 'SUPER_ADMIN') = (branch_id is null)),
  constraint membership_no_parent check (role <> 'PARENT'),  -- phụ huynh đi qua guardian_students
  unique nulls not distinct (user_id, branch_id, role)
);
create index on public.branch_memberships (user_id) where active;

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  name text not null,
  address text,
  rent_terms jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, branch_id)
);

-- ---------------------------------------------------------------- people
create table public.students (
  id uuid primary key default gen_random_uuid(),
  student_code text not null unique,
  full_name text not null,
  birth_date date,
  status public.student_status not null default 'UNKNOWN',
  primary_branch_id uuid not null references public.branches(id),
  status_reason text,
  status_changed_at timestamptz,
  status_changed_by uuid references public.profiles(id),
  is_synthetic boolean not null default false,    -- dữ liệu giả để demo/test
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stopped_needs_reason
    check (status <> 'STOPPED' or (status_reason is not null and status_changed_by is not null))
);
create index on public.students (primary_branch_id, status);

create table public.guardians (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.profiles(id),
  full_name text not null,
  phone text,
  email text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.guardian_students (
  guardian_id uuid not null references public.guardians(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  relationship text not null,
  can_view_finance boolean not null default true,
  can_request_leave boolean not null default false,
  verified_at timestamptz,                 -- chỉ liên kết đã duyệt mới có hiệu lực
  approved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (guardian_id, student_id)
);
create index on public.guardian_students (student_id);

-- ---------------------------------------------------------------- courses / classes
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  code text not null,
  name text not null,
  year int not null,
  start_date date,
  end_date date,
  status text not null default 'PLANNED' check (status in ('PLANNED','OPEN','CLOSED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, code, year),
  unique (id, branch_id)
);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null,
  course_id uuid not null,
  venue_id uuid,
  name text not null,
  age_group text,
  -- lịch lặp: {"weekdays":[1,3,5],"start":"17:30","end":"19:00"} (ISO weekday 1=Thứ 2)
  schedule jsonb,
  capacity int check (capacity > 0),
  planned_session_count int not null default 36 check (planned_session_count > 0),
  -- mốc tháng học lũy kế đã duyệt, VD {12,24,36}
  monthly_session_targets int[] not null default '{12,24,36}',
  -- điểm danh trong hệ thống đáng tin từ ngày này; null = chưa nhập/đối chiếu điểm danh
  attendance_tracked_from date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (course_id, branch_id) references public.courses(id, branch_id),
  foreign key (venue_id, branch_id) references public.venues(id, branch_id),
  unique (id, course_id),
  unique (id, course_id, branch_id),
  constraint targets_ascending check (
    cardinality(monthly_session_targets) = 0 or
    monthly_session_targets[cardinality(monthly_session_targets)] <= planned_session_count)
);
create index on public.classes (branch_id, course_id);

create table public.coach_assignments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  coach_id uuid not null references public.profiles(id),
  start_date date not null,
  end_date date,
  created_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create index on public.coach_assignments (coach_id);

-- ---------------------------------------------------------------- plans / enrollments
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  name text not null,
  billing_type public.billing_type not null default 'PACKAGE',
  months int check (months > 0),
  sessions_per_week int check (sessions_per_week between 1 and 7),
  session_quota int check (session_quota > 0),
  milestone_targets int[] not null default '{}',   -- mốc tháng lũy kế; rỗng = không có mốc
  price bigint not null check (price >= 0),
  active boolean not null default true,
  policy_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (billing_type = 'PER_SESSION' or session_quota is not null)
);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id),
  branch_id uuid not null,
  course_id uuid not null,
  class_id uuid not null,
  plan_id uuid references public.plans(id),
  start_date date not null,
  status public.enrollment_status not null default 'DRAFT',
  -- snapshot tại lúc đăng ký (không đổi khi plan đổi)
  snapshot_months int,
  snapshot_quota int,
  snapshot_milestones int[] not null default '{}',
  snapshot_price bigint,
  snapshot_billing_type public.billing_type not null default 'PACKAGE',
  policy_version int not null default 1,
  -- lịch cá nhân (gói 1/2 buổi/tuần): ISO weekdays; null = theo toàn bộ lịch lớp
  schedule_weekdays int[],
  source_enrollment_id uuid references public.enrollments(id),
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (class_id, course_id, branch_id) references public.classes(id, course_id, branch_id),
  foreign key (course_id, branch_id) references public.courses(id, branch_id),
  check (schedule_weekdays is null or schedule_weekdays <@ '{1,2,3,4,5,6,7}'::int[])
);
create index on public.enrollments (student_id, status);
create index on public.enrollments (class_id, status);
create index on public.enrollments (branch_id, course_id);

-- ---------------------------------------------------------------- sessions / attendance
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null,
  course_id uuid not null,
  scheduled_start timestamptz not null,
  scheduled_end timestamptz,
  actual_start timestamptz,
  actual_end timestamptz,
  status public.session_status not null default 'scheduled',
  completed_at timestamptz,
  confirmed_by uuid references public.profiles(id),
  cancel_reason text,
  replacement_for_session_id uuid references public.sessions(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (class_id, course_id) references public.classes(id, course_id),
  constraint completed_has_actual check (status <> 'completed' or (actual_start is not null and completed_at is not null)),
  constraint cancelled_has_reason check (status <> 'cancelled' or cancel_reason is not null)
);
-- một buổi hủy chỉ được thay bằng tối đa một buổi bù còn hiệu lực
create unique index sessions_one_replacement
  on public.sessions (replacement_for_session_id)
  where replacement_for_session_id is not null and status <> 'cancelled';
create index on public.sessions (class_id, status, scheduled_start);
create index on public.sessions (class_id, actual_start) where status = 'completed';

-- ngày hiệu lực của buổi: thực tế nếu đã tổ chức, ngược lại theo lịch
create or replace function app.session_date(s public.sessions) returns date
language sql immutable as $$
  select app.vn_date(coalesce(case when s.status = 'completed' then s.actual_start end, s.scheduled_start))
$$;

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id),
  student_id uuid not null references public.students(id),
  enrollment_id uuid references public.enrollments(id),   -- phân bổ quyền học
  status public.attendance_status not null default 'NOT_MARKED',
  reason text,
  confirmed_at timestamptz,
  recorded_by uuid references public.profiles(id),
  charge_decision public.charge_status not null default 'NOT_CHARGEABLE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, student_id)
);
create index on public.attendance (student_id, status);
create index on public.attendance (enrollment_id);

-- Lịch nghỉ đã biết trước (xin nghỉ). charge=false: không trừ quyền học.
create table public.student_leaves (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id),
  enrollment_id uuid references public.enrollments(id),
  from_date date not null,
  to_date date not null,
  status public.leave_status not null default 'REQUESTED',
  charge boolean not null default false,
  reason text,
  requested_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (to_date >= from_date)
);
create index on public.student_leaves (student_id, from_date);

-- ---------------------------------------------------------------- entitlements & ledger
create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id),
  student_id uuid not null references public.students(id),
  source public.entitlement_source not null,
  quota int not null check (quota > 0),
  granted_at date not null,
  valid_until date,
  state public.entitlement_state not null default 'ACTIVE',
  priority int not null default 100,
  transfer_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.entitlements (student_id, state);
create index on public.entitlements (enrollment_id);

create table public.session_ledger (
  id uuid primary key default gen_random_uuid(),
  entitlement_id uuid not null references public.entitlements(id),
  enrollment_id uuid not null references public.enrollments(id),
  student_id uuid not null references public.students(id),
  attendance_id uuid references public.attendance(id),
  session_id uuid references public.sessions(id),
  event_type public.ledger_event not null,
  signed_delta int not null,
  effective_date date not null,           -- ngày nghiệp vụ (ngày tập thực tế với CONSUME)
  idempotency_key text not null unique,
  source_entry_id uuid references public.session_ledger(id),
  transfer_id uuid,
  reason text,
  actor uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (
    (event_type in ('GRANT','TRANSFER_IN') and signed_delta > 0) or
    (event_type in ('CONSUME','TRANSFER_OUT','EXPIRE') and signed_delta < 0) or
    (event_type = 'REVERSAL' and source_entry_id is not null) or
    (event_type = 'ADJUST' and signed_delta <> 0)),
  check (event_type not in ('TRANSFER_OUT','TRANSFER_IN') or transfer_id is not null)
);
create index on public.session_ledger (entitlement_id, effective_date);
create index on public.session_ledger (enrollment_id, effective_date);
create index on public.session_ledger (attendance_id);

-- Ledger chỉ ghi thêm
create or replace function app.ledger_append_only() returns trigger
language plpgsql as $$
begin raise exception 'session_ledger là append-only; dùng REVERSAL/ADJUST'; end $$;
create trigger ledger_no_update before update or delete on public.session_ledger
  for each row execute function app.ledger_append_only();

-- ---------------------------------------------------------------- policy / audit / notes / import
create table public.policy_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  version int not null,
  value jsonb not null,
  status text not null default 'DRAFT' check (status in ('DRAFT','APPROVED','RETIRED')),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (key, version)
);
create unique index policy_one_approved on public.policy_settings (key) where status = 'APPROVED';

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor uuid,
  branch_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  change jsonb,
  created_at timestamptz not null default now()
);
create index on public.audit_logs (entity, entity_id);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id),
  branch_id uuid not null references public.branches(id),
  author uuid references public.profiles(id),
  content text not null,
  visibility public.note_visibility not null default 'INTERNAL',
  shared_at timestamptz,
  created_at timestamptz not null default now(),
  check (visibility = 'INTERNAL' or shared_at is not null)
);

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches(id),
  source_name text not null,
  source_sheet text,
  fingerprint text not null unique,
  status text not null default 'PREVIEW' check (status in ('PREVIEW','REVIEW','APPROVED','APPLIED','REJECTED')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  source_row int not null,
  raw_payload jsonb,              -- hạn chế quyền; có thể chứa PII
  normalized_payload jsonb,
  fingerprint text not null,
  errors jsonb not null default '[]',
  review_status text not null default 'PENDING' check (review_status in ('PENDING','OK','NEEDS_REVIEW','SKIPPED','APPLIED')),
  mapped_ids jsonb,
  unique (batch_id, source_row),
  unique (batch_id, fingerprint)
);

-- Hóa đơn (khung tối thiểu, đầy đủ ở Phase 3). due_date độc lập với dự báo buổi học.
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  student_id uuid not null references public.students(id),
  enrollment_id uuid references public.enrollments(id),
  course_id uuid references public.courses(id),
  due_date date,
  status text not null default 'DRAFT' check (status in ('DRAFT','ISSUED','PARTIAL','PAID','VOID')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  category text not null check (category in ('tuition','shoes','uniform','other')),
  amount bigint not null check (amount >= 0),
  discount bigint not null default 0 check (discount >= 0),
  description text
);

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['branches','profiles','branch_memberships','venues','students','guardians',
    'courses','classes','plans','enrollments','sessions','attendance','entitlements','invoices']
  loop
    execute format('create trigger touch_%1$s before update on public.%1$I
                    for each row execute function app.touch_updated_at()', t);
  end loop;
end $$;

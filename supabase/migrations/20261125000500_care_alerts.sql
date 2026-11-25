-- Phase 2 — CRM chăm sóc & thông báo in-app (mục 7, test 4).
-- Chuỗi vắng không phép liên tiếp -> care case (2 buổi), tăng ưu tiên (3 buổi).
-- Nhắc gia hạn khi còn 3/1/0 buổi theo ledger, chống trùng bằng dedupe key; không gửi kênh ngoài.

create type public.care_type as enum ('ABSENCE_STREAK','RENEWAL','OTHER');
create type public.care_priority as enum ('NORMAL','HIGH');
create type public.care_status as enum ('OPEN','IN_PROGRESS','RESOLVED','CLOSED');

alter table public.guardians add column notify_opt_out boolean not null default false;

create table public.care_cases (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  student_id uuid not null references public.students(id),
  enrollment_id uuid references public.enrollments(id),
  type public.care_type not null,
  priority public.care_priority not null default 'NORMAL',
  status public.care_status not null default 'OPEN',
  assignee uuid references public.profiles(id),
  due_at timestamptz,
  reason text not null,
  absence_reason text,
  expected_return_date date,
  streak_length int,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references public.profiles(id)
);
create index on public.care_cases (branch_id, status, priority);
create index on public.care_cases (assignee) where status in ('OPEN','IN_PROGRESS');

create table public.care_interactions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.care_cases(id) on delete cascade,
  actor uuid references public.profiles(id),
  channel text not null default 'PHONE' check (channel in ('PHONE','ZALO','IN_PERSON','SMS','EMAIL','OTHER')),
  outcome text,
  note text,                                   -- nội bộ, không gửi phụ huynh
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient uuid not null references public.profiles(id),
  branch_id uuid references public.branches(id),
  student_id uuid references public.students(id),
  event text not null,
  title text not null,
  body text not null,
  dedupe_key text not null unique,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (recipient, read_at);

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  channel text not null default 'IN_APP' check (channel in ('IN_APP','EMAIL','PUSH','ZALO')),
  state text not null default 'DELIVERED' check (state in ('QUEUED','SENT','DELIVERED','FAILED','SKIPPED_OPT_OUT')),
  attempts int not null default 1,
  scheduled_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  error text,
  unique (notification_id, channel)
);

create trigger touch_care_cases before update on public.care_cases
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------- policy
create or replace function app.care_policy() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select value from policy_settings where key = 'care.rules' and status = 'APPROVED'),
    '{"absence_case_at":2,"absence_high_at":3,"excused_breaks_streak":false,"renewal_thresholds":[3,1,0],"version":1}'::jsonb)
$$;

-- ---------------------------------------------------------------- notifications
create or replace function app.notify(p_recipient uuid, p_branch uuid, p_student uuid, p_event text,
  p_title text, p_body text, p_dedupe text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  insert into notifications (recipient, branch_id, student_id, event, title, body, dedupe_key)
  values (p_recipient, p_branch, p_student, p_event, p_title, p_body, p_dedupe)
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  if v_id is not null then
    insert into notification_deliveries (notification_id, channel, state, last_attempt_at)
    values (v_id, 'IN_APP', 'DELIVERED', now());
  end if;
end $$;

-- ---------------------------------------------------------------- chuỗi vắng
-- Quét các buổi đã tổ chức (kể từ start_date) theo thứ tự thời gian, tìm mọi chuỗi ABSENT_UNEXCUSED liên tiếp.
-- PRESENT/TRIAL kết thúc chuỗi; NOT_MARKED/chưa có bản ghi/chưa xác nhận cũng cắt chuỗi (không suy đoán là vắng);
-- nghỉ có phép: bỏ qua (mặc định) hoặc cắt chuỗi theo policy. Mỗi chuỗi >= ngưỡng -> đúng một case (khóa theo buổi đầu).
create or replace function app.upsert_absence_case(e enrollments, p_first uuid, p_len int, p_pol jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_case uuid; v_name text;
begin
  if p_len < coalesce((p_pol ->> 'absence_case_at')::int, 2) then return; end if;
  insert into care_cases (branch_id, student_id, enrollment_id, type, priority, reason, streak_length, dedupe_key, due_at)
  values (e.branch_id, e.student_id, e.id, 'ABSENCE_STREAK', 'NORMAL',
          format('Vắng không phép %s buổi liên tiếp', p_len), p_len,
          'absence:' || e.id || ':' || p_first, now() + interval '2 days')
  on conflict (dedupe_key) do update
    set streak_length = greatest(care_cases.streak_length, excluded.streak_length),
        reason = format('Vắng không phép %s buổi liên tiếp', greatest(care_cases.streak_length, excluded.streak_length))
  returning id into v_case;
  if p_len >= coalesce((p_pol ->> 'absence_high_at')::int, 3) then
    update care_cases set priority = 'HIGH', due_at = least(due_at, now() + interval '1 day')
    where id = v_case and priority <> 'HIGH';
  end if;
  select full_name into v_name from students where id = e.student_id;
  perform app.notify(m.user_id, e.branch_id, e.student_id, 'ABSENCE_STREAK',
            format('%s vắng không phép %s buổi liên tiếp', v_name, least(p_len, 3)),
            'Cần liên hệ phụ huynh để chăm sóc.',
            'absence:' || p_first || ':' || least(p_len, 3) || ':' || m.user_id)
  from branch_memberships m
  where m.branch_id = e.branch_id and m.active and m.role in ('BRANCH_MANAGER','CARE_STAFF');
end $$;

create or replace function app.evaluate_absence(p_enrollment uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e enrollments; r record; v_pol jsonb := app.care_policy();
  v_streak int := 0; v_first uuid; v_excused_breaks boolean;
begin
  select * into e from enrollments where id = p_enrollment;
  if not found or e.status not in ('CONFIRMED','COMPLETED') then return; end if;
  v_excused_breaks := coalesce((v_pol ->> 'excused_breaks_streak')::boolean, false);
  for r in
    select s.id, a.status, a.confirmed_at
    from sessions s
    left join attendance a on a.session_id = s.id and a.student_id = e.student_id
    where s.class_id = e.class_id and s.status = 'completed' and app.vn_date(s.actual_start) >= e.start_date
    order by s.actual_start, s.id
  loop
    if r.status = 'ABSENT_UNEXCUSED' and r.confirmed_at is not null then
      if v_streak = 0 then v_first := r.id; end if;
      v_streak := v_streak + 1;
    elsif r.status = 'ABSENT_EXCUSED' and r.confirmed_at is not null and not v_excused_breaks then
      null;                                            -- bỏ qua, không cắt chuỗi
    else
      perform app.upsert_absence_case(e, v_first, v_streak, v_pol);
      v_streak := 0;
    end if;
  end loop;
  perform app.upsert_absence_case(e, v_first, v_streak, v_pol);
end $$;

-- ---------------------------------------------------------------- nhắc gia hạn 3/1/0
create or replace function app.evaluate_renewal(p_enrollment uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e enrollments; v_avail int; v_pol jsonb := app.care_policy(); t int; v_name text; v_ver text;
begin
  select * into e from enrollments where id = p_enrollment;
  if not found or e.status <> 'CONFIRMED' or e.snapshot_billing_type <> 'PACKAGE' then return; end if;
  select coalesce(sum(l.signed_delta), 0) into v_avail
  from session_ledger l join entitlements en on en.id = l.entitlement_id
  where l.enrollment_id = e.id and (en.valid_until is null or en.valid_until >= app.vn_today());
  select full_name into v_name from students where id = e.student_id;
  v_ver := coalesce(v_pol ->> 'version', '1');

  for t in select (jsonb_array_elements_text(v_pol -> 'renewal_thresholds'))::int loop
    continue when v_avail > t;
    -- nội bộ
    perform app.notify(m.user_id, e.branch_id, e.student_id, 'RENEWAL_' || t,
              format('%s còn %s buổi', v_name, t),
              case when t = 0 then 'Đã hết quyền học — nhắc đăng ký gói mới (không tự tạo hóa đơn).'
                   else 'Sắp hết buổi — nhắc phụ huynh đăng ký tiếp khi phù hợp.' end,
              'renew:' || e.id || ':' || t || ':v' || v_ver || ':' || m.user_id)
    from branch_memberships m
    where m.branch_id = e.branch_id and m.active and m.role in ('BRANCH_MANAGER','CARE_STAFF');
    -- phụ huynh đã xác minh, không opt-out
    perform app.notify(g.user_id, e.branch_id, e.student_id, 'RENEWAL_' || t,
              case when t = 0 then format('%s đã dùng hết buổi học của gói', v_name)
                   else format('%s còn %s buổi học', v_name, t) end,
              'Phụ huynh liên hệ học viện để đăng ký gói tiếp theo khi thuận tiện.',
              'renew:' || e.id || ':' || t || ':v' || v_ver || ':' || g.user_id)
    from guardian_students gs join guardians g on g.id = gs.guardian_id
    where gs.student_id = e.student_id and gs.verified_at is not null and g.verified_at is not null
      and g.user_id is not null and not g.notify_opt_out;
    if t = 0 then
      insert into care_cases (branch_id, student_id, enrollment_id, type, reason, dedupe_key, due_at)
      values (e.branch_id, e.student_id, e.id, 'RENEWAL', 'Hết quyền học, cần tư vấn đăng ký tiếp',
              'renew:' || e.id || ':0:v' || v_ver, now() + interval '3 days')
      on conflict (dedupe_key) do nothing;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- triggers
create or replace function app.trg_ledger_alerts() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- chỉ khi số dư giảm do học/điều chỉnh/hết hạn; chuyển bảo lưu không phải "hết buổi"
  if new.event_type in ('CONSUME','ADJUST','EXPIRE') then perform app.evaluate_renewal(new.enrollment_id); end if;
  return null;
end $$;
create trigger ledger_alerts after insert on public.session_ledger
  for each row execute function app.trg_ledger_alerts();

create or replace function app.trg_attendance_alerts() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.enrollment_id is not null then perform app.evaluate_absence(new.enrollment_id); end if;
  return null;
end $$;
create trigger attendance_alerts after insert or update of status, confirmed_at on public.attendance
  for each row execute function app.trg_attendance_alerts();

create or replace function app.trg_session_alerts() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  if new.status is distinct from old.status then
    for r in select distinct enrollment_id from attendance where session_id = new.id and enrollment_id is not null loop
      perform app.evaluate_absence(r.enrollment_id);
    end loop;
  end if;
  return null;
end $$;
create trigger session_alerts after update of status on public.sessions
  for each row execute function app.trg_session_alerts();

-- ---------------------------------------------------------------- RPC
-- Job chạy định kỳ (server-side scheduler): idempotent, chạy lặp không tạo trùng.
create or replace function public.run_care_job() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_before_n int; v_before_c int;
begin
  if auth.uid() is not null and not app.is_super_admin() then perform app.forbid(); end if;
  select count(*) into v_before_n from notifications;
  select count(*) into v_before_c from care_cases;
  for r in select id from enrollments where status = 'CONFIRMED' loop
    perform app.evaluate_absence(r.id);
    perform app.evaluate_renewal(r.id);
  end loop;
  return jsonb_build_object('new_notifications', (select count(*) from notifications) - v_before_n,
                            'new_cases', (select count(*) from care_cases) - v_before_c);
end $$;

create or replace function public.update_care_case(
  p_case uuid, p_status care_status default null, p_assignee uuid default null,
  p_note text default null, p_channel text default 'PHONE', p_outcome text default null,
  p_absence_reason text default null, p_expected_return date default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c care_cases;
begin
  select * into c from care_cases where id = p_case for update;
  if not found then raise exception 'Không tìm thấy hồ sơ chăm sóc'; end if;
  if not (app.has_branch_role(c.branch_id, '{BRANCH_MANAGER,CARE_STAFF}') or coalesce(c.assignee = auth.uid(), false)) then
    perform app.forbid();
  end if;
  if p_assignee is not null and not app.has_branch_role(c.branch_id, '{BRANCH_MANAGER,CARE_STAFF}') then
    perform app.forbid();                  -- chỉ quản lý/CSKH được giao việc
  end if;
  update care_cases set
    status = coalesce(p_status, status),
    assignee = coalesce(p_assignee, assignee),
    absence_reason = coalesce(p_absence_reason, absence_reason),
    expected_return_date = coalesce(p_expected_return, expected_return_date),
    closed_at = case when p_status in ('RESOLVED','CLOSED') then now() else closed_at end,
    closed_by = case when p_status in ('RESOLVED','CLOSED') then auth.uid() else closed_by end
  where id = c.id;
  if p_note is not null or p_outcome is not null then
    insert into care_interactions (case_id, actor, channel, outcome, note) values (c.id, auth.uid(), p_channel, p_outcome, p_note);
  end if;
  perform app.audit('UPDATE', 'care_case', c.id, c.branch_id,
    jsonb_build_object('status', p_status, 'assignee', p_assignee));
end $$;

create or replace function public.mark_notification_read(p_id uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  update notifications set read_at = coalesce(read_at, now()) where id = p_id and recipient = auth.uid()
$$;

-- ---------------------------------------------------------------- RLS
do $$
declare t text;
begin
  foreach t in array array['care_cases','care_interactions','notifications','notification_deliveries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;
grant select on public.care_cases, public.care_interactions, public.notifications, public.notification_deliveries to authenticated;

create policy care_cases_read on public.care_cases for select to authenticated using (
  app.has_branch_role(branch_id, '{BRANCH_MANAGER,CARE_STAFF}') or assignee = auth.uid());
create policy care_interactions_read on public.care_interactions for select to authenticated using (
  exists (select 1 from care_cases c where c.id = case_id
          and (app.has_branch_role(c.branch_id, '{BRANCH_MANAGER,CARE_STAFF}') or c.assignee = auth.uid())));
create policy notifications_read on public.notifications for select to authenticated using (recipient = auth.uid());
create policy deliveries_read on public.notification_deliveries for select to authenticated using (
  exists (select 1 from notifications n where n.id = notification_id and n.recipient = auth.uid()));

revoke execute on function app.notify(uuid, uuid, uuid, text, text, text, text), app.evaluate_absence(uuid),
  app.upsert_absence_case(enrollments, uuid, int, jsonb),
  app.evaluate_renewal(uuid) from public, authenticated;
revoke execute on function public.run_care_job(), public.update_care_case(uuid, care_status, uuid, text, text, text, text, date),
  public.mark_notification_read(uuid) from public, anon;
grant execute on function public.run_care_job(), public.update_care_case(uuid, care_status, uuid, text, text, text, text, date),
  public.mark_notification_read(uuid) to authenticated;

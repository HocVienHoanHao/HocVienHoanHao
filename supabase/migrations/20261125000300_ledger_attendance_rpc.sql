-- Nghiệp vụ ghi: xác nhận đăng ký, xác nhận/hủy buổi, điểm danh + ledger quyền học, chuyển bảo lưu.
-- Tất cả là SECURITY DEFINER và tự kiểm tra quyền; client không ghi trực tiếp attendance/ledger.

-- ---------------------------------------------------------------- policy
-- Mặc định ĐỀ XUẤT (chưa duyệt): chỉ PRESENT bị trừ. Chủ học viện phải duyệt trước vận hành.
create or replace function app.policy_value(p_key text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select value from policy_settings where key = p_key and status = 'APPROVED'),
    case p_key
      when 'attendance.charge' then '{"PRESENT":true,"ABSENT_EXCUSED":false,"ABSENT_UNEXCUSED":false,"TRIAL":false}'::jsonb
      when 'forecast.recurring_estimate' then '{"enabled":false}'::jsonb
      else '{}'::jsonb end)
$$;

create or replace function app.status_is_charged(p_status attendance_status) returns boolean
language sql stable as $$
  select p_status <> 'NOT_MARKED' and coalesce((app.policy_value('attendance.charge') ->> p_status::text)::boolean, false)
$$;

create or replace function app.audit(p_action text, p_entity text, p_id uuid, p_branch uuid, p_change jsonb)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into audit_logs (actor, branch_id, action, entity, entity_id, change)
  values (auth.uid(), p_branch, p_action, p_entity, p_id, p_change)
$$;

create or replace function app.forbid() returns void language plpgsql as $$
begin raise exception 'Không có quyền thực hiện thao tác này' using errcode = '42501'; end $$;

-- Số dư một quyền học tại một ngày (từ ledger)
create or replace function app.entitlement_balance(p_entitlement uuid, p_as_of date default null) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(signed_delta), 0)::int from session_ledger
  where entitlement_id = p_entitlement and (p_as_of is null or effective_date <= p_as_of)
$$;

create or replace function app.refresh_entitlement_state(p_entitlement uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_bal int; v_state entitlement_state;
begin
  select state into v_state from entitlements where id = p_entitlement;
  if v_state in ('EXPIRED') then return; end if;
  v_bal := app.entitlement_balance(p_entitlement);
  update entitlements set state = case
      when v_bal > 0 then 'ACTIVE'::entitlement_state
      when exists (select 1 from session_ledger where entitlement_id = p_entitlement and event_type = 'TRANSFER_OUT')
           and v_bal = 0 then 'TRANSFERRED'
      else 'EXHAUSTED' end
  where id = p_entitlement;
end $$;

-- ---------------------------------------------------------------- enrollment
create or replace function public.confirm_enrollment(p_enrollment uuid, p_valid_until date default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare e enrollments; v_ent uuid;
begin
  select * into e from enrollments where id = p_enrollment for update;
  if not found then raise exception 'Không tìm thấy đăng ký'; end if;
  if not app.has_branch_role(e.branch_id, '{BRANCH_MANAGER}') then perform app.forbid(); end if;
  if e.status = 'CONFIRMED' then          -- idempotent
    select id into v_ent from entitlements where enrollment_id = e.id and source = 'PURCHASE' limit 1;
    return v_ent;
  end if;
  if e.status <> 'DRAFT' then raise exception 'Đăng ký ở trạng thái % không thể xác nhận', e.status; end if;

  update enrollments set status = 'CONFIRMED', confirmed_at = now(), confirmed_by = auth.uid() where id = e.id;

  if e.snapshot_billing_type = 'PACKAGE' then
    if coalesce(e.snapshot_quota, 0) <= 0 then raise exception 'Gói chưa có quota được duyệt'; end if;
    insert into entitlements (enrollment_id, student_id, source, quota, granted_at, valid_until)
    -- quyền học có từ lúc xác nhận đăng ký (hoặc ngày bắt đầu nếu sớm hơn)
    values (e.id, e.student_id, 'PURCHASE', e.snapshot_quota, least(e.start_date, app.vn_today()), p_valid_until)
    returning id into v_ent;
    insert into session_ledger (entitlement_id, enrollment_id, student_id, event_type, signed_delta,
                                effective_date, idempotency_key, reason, actor)
    values (v_ent, e.id, e.student_id, 'GRANT', e.snapshot_quota, least(e.start_date, app.vn_today()),
            'grant:' || e.id, 'Xác nhận đăng ký', auth.uid());
  end if;
  perform app.audit('CONFIRM', 'enrollment', e.id, e.branch_id, jsonb_build_object('entitlement', v_ent));
  return v_ent;
end $$;

-- ---------------------------------------------------------------- charge engine
create or replace function app.resolve_enrollment(p_student uuid, p_session uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select e.id from enrollments e join sessions s on s.class_id = e.class_id
  where s.id = p_session and e.student_id = p_student
    and e.status in ('CONFIRMED','COMPLETED','TRANSFERRED') and e.start_date <= app.session_date(s)
  order by e.start_date desc, e.created_at desc limit 1
$$;

-- Đồng bộ ledger với trạng thái hiện tại của một bản ghi điểm danh. Idempotent.
create or replace function app.apply_charge(p_attendance uuid) returns charge_status
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a attendance; s sessions; e enrollments;
  v_should boolean; v_net int; v_ent uuid; v_seq int; v_consume session_ledger; v_date date;
  v_result charge_status;
begin
  select * into a from attendance where id = p_attendance for update;
  select * into s from sessions where id = a.session_id;
  perform pg_advisory_xact_lock(hashtext('student-ledger:' || a.student_id));
  v_date := app.session_date(s);
  if a.enrollment_id is not null then select * into e from enrollments where id = a.enrollment_id; end if;

  v_should := coalesce(s.status = 'completed' and a.confirmed_at is not null and a.enrollment_id is not null
              and app.status_is_charged(a.status) and v_date >= e.start_date, false);

  select coalesce(-sum(signed_delta), 0) into v_net from session_ledger
  where attendance_id = a.id and event_type in ('CONSUME','REVERSAL');

  if v_should and v_net = 0 then
    -- FIFO: quyền hết hạn sớm nhất, rồi ngày cấp, rồi ưu tiên
    select en.id into v_ent from entitlements en
    where en.enrollment_id = a.enrollment_id and en.state = 'ACTIVE'
      and en.granted_at <= v_date and (en.valid_until is null or en.valid_until >= v_date)
      and app.entitlement_balance(en.id) > 0
    order by en.valid_until nulls last, en.granted_at, en.priority, en.created_at
    limit 1 for update;
    if v_ent is null then
      v_result := 'PENDING_NO_ENTITLEMENT';      -- không âm số dư; cảnh báo xử lý thủ công
    else
      select count(*) + 1 into v_seq from session_ledger where attendance_id = a.id and event_type = 'CONSUME';
      insert into session_ledger (entitlement_id, enrollment_id, student_id, attendance_id, session_id,
                                  event_type, signed_delta, effective_date, idempotency_key, reason, actor)
      values (v_ent, a.enrollment_id, a.student_id, a.id, s.id, 'CONSUME', -1, v_date,
              'consume:' || a.id || ':' || v_seq, 'Điểm danh ' || a.status, auth.uid());
      perform app.refresh_entitlement_state(v_ent);
      v_result := 'CHARGED';
    end if;
  elsif not v_should and v_net = 1 then
    select l.* into v_consume from session_ledger l
    where l.attendance_id = a.id and l.event_type = 'CONSUME'
      and not exists (select 1 from session_ledger r where r.source_entry_id = l.id and r.event_type = 'REVERSAL')
    order by l.created_at desc limit 1;
    insert into session_ledger (entitlement_id, enrollment_id, student_id, attendance_id, session_id,
                                event_type, signed_delta, effective_date, idempotency_key, source_entry_id, reason, actor)
    values (v_consume.entitlement_id, v_consume.enrollment_id, a.student_id, a.id, s.id, 'REVERSAL', 1,
            v_consume.effective_date, 'reversal:' || v_consume.id, v_consume.id,
            'Đảo bút toán: ' || a.status || ' / buổi ' || s.status, auth.uid());
    perform app.refresh_entitlement_state(v_consume.entitlement_id);
    v_result := 'NOT_CHARGEABLE';
  elsif v_should then
    v_result := 'CHARGED';
  else
    v_result := 'NOT_CHARGEABLE';
  end if;

  update attendance set charge_decision = v_result where id = a.id and charge_decision is distinct from v_result;
  return v_result;
end $$;

-- ---------------------------------------------------------------- sessions
create or replace function public.confirm_session(p_session uuid, p_actual_start timestamptz, p_actual_end timestamptz default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare s sessions; v_branch uuid; r record;
begin
  select * into s from sessions where id = p_session for update;
  if not found then raise exception 'Không tìm thấy buổi tập'; end if;
  if not app.can_mark_attendance(s.class_id) then perform app.forbid(); end if;
  if s.status = 'cancelled' then raise exception 'Buổi đã hủy không thể xác nhận'; end if;
  if p_actual_start > app.clock_now() then raise exception 'Chỉ xác nhận buổi đã thực sự diễn ra'; end if;
  if p_actual_end is not null and p_actual_end < p_actual_start then raise exception 'Giờ kết thúc không hợp lệ'; end if;
  if s.replacement_for_session_id is not null and not exists (
      select 1 from sessions o where o.id = s.replacement_for_session_id and o.status = 'cancelled') then
    raise exception 'Buổi bù chỉ hợp lệ khi buổi gốc đã hủy (tránh đếm hai lần)';
  end if;
  update sessions set status = 'completed', actual_start = p_actual_start, actual_end = p_actual_end,
                      completed_at = coalesce(completed_at, now()), confirmed_by = auth.uid()
  where id = s.id;
  for r in select id from attendance where session_id = s.id loop perform app.apply_charge(r.id); end loop;
  select branch_id into v_branch from classes where id = s.class_id;
  perform app.audit('CONFIRM', 'session', s.id, v_branch,
    jsonb_build_object('actual_start', p_actual_start, 'previous_status', s.status, 'previous_actual_start', s.actual_start));
end $$;

create or replace function public.cancel_session(p_session uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare s sessions; v_branch uuid; r record;
begin
  select * into s from sessions where id = p_session for update;
  if not found then raise exception 'Không tìm thấy buổi tập'; end if;
  select branch_id into v_branch from classes where id = s.class_id;
  -- hủy buổi đã tổ chức chỉ quản lý được phép (sửa sai)
  if s.status = 'completed' and not app.has_branch_role(v_branch, '{BRANCH_MANAGER}') then perform app.forbid(); end if;
  if not app.can_mark_attendance(s.class_id) then perform app.forbid(); end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Cần lý do hủy buổi'; end if;
  if s.status = 'cancelled' then return; end if;
  update sessions set status = 'cancelled', cancel_reason = p_reason where id = s.id;
  for r in select id from attendance where session_id = s.id loop perform app.apply_charge(r.id); end loop;
  perform app.audit('CANCEL', 'session', s.id, v_branch, jsonb_build_object('reason', p_reason, 'previous_status', s.status));
end $$;

create or replace function public.schedule_makeup_session(p_cancelled uuid, p_start timestamptz, p_end timestamptz default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare o sessions; v_id uuid; v_branch uuid;
begin
  select * into o from sessions where id = p_cancelled;
  select branch_id into v_branch from classes where id = o.class_id;
  if not app.has_branch_role(v_branch, '{BRANCH_MANAGER}') then perform app.forbid(); end if;
  if o.status <> 'cancelled' then raise exception 'Chỉ tạo buổi bù cho buổi đã hủy'; end if;
  insert into sessions (class_id, course_id, scheduled_start, scheduled_end, replacement_for_session_id)
  values (o.class_id, o.course_id, p_start, p_end, o.id) returning id into v_id;
  perform app.audit('MAKEUP', 'session', v_id, v_branch, jsonb_build_object('replaces', o.id));
  return v_id;
end $$;

-- ---------------------------------------------------------------- attendance
create or replace function public.record_attendance(
  p_session uuid, p_student uuid, p_status attendance_status,
  p_reason text default null, p_enrollment uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s sessions; v_enr uuid; v_att attendance; v_old attendance_status; v_branch uuid; v_charge charge_status;
begin
  select * into s from sessions where id = p_session;
  if not found then raise exception 'Không tìm thấy buổi tập'; end if;
  if not app.can_mark_attendance(s.class_id) then perform app.forbid(); end if;
  if s.status = 'cancelled' then raise exception 'Không điểm danh buổi đã hủy'; end if;
  select branch_id into v_branch from classes where id = s.class_id;

  if p_enrollment is not null then             -- học bù/chuyển lớp: phân bổ rõ ràng
    select id into v_enr from enrollments where id = p_enrollment and student_id = p_student
      and status in ('CONFIRMED','COMPLETED','TRANSFERRED') and branch_id = v_branch;
    if v_enr is null then raise exception 'Đăng ký phân bổ không hợp lệ cho học viên này'; end if;
  else
    v_enr := app.resolve_enrollment(p_student, p_session);
  end if;
  if v_enr is null and p_status not in ('TRIAL','NOT_MARKED') then
    raise exception 'Học viên chưa có đăng ký hợp lệ cho buổi này';
  end if;

  select status into v_old from attendance where session_id = p_session and student_id = p_student;

  insert into attendance (session_id, student_id, enrollment_id, status, reason, confirmed_at, recorded_by)
  values (p_session, p_student, v_enr, p_status, p_reason,
          case when p_status <> 'NOT_MARKED' then now() end, auth.uid())
  on conflict (session_id, student_id) do update set
    status = excluded.status,
    reason = excluded.reason,
    enrollment_id = excluded.enrollment_id,
    confirmed_at = case when excluded.status = 'NOT_MARKED' then null
                        when attendance.status = excluded.status then attendance.confirmed_at
                        else now() end,
    recorded_by = excluded.recorded_by
  returning * into v_att;

  v_charge := app.apply_charge(v_att.id);
  if v_old is distinct from p_status then
    perform app.audit(case when v_old is null then 'CREATE' else 'UPDATE' end, 'attendance', v_att.id, v_branch,
      jsonb_build_object('from', v_old, 'to', p_status, 'session', p_session, 'charge', v_charge));
  end if;
  return jsonb_build_object('attendance_id', v_att.id, 'status', p_status, 'charge', v_charge, 'enrollment_id', v_enr);
end $$;

-- ---------------------------------------------------------------- carryover (bảo lưu)
-- Chọn cách: chuyển bằng cặp TRANSFER_OUT/TRANSFER_IN cùng transfer_id (không vừa giữ vừa cộng).
create or replace function public.transfer_carryover(
  p_request_id uuid, p_from_enrollment uuid, p_to_enrollment uuid, p_sessions int,
  p_transfer_date date, p_reason text, p_valid_until date default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare f enrollments; t enrollments; v_left int := p_sessions; r record; v_take int; v_new uuid; v_avail int;
begin
  if exists (select 1 from session_ledger where transfer_id = p_request_id) then
    return p_request_id;                              -- idempotent
  end if;
  if p_sessions <= 0 then raise exception 'Số buổi chuyển phải > 0'; end if;
  select * into f from enrollments where id = p_from_enrollment;
  select * into t from enrollments where id = p_to_enrollment;
  if f.student_id <> t.student_id then raise exception 'Chỉ chuyển quyền học trong cùng một học viên'; end if;
  -- đổi chi nhánh cần quyền quản lý ở cả hai chi nhánh (hoặc SUPER_ADMIN)
  if not (app.has_branch_role(f.branch_id, '{BRANCH_MANAGER}') and app.has_branch_role(t.branch_id, '{BRANCH_MANAGER}')) then
    perform app.forbid();
  end if;
  if t.status not in ('CONFIRMED','DRAFT') then raise exception 'Đăng ký đích không hợp lệ'; end if;
  perform pg_advisory_xact_lock(hashtext('student-ledger:' || f.student_id));

  select coalesce(sum(app.entitlement_balance(id)), 0) into v_avail from entitlements
  where enrollment_id = f.id and state = 'ACTIVE' and (valid_until is null or valid_until >= p_transfer_date);
  if v_avail < p_sessions then raise exception 'Số dư khả dụng % < số buổi chuyển %', v_avail, p_sessions; end if;

  for r in select id from entitlements where enrollment_id = f.id and state = 'ACTIVE'
             and (valid_until is null or valid_until >= p_transfer_date)
           order by valid_until nulls last, granted_at, priority loop
    exit when v_left = 0;
    v_take := least(v_left, app.entitlement_balance(r.id));
    continue when v_take <= 0;
    insert into session_ledger (entitlement_id, enrollment_id, student_id, event_type, signed_delta, effective_date,
                                idempotency_key, transfer_id, reason, actor)
    values (r.id, f.id, f.student_id, 'TRANSFER_OUT', -v_take, p_transfer_date,
            'transfer-out:' || p_request_id || ':' || r.id, p_request_id, p_reason, auth.uid());
    perform app.refresh_entitlement_state(r.id);
    v_left := v_left - v_take;
  end loop;

  insert into entitlements (enrollment_id, student_id, source, quota, granted_at, valid_until, transfer_id, priority)
  values (t.id, t.student_id, 'CARRYOVER', p_sessions, p_transfer_date, p_valid_until, p_request_id, 50)
  returning id into v_new;
  insert into session_ledger (entitlement_id, enrollment_id, student_id, event_type, signed_delta, effective_date,
                              idempotency_key, transfer_id, reason, actor)
  values (v_new, t.id, t.student_id, 'TRANSFER_IN', p_sessions, p_transfer_date,
          'transfer-in:' || p_request_id, p_request_id, p_reason, auth.uid());
  update enrollments set status = 'TRANSFERRED' where id = f.id
    and not exists (select 1 from entitlements where enrollment_id = f.id and state = 'ACTIVE');
  perform app.audit('TRANSFER', 'entitlement', v_new, t.branch_id,
    jsonb_build_object('from_enrollment', f.id, 'to_enrollment', t.id, 'sessions', p_sessions, 'transfer_id', p_request_id));
  return p_request_id;
end $$;

-- duyệt lịch nghỉ đã biết trước
create or replace function public.approve_leave(p_leave uuid, p_charge boolean default false)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare l student_leaves; v_branch uuid;
begin
  select * into l from student_leaves where id = p_leave for update;
  select primary_branch_id into v_branch from students where id = l.student_id;
  if not app.has_branch_role(v_branch, '{BRANCH_MANAGER}') then perform app.forbid(); end if;
  update student_leaves set status = 'APPROVED', charge = p_charge, approved_by = auth.uid() where id = l.id;
  perform app.audit('APPROVE', 'student_leave', l.id, v_branch, jsonb_build_object('charge', p_charge));
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.confirm_enrollment, public.confirm_session, public.cancel_session,
  public.schedule_makeup_session, public.record_attendance, public.transfer_carryover, public.approve_leave
  to authenticated;

-- helper ghi nội bộ: không cho gọi trực tiếp từ API
revoke execute on function app.apply_charge(uuid), app.audit(text, text, uuid, uuid, jsonb),
  app.refresh_entitlement_state(uuid) from public, authenticated;

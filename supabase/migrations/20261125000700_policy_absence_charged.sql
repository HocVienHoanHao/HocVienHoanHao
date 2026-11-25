-- D1 (chủ học viện duyệt 25/11/2026): học viên nghỉ thì KHÔNG bảo lưu buổi.
-- Vắng có phép và vắng không phép đều trừ buổi; học thử không trừ.
-- Trường hợp đặc biệt do quản lý làm việc riêng với phụ huynh: duyệt đơn nghỉ "không trừ buổi" (ngoại lệ, có audit).

insert into public.policy_settings (key, version, value, status, approved_at)
select 'attendance.charge', coalesce(max(version), 0) + 1,
       '{"PRESENT":true,"ABSENT_EXCUSED":true,"ABSENT_UNEXCUSED":true,"TRIAL":false}'::jsonb, 'APPROVED', now()
from public.policy_settings where key = 'attendance.charge'
having not exists (select 1 from public.policy_settings where key = 'attendance.charge' and status = 'APPROVED');

-- Đồng bộ ledger với điểm danh, có tính ngoại lệ đơn nghỉ không trừ buổi. Thay bản ở migration 0300.
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
              and app.status_is_charged(a.status) and v_date >= e.start_date
              -- ngoại lệ do quản lý duyệt: đơn nghỉ "không trừ buổi" phủ ngày này (chỉ áp dụng khi vắng)
              and not (a.status in ('ABSENT_EXCUSED','ABSENT_UNEXCUSED') and exists (
                select 1 from student_leaves sl where sl.student_id = a.student_id and sl.status = 'APPROVED'
                  and not sl.charge and v_date between sl.from_date and sl.to_date)), false);

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

-- Duyệt đơn: mặc định trừ buổi theo chính sách; p_charge = false là ngoại lệ.
-- Sau khi duyệt, tính lại các buổi đã điểm danh trong khoảng nghỉ (hoàn buổi nếu là ngoại lệ).
drop function if exists public.approve_leave(uuid, boolean);
create function public.approve_leave(p_leave uuid, p_charge boolean default true)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare l student_leaves; v_branch uuid; r record;
begin
  select * into l from student_leaves where id = p_leave for update;
  if not found then raise exception 'Không tìm thấy đơn nghỉ'; end if;
  select primary_branch_id into v_branch from students where id = l.student_id;
  if not app.has_branch_role(v_branch, '{BRANCH_MANAGER}') then perform app.forbid(); end if;
  if l.status <> 'REQUESTED' then raise exception 'Đơn đã được xử lý'; end if;
  update student_leaves set status = 'APPROVED', charge = p_charge, approved_by = auth.uid() where id = l.id;
  for r in select a.id from attendance a join sessions s on s.id = a.session_id
           where a.student_id = l.student_id and app.session_date(s) between l.from_date and l.to_date loop
    perform app.apply_charge(r.id);
  end loop;
  perform app.audit('APPROVE', 'student_leave', l.id, v_branch,
    jsonb_build_object('charge', p_charge, 'exception', not p_charge));
end $$;
revoke execute on function public.approve_leave(uuid, boolean) from public, anon;
grant execute on function public.approve_leave(uuid, boolean) to authenticated;
revoke execute on function app.apply_charge(uuid) from public, authenticated;

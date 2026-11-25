-- D3 (chủ học viện duyệt 25/11/2026): số buổi còn lại khi hết khóa chuyển sang khóa tiếp theo,
-- và buổi bảo lưu CHỈ được dùng trong khóa kế tiếp:
--   * hạn dùng (valid_until) = ngày kết thúc khóa của đăng ký đích (không cho đặt dài hơn);
--   * không chuyển ngược về khóa trước;
--   * buổi đã bảo lưu (nguồn CARRYOVER) không được chuyển tiếp sang khóa thứ ba.
-- Đổi lớp/chi nhánh trong cùng khóa vẫn chuyển bình thường. Thay bản ở migration 0300.
create or replace function public.transfer_carryover(
  p_request_id uuid, p_from_enrollment uuid, p_to_enrollment uuid, p_sessions int,
  p_transfer_date date, p_reason text, p_valid_until date default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare f enrollments; t enrollments; v_cross boolean; v_until date; v_end date; v_left int := p_sessions; r record; v_take int; v_new uuid; v_avail int;
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
  -- D3: chuyển sang khóa khác = bảo lưu cuối khóa; buổi bảo lưu chỉ dùng trong khóa kế tiếp
  v_cross := t.course_id <> f.course_id;
  select end_date into v_end from courses where id = t.course_id;
  if v_cross then
    if (select start_date from courses where id = t.course_id) < (select start_date from courses where id = f.course_id) then
      raise exception 'Chỉ chuyển bảo lưu sang khóa sau';
    end if;
    if v_end is null then raise exception 'Khóa đích chưa có ngày kết thúc nên chưa đặt được hạn dùng buổi bảo lưu'; end if;
  end if;
  v_until := case when v_end is null then p_valid_until else least(coalesce(p_valid_until, v_end), v_end) end;
  perform pg_advisory_xact_lock(hashtext('student-ledger:' || f.student_id));

  select coalesce(sum(app.entitlement_balance(id)), 0) into v_avail from entitlements
  where enrollment_id = f.id and state = 'ACTIVE' and (valid_until is null or valid_until >= p_transfer_date)
    and not (v_cross and source = 'CARRYOVER');  -- buổi đã bảo lưu một lần không chuyển tiếp sang khóa khác
  if v_avail < p_sessions then raise exception 'Số dư khả dụng % < số buổi chuyển %', v_avail, p_sessions; end if;

  for r in select id from entitlements where enrollment_id = f.id and state = 'ACTIVE'
             and (valid_until is null or valid_until >= p_transfer_date) and not (v_cross and source = 'CARRYOVER')
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
  values (t.id, t.student_id, 'CARRYOVER', p_sessions, p_transfer_date, v_until, p_request_id, 50)
  returning id into v_new;
  insert into session_ledger (entitlement_id, enrollment_id, student_id, event_type, signed_delta, effective_date,
                              idempotency_key, transfer_id, reason, actor)
  values (v_new, t.id, t.student_id, 'TRANSFER_IN', p_sessions, p_transfer_date,
          'transfer-in:' || p_request_id, p_request_id, p_reason, auth.uid());
  update enrollments set status = 'TRANSFERRED' where id = f.id
    and not exists (select 1 from entitlements where enrollment_id = f.id and state = 'ACTIVE');
  perform app.audit('TRANSFER', 'entitlement', v_new, t.branch_id,
    jsonb_build_object('from_enrollment', f.id, 'to_enrollment', t.id, 'sessions', p_sessions, 'transfer_id', p_request_id, 'valid_until', v_until));
  return p_request_id;
end $$;

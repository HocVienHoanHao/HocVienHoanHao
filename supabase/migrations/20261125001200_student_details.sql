-- Hồ sơ học viên đầy đủ như bảng tính tuyển sinh: năm sinh, địa chỉ, size đồng phục/giày, ghi chú;
-- SĐT phụ huynh có Zalo; nhập số buổi bảo lưu mang từ khóa trước (trước khi có app).

alter table public.students
  add column birth_year int check (birth_year between 1990 and 2100),
  add column address text check (length(address) <= 300),
  add column uniform_size text check (length(uniform_size) <= 20),
  add column shoe_size text check (length(shoe_size) <= 20),
  add column note text check (length(note) <= 1000);

alter table public.guardians add column phone_has_zalo boolean not null default false;

-- ---------------------------------------------------------------- sửa học viên (thay bản 5 tham số)
drop function public.update_student(uuid, text, date, student_status, text);

create or replace function public.update_student(p_student uuid, p_full_name text, p_birth_date date,
  p_status student_status, p_status_reason text default null, p_birth_year int default null,
  p_address text default null, p_uniform_size text default null, p_shoe_size text default null, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare s students; v_name text; v_reason text; v_year int; v_addr text; v_us text; v_ss text; v_note text;
begin
  select * into s from students where id = p_student for update;
  if not found or not app.has_branch_role(s.primary_branch_id, '{BRANCH_MANAGER}') then perform app.forbid(); end if;
  v_name := normalize(trim(regexp_replace(coalesce(p_full_name, ''), '\s+', ' ', 'g')), NFC);
  if length(v_name) < 2 or length(v_name) > 120 then raise exception 'Họ tên không hợp lệ'; end if;
  if p_birth_date is not null and (p_birth_date > current_date or p_birth_date < date '1990-01-01') then
    raise exception 'Ngày sinh không hợp lệ';
  end if;
  v_year := coalesce(extract(year from p_birth_date)::int, p_birth_year);
  if v_year is not null and (v_year < 1990 or v_year > extract(year from current_date)::int) then
    raise exception 'Năm sinh không hợp lệ';
  end if;
  if p_status is null or p_status = 'UNKNOWN' then raise exception 'Chọn trạng thái học viên'; end if;
  v_reason := nullif(left(trim(coalesce(p_status_reason, '')), 300), '');
  if p_status = 'STOPPED' and v_reason is null then raise exception 'Cần lý do khi chuyển sang Đã nghỉ hẳn'; end if;
  v_addr := nullif(left(trim(coalesce(p_address, '')), 300), '');
  v_us := nullif(left(trim(coalesce(p_uniform_size, '')), 20), '');
  v_ss := nullif(left(trim(coalesce(p_shoe_size, '')), 20), '');
  v_note := nullif(left(trim(coalesce(p_note, '')), 1000), '');

  update students set full_name = v_name, birth_date = p_birth_date, birth_year = v_year, status = p_status,
    address = v_addr, uniform_size = v_us, shoe_size = v_ss, note = v_note,
    status_reason = case when p_status is distinct from s.status or v_reason is not null then v_reason else s.status_reason end,
    status_changed_at = case when p_status is distinct from s.status then now() else s.status_changed_at end,
    status_changed_by = case when p_status is distinct from s.status or p_status = 'STOPPED' then auth.uid() else s.status_changed_by end,
    updated_at = now()
  where id = p_student;

  perform app.audit('UPDATE', 'student', p_student, s.primary_branch_id, jsonb_strip_nulls(jsonb_build_object(
    'full_name', case when v_name is distinct from s.full_name then jsonb_build_array(s.full_name, v_name) end,
    'birth_date', case when p_birth_date is distinct from s.birth_date then jsonb_build_array(s.birth_date, p_birth_date) end,
    'birth_year', case when v_year is distinct from s.birth_year then jsonb_build_array(s.birth_year, v_year) end,
    'status', case when p_status is distinct from s.status then jsonb_build_array(s.status, p_status) end,
    'status_reason', case when p_status is distinct from s.status then v_reason end,
    'address_changed', case when v_addr is distinct from s.address then true end,
    'uniform_size', case when v_us is distinct from s.uniform_size then jsonb_build_array(s.uniform_size, v_us) end,
    'shoe_size', case when v_ss is distinct from s.shoe_size then jsonb_build_array(s.shoe_size, v_ss) end,
    'note_changed', case when v_note is distinct from s.note then true end)));
end $$;

-- ---------------------------------------------------------------- phụ huynh: thêm cờ "SĐT có Zalo"
drop function public.save_student_guardian(uuid, uuid, text, text, text, text, boolean);

create or replace function public.save_student_guardian(p_student uuid, p_guardian uuid, p_full_name text,
  p_phone text, p_email text, p_relationship text, p_can_request_leave boolean default false, p_has_zalo boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s students; v_gid uuid; v_name text; v_phone text; v_email text; v_rel text; v_reused boolean := false; g guardians;
begin
  select * into s from students where id = p_student;
  if not found or not app.has_branch_role(s.primary_branch_id, '{BRANCH_MANAGER}') then perform app.forbid(); end if;
  v_name := normalize(trim(regexp_replace(coalesce(p_full_name, ''), '\s+', ' ', 'g')), NFC);
  if length(v_name) < 2 or length(v_name) > 120 then raise exception 'Họ tên phụ huynh không hợp lệ'; end if;
  v_phone := app.normalize_phone(p_phone);
  if v_phone is not null and v_phone !~ '^\+?[0-9]{8,15}$' then raise exception 'Số điện thoại không hợp lệ'; end if;
  v_email := nullif(lower(trim(coalesce(p_email, ''))), '');
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Email không hợp lệ'; end if;
  v_rel := coalesce(nullif(left(trim(coalesce(p_relationship, '')), 50), ''), 'Phụ huynh');

  if p_guardian is null then
    if v_phone is not null then
      select g2.id into v_gid from guardians g2
        join guardian_students gs on gs.guardian_id = g2.id join students s2 on s2.id = gs.student_id
       where app.normalize_phone(g2.phone) = v_phone and s2.primary_branch_id = s.primary_branch_id
       order by g2.created_at limit 1;
    end if;
    if v_gid is not null then
      v_reused := true;
      if exists (select 1 from guardian_students where guardian_id = v_gid and student_id = p_student) then
        raise exception 'Phụ huynh có SĐT này đã được liên kết với học viên';
      end if;
      update guardians set email = coalesce(email, v_email), phone_has_zalo = phone_has_zalo or coalesce(p_has_zalo, false),
        updated_at = now() where id = v_gid;
    else
      insert into guardians (full_name, phone, email, phone_has_zalo)
      values (v_name, v_phone, v_email, v_phone is not null and coalesce(p_has_zalo, false)) returning id into v_gid;
    end if;
    insert into guardian_students (guardian_id, student_id, relationship, can_request_leave, verified_at, approved_by)
    values (v_gid, p_student, v_rel, coalesce(p_can_request_leave, false), now(), auth.uid());
    perform app.audit('LINK', 'guardian', v_gid, s.primary_branch_id,
      jsonb_build_object('student', p_student, 'relationship', v_rel, 'reused', v_reused));
  else
    select * into g from guardians where id = p_guardian for update;
    if not found or not exists (select 1 from guardian_students where guardian_id = p_guardian and student_id = p_student) then
      raise exception 'Phụ huynh không thuộc học viên này';
    end if;
    v_gid := p_guardian;
    update guardians set full_name = v_name, phone = v_phone, email = v_email,
      phone_has_zalo = v_phone is not null and coalesce(p_has_zalo, false), updated_at = now() where id = v_gid;
    update guardian_students set relationship = v_rel, can_request_leave = coalesce(p_can_request_leave, false)
     where guardian_id = v_gid and student_id = p_student;
    perform app.audit('UPDATE', 'guardian', v_gid, s.primary_branch_id, jsonb_strip_nulls(jsonb_build_object(
      'student', p_student,
      'full_name', case when v_name is distinct from g.full_name then jsonb_build_array(g.full_name, v_name) end,
      'phone_changed', case when v_phone is distinct from g.phone then true end,
      'email_changed', case when v_email is distinct from g.email then true end,
      'relationship', v_rel, 'can_request_leave', coalesce(p_can_request_leave, false))));
  end if;
  return jsonb_build_object('id', v_gid, 'reused', v_reused);
end $$;

-- ---------------------------------------------------------------- bảo lưu mang sang từ khóa trước
-- Cho học viên có buổi bảo lưu từ khóa trước khi dùng app (không có đăng ký nguồn trong app).
-- Theo D3: chỉ dùng trong khóa của đăng ký này (hạn = ngày kết thúc khóa), mỗi đăng ký nhận tối đa 1 lần.
create or replace function public.add_opening_carryover(p_enrollment uuid, p_sessions int, p_reason text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare e enrollments; v_end date; v_ent uuid; v_tid uuid := gen_random_uuid(); v_date date; v_reason text;
begin
  select * into e from enrollments where id = p_enrollment for update;
  if not found or not app.has_branch_role(e.branch_id, '{BRANCH_MANAGER}') then perform app.forbid(); end if;
  if p_sessions is null or p_sessions <= 0 or p_sessions > 100 then raise exception 'Số buổi bảo lưu không hợp lệ'; end if;
  if e.status not in ('CONFIRMED','DRAFT') then raise exception 'Đăng ký đích không hợp lệ'; end if;
  if exists (select 1 from entitlements where enrollment_id = e.id and source = 'CARRYOVER') then
    raise exception 'Đăng ký này đã nhận buổi bảo lưu, mỗi học viên chỉ được bảo lưu 1 lần';
  end if;
  select end_date into v_end from courses where id = e.course_id;
  v_date := least(e.start_date, app.vn_today());
  v_reason := coalesce(nullif(left(trim(coalesce(p_reason, '')), 300), ''), 'Bảo lưu từ khóa trước');
  perform pg_advisory_xact_lock(hashtext('student-ledger:' || e.student_id));
  insert into entitlements (enrollment_id, student_id, source, quota, granted_at, valid_until, transfer_id, priority)
  values (e.id, e.student_id, 'CARRYOVER', p_sessions, v_date, v_end, v_tid, 50)
  returning id into v_ent;
  insert into session_ledger (entitlement_id, enrollment_id, student_id, event_type, signed_delta, effective_date,
                              idempotency_key, transfer_id, reason, actor)
  values (v_ent, e.id, e.student_id, 'TRANSFER_IN', p_sessions, v_date, 'opening-carryover:' || e.id, v_tid, v_reason, auth.uid());
  perform app.audit('OPENING_CARRYOVER', 'entitlement', v_ent, e.branch_id,
    jsonb_build_object('enrollment', e.id, 'sessions', p_sessions, 'valid_until', v_end, 'reason', v_reason));
  return v_ent;
end $$;

revoke execute on function public.update_student(uuid, text, date, student_status, text, int, text, text, text, text) from public, anon;
grant execute on function public.update_student(uuid, text, date, student_status, text, int, text, text, text, text) to authenticated;
revoke execute on function public.save_student_guardian(uuid, uuid, text, text, text, text, boolean, boolean) from public, anon;
grant execute on function public.save_student_guardian(uuid, uuid, text, text, text, text, boolean, boolean) to authenticated;
revoke execute on function public.add_opening_carryover(uuid, int, text) from public, anon;
grant execute on function public.add_opening_carryover(uuid, int, text) to authenticated;

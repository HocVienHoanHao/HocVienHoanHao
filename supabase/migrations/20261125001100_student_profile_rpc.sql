-- Thêm / sửa hồ sơ học viên và phụ huynh ngay trên app.
-- Mọi thao tác ghi đi qua RPC security definer: chỉ SUPER_ADMIN hoặc BRANCH_MANAGER của chi nhánh
-- học viên được ghi; mỗi thay đổi ghi audit_logs.

-- ---------------------------------------------------------------- mã học viên không trùng
-- Dữ liệu nhập trực tiếp (vd. import K3-2026 với mã QN-000001…) không đi qua sequence,
-- nên đẩy sequence lên trên số lớn nhất đang có, và create_student bỏ qua mã đã tồn tại.
select setval('public.student_code_seq', greatest(
  (select max((regexp_match(student_code, '-(\d{6})$'))[1]::bigint) from public.students where student_code ~ '-\d{6}$'),
  (select last_value from public.student_code_seq), 1));

create or replace function public.create_student(p_branch uuid, p_full_name text, p_birth_date date default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text; v_prefix text; v_id uuid;
begin
  if not app.has_branch_role(p_branch, '{BRANCH_MANAGER}') then perform app.forbid(); end if;
  if length(trim(coalesce(p_full_name, ''))) < 2 then raise exception 'Họ tên không hợp lệ'; end if;
  if p_birth_date is not null and (p_birth_date > current_date or p_birth_date < date '1990-01-01') then
    raise exception 'Ngày sinh không hợp lệ';
  end if;
  select code into v_prefix from branches where id = p_branch;
  if v_prefix is null then raise exception 'Chi nhánh không tồn tại'; end if;
  loop
    v_code := v_prefix || '-' || lpad(nextval('student_code_seq')::text, 6, '0');
    exit when not exists (select 1 from students where student_code = v_code);
  end loop;
  insert into students (student_code, full_name, birth_date, status, primary_branch_id)
  values (v_code, normalize(trim(regexp_replace(p_full_name, '\s+', ' ', 'g')), NFC), p_birth_date, 'ACTIVE', p_branch)
  returning id into v_id;
  perform app.audit('CREATE', 'student', v_id, p_branch, jsonb_build_object('code', v_code));
  return v_id;
end $$;

-- ---------------------------------------------------------------- sửa học viên
-- Không đổi chi nhánh / mã học viên (gắn với đăng ký, sổ buổi học). STOPPED cần lý do.
create or replace function public.update_student(p_student uuid, p_full_name text, p_birth_date date,
  p_status student_status, p_status_reason text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare s students; v_name text; v_reason text;
begin
  select * into s from students where id = p_student for update;
  if not found or not app.has_branch_role(s.primary_branch_id, '{BRANCH_MANAGER}') then perform app.forbid(); end if;
  v_name := normalize(trim(regexp_replace(coalesce(p_full_name, ''), '\s+', ' ', 'g')), NFC);
  if length(v_name) < 2 or length(v_name) > 120 then raise exception 'Họ tên không hợp lệ'; end if;
  if p_birth_date is not null and (p_birth_date > current_date or p_birth_date < date '1990-01-01') then
    raise exception 'Ngày sinh không hợp lệ';
  end if;
  if p_status is null or p_status = 'UNKNOWN' then raise exception 'Chọn trạng thái học viên'; end if;
  v_reason := nullif(left(trim(coalesce(p_status_reason, '')), 300), '');
  if p_status = 'STOPPED' and v_reason is null then raise exception 'Cần lý do khi chuyển sang Đã nghỉ hẳn'; end if;

  update students set full_name = v_name, birth_date = p_birth_date, status = p_status,
    status_reason = case when p_status is distinct from s.status or v_reason is not null then v_reason else s.status_reason end,
    status_changed_at = case when p_status is distinct from s.status then now() else s.status_changed_at end,
    status_changed_by = case when p_status is distinct from s.status or p_status = 'STOPPED' then auth.uid() else s.status_changed_by end,
    updated_at = now()
  where id = p_student;

  perform app.audit('UPDATE', 'student', p_student, s.primary_branch_id, jsonb_strip_nulls(jsonb_build_object(
    'full_name', case when v_name is distinct from s.full_name then jsonb_build_array(s.full_name, v_name) end,
    'birth_date', case when p_birth_date is distinct from s.birth_date then jsonb_build_array(s.birth_date, p_birth_date) end,
    'status', case when p_status is distinct from s.status then jsonb_build_array(s.status, p_status) end,
    'status_reason', case when p_status is distinct from s.status then v_reason end)));
end $$;

-- ---------------------------------------------------------------- phụ huynh
create or replace function app.normalize_phone(p text) returns text language sql immutable as $$
  select nullif(regexp_replace(coalesce(p, ''), '[^0-9+]', '', 'g'), '')
$$;

-- Thêm (p_guardian null) hoặc sửa phụ huynh của học viên. Khi thêm mới mà SĐT trùng phụ huynh
-- đã có của một học viên cùng chi nhánh (anh chị em), dùng lại hồ sơ đó thay vì tạo bản trùng.
-- Trả về {"id": …, "reused": bool}.
create or replace function public.save_student_guardian(p_student uuid, p_guardian uuid, p_full_name text,
  p_phone text, p_email text, p_relationship text, p_can_request_leave boolean default false)
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
      -- bổ sung thông tin còn trống, không ghi đè hồ sơ dùng chung
      update guardians set email = coalesce(email, v_email), updated_at = now() where id = v_gid;
    else
      insert into guardians (full_name, phone, email) values (v_name, v_phone, v_email) returning id into v_gid;
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
    update guardians set full_name = v_name, phone = v_phone, email = v_email, updated_at = now() where id = v_gid;
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

-- Gỡ liên kết phụ huynh khỏi học viên. Hồ sơ phụ huynh không có tài khoản và không còn liên kết nào thì xóa luôn.
create or replace function public.unlink_student_guardian(p_student uuid, p_guardian uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare s students;
begin
  select * into s from students where id = p_student;
  if not found or not app.has_branch_role(s.primary_branch_id, '{BRANCH_MANAGER}') then perform app.forbid(); end if;
  delete from guardian_students where guardian_id = p_guardian and student_id = p_student;
  if not found then raise exception 'Phụ huynh không thuộc học viên này'; end if;
  delete from guardians g where g.id = p_guardian and g.user_id is null
    and not exists (select 1 from guardian_students gs where gs.guardian_id = g.id);
  perform app.audit('UNLINK', 'guardian', p_guardian, s.primary_branch_id, jsonb_build_object('student', p_student));
end $$;

revoke execute on function public.create_student(uuid, text, date) from public, anon;
grant execute on function public.create_student(uuid, text, date) to authenticated;
revoke execute on function public.update_student(uuid, text, date, student_status, text) from public, anon;
grant execute on function public.update_student(uuid, text, date, student_status, text) to authenticated;
revoke execute on function public.save_student_guardian(uuid, uuid, text, text, text, text, boolean) from public, anon;
grant execute on function public.save_student_guardian(uuid, uuid, text, text, text, text, boolean) to authenticated;
revoke execute on function public.unlink_student_guardian(uuid, uuid) from public, anon;
grant execute on function public.unlink_student_guardian(uuid, uuid) to authenticated;
revoke execute on function app.normalize_phone(text) from public, anon;
grant execute on function app.normalize_phone(text) to authenticated;

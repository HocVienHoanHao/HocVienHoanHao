-- Phase 2 — nghiệp vụ quản lý: tạo đăng ký (snapshot từ gói), sinh lịch buổi tập, dời buổi, xin nghỉ.

-- Đăng ký chỉ tạo qua RPC để snapshot quota/mốc/giá luôn lấy từ gói đã duyệt (client không tự đặt quota).
revoke insert on public.enrollments from authenticated;
-- Đơn nghỉ chỉ tạo/duyệt qua RPC (kiểm tra ngày, lý do, trạng thái và ghi audit); trước đây CSKH có thể insert thẳng status APPROVED.
revoke insert, update on public.student_leaves from authenticated;

create or replace function public.create_enrollment(
  p_student uuid, p_class uuid, p_plan uuid, p_start date, p_weekdays int[] default null,
  p_confirm boolean default true, p_valid_until date default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare c classes; pl plans; st students; v_id uuid;
begin
  select * into c from classes where id = p_class;
  select * into pl from plans where id = p_plan;
  select * into st from students where id = p_student;
  if c.id is null or pl.id is null or st.id is null then raise exception 'Lớp, gói hoặc học viên không tồn tại'; end if;
  if not app.has_branch_role(c.branch_id, '{BRANCH_MANAGER}') then perform app.forbid(); end if;
  -- học viên chi nhánh khác: cần quyền quản lý chi nhánh gốc (hoặc SUPER_ADMIN)
  if not app.has_branch_role(st.primary_branch_id, '{BRANCH_MANAGER}') then perform app.forbid(); end if;
  if pl.branch_id <> c.branch_id then raise exception 'Gói không thuộc chi nhánh của lớp'; end if;
  if not pl.active then raise exception 'Gói đã ngừng áp dụng'; end if;
  if p_weekdays is not null and not (p_weekdays <@ '{1,2,3,4,5,6,7}'::int[]) then raise exception 'Thứ trong tuần không hợp lệ'; end if;
  if p_weekdays is not null and pl.sessions_per_week is not null and cardinality(p_weekdays) <> pl.sessions_per_week then
    raise exception 'Gói % buổi/tuần nhưng chọn % ngày', pl.sessions_per_week, cardinality(p_weekdays);
  end if;
  insert into enrollments (student_id, branch_id, course_id, class_id, plan_id, start_date,
      snapshot_months, snapshot_quota, snapshot_milestones, snapshot_price, snapshot_billing_type,
      policy_version, schedule_weekdays)
  values (st.id, c.branch_id, c.course_id, c.id, pl.id, p_start,
      pl.months, pl.session_quota, pl.milestone_targets, pl.price, pl.billing_type,
      pl.policy_version, p_weekdays)
  returning id into v_id;
  perform app.audit('CREATE', 'enrollment', v_id, c.branch_id,
    jsonb_build_object('plan', pl.id, 'quota', pl.session_quota, 'start', p_start));
  if p_confirm then perform public.confirm_enrollment(v_id, p_valid_until); end if;
  return v_id;
end $$;

-- Sinh buổi tập theo lịch lặp của lớp trong khoảng ngày; bỏ qua ngày đã có buổi (kể cả buổi hủy). Idempotent.
create or replace function public.generate_sessions(p_class uuid, p_from date, p_to date)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare c classes; co courses; v_days int[]; v_start time; v_end time; v_n int;
begin
  select * into c from classes where id = p_class;
  if c.id is null then raise exception 'Không tìm thấy lớp'; end if;
  if not app.has_branch_role(c.branch_id, '{BRANCH_MANAGER}') then perform app.forbid(); end if;
  select * into co from courses where id = c.course_id;
  if p_to < p_from or p_to - p_from > 200 then raise exception 'Khoảng ngày không hợp lệ (tối đa 200 ngày)'; end if;
  if co.end_date is not null and p_to > co.end_date then raise exception 'Vượt ngày kết thúc khóa %', to_char(co.end_date, 'DD/MM/YYYY'); end if;
  select array_agg(x::int) into v_days from jsonb_array_elements_text(c.schedule -> 'weekdays') x;
  if v_days is null then raise exception 'Lớp chưa cấu hình lịch lặp (thứ trong tuần)'; end if;
  v_start := coalesce((c.schedule ->> 'start')::time, '17:30');
  v_end := coalesce((c.schedule ->> 'end')::time, v_start + interval '90 minutes');
  insert into sessions (class_id, course_id, scheduled_start, scheduled_end)
  select c.id, c.course_id, (d::date + v_start) at time zone 'Asia/Ho_Chi_Minh', (d::date + v_end) at time zone 'Asia/Ho_Chi_Minh'
  from generate_series(p_from, p_to, interval '1 day') d
  where extract(isodow from d)::int = any(v_days)
    and not exists (select 1 from sessions s where s.class_id = c.id and app.session_date(s) = d::date);
  get diagnostics v_n = row_count;
  perform app.audit('GENERATE', 'sessions', c.id, c.branch_id, jsonb_build_object('from', p_from, 'to', p_to, 'created', v_n));
  return v_n;
end $$;

-- Dời buổi chưa tổ chức sang giờ khác (dự báo tự tính lại vì không lưu ngày dự kiến).
create or replace function public.reschedule_session(p_session uuid, p_start timestamptz, p_end timestamptz default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare s sessions; v_branch uuid;
begin
  select * into s from sessions where id = p_session for update;
  select branch_id into v_branch from classes where id = s.class_id;
  if not app.has_branch_role(v_branch, '{BRANCH_MANAGER}') then perform app.forbid(); end if;
  if s.status <> 'scheduled' then raise exception 'Chỉ dời được buổi chưa tổ chức'; end if;
  update sessions set scheduled_start = p_start,
    scheduled_end = coalesce(p_end, p_start + coalesce(s.scheduled_end - s.scheduled_start, interval '90 minutes'))
  where id = s.id;
  perform app.audit('RESCHEDULE', 'session', s.id, v_branch, jsonb_build_object('from', s.scheduled_start, 'to', p_start));
end $$;

-- Xin nghỉ: phụ huynh (liên kết đã xác minh + được bật quyền) hoặc quản lý/CSKH chi nhánh.
create or replace function public.request_leave(p_student uuid, p_from date, p_to date, p_reason text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_branch uuid; v_id uuid; v_parent boolean;
begin
  select primary_branch_id into v_branch from students where id = p_student;
  v_parent := exists (select 1 from guardian_students gs where gs.student_id = p_student
                      and gs.guardian_id = app.my_guardian_id() and gs.can_request_leave)
              and app.is_guardian_of(p_student);
  if not (v_parent or app.has_branch_role(v_branch, '{BRANCH_MANAGER,CARE_STAFF}')) then perform app.forbid(); end if;
  if p_to < p_from or p_to - p_from > 90 then raise exception 'Khoảng ngày nghỉ không hợp lệ'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Cần lý do nghỉ'; end if;
  insert into student_leaves (student_id, from_date, to_date, status, reason, requested_by)
  values (p_student, p_from, p_to, 'REQUESTED', left(p_reason, 500), auth.uid()) returning id into v_id;
  perform app.audit('REQUEST', 'student_leave', v_id, v_branch, jsonb_build_object('from', p_from, 'to', p_to));
  return v_id;
end $$;

create or replace function public.reject_leave(p_leave uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare l student_leaves; v_branch uuid;
begin
  select * into l from student_leaves where id = p_leave for update;
  select primary_branch_id into v_branch from students where id = l.student_id;
  if not app.has_branch_role(v_branch, '{BRANCH_MANAGER}') then perform app.forbid(); end if;
  if l.status <> 'REQUESTED' then raise exception 'Đơn đã được xử lý'; end if;
  update student_leaves set status = 'REJECTED', approved_by = auth.uid() where id = l.id;
  perform app.audit('REJECT', 'student_leave', l.id, v_branch, null);
end $$;

-- Duyệt đơn: chỉ đơn đang chờ (không duyệt lại đơn đã từ chối/đã duyệt). Thay bản ở migration 0300.
create or replace function public.approve_leave(p_leave uuid, p_charge boolean default false)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare l student_leaves; v_branch uuid;
begin
  select * into l from student_leaves where id = p_leave for update;
  select primary_branch_id into v_branch from students where id = l.student_id;
  if not app.has_branch_role(v_branch, '{BRANCH_MANAGER}') then perform app.forbid(); end if;
  if l.status <> 'REQUESTED' then raise exception 'Đơn đã được xử lý'; end if;
  update student_leaves set status = 'APPROVED', charge = p_charge, approved_by = auth.uid() where id = l.id;
  perform app.audit('APPROVE', 'student_leave', l.id, v_branch, jsonb_build_object('charge', p_charge));
end $$;

revoke execute on function public.create_enrollment(uuid, uuid, uuid, date, int[], boolean, date),
  public.generate_sessions(uuid, date, date), public.reschedule_session(uuid, timestamptz, timestamptz),
  public.request_leave(uuid, date, date, text), public.reject_leave(uuid) from public, anon;
grant execute on function public.create_enrollment(uuid, uuid, uuid, date, int[], boolean, date),
  public.generate_sessions(uuid, date, date), public.reschedule_session(uuid, timestamptz, timestamptz),
  public.request_leave(uuid, date, date, text), public.reject_leave(uuid) to authenticated;

-- Tạo học viên với mã tự sinh <MÃ CHI NHÁNH>-000001 (duy nhất toàn hệ thống).
create sequence public.student_code_seq;
create or replace function public.create_student(p_branch uuid, p_full_name text, p_birth_date date default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text; v_id uuid;
begin
  if not app.has_branch_role(p_branch, '{BRANCH_MANAGER}') then perform app.forbid(); end if;
  if length(trim(coalesce(p_full_name, ''))) < 2 then raise exception 'Họ tên không hợp lệ'; end if;
  select code || '-' || lpad(nextval('student_code_seq')::text, 6, '0') into v_code from branches where id = p_branch;
  insert into students (student_code, full_name, birth_date, status, primary_branch_id)
  values (v_code, normalize(trim(regexp_replace(p_full_name, '\s+', ' ', 'g')), NFC), p_birth_date, 'ACTIVE', p_branch)
  returning id into v_id;
  perform app.audit('CREATE', 'student', v_id, p_branch, jsonb_build_object('code', v_code));
  return v_id;
end $$;
revoke execute on function public.create_student(uuid, text, date) from public, anon;
grant execute on function public.create_student(uuid, text, date) to authenticated;

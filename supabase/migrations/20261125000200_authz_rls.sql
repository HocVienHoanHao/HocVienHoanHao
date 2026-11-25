-- Phân quyền: helper + RLS. Vai trò không bao giờ lấy từ client input:
-- chỉ từ auth.uid() (JWT do Supabase Auth ký) + bảng memberships/assignments/guardian links.

create or replace function app.uid() returns uuid
language sql stable as $$ select auth.uid() $$;

create or replace function app.is_super_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from branch_memberships m
                 where m.user_id = auth.uid() and m.role = 'SUPER_ADMIN' and m.active)
$$;

create or replace function app.has_branch_role(p_branch uuid, p_roles app_role[]) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.is_super_admin() or exists (
    select 1 from branch_memberships m
    where m.user_id = auth.uid() and m.active and m.branch_id = p_branch and m.role = any(p_roles))
$$;

create or replace function app.is_class_coach(p_class uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from coach_assignments ca
    join classes c on c.id = ca.class_id
    join branch_memberships m on m.user_id = ca.coach_id and m.branch_id = c.branch_id
                              and m.role = 'COACH' and m.active
    where ca.class_id = p_class and ca.coach_id = auth.uid()
      and ca.start_date <= app.vn_today() and (ca.end_date is null or ca.end_date >= app.vn_today()))
$$;

create or replace function app.is_guardian_of(p_student uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from guardian_students gs join guardians g on g.id = gs.guardian_id
    where gs.student_id = p_student and g.user_id = auth.uid()
      and gs.verified_at is not null and g.verified_at is not null)
$$;

create or replace function app.guardian_can_view_finance(p_student uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from guardian_students gs join guardians g on g.id = gs.guardian_id
    where gs.student_id = p_student and g.user_id = auth.uid()
      and gs.verified_at is not null and g.verified_at is not null and gs.can_view_finance)
$$;

-- Nhân sự xem được lớp (không gồm phụ huynh)
create or replace function app.staff_can_view_class(p_class uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from classes c where c.id = p_class
                 and app.has_branch_role(c.branch_id, '{BRANCH_MANAGER,CARE_STAFF,ACCOUNTANT}'))
      or app.is_class_coach(p_class)
$$;

-- Phụ huynh chỉ thấy thông tin tổng hợp lớp của con (không thấy danh sách lớp)
create or replace function app.parent_of_class_member(p_class uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from enrollments e
                 where e.class_id = p_class and e.status in ('CONFIRMED','COMPLETED')
                   and app.is_guardian_of(e.student_id))
$$;

create or replace function app.can_view_class(p_class uuid) returns boolean
language sql stable as $$
  select app.staff_can_view_class(p_class) or app.parent_of_class_member(p_class)
$$;

create or replace function app.staff_can_view_student(p_student uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from students s where s.id = p_student
                 and app.has_branch_role(s.primary_branch_id, '{BRANCH_MANAGER,CARE_STAFF,ACCOUNTANT}'))
      or exists (select 1 from enrollments e where e.student_id = p_student
                 and (app.has_branch_role(e.branch_id, '{BRANCH_MANAGER,CARE_STAFF,ACCOUNTANT}')
                      or app.is_class_coach(e.class_id)))
$$;

create or replace function app.can_view_student(p_student uuid) returns boolean
language sql stable as $$
  select app.staff_can_view_student(p_student) or app.is_guardian_of(p_student)
$$;

create or replace function app.can_view_enrollment(p_enrollment uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from enrollments e where e.id = p_enrollment and (
      app.has_branch_role(e.branch_id, '{BRANCH_MANAGER,CARE_STAFF,ACCOUNTANT}')
      or app.is_class_coach(e.class_id)
      or app.is_guardian_of(e.student_id)))
$$;

create or replace function app.can_mark_attendance(p_class uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.is_class_coach(p_class)
      or exists (select 1 from classes c where c.id = p_class
                 and app.has_branch_role(c.branch_id, '{BRANCH_MANAGER}'))
$$;

-- ---------------------------------------------------------------- grants
grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;
revoke all on all tables in schema public from anon;
grant select on all tables in schema public to authenticated;
grant insert, update on public.branches, public.venues, public.students, public.guardians,
  public.guardian_students, public.courses, public.classes, public.coach_assignments,
  public.plans, public.notes, public.student_leaves to authenticated;
-- sessions: chỉ tạo/sửa lịch trực tiếp; xác nhận/hủy phải qua RPC
grant insert, update (scheduled_start, scheduled_end) on public.sessions to authenticated;
-- attendance, entitlements, session_ledger, enrollments.status: chỉ ghi qua RPC (security definer)
grant insert on public.enrollments to authenticated;

-- ---------------------------------------------------------------- RLS
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

create policy branches_read on public.branches for select to authenticated using (true);
create policy branches_write on public.branches for all to authenticated
  using (app.is_super_admin()) with check (app.is_super_admin());

create policy profiles_read on public.profiles for select to authenticated using (
  id = auth.uid() or app.is_super_admin() or exists (
    select 1 from branch_memberships m where m.user_id = profiles.id
      and app.has_branch_role(m.branch_id, '{BRANCH_MANAGER}')));

create policy memberships_read on public.branch_memberships for select to authenticated using (
  user_id = auth.uid() or app.has_branch_role(branch_id, '{BRANCH_MANAGER}'));
create policy memberships_write on public.branch_memberships for all to authenticated
  using (app.is_super_admin()) with check (app.is_super_admin());

create policy venues_read on public.venues for select to authenticated using (
  app.has_branch_role(branch_id, '{BRANCH_MANAGER,ACCOUNTANT,CARE_STAFF,COACH}'));
create policy venues_write on public.venues for all to authenticated
  using (app.has_branch_role(branch_id, '{BRANCH_MANAGER}'))
  with check (app.has_branch_role(branch_id, '{BRANCH_MANAGER}'));

create policy students_read on public.students for select to authenticated
  using (app.can_view_student(id));
create policy students_insert on public.students for insert to authenticated
  with check (app.has_branch_role(primary_branch_id, '{BRANCH_MANAGER}'));
create policy students_update on public.students for update to authenticated
  using (app.has_branch_role(primary_branch_id, '{BRANCH_MANAGER}'))
  with check (app.has_branch_role(primary_branch_id, '{BRANCH_MANAGER}'));

create policy guardians_read on public.guardians for select to authenticated using (
  user_id = auth.uid() or exists (select 1 from guardian_students gs
    join students s on s.id = gs.student_id
    where gs.guardian_id = guardians.id
      and app.has_branch_role(s.primary_branch_id, '{BRANCH_MANAGER,CARE_STAFF}')));
create policy guardians_write on public.guardians for all to authenticated using (
  exists (select 1 from guardian_students gs join students s on s.id = gs.student_id
          where gs.guardian_id = guardians.id
            and app.has_branch_role(s.primary_branch_id, '{BRANCH_MANAGER}')))
  with check (app.is_super_admin() or exists (select 1 from branch_memberships m
          where m.user_id = auth.uid() and m.role = 'BRANCH_MANAGER' and m.active));

create policy guardian_students_read on public.guardian_students for select to authenticated using (
  exists (select 1 from guardians g where g.id = guardian_id and g.user_id = auth.uid())
  or exists (select 1 from students s where s.id = student_id
             and app.has_branch_role(s.primary_branch_id, '{BRANCH_MANAGER,CARE_STAFF}')));
create policy guardian_students_write on public.guardian_students for all to authenticated
  using (exists (select 1 from students s where s.id = student_id
                 and app.has_branch_role(s.primary_branch_id, '{BRANCH_MANAGER}')))
  with check (exists (select 1 from students s where s.id = student_id
                 and app.has_branch_role(s.primary_branch_id, '{BRANCH_MANAGER}')));

create policy courses_read on public.courses for select to authenticated using (
  app.has_branch_role(branch_id, '{BRANCH_MANAGER,ACCOUNTANT,CARE_STAFF}')
  or exists (select 1 from classes c where c.course_id = courses.id and app.can_view_class(c.id)));
create policy courses_write on public.courses for all to authenticated
  using (app.has_branch_role(branch_id, '{BRANCH_MANAGER}'))
  with check (app.has_branch_role(branch_id, '{BRANCH_MANAGER}'));

create policy classes_read on public.classes for select to authenticated using (app.can_view_class(id));
create policy classes_write on public.classes for all to authenticated
  using (app.has_branch_role(branch_id, '{BRANCH_MANAGER}'))
  with check (app.has_branch_role(branch_id, '{BRANCH_MANAGER}'));

create policy coach_assignments_read on public.coach_assignments for select to authenticated using (
  coach_id = auth.uid() or exists (select 1 from classes c where c.id = class_id
    and app.has_branch_role(c.branch_id, '{BRANCH_MANAGER}')));
create policy coach_assignments_write on public.coach_assignments for all to authenticated
  using (exists (select 1 from classes c where c.id = class_id and app.has_branch_role(c.branch_id, '{BRANCH_MANAGER}')))
  with check (exists (select 1 from classes c where c.id = class_id and app.has_branch_role(c.branch_id, '{BRANCH_MANAGER}')));

create policy plans_read on public.plans for select to authenticated using (
  app.has_branch_role(branch_id, '{BRANCH_MANAGER,ACCOUNTANT,CARE_STAFF}')
  or exists (select 1 from enrollments e where e.plan_id = plans.id and app.is_guardian_of(e.student_id)));
create policy plans_write on public.plans for all to authenticated
  using (app.has_branch_role(branch_id, '{BRANCH_MANAGER}'))
  with check (app.has_branch_role(branch_id, '{BRANCH_MANAGER}'));

create policy enrollments_read on public.enrollments for select to authenticated using (
  app.has_branch_role(branch_id, '{BRANCH_MANAGER,CARE_STAFF,ACCOUNTANT}')
  or app.is_class_coach(class_id) or app.is_guardian_of(student_id));
create policy enrollments_insert on public.enrollments for insert to authenticated
  with check (status = 'DRAFT' and app.has_branch_role(branch_id, '{BRANCH_MANAGER}')
    -- học viên thuộc chi nhánh khác: chỉ SUPER_ADMIN hoặc quản lý chi nhánh gốc (chống IDOR theo ID đoán)
    and exists (select 1 from students s where s.id = student_id
                and app.has_branch_role(s.primary_branch_id, '{BRANCH_MANAGER}')));

-- sessions: phụ huynh thấy lịch lớp của con (không có thông tin học viên khác)
create policy sessions_read on public.sessions for select to authenticated using (app.can_view_class(class_id));
create policy sessions_insert on public.sessions for insert to authenticated with check (
  status = 'scheduled' and exists (select 1 from classes c where c.id = class_id
    and app.has_branch_role(c.branch_id, '{BRANCH_MANAGER}')));
create policy sessions_update on public.sessions for update to authenticated
  using (status = 'scheduled' and exists (select 1 from classes c where c.id = class_id
    and app.has_branch_role(c.branch_id, '{BRANCH_MANAGER}')))
  with check (status = 'scheduled');

create policy attendance_read on public.attendance for select to authenticated using (
  app.is_guardian_of(student_id)
  or exists (select 1 from sessions s where s.id = session_id and app.staff_can_view_class(s.class_id)));

create policy leaves_read on public.student_leaves for select to authenticated
  using (app.can_view_student(student_id));
create policy leaves_write on public.student_leaves for insert to authenticated with check (
  (status = 'REQUESTED' and app.is_guardian_of(student_id) and exists (
     select 1 from guardian_students gs join guardians g on g.id = gs.guardian_id
     where gs.student_id = student_leaves.student_id and g.user_id = auth.uid() and gs.can_request_leave))
  or exists (select 1 from students s where s.id = student_id
             and app.has_branch_role(s.primary_branch_id, '{BRANCH_MANAGER,CARE_STAFF}')));
create policy leaves_update on public.student_leaves for update to authenticated
  using (exists (select 1 from students s where s.id = student_id
                 and app.has_branch_role(s.primary_branch_id, '{BRANCH_MANAGER}')))
  with check (true);

create policy entitlements_read on public.entitlements for select to authenticated using (
  app.is_guardian_of(student_id) or exists (select 1 from enrollments e where e.id = enrollment_id
    and app.has_branch_role(e.branch_id, '{BRANCH_MANAGER,ACCOUNTANT,CARE_STAFF}')));
create policy ledger_read on public.session_ledger for select to authenticated using (
  app.is_guardian_of(student_id) or exists (select 1 from enrollments e where e.id = enrollment_id
    and app.has_branch_role(e.branch_id, '{BRANCH_MANAGER,ACCOUNTANT}')));

create policy policy_read on public.policy_settings for select to authenticated using (true);
create policy policy_write on public.policy_settings for all to authenticated
  using (app.is_super_admin()) with check (app.is_super_admin());

create policy audit_read on public.audit_logs for select to authenticated using (
  app.is_super_admin() or (branch_id is not null and app.has_branch_role(branch_id, '{BRANCH_MANAGER}')));

create policy notes_read on public.notes for select to authenticated using (
  app.has_branch_role(branch_id, '{BRANCH_MANAGER,CARE_STAFF}')
  or (author = auth.uid())
  or (visibility = 'PARENT' and shared_at is not null and app.is_guardian_of(student_id)));
create policy notes_insert on public.notes for insert to authenticated with check (
  author = auth.uid() and (app.has_branch_role(branch_id, '{BRANCH_MANAGER,CARE_STAFF}')
    or exists (select 1 from enrollments e where e.student_id = notes.student_id
               and e.branch_id = notes.branch_id and app.is_class_coach(e.class_id))));

create policy import_batches_rw on public.import_batches for all to authenticated
  using (app.is_super_admin() or (branch_id is not null and app.has_branch_role(branch_id, '{BRANCH_MANAGER}')))
  with check (app.is_super_admin() or (branch_id is not null and app.has_branch_role(branch_id, '{BRANCH_MANAGER}')));
create policy import_rows_rw on public.import_rows for all to authenticated
  using (exists (select 1 from import_batches b where b.id = batch_id
    and (app.is_super_admin() or app.has_branch_role(b.branch_id, '{BRANCH_MANAGER}'))))
  with check (exists (select 1 from import_batches b where b.id = batch_id
    and (app.is_super_admin() or app.has_branch_role(b.branch_id, '{BRANCH_MANAGER}'))));

create policy invoices_read on public.invoices for select to authenticated using (
  app.has_branch_role(branch_id, '{BRANCH_MANAGER,ACCOUNTANT}') or app.guardian_can_view_finance(student_id));
create policy invoice_items_read on public.invoice_items for select to authenticated using (
  exists (select 1 from invoices i where i.id = invoice_id and (
    app.has_branch_role(i.branch_id, '{BRANCH_MANAGER,ACCOUNTANT}') or app.guardian_can_view_finance(i.student_id))));

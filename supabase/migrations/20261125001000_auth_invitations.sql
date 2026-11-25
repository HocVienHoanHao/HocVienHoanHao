-- Đăng nhập thật (Supabase Auth): người dùng chỉ có quyền khi được MỜI theo email.
-- Đăng nhập thành công nhưng chưa có lời mời -> không có profile/vai trò -> không thấy dữ liệu nào.
-- Lời mời được nhận qua RPC claim_my_invitations() dùng email đã xác minh trong JWT (do Supabase ký).

create table public.user_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  full_name text not null check (length(trim(full_name)) >= 2),
  kind text not null check (kind in ('STAFF','GUARDIAN')),
  role public.app_role,                 -- STAFF
  branch_id uuid references public.branches(id),
  student_id uuid references public.students(id),   -- GUARDIAN
  relationship text,
  can_request_leave boolean not null default false,
  can_view_finance boolean not null default true,
  invited_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references public.profiles(id),
  revoked_at timestamptz,
  check (kind <> 'STAFF' or (role is not null and role <> 'PARENT' and (role = 'SUPER_ADMIN') = (branch_id is null) and student_id is null)),
  check (kind <> 'GUARDIAN' or (student_id is not null and role is null and branch_id is null and relationship is not null))
);
create index on public.user_invitations (email) where accepted_at is null and revoked_at is null;

alter table public.user_invitations enable row level security;
alter table public.user_invitations force row level security;
grant select on public.user_invitations to authenticated;
-- Chỉ đọc; tạo/thu hồi/nhận qua RPC.
create policy invitations_read on public.user_invitations for select to authenticated using (
  app.is_super_admin()
  or (branch_id is not null and app.has_branch_role(branch_id, '{BRANCH_MANAGER}'))
  or (student_id is not null and exists (select 1 from students s where s.id = student_id
        and app.has_branch_role(s.primary_branch_id, '{BRANCH_MANAGER,CARE_STAFF}'))));

-- Email đã xác minh của người đang đăng nhập (claim do server đặt từ phiên Supabase đã kiểm tra).
create or replace function app.my_email() returns text language sql stable as $$
  select nullif(lower(trim((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email'))), '')
$$;

create or replace function public.create_invitation(
  p_email text, p_full_name text, p_kind text, p_role app_role default null, p_branch uuid default null,
  p_student uuid default null, p_relationship text default null,
  p_can_request_leave boolean default false, p_can_view_finance boolean default true)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email text := lower(trim(p_email)); v_branch uuid; v_id uuid;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Email không hợp lệ'; end if;
  if length(trim(coalesce(p_full_name, ''))) < 2 then raise exception 'Họ tên không hợp lệ'; end if;
  if p_kind = 'STAFF' then
    if p_role is null or p_role = 'PARENT' then raise exception 'Vai trò không hợp lệ'; end if;
    -- SUPER_ADMIN và quản lý chi nhánh chỉ SUPER_ADMIN được mời; quản lý mời HLV/kế toán/CSKH cho chi nhánh mình
    if p_role in ('SUPER_ADMIN','BRANCH_MANAGER') then
      if not app.is_super_admin() then perform app.forbid(); end if;
    elsif not app.has_branch_role(p_branch, '{BRANCH_MANAGER}') then perform app.forbid();
    end if;
    if (p_role = 'SUPER_ADMIN') <> (p_branch is null) then raise exception 'Chi nhánh không hợp lệ cho vai trò này'; end if;
    v_branch := p_branch;
  elsif p_kind = 'GUARDIAN' then
    select primary_branch_id into v_branch from students where id = p_student;
    if v_branch is null then raise exception 'Không tìm thấy học viên'; end if;
    if not app.has_branch_role(v_branch, '{BRANCH_MANAGER,CARE_STAFF}') then perform app.forbid(); end if;
    if coalesce(trim(p_relationship), '') = '' then raise exception 'Cần ghi quan hệ với học viên'; end if;
  else
    raise exception 'Loại lời mời không hợp lệ';
  end if;
  -- thu hồi lời mời trùng còn hiệu lực rồi tạo mới (gửi lại lời mời)
  update user_invitations set revoked_at = now()
  where email = v_email and accepted_at is null and revoked_at is null and kind = p_kind
    and role is not distinct from (case when p_kind = 'STAFF' then p_role end)
    and branch_id is not distinct from (case when p_kind = 'STAFF' then p_branch end)
    and student_id is not distinct from (case when p_kind = 'GUARDIAN' then p_student end);
  insert into user_invitations (email, full_name, kind, role, branch_id, student_id, relationship,
                                can_request_leave, can_view_finance, invited_by)
  values (v_email, normalize(trim(regexp_replace(p_full_name, '\s+', ' ', 'g')), NFC), p_kind,
          case when p_kind = 'STAFF' then p_role end, case when p_kind = 'STAFF' then p_branch end,
          case when p_kind = 'GUARDIAN' then p_student end,
          case when p_kind = 'GUARDIAN' then left(trim(p_relationship), 50) end,
          p_kind = 'GUARDIAN' and p_can_request_leave, p_kind <> 'GUARDIAN' or p_can_view_finance, auth.uid())
  returning id into v_id;
  -- không ghi email vào audit (dữ liệu cá nhân); chỉ ghi loại + vai trò
  perform app.audit('INVITE', 'user_invitation', v_id, v_branch,
    jsonb_build_object('kind', p_kind, 'role', p_role, 'student', p_student));
  return v_id;
end $$;

create or replace function public.revoke_invitation(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare i user_invitations; v_branch uuid;
begin
  select * into i from user_invitations where id = p_id for update;
  if i.id is null then raise exception 'Không tìm thấy lời mời'; end if;
  v_branch := coalesce(i.branch_id, (select primary_branch_id from students where id = i.student_id));
  if i.kind = 'STAFF' and i.role in ('SUPER_ADMIN','BRANCH_MANAGER') then
    if not app.is_super_admin() then perform app.forbid(); end if;
  elsif not app.has_branch_role(v_branch, case when i.kind = 'GUARDIAN' then '{BRANCH_MANAGER,CARE_STAFF}'::app_role[] else '{BRANCH_MANAGER}'::app_role[] end) then
    perform app.forbid();
  end if;
  if i.accepted_at is not null then raise exception 'Lời mời đã được nhận'; end if;
  update user_invitations set revoked_at = coalesce(revoked_at, now()) where id = i.id;
  perform app.audit('REVOKE', 'user_invitation', i.id, v_branch, null);
end $$;

-- Gọi ngay sau khi đăng nhập: tạo profile (nếu chưa có) và áp dụng mọi lời mời còn hiệu lực cho email này.
-- Idempotent. Trả về số lời mời vừa nhận.
create or replace function public.claim_my_invitations()
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_email text := app.my_email(); i record; v_gid uuid; v_n int := 0;
begin
  if v_uid is null or v_email is null then raise exception 'Chưa đăng nhập'; end if;
  for i in select * from user_invitations
           where email = v_email and accepted_at is null and revoked_at is null and expires_at > now()
           order by created_at for update loop
    insert into profiles (id, full_name) values (v_uid, i.full_name) on conflict (id) do nothing;
    if i.kind = 'STAFF' then
      insert into branch_memberships (user_id, branch_id, role) values (v_uid, i.branch_id, i.role)
      on conflict (user_id, branch_id, role) do update set active = true, updated_at = now();
    else
      select id into v_gid from guardians where user_id = v_uid;
      if v_gid is null then
        insert into guardians (user_id, full_name, email, verified_at) values (v_uid, i.full_name, v_email, now())
        returning id into v_gid;
      end if;
      insert into guardian_students (guardian_id, student_id, relationship, can_view_finance, can_request_leave, verified_at, approved_by)
      values (v_gid, i.student_id, i.relationship, i.can_view_finance, i.can_request_leave, now(), i.invited_by)
      on conflict (guardian_id, student_id) do update set verified_at = coalesce(guardian_students.verified_at, now()),
        can_view_finance = excluded.can_view_finance, can_request_leave = excluded.can_request_leave;
    end if;
    update user_invitations set accepted_at = now(), accepted_by = v_uid where id = i.id;
    perform app.audit('ACCEPT', 'user_invitation', i.id,
      coalesce(i.branch_id, (select primary_branch_id from students where id = i.student_id)), null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

revoke execute on function public.create_invitation(text, text, text, app_role, uuid, uuid, text, boolean, boolean),
  public.revoke_invitation(uuid), public.claim_my_invitations() from public, anon;
grant execute on function public.create_invitation(text, text, text, app_role, uuid, uuid, text, boolean, boolean),
  public.revoke_invitation(uuid), public.claim_my_invitations() to authenticated;

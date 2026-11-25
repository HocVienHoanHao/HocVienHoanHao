-- Sổ thu tiền đơn giản (chủ học viện chọn 25/11/2026): mỗi học viên có các phiếu thu (invoices) gồm
-- khoản phải thu (invoice_items: học phí, đồng phục, giày, khác) và các lần đã trả (receipts).
-- Còn lại = tổng phải thu − tổng đã trả (không tính lần trả đã hủy). Không xóa: sửa sai bằng hủy có lý do.
-- Ghi: quản lý chi nhánh hoặc kế toán chi nhánh (hoặc SUPER_ADMIN). Đây là nền cho module Thu chi Phase 3.

alter table public.invoices
  add column note text check (length(note) <= 500),
  add column created_by uuid references public.profiles(id),
  add column void_reason text;

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id),
  branch_id uuid not null references public.branches(id),
  student_id uuid not null references public.students(id),
  amount bigint not null check (amount > 0),
  paid_on date not null,
  method text not null default 'CASH' check (method in ('CASH','TRANSFER','OTHER')),
  note text check (length(note) <= 300),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles(id),
  void_reason text,
  check (voided_at is null or (void_reason is not null and voided_by is not null))
);
create index on public.receipts (invoice_id);
create index on public.receipts (student_id);

alter table public.receipts enable row level security;
alter table public.receipts force row level security;
grant select on public.receipts to authenticated;
create policy receipts_read on public.receipts for select to authenticated using (
  app.has_branch_role(branch_id, '{BRANCH_MANAGER,ACCOUNTANT}') or app.guardian_can_view_finance(student_id));

-- Tổng phải thu / đã trả / còn lại của một phiếu
create or replace function app.invoice_totals(p_invoice uuid, out total bigint, out paid bigint, out remaining bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.total, p.paid, t.total - p.paid from
    (select coalesce(sum(amount - least(discount, amount)), 0)::bigint total from invoice_items where invoice_id = p_invoice) t,
    (select coalesce(sum(amount), 0)::bigint paid from receipts where invoice_id = p_invoice and voided_at is null) p
$$;

create or replace function app.refresh_invoice_status(p_invoice uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t record;
begin
  select * into t from app.invoice_totals(p_invoice);
  update invoices set status = case when t.paid <= 0 then 'ISSUED' when t.remaining > 0 then 'PARTIAL' else 'PAID' end
   where id = p_invoice and status <> 'VOID';
end $$;

-- Tạo phiếu thu. p_items: [{"category":"tuition|uniform|shoes|other","amount":1350000,"discount":0,"description":"…"}]
-- Khoản "tặng" = discount bằng amount.
create or replace function public.create_invoice(p_student uuid, p_enrollment uuid, p_due_date date, p_items jsonb, p_note text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare s students; e enrollments; v_id uuid; it jsonb; v_amt bigint; v_disc bigint; v_cat text; n int := 0;
begin
  select * into s from students where id = p_student;
  if not found or not app.has_branch_role(s.primary_branch_id, '{BRANCH_MANAGER,ACCOUNTANT}') then perform app.forbid(); end if;
  if p_enrollment is not null then
    select * into e from enrollments where id = p_enrollment;
    if not found or e.student_id <> p_student then raise exception 'Đăng ký không thuộc học viên này'; end if;
  end if;
  -- client gửi JSON dạng chuỗi (postgres.js tham số text) -> giải mã một lần
  if jsonb_typeof(p_items) = 'string' then p_items := (p_items #>> '{}')::jsonb; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Danh sách khoản thu không hợp lệ'; end if;
  insert into invoices (branch_id, student_id, enrollment_id, course_id, due_date, status, note, created_by)
  values (s.primary_branch_id, p_student, p_enrollment, e.course_id, p_due_date, 'ISSUED',
          nullif(left(trim(coalesce(p_note, '')), 500), ''), auth.uid())
  returning id into v_id;
  for it in select * from jsonb_array_elements(p_items) loop
    v_cat := it->>'category';
    if v_cat is null or v_cat not in ('tuition','uniform','shoes','other') then raise exception 'Loại khoản thu không hợp lệ'; end if;
    v_amt := coalesce((it->>'amount')::bigint, 0);
    v_disc := coalesce((it->>'discount')::bigint, 0);
    if v_amt < 0 or v_amt > 100000000 or v_disc < 0 or v_disc > v_amt then raise exception 'Số tiền không hợp lệ'; end if;
    continue when v_amt = 0 and coalesce(trim(it->>'description'), '') = '';
    insert into invoice_items (invoice_id, category, amount, discount, description)
    values (v_id, v_cat, v_amt, v_disc, nullif(left(trim(coalesce(it->>'description', '')), 200), ''));
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Nhập ít nhất một khoản phải thu'; end if;
  perform app.audit('CREATE', 'invoice', v_id, s.primary_branch_id,
    jsonb_build_object('student', p_student, 'total', (app.invoice_totals(v_id)).total));
  return v_id;
end $$;

create or replace function public.add_receipt(p_invoice uuid, p_amount bigint, p_paid_on date,
  p_method text default 'CASH', p_note text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare i invoices; v_id uuid; t record;
begin
  select * into i from invoices where id = p_invoice for update;
  if not found or not app.has_branch_role(i.branch_id, '{BRANCH_MANAGER,ACCOUNTANT}') then perform app.forbid(); end if;
  if i.status = 'VOID' then raise exception 'Phiếu thu đã hủy'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000 then raise exception 'Số tiền không hợp lệ'; end if;
  if p_paid_on is null or p_paid_on > app.vn_today() then raise exception 'Ngày thanh toán không hợp lệ'; end if;
  if coalesce(p_method, 'CASH') not in ('CASH','TRANSFER','OTHER') then raise exception 'Hình thức thanh toán không hợp lệ'; end if;
  select * into t from app.invoice_totals(p_invoice);
  if p_amount > t.remaining then raise exception 'Số tiền vượt số còn phải thu (% đ)', t.remaining; end if;
  insert into receipts (invoice_id, branch_id, student_id, amount, paid_on, method, note, created_by)
  values (i.id, i.branch_id, i.student_id, p_amount, p_paid_on, coalesce(p_method, 'CASH'),
          nullif(left(trim(coalesce(p_note, '')), 300), ''), auth.uid())
  returning id into v_id;
  perform app.refresh_invoice_status(i.id);
  perform app.audit('CREATE', 'receipt', v_id, i.branch_id, jsonb_build_object('invoice', i.id, 'amount', p_amount));
  return v_id;
end $$;

create or replace function public.void_receipt(p_receipt uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare r receipts;
begin
  select * into r from receipts where id = p_receipt for update;
  if not found or not app.has_branch_role(r.branch_id, '{BRANCH_MANAGER,ACCOUNTANT}') then perform app.forbid(); end if;
  if r.voided_at is not null then raise exception 'Lần thu này đã hủy'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Cần lý do hủy'; end if;
  update receipts set voided_at = now(), voided_by = auth.uid(), void_reason = left(trim(p_reason), 300) where id = r.id;
  perform app.refresh_invoice_status(r.invoice_id);
  perform app.audit('VOID', 'receipt', r.id, r.branch_id, jsonb_build_object('amount', r.amount, 'reason', left(trim(p_reason), 300)));
end $$;

create or replace function public.void_invoice(p_invoice uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare i invoices;
begin
  select * into i from invoices where id = p_invoice for update;
  if not found or not app.has_branch_role(i.branch_id, '{BRANCH_MANAGER,ACCOUNTANT}') then perform app.forbid(); end if;
  if i.status = 'VOID' then return; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Cần lý do hủy'; end if;
  if exists (select 1 from receipts where invoice_id = i.id and voided_at is null) then
    raise exception 'Phiếu đã có lần thu tiền, hãy hủy các lần thu trước';
  end if;
  update invoices set status = 'VOID', void_reason = left(trim(p_reason), 300) where id = i.id;
  perform app.audit('VOID', 'invoice', i.id, i.branch_id, jsonb_build_object('reason', left(trim(p_reason), 300)));
end $$;

-- Tổng hợp tiền theo học viên (cho danh sách / hồ sơ). Chỉ trả số liệu người gọi được xem (RLS qua security invoker).
create or replace view public.student_balances with (security_invoker = true) as
  select i.student_id,
         sum(t.total)::bigint total, sum(t.paid)::bigint paid, sum(t.remaining)::bigint remaining
  from invoices i cross join lateral app.invoice_totals(i.id) t
  where i.status <> 'VOID'
  group by i.student_id;
grant select on public.student_balances to authenticated;

revoke execute on function public.create_invoice(uuid, uuid, date, jsonb, text), public.add_receipt(uuid, bigint, date, text, text),
  public.void_receipt(uuid, text), public.void_invoice(uuid, text) from public, anon;
grant execute on function public.create_invoice(uuid, uuid, date, jsonb, text), public.add_receipt(uuid, bigint, date, text, text),
  public.void_receipt(uuid, text), public.void_invoice(uuid, text) to authenticated;
grant execute on function app.invoice_totals(uuid) to authenticated;
revoke execute on function app.refresh_invoice_status(uuid) from public, anon;

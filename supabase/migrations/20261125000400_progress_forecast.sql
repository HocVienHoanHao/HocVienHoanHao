-- Mục 5.1: Tiến độ buổi học theo ngày chốt, mốc tháng học và dự báo ngày kết thúc.
-- Nguyên tắc: chỉ đếm dữ liệu đã xác nhận có ngày thực tế <= as_of_date; ngày dự kiến = ngày của buổi
-- đủ điều kiện thứ n trong lịch tương lai. KHÔNG cộng cứng 30/60/90 ngày; thiếu lịch -> 'INSUFFICIENT_SCHEDULE'.
-- Các hàm chỉ đọc (STABLE), không ghi ngày dự kiến/số dư vào bảng; hạn hóa đơn không bị đụng tới.

-- ---------------------------------------------------------------- lịch tương lai
-- Trả về các buổi đủ điều kiện sau ngày chốt của một lớp, theo thứ tự thời gian (ngày, giờ, id).
-- p_weekdays: lịch cá nhân (ISO weekday) hoặc null; p_from/p_until: khoảng hiệu lực quyền học.
create or replace function app.future_sessions(
  p_class uuid, p_as_of date, p_weekdays int[], p_from date, p_until date)
returns table (session_date date, session_id uuid, is_estimate boolean, is_pending_today boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_last date; v_end date; v_weekdays int[]; v_enabled boolean;
begin
  return query
  select app.session_date(s), s.id, false,
         (s.status = 'scheduled' and app.session_date(s) = p_as_of)
  from sessions s
  where s.class_id = p_class and s.status <> 'cancelled'
    and (app.session_date(s) > p_as_of
         -- buổi hôm nay chưa xác nhận: được đưa vào lịch dự kiến, gắn cờ "chờ xác nhận"
         or (s.status = 'scheduled' and app.session_date(s) = p_as_of and p_as_of = app.vn_today()))
    and (p_weekdays is null or extract(isodow from app.session_date(s))::int = any(p_weekdays))
    and (p_from is null or app.session_date(s) >= p_from)
    and (p_until is null or app.session_date(s) <= p_until)
  order by app.session_date(s), coalesce(s.actual_start, s.scheduled_start), s.id;

  -- Ước tính theo lịch lặp: chỉ khi quản lý đã duyệt policy và khóa có ngày kết thúc kế hoạch.
  v_enabled := coalesce((app.policy_value('forecast.recurring_estimate') ->> 'enabled')::boolean, false);
  if not v_enabled then return; end if;
  select coalesce(p_weekdays, (select array_agg(x::int) from jsonb_array_elements_text(c.schedule -> 'weekdays') x)),
         co.end_date
    into v_weekdays, v_end
  from classes c join courses co on co.id = c.course_id where c.id = p_class;
  if v_weekdays is null or v_end is null then return; end if;
  if p_until is not null then v_end := least(v_end, p_until); end if;
  select max(app.session_date(s)) into v_last from sessions s where s.class_id = p_class;
  return query
  select d::date, null::uuid, true, false
  from generate_series(greatest(coalesce(v_last, p_as_of), p_as_of, coalesce(p_from, p_as_of)) + 1, v_end, interval '1 day') d
  where extract(isodow from d)::int = any(v_weekdays)
    and not exists (select 1 from sessions s where s.class_id = p_class and app.session_date(s) = d::date)
  order by d;
end $$;

-- ---------------------------------------------------------------- mốc
-- p_done[k] = ngày của lượt thứ k đã đạt; p_future[n] = ngày buổi đủ điều kiện thứ n.
create or replace function app.eval_milestones(
  p_targets int[], p_progress int, p_done date[], p_future date[], p_future_est boolean[])
returns jsonb language plpgsql immutable as $$
declare
  v_out jsonb := '[]'; i int; t int; v_need int; v_status text; v_actual date; v_est date;
begin
  if p_targets is null then return v_out; end if;
  for i in 1 .. coalesce(cardinality(p_targets), 0) loop
    t := p_targets[i]; v_actual := null; v_est := null;
    if p_progress is null then
      v_status := 'NO_DATA';
    elsif p_progress >= t then
      v_status := 'REACHED'; v_actual := p_done[t];
    else
      v_need := t - p_progress;
      if v_need <= coalesce(cardinality(p_future), 0) then
        v_est := p_future[v_need];
        v_status := case when p_future_est[v_need] then 'ESTIMATED_RECURRING' else 'FORECAST' end;
      else
        v_status := 'INSUFFICIENT_SCHEDULE';
      end if;
    end if;
    v_out := v_out || jsonb_build_object(
      'month', i, 'target', t, 'status', v_status,
      'remaining', case when p_progress is null then null else greatest(t - p_progress, 0) end,
      'actual_date', v_actual, 'estimated_date', v_est);
  end loop;
  return v_out;
end $$;

create or replace function app.current_milestone(p_milestones jsonb) returns jsonb
language sql immutable as $$
  select coalesce(
    (select m from jsonb_array_elements(p_milestones) m where m ->> 'status' <> 'REACHED'
      order by (m ->> 'month')::int limit 1),
    'null'::jsonb)
$$;

create or replace function app.forecast_label(p_status text) returns text
language sql immutable as $$
  select case p_status
    when 'REACHED' then 'Đã đạt'
    when 'FORECAST' then 'Dự kiến theo lịch đã xác nhận'
    when 'ESTIMATED_RECURRING' then 'Ước tính theo lịch lặp'
    when 'INSUFFICIENT_SCHEDULE' then 'Chưa đủ lịch để dự báo'
    when 'NO_DATA' then 'Chưa đủ dữ liệu'
    when 'EXHAUSTED' then 'Đã hết quyền học'
    when 'NO_MILESTONES' then 'Gói không có mốc tháng'
    else p_status end
$$;

-- ---------------------------------------------------------------- class_progress
create or replace function public.class_progress(p_class_id uuid, p_as_of_date date default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  c classes; co courses; v_as_of date := coalesce(p_as_of_date, app.vn_today());
  v_done date[]; v_completed int; v_last date; v_fut date[]; v_fut_est boolean[]; v_pending_today int;
  v_unconfirmed int; v_milestones jsonb; v_course jsonb; v_updated timestamptz; v_cur jsonb; v_warnings jsonb := '[]';
begin
  if not app.can_view_class(p_class_id) then perform app.forbid(); end if;
  select * into c from classes where id = p_class_id;
  select * into co from courses where id = c.course_id;

  select coalesce(array_agg(app.vn_date(s.actual_start) order by s.actual_start, s.id), '{}'), count(*),
         max(app.vn_date(s.actual_start))
    into v_done, v_completed, v_last
  from sessions s
  where s.class_id = c.id and s.status = 'completed' and app.vn_date(s.actual_start) <= v_as_of;

  select coalesce(array_agg(f.session_date order by f.ord), '{}'), coalesce(array_agg(f.is_estimate order by f.ord), '{}'),
         count(*) filter (where f.is_pending_today)
    into v_fut, v_fut_est, v_pending_today
  from (select fs.*, row_number() over () ord from app.future_sessions(c.id, v_as_of, null, null, null) fs) f;

  -- buổi đã qua ngày theo lịch nhưng chưa xác nhận tổ chức/hủy -> dự báo chưa đáng tin
  select count(*) into v_unconfirmed from sessions s
  where s.class_id = c.id and s.status = 'scheduled' and app.vn_date(s.scheduled_start) <= v_as_of
    and not (app.vn_date(s.scheduled_start) = v_as_of and v_as_of = app.vn_today());

  v_milestones := app.eval_milestones(c.monthly_session_targets, v_completed, v_done, v_fut, v_fut_est);
  v_course := app.eval_milestones(array[c.planned_session_count], v_completed, v_done, v_fut, v_fut_est) -> 0;
  v_cur := app.current_milestone(v_milestones);

  if v_completed > c.planned_session_count then
    v_warnings := v_warnings || jsonb_build_object('code', 'OVER_PLAN',
      'message', format('Lớp đã tổ chức %s buổi, vượt kế hoạch %s buổi', v_completed, c.planned_session_count));
  end if;
  if v_unconfirmed > 0 then
    v_warnings := v_warnings || jsonb_build_object('code', 'UNCONFIRMED_SESSIONS',
      'message', format('%s buổi đã qua lịch nhưng chưa xác nhận tổ chức/hủy', v_unconfirmed));
  end if;

  select greatest(max(s.updated_at), (select max(a.updated_at) from attendance a join sessions s2 on s2.id = a.session_id where s2.class_id = c.id))
    into v_updated from sessions s where s.class_id = c.id;

  return jsonb_build_object(
    'class_id', c.id, 'class_name', c.name, 'branch_id', c.branch_id, 'course_id', c.course_id,
    'course_code', co.code, 'course_name', co.name,
    'as_of_date', v_as_of, 'generated_at', app.clock_now(),
    'class_completed_sessions', v_completed,
    'class_target_sessions', c.planned_session_count,
    'class_remaining_sessions', greatest(c.planned_session_count - v_completed, 0),
    'last_class_session_date', v_last,
    'current_month', case when v_cur = 'null'::jsonb then null else (v_cur ->> 'month')::int end,
    'current_month_milestone', v_cur,
    'milestones', v_milestones,
    'course_end', v_course || jsonb_build_object('planned_end_date', co.end_date),
    'future_sessions_known', cardinality(v_fut) - coalesce((select count(*) from unnest(v_fut_est) x where x), 0),
    'pending_today_sessions', v_pending_today,
    'unconfirmed_past_sessions', v_unconfirmed,
    'forecast_reliable', v_unconfirmed = 0,
    'warnings', v_warnings,
    'updated_at', v_updated);
end $$;

-- Tiến độ khóa = danh sách tiến độ từng lớp (không cộng buổi của nhiều lớp thành một khóa)
create or replace function public.course_progress(p_course_id uuid, p_as_of_date date default null)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'course_id', p_course_id,
    'as_of_date', coalesce(p_as_of_date, app.vn_today()),
    'classes', coalesce(jsonb_agg(public.class_progress(c.id, p_as_of_date) order by c.name), '[]'),
    'classes_total', count(*),
    'classes_completed', count(*) filter (where
        (public.class_progress(c.id, p_as_of_date) ->> 'class_completed_sessions')::int >= c.planned_session_count))
  from classes c where c.course_id = p_course_id and app.can_view_class(c.id)
$$;

-- ---------------------------------------------------------------- student_progress
create or replace function public.student_progress(p_enrollment_id uuid, p_as_of_date date default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  e enrollments; c classes; st students; v_as_of date := coalesce(p_as_of_date, app.vn_today());
  v_has_data boolean; v_staff boolean;
  v_class_total int; v_class_since int; v_last_class date;
  v_present int; v_excused int; v_unexcused int; v_trial int; v_not_marked int;
  v_present_dates date[]; v_last_attended date; v_last_update timestamptz;
  v_charged int; v_charged_dates date[]; v_granted int; v_transfer_in int; v_transfer_out int;
  v_available int; v_carry int; v_expired int;
  v_until date; v_min_until date;
  v_sfut date[]; v_sfut_est boolean[]; v_cfut date[]; v_cfut_est boolean[];
  v_study jsonb; v_charge_ms jsonb; v_package jsonb; v_exhaust jsonb; v_cur jsonb;
  v_unconfirmed int; v_warnings jsonb := '[]'; v_alert text; v_due date; v_need int; v_until_count int;
begin
  if not app.can_view_enrollment(p_enrollment_id) then perform app.forbid(); end if;
  select * into e from enrollments where id = p_enrollment_id;
  select * into c from classes where id = e.class_id;
  select * into st from students where id = e.student_id;
  v_staff := app.staff_can_view_class(c.id);

  -- dữ liệu điểm danh có đủ từ ngày bắt đầu học không?
  v_has_data := c.attendance_tracked_from is not null and c.attendance_tracked_from <= e.start_date;

  -- tiến độ lớp (để đối chiếu)
  select count(*), count(*) filter (where app.vn_date(s.actual_start) >= e.start_date), max(app.vn_date(s.actual_start))
    into v_class_total, v_class_since, v_last_class
  from sessions s where s.class_id = c.id and s.status = 'completed' and app.vn_date(s.actual_start) <= v_as_of;

  -- điểm danh phân bổ vào đăng ký này (gồm học bù ở lớp khác nếu được phân bổ)
  select count(distinct a.session_id) filter (where a.status = 'PRESENT'),
         count(distinct a.session_id) filter (where a.status = 'ABSENT_EXCUSED'),
         count(distinct a.session_id) filter (where a.status = 'ABSENT_UNEXCUSED'),
         count(distinct a.session_id) filter (where a.status = 'TRIAL'),
         coalesce(array_agg(app.vn_date(s.actual_start) order by s.actual_start, s.id) filter (where a.status = 'PRESENT'), '{}'),
         max(app.vn_date(s.actual_start)) filter (where a.status = 'PRESENT')
    into v_present, v_excused, v_unexcused, v_trial, v_present_dates, v_last_attended
  from attendance a join sessions s on s.id = a.session_id
  where a.enrollment_id = e.id and a.confirmed_at is not null and s.status = 'completed'
    and app.vn_date(s.actual_start) between e.start_date and v_as_of;

  select count(*) into v_not_marked from sessions s
  where s.class_id = c.id and s.status = 'completed'
    and app.vn_date(s.actual_start) between e.start_date and v_as_of
    and not exists (select 1 from attendance a where a.session_id = s.id and a.student_id = e.student_id
                    and a.status <> 'NOT_MARKED' and a.confirmed_at is not null);

  select max(a.updated_at) into v_last_update from attendance a where a.enrollment_id = e.id;

  -- ledger tại ngày chốt
  select coalesce(-sum(l.signed_delta) filter (where l.event_type in ('CONSUME','REVERSAL')), 0),
         coalesce(sum(l.signed_delta) filter (where l.event_type = 'GRANT'), 0),
         coalesce(sum(l.signed_delta) filter (where l.event_type = 'TRANSFER_IN'), 0),
         coalesce(-sum(l.signed_delta) filter (where l.event_type = 'TRANSFER_OUT'), 0)
    into v_charged, v_granted, v_transfer_in, v_transfer_out
  from session_ledger l where l.enrollment_id = e.id and l.effective_date <= v_as_of;

  select coalesce(sum(b.bal) filter (where b.valid), 0),
         coalesce(sum(b.bal) filter (where b.valid and b.source = 'CARRYOVER'), 0),
         coalesce(sum(b.bal) filter (where not b.valid), 0),
         case when bool_and(b.valid_until is not null) filter (where b.valid and b.bal > 0)
              then max(b.valid_until) filter (where b.valid and b.bal > 0) end,
         min(b.valid_until) filter (where b.valid and b.bal > 0)
    into v_available, v_carry, v_expired, v_until, v_min_until
  from (select en.source, en.valid_until,
               (en.valid_until is null or en.valid_until >= v_as_of) as valid,
               coalesce((select sum(l.signed_delta) from session_ledger l
                         where l.entitlement_id = en.id and l.effective_date <= v_as_of), 0) as bal
        from entitlements en where en.enrollment_id = e.id and en.granted_at <= v_as_of) b;

  -- ngày của từng lượt trừ ròng (không tính lượt đã đảo)
  select coalesce(array_agg(l.effective_date order by l.effective_date, s.actual_start, l.id), '{}')
    into v_charged_dates
  from session_ledger l left join sessions s on s.id = l.session_id
  where l.enrollment_id = e.id and l.event_type = 'CONSUME' and l.effective_date <= v_as_of
    and not exists (select 1 from session_ledger r where r.source_entry_id = l.id and r.event_type = 'REVERSAL');

  -- lịch tương lai cho học viên: dự báo học thực tế bỏ mọi ngày nghỉ đã duyệt;
  -- dự báo hết quyền chỉ bỏ ngày nghỉ không trừ buổi.
  select coalesce(array_agg(f.session_date order by f.ord) filter (where not f.on_leave), '{}'),
         coalesce(array_agg(f.is_estimate order by f.ord) filter (where not f.on_leave), '{}'),
         coalesce(array_agg(f.session_date order by f.ord) filter (where not f.on_free_leave), '{}'),
         coalesce(array_agg(f.is_estimate order by f.ord) filter (where not f.on_free_leave), '{}')
    into v_sfut, v_sfut_est, v_cfut, v_cfut_est
  from (select fs.*, row_number() over () ord,
               exists (select 1 from student_leaves sl where sl.student_id = e.student_id and sl.status = 'APPROVED'
                       and fs.session_date between sl.from_date and sl.to_date) as on_leave,
               exists (select 1 from student_leaves sl where sl.student_id = e.student_id and sl.status = 'APPROVED'
                       and not sl.charge and fs.session_date between sl.from_date and sl.to_date) as on_free_leave
        from app.future_sessions(c.id, v_as_of, e.schedule_weekdays, e.start_date, v_until) fs) f;

  select count(*) into v_unconfirmed from sessions s
  where s.class_id = c.id and s.status = 'scheduled' and app.vn_date(s.scheduled_start) between e.start_date and v_as_of
    and not (app.vn_date(s.scheduled_start) = v_as_of and v_as_of = app.vn_today());

  if not v_has_data then
    v_present := null; v_excused := null; v_unexcused := null; v_trial := null; v_not_marked := null;
    v_charged := null; v_available := null; v_carry := null;
    v_warnings := v_warnings || jsonb_build_object('code', 'NO_ATTENDANCE_DATA',
      'message', 'Chưa nhập/đối chiếu điểm danh từ ngày bắt đầu học: Chưa đủ dữ liệu');
  end if;

  v_study := app.eval_milestones(e.snapshot_milestones, v_present, v_present_dates, v_sfut, v_sfut_est);
  v_charge_ms := app.eval_milestones(e.snapshot_milestones, v_charged, v_charged_dates, v_cfut, v_cfut_est);
  v_cur := app.current_milestone(v_study);
  if e.snapshot_billing_type = 'PACKAGE' and e.snapshot_quota is not null then
    v_package := app.eval_milestones(array[e.snapshot_quota], v_present, v_present_dates, v_sfut, v_sfut_est) -> 0;
  end if;

  -- dự báo hết quyền học: buổi thứ <available> trong lịch phù hợp
  if v_available is null then
    v_exhaust := jsonb_build_object('status', 'NO_DATA');
  elsif v_available <= 0 then
    v_exhaust := jsonb_build_object('status', 'EXHAUSTED', 'actual_date', v_charged_dates[cardinality(v_charged_dates)]);
  elsif v_available <= cardinality(v_cfut) then
    v_exhaust := jsonb_build_object('status', case when v_cfut_est[v_available] then 'ESTIMATED_RECURRING' else 'FORECAST' end,
                                    'estimated_date', v_cfut[v_available], 'sessions_needed', v_available);
  else
    v_exhaust := jsonb_build_object('status', 'INSUFFICIENT_SCHEDULE', 'sessions_needed', v_available,
                                    'sessions_scheduled', cardinality(v_cfut));
  end if;
  v_exhaust := v_exhaust || jsonb_build_object('label', app.forecast_label(v_exhaust ->> 'status'));

  -- rủi ro: còn buổi nhưng quyền hết hạn trước khi kịp dùng
  if v_min_until is not null and v_available > 0 then
    select count(*) into v_until_count from app.future_sessions(c.id, v_as_of, e.schedule_weekdays, e.start_date, v_min_until);
    if v_until_count < v_available then
      v_warnings := v_warnings || jsonb_build_object('code', 'EXPIRY_RISK', 'valid_until', v_min_until,
        'message', format('Quyền học hết hiệu lực ngày %s, chỉ còn %s buổi phù hợp cho %s buổi còn lại',
                          to_char(v_min_until, 'DD/MM/YYYY'), v_until_count, v_available));
    end if;
  end if;
  if v_expired > 0 then
    v_warnings := v_warnings || jsonb_build_object('code', 'EXPIRED_BALANCE',
      'message', format('%s buổi thuộc quyền học đã hết hiệu lực', v_expired));
  end if;
  if v_present is not null and v_charged is not null and v_present <> v_charged then
    v_warnings := v_warnings || jsonb_build_object('code', 'PRESENT_CHARGED_DIFFER',
      'message', format('Số buổi có mặt (%s) khác số buổi đã trừ (%s) theo chính sách', v_present, v_charged));
  end if;
  if v_unconfirmed > 0 or coalesce(v_not_marked, 0) > 0 then
    v_warnings := v_warnings || jsonb_build_object('code', 'UNRELIABLE_FORECAST',
      'message', 'Có buổi chưa xác nhận hoặc chưa điểm danh; dự báo chưa đáng tin cậy');
  end if;

  v_alert := case when v_available is null then null
                  when v_available <= 0 then 'RENEW_0' when v_available <= 1 then 'RENEW_1'
                  when v_available <= 3 then 'RENEW_3' end;

  select min(i.due_date) into v_due from invoices i
  where i.enrollment_id = e.id and i.status in ('ISSUED','PARTIAL')
    and (v_staff and app.has_branch_role(e.branch_id, '{BRANCH_MANAGER,ACCOUNTANT}') or app.guardian_can_view_finance(e.student_id));

  return jsonb_build_object(
    'enrollment_id', e.id, 'student_id', st.id, 'student_code', st.student_code, 'student_name', st.full_name,
    'class_id', c.id, 'class_name', c.name, 'branch_id', e.branch_id, 'course_id', e.course_id,
    'start_date', e.start_date, 'enrollment_status', e.status,
    'billing_type', e.snapshot_billing_type, 'quota', e.snapshot_quota, 'months', e.snapshot_months,
    'as_of_date', v_as_of, 'generated_at', app.clock_now(),
    'data_status', case when not v_has_data then 'NO_DATA'
                        when v_unconfirmed > 0 or v_not_marked > 0 then 'PENDING_CONFIRMATION'
                        else 'OK' end,
    'class_completed_sessions', v_class_total,
    'class_sessions_since_join', v_class_since,
    'present_sessions', v_present,
    'absent_excused', v_excused, 'absent_unexcused', v_unexcused, 'trial', v_trial,
    'not_marked', v_not_marked,
    'charged_sessions', v_charged,
    'granted_sessions', case when v_has_data then v_granted + v_transfer_in end,
    'transferred_out', case when v_has_data then v_transfer_out end,
    'available_sessions', v_available,
    'carryover_available', v_carry,
    'last_class_session_date', v_last_class,
    'last_attended_date', v_last_attended,
    'last_attendance_update_at', v_last_update,
    'current_month', case when v_cur = 'null'::jsonb then null else (v_cur ->> 'month')::int end,
    'current_month_milestone', v_cur,
    'study_milestones', v_study,
    'entitlement_milestones', v_charge_ms,
    'package_end', v_package,
    'entitlement_exhaustion', v_exhaust,
    'valid_until', v_min_until,
    'renewal_alert', v_alert,
    'invoice_due_date', v_due,
    'forecast_reliable', v_has_data and v_unconfirmed = 0 and coalesce(v_not_marked, 0) = 0,
    'warnings', v_warnings);
end $$;

-- Danh sách tiến độ học viên theo phạm vi quyền (dùng cho bảng học viên/export)
create or replace function public.student_progress_list(
  p_as_of_date date default null, p_branch_id uuid default null, p_course_id uuid default null, p_class_id uuid default null)
returns setof jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select public.student_progress(e.id, p_as_of_date)
  from enrollments e join students s on s.id = e.student_id
  where e.status in ('CONFIRMED','COMPLETED','TRANSFERRED')
    and (p_branch_id is null or e.branch_id = p_branch_id)
    and (p_course_id is null or e.course_id = p_course_id)
    and (p_class_id is null or e.class_id = p_class_id)
    and app.can_view_enrollment(e.id)
    -- phụ huynh không được liệt kê cả lớp: can_view_enrollment chỉ trả con của mình
  order by s.full_name, e.start_date
$$;

revoke execute on function public.class_progress, public.course_progress, public.student_progress,
  public.student_progress_list from public, anon;
grant execute on function public.class_progress, public.course_progress, public.student_progress,
  public.student_progress_list to authenticated;
revoke execute on function app.future_sessions(uuid, date, int[], date, date) from public, authenticated;

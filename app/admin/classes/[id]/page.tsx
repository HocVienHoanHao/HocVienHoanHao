import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { asUser } from "@/lib/db";
import { fmtDate, fmtDateTime, isIsoDate, todayVn } from "@/lib/format";
import { classProgress } from "@/lib/progress";
import { isStaff, requireViewer } from "@/lib/session";
import { StaffShell } from "@/components/StaffShell";
import { Flash, MilestoneDate, ProgressBar, StatusBadge, Warnings } from "@/components/ui";
import { cancelSessionAction, generateSessionsAction, makeupSessionAction, rescheduleSessionAction } from "@/lib/actions/schedule";

export const dynamic = "force-dynamic";

const ATT_LABEL: Record<string, string> = {
  PRESENT: "Có mặt", ABSENT_EXCUSED: "Nghỉ có phép", ABSENT_UNEXCUSED: "Nghỉ không phép", TRIAL: "Học thử", NOT_MARKED: "Chưa điểm danh",
};
const SESSION_LABEL: Record<string, string> = { scheduled: "Theo lịch", completed: "Đã tổ chức", cancelled: "Đã hủy" };

export default async function ClassDetail({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ asOf?: string; session?: string; ok?: string; err?: string }>;
}) {
  const viewer = await requireViewer();
  if (!isStaff(viewer) && !viewer.roles.some((r) => r.role === "COACH")) redirect("/");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const asOf = isIsoDate(sp.asOf) ? sp.asOf : todayVn();

  const data = await asUser(viewer.id, async (tx) => {
    const [cls] = await tx<{ id: string; branch_id: string }[]>`select id, branch_id from classes where id = ${id}`;
    if (!cls) return null;
    const p = await classProgress(tx, id, asOf);
    const sessions = await tx<{ id: string; d: string; status: string; actual_start: string | null; scheduled_start: string; replacement: boolean; has_makeup: boolean; present: number; marked: number; cancel_reason: string | null; at: string }[]>`
      select s.id, app.session_date(s)::text d, s.status::text, s.actual_start, s.scheduled_start,
             s.replacement_for_session_id is not null replacement, s.cancel_reason,
             exists (select 1 from sessions r where r.replacement_for_session_id = s.id) has_makeup,
             to_char(s.scheduled_start at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD"T"HH24:MI') at,
             count(a.*) filter (where a.status = 'PRESENT')::int present,
             count(a.*) filter (where a.status <> 'NOT_MARKED')::int marked
      from sessions s left join attendance a on a.session_id = s.id
      where s.class_id = ${id}
      group by s.id order by app.session_date(s), coalesce(s.actual_start, s.scheduled_start), s.id`;
    const roster = sp.session && /^[0-9a-f-]{36}$/i.test(sp.session)
      ? await tx<{ code: string; name: string; status: string | null; charge: string | null; confirmed_at: string | null }[]>`
          select st.student_code code, st.full_name name, a.status::text status, a.charge_decision::text charge, a.confirmed_at
          from sessions s
          join enrollments e on e.class_id = s.class_id and e.status in ('CONFIRMED','COMPLETED','TRANSFERRED') and e.start_date <= app.session_date(s)
          join students st on st.id = e.student_id
          left join attendance a on a.session_id = s.id and a.student_id = st.id
          where s.id = ${sp.session} order by st.full_name`
      : null;
    return { p, sessions, roster, branchId: cls.branch_id };
  });
  if (!data) notFound();
  const { p, sessions, roster, branchId } = data;
  // chỉ để ẩn/hiện nút; quyền thật do RPC kiểm tra
  const canManage = viewer.isSuperAdmin || viewer.roles.some((r) => r.role === "BRANCH_MANAGER" && r.branchId === branchId);
  const today = todayVn();
  // số thứ tự buổi đã tổ chức tính đến ngày chốt (theo ngày giờ thực tế rồi ID — đã sắp ở SQL)
  const order = new Map<string, number>();
  for (const s of sessions) if (s.status === "completed" && s.d <= asOf) order.set(s.id, order.size + 1);

  return (
    <StaffShell viewer={viewer}>
      <Link href={`/admin?asOf=${asOf}`} className="text-sm text-brand">← Tổng quan</Link>
      <h1 className="mt-1 text-xl font-bold text-navy">{p.class_name}</h1>
      <p className="text-sm text-slate-500">{p.course_name} · ngày chốt {fmtDate(asOf)} · cập nhật {fmtDateTime(p.updated_at)}</p>
      <form method="get" className="my-3 flex items-end gap-2">
        <label className="flex flex-col gap-1"><span className="label">Ngày chốt</span><input type="date" name="asOf" defaultValue={asOf} className="input" /></label>
        <button className="btn">Xem</button>
      </form>

      <Flash ok={sp.ok} err={sp.err} />

      <div className="grid gap-3 lg:grid-cols-3">
        <section className="card lg:col-span-1">
          <div className="text-3xl font-extrabold text-navy">{p.class_completed_sessions}/{p.class_target_sessions}</div>
          <div className="text-sm text-slate-500">buổi đã tổ chức · còn {p.class_remaining_sessions}</div>
          <div className="mt-2"><ProgressBar value={p.class_completed_sessions} max={p.class_target_sessions} label="Tiến độ lớp" /></div>
          <dl className="mt-3 space-y-2 text-sm">
            <div><dt className="label">Buổi gần nhất</dt><dd>{fmtDate(p.last_class_session_date)}</dd></div>
            <div><dt className="label">Tháng học hiện tại</dt><dd>{p.current_month ? `Tháng ${p.current_month}` : "Đã hoàn thành kế hoạch"}</dd></div>
            <div><dt className="label">Kết thúc khóa (dự kiến/thực tế)</dt><dd><MilestoneDate m={p.course_end} /></dd></div>
            <div><dt className="label">Kết thúc khóa theo kế hoạch</dt><dd>{fmtDate(p.course_end.planned_end_date)}</dd></div>
            <div><dt className="label">Buổi tương lai đã có lịch</dt><dd>{p.future_sessions_known}</dd></div>
          </dl>
          <Warnings items={p.warnings} />
        </section>
        <section className="card overflow-x-auto lg:col-span-2">
          <h2 className="mb-2 font-semibold text-navy">Mốc tháng học (theo số buổi, không theo tháng dương lịch)</h2>
          <table className="min-w-full">
            <thead><tr><th>Tháng</th><th>Mốc</th><th>Trạng thái</th><th>Ngày kết thúc</th><th>Còn</th></tr></thead>
            <tbody>
              {p.milestones.map((m) => (
                <tr key={m.month} className="border-t border-slate-100">
                  <td>Tháng {m.month}</td><td>{m.target} buổi</td><td><StatusBadge status={m.status} /></td>
                  <td><MilestoneDate m={m} /></td><td>{m.remaining ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="card mt-3 overflow-x-auto">
        <h2 className="mb-2 font-semibold text-navy">Lịch buổi tập & điểm danh theo ngày</h2>
        {canManage && (
          <form action={generateSessionsAction} className="mb-3 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
            <input type="hidden" name="class" value={id} />
            <label className="flex flex-col gap-1"><span className="label">Tạo lịch từ ngày</span><input type="date" name="from" required defaultValue={today} className="input" /></label>
            <label className="flex flex-col gap-1"><span className="label">Đến ngày</span><input type="date" name="to" required className="input" /></label>
            <button className="btn">Tạo lịch theo thứ học của lớp</button>
            <span className="text-xs text-slate-500">Bỏ qua ngày đã có buổi (kể cả buổi đã hủy). Tối đa 200 ngày, không vượt ngày kết thúc khóa.</span>
          </form>
        )}
        <table className="min-w-full">
          <thead><tr><th>#</th><th>Ngày</th><th>Trạng thái</th><th>Có mặt</th><th>Đã điểm danh</th><th></th>{canManage && <th>Quản lý buổi</th>}</tr></thead>
          <tbody>
            {sessions.map((s) => {
              return (
                <tr key={s.id} className={`border-t border-slate-100 ${s.d > asOf ? "text-slate-400" : ""}`}>
                  <td>{order.get(s.id) ?? ""}</td>
                  <td>{fmtDate(s.d)}{s.replacement && <span className="ml-1 text-xs text-amber-700">(buổi bù)</span>}</td>
                  <td>{SESSION_LABEL[s.status]}{s.cancel_reason ? ` — ${s.cancel_reason}` : ""}</td>
                  <td>{s.status === "completed" ? s.present : ""}</td>
                  <td>{s.status === "completed" ? s.marked : ""}</td>
                  <td>{s.status !== "cancelled" && <Link className="text-brand underline" href={`?asOf=${asOf}&session=${s.id}#roster`}>Chi tiết</Link>}</td>
                  {canManage && <td><SessionActions classId={id} s={s} /></td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {roster && (
        <section id="roster" className="card mt-3 overflow-x-auto">
          <h2 className="mb-2 font-semibold text-navy">Điểm danh buổi đã chọn</h2>
          <table className="min-w-full">
            <thead><tr><th>Mã</th><th>Học viên</th><th>Trạng thái</th><th>Trừ buổi</th><th>Xác nhận lúc</th></tr></thead>
            <tbody>
              {roster.map((r) => (
                <tr key={r.code} className="border-t border-slate-100">
                  <td>{r.code}</td><td>{r.name}</td><td>{ATT_LABEL[r.status ?? "NOT_MARKED"]}</td>
                  <td>{r.charge === "CHARGED" ? "Đã trừ" : r.charge === "PENDING_NO_ENTITLEMENT" ? "Hết quyền học — cần xử lý" : "Không"}</td>
                  <td>{fmtDateTime(r.confirmed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </StaffShell>
  );
}

function SessionActions({ classId, s }: { classId: string; s: { id: string; status: string; has_makeup: boolean; at: string } }) {
  if (s.status === "scheduled") {
    return (
      <details className="text-sm">
        <summary className="cursor-pointer text-brand">Dời / hủy</summary>
        <div className="mt-2 space-y-2">
          <form action={rescheduleSessionAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="class" value={classId} /><input type="hidden" name="session" value={s.id} />
            <input type="datetime-local" name="at" required defaultValue={s.at} className="input py-1" aria-label="Giờ mới" />
            <button className="btn-ghost py-1">Dời buổi</button>
          </form>
          <form action={cancelSessionAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="class" value={classId} /><input type="hidden" name="session" value={s.id} />
            <input name="reason" required maxLength={300} placeholder="Lý do hủy (mưa, sân bận…)" className="input py-1" aria-label="Lý do hủy" />
            <button className="btn-ghost py-1 text-red-700">Hủy buổi</button>
          </form>
        </div>
      </details>
    );
  }
  if (s.status === "cancelled" && !s.has_makeup) {
    return (
      <form action={makeupSessionAction} className="flex flex-wrap items-center gap-2 text-sm">
        <input type="hidden" name="class" value={classId} /><input type="hidden" name="session" value={s.id} />
        <input type="datetime-local" name="at" required className="input py-1" aria-label="Giờ buổi bù" />
        <button className="btn-ghost py-1">Xếp buổi bù</button>
      </form>
    );
  }
  return null;
}

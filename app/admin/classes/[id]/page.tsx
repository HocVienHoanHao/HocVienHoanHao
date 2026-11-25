import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { asUser } from "@/lib/db";
import { fmtDate, fmtDateTime, isIsoDate, todayVn } from "@/lib/format";
import { classProgress } from "@/lib/progress";
import { isStaff, requireViewer } from "@/lib/session";
import { StaffShell } from "@/components/StaffShell";
import { MilestoneDate, ProgressBar, StatusBadge, Warnings } from "@/components/ui";

export const dynamic = "force-dynamic";

const ATT_LABEL: Record<string, string> = {
  PRESENT: "Có mặt", ABSENT_EXCUSED: "Nghỉ có phép", ABSENT_UNEXCUSED: "Nghỉ không phép", TRIAL: "Học thử", NOT_MARKED: "Chưa điểm danh",
};
const SESSION_LABEL: Record<string, string> = { scheduled: "Theo lịch", completed: "Đã tổ chức", cancelled: "Đã hủy" };

export default async function ClassDetail({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ asOf?: string; session?: string }>;
}) {
  const viewer = await requireViewer();
  if (!isStaff(viewer) && !viewer.roles.some((r) => r.role === "COACH")) redirect("/");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const asOf = isIsoDate(sp.asOf) ? sp.asOf : todayVn();

  const data = await asUser(viewer.id, async (tx) => {
    const [cls] = await tx`select id from classes where id = ${id}`;
    if (!cls) return null;
    const p = await classProgress(tx, id, asOf);
    const sessions = await tx<{ id: string; d: string; status: string; actual_start: string | null; scheduled_start: string; replacement: boolean; present: number; marked: number; cancel_reason: string | null }[]>`
      select s.id, app.session_date(s)::text d, s.status::text, s.actual_start, s.scheduled_start,
             s.replacement_for_session_id is not null replacement, s.cancel_reason,
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
    return { p, sessions, roster };
  });
  if (!data) notFound();
  const { p, sessions, roster } = data;
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
        <table className="min-w-full">
          <thead><tr><th>#</th><th>Ngày</th><th>Trạng thái</th><th>Có mặt</th><th>Đã điểm danh</th><th></th></tr></thead>
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

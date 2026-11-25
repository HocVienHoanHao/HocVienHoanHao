import Link from "next/link";
import { redirect } from "next/navigation";
import { asUser } from "@/lib/db";
import { fmtDate, fmtDateTime, isIsoDate, todayVn } from "@/lib/format";
import { classProgress, studentProgressList, type ClassProgress } from "@/lib/progress";
import { isStaff, requireViewer } from "@/lib/session";
import { StaffShell } from "@/components/StaffShell";
import { FilterBar } from "@/components/FilterBar";
import { EmptyState, MilestoneDate, ProgressBar, Stat, StatusBadge, Warnings } from "@/components/ui";

export const dynamic = "force-dynamic";

type Search = Promise<{ branch?: string; asOf?: string }>;

export default async function AdminDashboard({ searchParams }: { searchParams: Search }) {
  const viewer = await requireViewer();
  if (!isStaff(viewer)) redirect("/");
  const sp = await searchParams;
  const asOf = isIsoDate(sp.asOf) ? sp.asOf : todayVn();
  const branchId = sp.branch && /^[0-9a-f-]{36}$/i.test(sp.branch) ? sp.branch : null;

  const data = await asUser(viewer.id, async (tx) => {
    const branches = await tx<{ id: string; code: string; name: string }[]>`select b.id, b.code, b.name from branches b where b.status = 'ACTIVE'
      and (app.is_super_admin() or exists (select 1 from branch_memberships m where m.user_id = auth.uid() and m.active and m.branch_id = b.id))
      order by b.code`;
    const classes = await tx<{ id: string; branch_id: string }[]>`select c.id, c.branch_id from classes c join courses co on co.id = c.course_id
      where (${branchId}::uuid is null or c.branch_id = ${branchId}::uuid) order by co.start_date desc nulls last, c.name`;
    const progress: ClassProgress[] = [];
    for (const c of classes) progress.push(await classProgress(tx, c.id, asOf));
    const students = await studentProgressList(tx, asOf, { branchId });
    return { branches, progress, students };
  });

  const active = data.students.filter((s) => s.start_date <= asOf && s.enrollment_status !== "TRANSFERRED");
  const distinct = new Set(active.map((s) => s.student_id)).size;
  const byMonths = (m: number) => active.filter((s) => s.months === m).length;
  const completed36 = active.filter((s) => s.quota === 36 && (s.present_sessions ?? 0) >= 36).length;
  const onCarry = data.students.filter((s) => (s.carryover_available ?? 0) > 0).length;
  const lowBalance = active.filter((s) => s.available_sessions != null && s.available_sessions <= 3).length;
  const noData = active.filter((s) => s.data_status === "NO_DATA").length;
  const branchesWithData = new Set(data.progress.map((p) => p.branch_id));

  return (
    <StaffShell viewer={viewer}>
      <h1 className="mb-1 text-xl font-bold text-navy">Tổng quan</h1>
      <p className="mb-4 text-sm text-slate-500">Ngày chốt {fmtDate(asOf)} · số liệu tính từ dữ liệu đã xác nhận đến hết ngày chốt</p>
      <FilterBar branches={data.branches} branchId={branchId} asOf={asOf} />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Chỉ số">
        <Stat label="Học viên đang học" value={distinct} hint="Đếm không trùng học viên" />
        <Stat label="Lượt đăng ký" value={active.length} hint={`1 tháng: ${byMonths(1)} · 2 tháng: ${byMonths(2)} · 3 tháng: ${byMonths(3)}`} />
        <Stat label="Hoàn thành 36 buổi" value={completed36} hint="Theo số buổi có mặt hợp lệ" />
        <Stat label="Đang có bảo lưu" value={onCarry} />
        <Stat label="Sắp hết buổi (≤3)" value={lowBalance} hint={<Link className="text-brand underline" href={`/admin/students?asOf=${asOf}&filter=low${branchId ? `&branch=${branchId}` : ""}`}>Xem danh sách</Link>} />
        <Stat label="Chưa đủ dữ liệu điểm danh" value={noData} />
        <Stat label="Thực thu / Chi phí" value={<span className="text-base text-slate-500">Chưa có dữ liệu</span>} hint="Module thu chi: Phase 3" />
        <Stat label="Công nợ" value={<span className="text-base text-slate-500">Chưa có dữ liệu</span>} hint="Phase 3" />
      </section>

      <h2 className="mb-2 mt-6 text-lg font-bold text-navy">Tiến độ lớp / khóa</h2>
      {data.branches.filter((b) => !branchId || b.id === branchId).filter((b) => !branchesWithData.has(b.id)).map((b) => (
        <div key={b.id} className="mb-3"><EmptyState title={`${b.name}: chưa có dữ liệu`}>Chưa nhập lớp/khóa cho chi nhánh này (không tính là 0).</EmptyState></div>
      ))}
      <div className="grid gap-3 xl:grid-cols-2">
        {data.progress.map((p) => {
          const b = data.branches.find((x) => x.id === p.branch_id);
          return (
            <article key={p.class_id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-xs text-slate-500">{b?.code} · {p.course_name}</div>
                  <Link href={`/admin/classes/${p.class_id}?asOf=${asOf}`} className="text-base font-semibold text-navy hover:underline">{p.class_name}</Link>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-extrabold text-navy">{p.class_completed_sessions}/{p.class_target_sessions}</div>
                  <div className="text-xs text-slate-500">buổi đã tập · còn {p.class_remaining_sessions}</div>
                </div>
              </div>
              <div className="mt-2"><ProgressBar value={p.class_completed_sessions} max={p.class_target_sessions} label={`Tiến độ ${p.class_name}`} /></div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div><dt className="label">Buổi gần nhất</dt><dd>{fmtDate(p.last_class_session_date)}</dd></div>
                <div><dt className="label">Tháng học hiện tại</dt><dd>{p.current_month ? `Tháng ${p.current_month}` : "Đã hoàn thành"}</dd></div>
                <div><dt className="label">Kết thúc tháng hiện tại</dt><dd><MilestoneDate m={p.current_month_milestone} /></dd></div>
                <div><dt className="label">Kết thúc khóa</dt><dd><MilestoneDate m={p.course_end} /><div className="text-xs text-slate-500">Kế hoạch: {fmtDate(p.course_end.planned_end_date)}</div></dd></div>
              </dl>
              <div className="mt-2 flex flex-wrap gap-1">
                {p.milestones.map((m) => <StatusBadge key={m.month} status={m.status} label={`Mốc ${m.target}: ${m.status === "REACHED" ? fmtDate(m.actual_date) : m.estimated_date ? `~${fmtDate(m.estimated_date)}` : "chưa đủ lịch"}`} />)}
                {p.pending_today_sessions > 0 && <StatusBadge status="INSUFFICIENT_SCHEDULE" label="Buổi hôm nay chờ xác nhận" />}
              </div>
              <Warnings items={p.warnings} />
              <div className="mt-2 text-[11px] text-slate-400">Cập nhật {fmtDateTime(p.updated_at)}</div>
            </article>
          );
        })}
      </div>
    </StaffShell>
  );
}

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { asUser } from "@/lib/db";
import { fmtCount, fmtDate, todayVn } from "@/lib/format";
import { studentProgressList } from "@/lib/progress";
import { requireViewer } from "@/lib/session";
import { StaffShell } from "@/components/StaffShell";
import { EmptyState, Flash } from "@/components/ui";
import { createEnrollmentAction, createStudentAction, transferCarryoverAction } from "@/lib/actions/enrollment";

export const dynamic = "force-dynamic";

const WD = [[1, "T2"], [2, "T3"], [3, "T4"], [4, "T5"], [5, "T6"], [6, "T7"], [7, "CN"]] as const;
const ENR_LABEL: Record<string, string> = {
  DRAFT: "Nháp", CONFIRMED: "Đang học", COMPLETED: "Hoàn thành", TRANSFERRED: "Đã chuyển bảo lưu", CANCELLED: "Đã hủy",
};

export default async function EnrollmentsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const viewer = await requireViewer();
  const managed = viewer.isSuperAdmin ? null : viewer.roles.filter((r) => r.role === "BRANCH_MANAGER").map((r) => r.branchId as string);
  if (managed && managed.length === 0) redirect("/admin");
  const sp = await searchParams;
  const today = todayVn();

  const data = await asUser(viewer.id, async (tx) => {
    const inScope = (b: string) => !managed || managed.includes(b);
    const branches = (await tx<{ id: string; code: string; name: string }[]>`select id, code, name from branches order by code`).filter((b) => inScope(b.id));
    const students = (await tx<{ id: string; code: string; name: string; branch_id: string }[]>`
      select id, student_code code, full_name name, primary_branch_id branch_id from students where status = 'ACTIVE' order by full_name`).filter((s) => inScope(s.branch_id));
    const classes = (await tx<{ id: string; name: string; branch_id: string; course: string; code: string }[]>`
      select c.id, c.name, c.branch_id, co.name course, b.code from classes c join courses co on co.id = c.course_id join branches b on b.id = c.branch_id
      where co.status in ('OPEN','PLANNED') order by b.code, co.start_date, c.name`).filter((c) => inScope(c.branch_id));
    const plans = (await tx<{ id: string; name: string; branch_id: string; code: string; spw: number | null }[]>`
      select p.id, p.name, p.branch_id, b.code, p.sessions_per_week spw from plans p join branches b on b.id = p.branch_id
      where p.active order by b.code, p.name`).filter((p) => inScope(p.branch_id));
    const progress = (await studentProgressList(tx, today)).filter((p) => inScope(p.branch_id));
    return { branches, students, classes, plans, progress };
  });
  const { branches, students, classes, plans, progress } = data;
  const recent = [...progress].sort((a, b) => b.start_date.localeCompare(a.start_date)).slice(0, 30);
  const withBalance = progress.filter((p) => (p.available_sessions ?? 0) > 0 && ["CONFIRMED", "COMPLETED"].includes(p.enrollment_status));
  const targets = progress.filter((p) => ["CONFIRMED", "DRAFT"].includes(p.enrollment_status));
  const enrLabel = (p: (typeof progress)[number]) => `${p.student_code} ${p.student_name} · ${p.class_name} · từ ${fmtDate(p.start_date)}`;

  return (
    <StaffShell viewer={viewer}>
      <h1 className="text-xl font-bold text-navy">Đăng ký & bảo lưu</h1>
      <p className="text-sm text-slate-500">Quota, mốc tháng và giá được chụp từ gói tại thời điểm đăng ký; đổi gói sau này không ảnh hưởng đăng ký cũ.</p>
      <Flash ok={sp.ok} err={sp.err} />

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <section className="card">
          <h2 className="mb-2 font-semibold text-navy">1. Tạo học viên</h2>
          <form action={createStudentAction} className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1"><span className="label">Chi nhánh</span>
              <select name="branch" required className="input">{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
            <label className="flex flex-col gap-1"><span className="label">Họ tên</span><input name="name" required minLength={2} maxLength={120} className="input" /></label>
            <label className="flex flex-col gap-1"><span className="label">Ngày sinh (không bắt buộc)</span><input type="date" name="birth" className="input" /></label>
            <div className="flex items-end"><button className="btn">Tạo học viên</button></div>
          </form>
          <p className="mt-2 text-xs text-slate-500">Mã học viên tự sinh theo chi nhánh (VD: QN-000001). Số điện thoại phụ huynh nhập ở bước liên kết phụ huynh.</p>
        </section>

        <section className="card">
          <h2 className="mb-2 font-semibold text-navy">2. Đăng ký gói học</h2>
          {students.length === 0 || classes.length === 0 || plans.length === 0 ? (
            <EmptyState title="Chưa đủ dữ liệu để đăng ký">Cần có học viên, lớp thuộc khóa đang mở/sắp mở và gói đang áp dụng.</EmptyState>
          ) : (
            <form action={createEnrollmentAction} className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 sm:col-span-2"><span className="label">Học viên</span>
                <select name="student" required className="input">{students.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}</select></label>
              <label className="flex flex-col gap-1"><span className="label">Lớp</span>
                <select name="class" required className="input">{classes.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.course} · {c.name}</option>)}</select></label>
              <label className="flex flex-col gap-1"><span className="label">Gói (cùng chi nhánh với lớp)</span>
                <select name="plan" required className="input">{plans.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>
              <label className="flex flex-col gap-1"><span className="label">Ngày bắt đầu</span><input type="date" name="start" required defaultValue={today} className="input" /></label>
              <label className="flex flex-col gap-1"><span className="label">Hạn dùng buổi (không bắt buộc)</span><input type="date" name="valid_until" className="input" /></label>
              <fieldset className="sm:col-span-2">
                <legend className="label">Ngày học riêng (chỉ gói 1–2 buổi/tuần; để trống = theo toàn bộ lịch lớp)</legend>
                <div className="mt-1 flex flex-wrap gap-3 text-sm">
                  {WD.map(([n, l]) => <label key={n} className="flex items-center gap-1"><input type="checkbox" name="weekdays" value={n} />{l}</label>)}
                </div>
              </fieldset>
              <div><button className="btn">Tạo & xác nhận đăng ký</button></div>
            </form>
          )}
        </section>

        <section className="card lg:col-span-2">
          <h2 className="mb-2 font-semibold text-navy">3. Chuyển buổi bảo lưu sang đăng ký mới</h2>
          {withBalance.length === 0 || targets.length < 2 ? (
            <EmptyState title="Chưa có đăng ký nào còn buổi để chuyển">Tạo đăng ký mới (bước 2) cho học viên trước, sau đó chuyển số buổi còn lại sang.</EmptyState>
          ) : (
            <form action={transferCarryoverAction} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <input type="hidden" name="request" value={randomUUID()} />
              <label className="flex flex-col gap-1 lg:col-span-3"><span className="label">Từ đăng ký (còn buổi)</span>
                <select name="from" required className="input">{withBalance.map((p) => <option key={p.enrollment_id} value={p.enrollment_id}>{enrLabel(p)} · còn {p.available_sessions}</option>)}</select></label>
              <label className="flex flex-col gap-1 lg:col-span-3"><span className="label">Sang đăng ký (cùng học viên)</span>
                <select name="to" required className="input">{targets.map((p) => <option key={p.enrollment_id} value={p.enrollment_id}>{enrLabel(p)}</option>)}</select></label>
              <label className="flex flex-col gap-1"><span className="label">Số buổi</span><input type="number" name="sessions" min={1} max={500} required className="input" /></label>
              <label className="flex flex-col gap-1"><span className="label">Ngày chuyển</span><input type="date" name="date" required defaultValue={today} className="input" /></label>
              <label className="flex flex-col gap-1 lg:col-span-2"><span className="label">Lý do</span><input name="reason" required maxLength={300} className="input" /></label>
              <div className="flex items-end"><button className="btn">Chuyển bảo lưu</button></div>
            </form>
          )}
          <p className="mt-2 text-xs text-slate-500">Buổi bảo lưu chỉ dùng trong khóa kế tiếp: hạn dùng tự đặt bằng ngày kết thúc khóa của đăng ký đích, và không chuyển tiếp sang khóa sau nữa. Chuyển giữa hai chi nhánh cần quyền quản lý ở cả hai. Mỗi lần mở trang tạo một mã yêu cầu mới, bấm hai lần không bị chuyển trùng.</p>
        </section>
      </div>

      <section className="card mt-3 overflow-x-auto">
        <h2 className="mb-2 font-semibold text-navy">Đăng ký gần đây</h2>
        {recent.length === 0 ? <EmptyState title="Chưa có đăng ký" /> : (
          <table className="min-w-full">
            <thead><tr><th>Mã</th><th>Học viên</th><th>Lớp</th><th>Bắt đầu</th><th>Trạng thái</th><th>Quota</th><th>Còn</th><th>Bảo lưu</th></tr></thead>
            <tbody>
              {recent.map((p) => (
                <tr key={p.enrollment_id} className="border-t border-slate-100">
                  <td>{p.student_code}</td><td>{p.student_name}</td><td>{p.class_name}</td><td>{fmtDate(p.start_date)}</td>
                  <td>{ENR_LABEL[p.enrollment_status] ?? p.enrollment_status}</td><td>{p.quota ?? "Theo lượt"}</td>
                  <td>{fmtCount(p.available_sessions)}</td><td>{fmtCount(p.carryover_available)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </StaffShell>
  );
}

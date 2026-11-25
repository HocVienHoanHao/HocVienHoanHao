import Link from "next/link";
import { redirect } from "next/navigation";
import { asUser } from "@/lib/db";
import { fmtCount, fmtDate, isIsoDate, todayVn } from "@/lib/format";
import { studentProgressList } from "@/lib/progress";
import { applyFilter, FILTER_LABEL, parseFilter, type ProgressFilter } from "@/lib/progress-filters";
import { isStaff, requireViewer } from "@/lib/session";
import { managedBranchIds } from "@/lib/students";
import { StaffShell } from "@/components/StaffShell";
import { FilterBar } from "@/components/FilterBar";
import { EmptyState, MilestoneDate, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function StudentsPage({ searchParams }: { searchParams: Promise<{ branch?: string; asOf?: string; filter?: string; class?: string }> }) {
  const viewer = await requireViewer();
  if (!isStaff(viewer)) redirect("/");
  const sp = await searchParams;
  const asOf = isIsoDate(sp.asOf) ? sp.asOf : todayVn();
  const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
  const branchId = uuid(sp.branch); const classId = uuid(sp.class);
  const filter = parseFilter(sp.filter);
  const managed = managedBranchIds(viewer);
  const canCreate = managed === null || managed.length > 0;

  const { branches, classes, rows } = await asUser(viewer.id, async (tx) => ({
    branches: await tx<{ id: string; code: string; name: string }[]>`select b.id, b.code, b.name from branches b where b.status = 'ACTIVE'
      and (app.is_super_admin() or exists (select 1 from branch_memberships m where m.user_id = auth.uid() and m.active and m.branch_id = b.id))
      order by b.code`,
    classes: await tx<{ id: string; name: string; code: string }[]>`select c.id, c.name, b.code from classes c join branches b on b.id = c.branch_id
      where (${branchId}::uuid is null or c.branch_id = ${branchId}::uuid) order by b.code, c.name`,
    rows: await studentProgressList(tx, asOf, { branchId, classId }),
  }));
  const shown = applyFilter(rows, filter, asOf);
  const qs = new URLSearchParams({ asOf, filter, ...(branchId ? { branch: branchId } : {}), ...(classId ? { class: classId } : {}) });

  return (
    <StaffShell viewer={viewer}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-navy">Học viên & tiến độ</h1>
        <div className="flex gap-2">
          <Link href="/admin/students/profiles" className="btn-ghost">Danh sách & hồ sơ học viên</Link>
          {canCreate && <Link href="/admin/students/new" className="btn">+ Thêm học viên</Link>}
        </div>
      </div>
      <p className="mb-4 text-sm text-slate-500">Ngày chốt {fmtDate(asOf)} · “Lớp đã tập” khác “Học viên đã học” và “Còn quyền học”</p>
      <FilterBar branches={branches} branchId={branchId} asOf={asOf} action="/admin/students">
        <label className="flex flex-col gap-1">
          <span className="label">Lớp</span>
          <select name="class" defaultValue={classId ?? ""} className="input">
            <option value="">Tất cả lớp</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">Lọc</span>
          <select name="filter" defaultValue={filter} className="input">
            {(Object.keys(FILTER_LABEL) as ProgressFilter[]).map((k) => <option key={k} value={k}>{FILTER_LABEL[k]}</option>)}
          </select>
        </label>
      </FilterBar>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm text-slate-600">{shown.length} lượt đăng ký</div>
        <a className="btn-ghost" href={`/api/export/progress?${qs}`}>Xuất CSV</a>
      </div>
      {shown.length === 0 ? <EmptyState title="Không có học viên phù hợp bộ lọc" /> : (
        <div className="card overflow-x-auto p-0">
          <table className="min-w-full">
            <thead className="bg-slate-50">
              <tr>
                <th>Mã</th><th>Họ tên</th><th>Lớp</th><th>Bắt đầu</th><th>Gói</th>
                <th title="Số buổi lớp đã tổ chức (cả khóa / từ khi vào)">Lớp đã tập</th><th>Có mặt</th><th>Đã trừ</th><th>Còn lại</th>
                <th>Bảo lưu</th><th>Đi học gần nhất</th><th>Hết tháng học</th><th>Hết gói</th><th>Hết quyền học</th><th>Hạn HĐ</th><th>Dữ liệu</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.enrollment_id} className="border-t border-slate-100 align-top">
                  <td className="font-mono text-xs">{p.student_code}</td>
                  <td className="font-medium"><Link className="hover:text-brand hover:underline" href={`/admin/students/${p.student_id}`}>{p.student_name}</Link></td>
                  <td><Link className="text-brand hover:underline" href={`/admin/classes/${p.class_id}?asOf=${asOf}`}>{p.class_name}</Link></td>
                  <td>{fmtDate(p.start_date)}</td>
                  <td>{p.quota ?? "Theo lượt"}</td>
                  <td>{p.class_completed_sessions} / {p.class_sessions_since_join}</td>
                  <td>{fmtCount(p.present_sessions)}</td>
                  <td>{fmtCount(p.charged_sessions)}</td>
                  <td className={p.available_sessions != null && p.available_sessions <= 3 ? "font-bold text-rose-700" : "font-semibold"}>{fmtCount(p.available_sessions)}</td>
                  <td>{p.carryover_available ? p.carryover_available : ""}</td>
                  <td>{fmtDate(p.last_attended_date)}</td>
                  <td>{p.current_month ? <><div className="text-xs text-slate-500">Tháng {p.current_month}</div><MilestoneDate m={p.current_month_milestone} /></> : "—"}</td>
                  <td><MilestoneDate m={p.package_end} /></td>
                  <td>{p.entitlement_exhaustion.estimated_date
                    ? <MilestoneDate m={{ month: 0, target: 0, remaining: null, actual_date: null, status: p.entitlement_exhaustion.status, estimated_date: p.entitlement_exhaustion.estimated_date }} />
                    : <StatusBadge status={p.entitlement_exhaustion.status} label={p.entitlement_exhaustion.label} />}</td>
                  <td>{fmtDate(p.invoice_due_date)}</td>
                  <td>
                    <StatusBadge status={p.data_status === "OK" ? "REACHED" : p.data_status === "NO_DATA" ? "NO_DATA" : "ESTIMATED_RECURRING"}
                      label={p.data_status === "OK" ? "Đủ" : p.data_status === "NO_DATA" ? "Chưa đủ dữ liệu" : "Chờ xác nhận"} />
                    {p.warnings.length > 0 && <div className="mt-1 max-w-56 whitespace-normal text-xs text-amber-800">{p.warnings.map((w) => w.message).join(" · ")}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </StaffShell>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { asUser } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { isStaff, requireViewer } from "@/lib/session";
import { STUDENT_STATUS_LABEL, managedBranchIds } from "@/lib/students";
import { StaffShell } from "@/components/StaffShell";
import { EmptyState, Flash } from "@/components/ui";

export const dynamic = "force-dynamic";

type Row = { id: string; student_code: string; full_name: string; birth_date: string | null; birth_year: number | null; status: string; branch_code: string;
  guardians: string | null; phones: string | null; active_enrollments: number };

export default async function StudentProfilesPage({ searchParams }: { searchParams: Promise<{ q?: string; branch?: string; status?: string; ok?: string }> }) {
  const viewer = await requireViewer();
  if (!isStaff(viewer)) redirect("/");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 60);
  const branchId = sp.branch && /^[0-9a-f-]{36}$/i.test(sp.branch) ? sp.branch : null;
  const status = sp.status && sp.status in STUDENT_STATUS_LABEL ? sp.status : null;
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const digits = q.replace(/\D/g, "");
  const managed = managedBranchIds(viewer);
  const canCreate = managed === null || managed.length > 0;

  const { branches, rows } = await asUser(viewer.id, async (tx) => ({
    branches: await tx<{ id: string; code: string; name: string }[]>`select b.id, b.code, b.name from branches b where b.status = 'ACTIVE'
      and (app.is_super_admin() or exists (select 1 from branch_memberships m where m.user_id = auth.uid() and m.active and m.branch_id = b.id))
      order by b.code`,
    // RLS chỉ trả về học viên và phụ huynh người dùng được xem
    rows: await tx<Row[]>`select s.id, s.student_code, s.full_name, to_char(s.birth_date, 'YYYY-MM-DD') birth_date, s.birth_year, s.status::text status, b.code branch_code,
        string_agg(distinct g.full_name, ', ') guardians, string_agg(distinct g.phone, ', ') phones,
        (select count(*)::int from enrollments e where e.student_id = s.id and e.status in ('CONFIRMED','DRAFT')) active_enrollments
      from students s join branches b on b.id = s.primary_branch_id
      left join guardian_students gs on gs.student_id = s.id left join guardians g on g.id = gs.guardian_id
      where (${branchId}::uuid is null or s.primary_branch_id = ${branchId}::uuid)
        and (${status}::text is null or s.status::text = ${status}::text)
        and (${q} = '' or s.full_name ilike ${like} or s.student_code ilike ${like} or g.full_name ilike ${like}
             or (${digits} <> '' and length(${digits}) >= 3 and regexp_replace(coalesce(g.phone, ''), '\\D', '', 'g') like ${"%" + digits + "%"}))
      group by s.id, b.code order by b.code, s.student_code limit 500`,
  }));

  return (
    <StaffShell viewer={viewer}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-navy">Danh sách học viên</h1>
        <div className="flex gap-2">
          <Link href="/admin/students" className="btn-ghost">Xem tiến độ</Link>
          {canCreate && <Link href="/admin/students/new" className="btn">+ Thêm học viên</Link>}
        </div>
      </div>
      <p className="mb-3 text-sm text-slate-500">Tất cả học viên, kể cả chưa đăng ký gói. Bấm tên để xem và sửa hồ sơ, phụ huynh.</p>
      <Flash ok={sp.ok} />
      <form className="card mb-3 flex flex-wrap items-end gap-3" action="/admin/students/profiles">
        <label className="flex min-w-56 flex-1 flex-col gap-1"><span className="label">Tìm (tên, mã, phụ huynh, SĐT)</span>
          <input name="q" defaultValue={q} maxLength={60} className="input" /></label>
        <label className="flex flex-col gap-1"><span className="label">Chi nhánh</span>
          <select name="branch" defaultValue={branchId ?? ""} className="input">
            <option value="">Tất cả</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
          </select></label>
        <label className="flex flex-col gap-1"><span className="label">Trạng thái</span>
          <select name="status" defaultValue={status ?? ""} className="input">
            <option value="">Tất cả</option>{Object.entries(STUDENT_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></label>
        <button className="btn">Lọc</button>
      </form>
      <div className="mb-2 text-sm text-slate-600">{rows.length}{rows.length === 500 ? "+" : ""} học viên</div>
      {rows.length === 0 ? <EmptyState title="Không có học viên phù hợp" /> : (
        <div className="card overflow-x-auto p-0">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50"><tr><th>Mã</th><th>Họ tên</th><th>Ngày / năm sinh</th><th>Phụ huynh</th><th>SĐT</th><th>Trạng thái</th><th>Đăng ký đang mở</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="font-mono text-xs">{r.student_code}</td>
                  <td><Link className="font-medium text-brand hover:underline" href={`/admin/students/${r.id}`}>{r.full_name}</Link></td>
                  <td>{r.birth_date ? fmtDate(r.birth_date) : r.birth_year ?? "—"}</td>
                  <td>{r.guardians ?? <span className="text-slate-400">—</span>}</td>
                  <td>{r.phones ?? <span className="text-slate-400">—</span>}</td>
                  <td>{STUDENT_STATUS_LABEL[r.status] ?? r.status}</td>
                  <td>{r.active_enrollments || <span className="text-amber-700">Chưa có</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </StaffShell>
  );
}

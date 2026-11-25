import Link from "next/link";
import { redirect } from "next/navigation";
import { asUser } from "@/lib/db";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { isStaff, requireViewer } from "@/lib/session";
import { StaffShell } from "@/components/StaffShell";
import { EmptyState, Flash, StatusBadge } from "@/components/ui";
import { decideLeaveAction } from "@/lib/actions/leaves";

export const dynamic = "force-dynamic";

const LEAVE_LABEL: Record<string, string> = { REQUESTED: "Chờ duyệt", APPROVED: "Đã duyệt", REJECTED: "Từ chối", CANCELLED: "Đã hủy" };

// dùng lại màu của huy hiệu tiến độ
const BADGE: Record<string, string> = { REQUESTED: "ESTIMATED_RECURRING", APPROVED: "REACHED", REJECTED: "EXHAUSTED" };

type Row = {
  id: string; code: string; name: string; branch_id: string; branch: string; from_date: string; to_date: string;
  status: string; charge: boolean; reason: string | null; requested_by: string | null; created_at: string;
};

export default async function LeavesPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; all?: string }> }) {
  const viewer = await requireViewer();
  if (!isStaff(viewer)) redirect("/");
  const sp = await searchParams;
  const showAll = sp.all === "1";
  const rows = await asUser(viewer.id, (tx) => tx<Row[]>`
    select l.id, st.student_code code, st.full_name name, st.primary_branch_id branch_id, b.code branch,
           l.from_date::text from_date, l.to_date::text to_date, l.status::text status, l.charge, l.reason,
           p.full_name requested_by, l.created_at
    from student_leaves l join students st on st.id = l.student_id join branches b on b.id = st.primary_branch_id
    left join profiles p on p.id = l.requested_by
    where ${showAll} or l.status = 'REQUESTED'
    order by (l.status = 'REQUESTED') desc, l.from_date desc limit 200`);
  const canDecide = (branchId: string) => viewer.isSuperAdmin || viewer.roles.some((r) => r.role === "BRANCH_MANAGER" && r.branchId === branchId);

  return (
    <StaffShell viewer={viewer}>
      <h1 className="text-xl font-bold text-navy">Xin nghỉ</h1>
      <p className="text-sm text-slate-500">Đơn từ phụ huynh hoặc CSKH. Chính sách mặc định: nghỉ có phép đã duyệt không trừ buổi; chọn &quot;Duyệt & trừ buổi&quot; nếu chính sách gói yêu cầu.</p>
      <Flash ok={sp.ok} err={sp.err} />
      <div className="my-2 text-sm">
        {showAll ? <Link className="text-brand underline" href="/admin/leaves">Chỉ đơn chờ duyệt</Link> : <Link className="text-brand underline" href="/admin/leaves?all=1">Xem cả đơn đã xử lý</Link>}
      </div>
      <section className="card overflow-x-auto">
        {rows.length === 0 ? <EmptyState title={showAll ? "Chưa có đơn xin nghỉ" : "Không có đơn chờ duyệt"} /> : (
          <table className="min-w-full">
            <thead><tr><th>CN</th><th>Học viên</th><th>Nghỉ</th><th>Lý do</th><th>Người gửi</th><th>Trạng thái</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 align-top">
                  <td>{r.branch}</td>
                  <td>{r.code}<div className="text-slate-600">{r.name}</div></td>
                  <td>{fmtDate(r.from_date)}{r.to_date !== r.from_date && <> – {fmtDate(r.to_date)}</>}</td>
                  <td className="max-w-xs whitespace-pre-wrap break-words">{r.reason}</td>
                  <td>{r.requested_by ?? "—"}<div className="text-xs text-slate-500">{fmtDateTime(r.created_at)}</div></td>
                  <td><StatusBadge status={BADGE[r.status] ?? "NO_DATA"} label={LEAVE_LABEL[r.status] + (r.status === "APPROVED" && r.charge ? " · trừ buổi" : "")} /></td>
                  <td>
                    {r.status === "REQUESTED" && canDecide(r.branch_id) && (
                      <form action={decideLeaveAction} className="flex flex-wrap gap-1">
                        <input type="hidden" name="leave" value={r.id} />
                        <button name="decision" value="approve" className="btn py-1">Duyệt</button>
                        <button name="decision" value="approve_charge" className="btn-ghost py-1">Duyệt & trừ buổi</button>
                        <button name="decision" value="reject" className="btn-ghost py-1 text-red-700">Từ chối</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </StaffShell>
  );
}

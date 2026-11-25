import { redirect } from "next/navigation";
import { asUser } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { requireViewer } from "@/lib/session";
import { StaffShell } from "@/components/StaffShell";
import { EmptyState, Flash } from "@/components/ui";
import { inviteGuardianAction, inviteStaffAction, revokeInvitationAction } from "@/lib/actions/users";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "Quản trị toàn hệ thống", BRANCH_MANAGER: "Quản lý chi nhánh", ACCOUNTANT: "Kế toán", COACH: "Huấn luyện viên", CARE_STAFF: "CSKH",
};

type Inv = { id: string; email: string; full_name: string; kind: string; role: string | null; branch: string | null; student: string | null;
  relationship: string | null; created_at: string; expires_at: string; accepted_at: string | null; revoked_at: string | null };

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const viewer = await requireViewer();
  const managerOf = viewer.roles.filter((r) => r.role === "BRANCH_MANAGER").map((r) => r.branchId as string);
  const careOf = viewer.roles.filter((r) => r.role === "CARE_STAFF").map((r) => r.branchId as string);
  if (!viewer.isSuperAdmin && managerOf.length === 0 && careOf.length === 0) redirect("/");
  const sp = await searchParams;
  const staffBranches = viewer.isSuperAdmin ? null : managerOf;              // ai mời được nhân viên ở đâu
  const guardianBranches = viewer.isSuperAdmin ? null : [...managerOf, ...careOf];
  const staffRoles = viewer.isSuperAdmin ? Object.keys(ROLE_LABEL) : ["COACH", "ACCOUNTANT", "CARE_STAFF"];

  const data = await asUser(viewer.id, async (tx) => {
    const branches = await tx<{ id: string; name: string }[]>`select id, name from branches order by code`;
    const students = await tx<{ id: string; code: string; name: string; branch_id: string }[]>`
      select id, student_code code, full_name name, primary_branch_id branch_id from students where status in ('ACTIVE','LEAD','PAUSED','ON_HOLD') order by full_name`;
    const invites = await tx<Inv[]>`
      select i.id, i.email, i.full_name, i.kind, i.role::text role, b.name branch, st.student_code || ' ' || st.full_name student,
             i.relationship, i.created_at, i.expires_at, i.accepted_at, i.revoked_at
      from user_invitations i left join branches b on b.id = i.branch_id left join students st on st.id = i.student_id
      order by (i.accepted_at is null and i.revoked_at is null) desc, i.created_at desc limit 100`;
    const members = await tx<{ name: string; role: string; branch: string | null; active: boolean }[]>`
      select p.full_name name, m.role::text role, b.name branch, m.active from branch_memberships m
      join profiles p on p.id = m.user_id left join branches b on b.id = m.branch_id order by b.code nulls first, m.role, p.full_name`;
    return { branches, students, invites, members };
  });
  const staffBr = data.branches.filter((b) => !staffBranches || staffBranches.includes(b.id));
  const kids = data.students.filter((s) => !guardianBranches || guardianBranches.includes(s.branch_id));
  const status = (i: Inv) => i.accepted_at ? "Đã nhận" : i.revoked_at ? "Đã thu hồi" : new Date(i.expires_at) < new Date() ? "Hết hạn" : "Chờ đăng nhập";

  return (
    <StaffShell viewer={viewer}>
      <h1 className="text-xl font-bold text-navy">Người dùng & lời mời</h1>
      <p className="text-sm text-slate-500">Mỗi người đăng nhập bằng email của mình (nhận mã qua email, không mật khẩu). Chỉ email đã được mời mới có quyền; lời mời hết hạn sau 14 ngày.</p>
      <Flash ok={sp.ok} err={sp.err} />

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {(viewer.isSuperAdmin || managerOf.length > 0) && (
          <section className="card">
            <h2 className="mb-2 font-semibold text-navy">Mời nhân viên</h2>
            <form action={inviteStaffAction} className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1"><span className="label">Email</span><input type="email" name="email" required maxLength={254} className="input" /></label>
              <label className="flex flex-col gap-1"><span className="label">Họ tên</span><input name="name" required minLength={2} maxLength={120} className="input" /></label>
              <label className="flex flex-col gap-1"><span className="label">Vai trò</span>
                <select name="role" className="input">{staffRoles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
              <label className="flex flex-col gap-1"><span className="label">Chi nhánh</span>
                <select name="branch" className="input">{staffBr.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
              <div><button className="btn">Tạo lời mời</button></div>
            </form>
            {viewer.isSuperAdmin && <p className="mt-2 text-xs text-slate-500">Vai trò &quot;Quản trị toàn hệ thống&quot; không gắn chi nhánh (bỏ qua ô chi nhánh).</p>}
          </section>
        )}
        <section className="card">
          <h2 className="mb-2 font-semibold text-navy">Mời phụ huynh</h2>
          {kids.length === 0 ? <EmptyState title="Chưa có học viên" /> : (
            <form action={inviteGuardianAction} className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1"><span className="label">Email phụ huynh</span><input type="email" name="email" required maxLength={254} className="input" /></label>
              <label className="flex flex-col gap-1"><span className="label">Họ tên phụ huynh</span><input name="name" required minLength={2} maxLength={120} className="input" /></label>
              <label className="flex flex-col gap-1"><span className="label">Học viên</span>
                <select name="student" className="input">{kids.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}</select></label>
              <label className="flex flex-col gap-1"><span className="label">Quan hệ</span><input name="relationship" required maxLength={50} placeholder="Bố / Mẹ / Ông / Bà…" className="input" /></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="can_request_leave" defaultChecked /> Được xin nghỉ qua app</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="can_view_finance" defaultChecked /> Được xem hóa đơn</label>
              <div><button className="btn">Tạo lời mời</button></div>
            </form>
          )}
        </section>
      </div>

      <section className="card mt-3 overflow-x-auto">
        <h2 className="mb-2 font-semibold text-navy">Lời mời</h2>
        {data.invites.length === 0 ? <EmptyState title="Chưa có lời mời" /> : (
          <table className="min-w-full">
            <thead><tr><th>Email</th><th>Họ tên</th><th>Quyền</th><th>Tạo lúc</th><th>Trạng thái</th><th></th></tr></thead>
            <tbody>
              {data.invites.map((i) => (
                <tr key={i.id} className="border-t border-slate-100">
                  <td className="break-all">{i.email}</td><td>{i.full_name}</td>
                  <td>{i.kind === "STAFF" ? `${ROLE_LABEL[i.role ?? ""] ?? i.role}${i.branch ? ` · ${i.branch}` : ""}` : `Phụ huynh (${i.relationship}) · ${i.student}`}</td>
                  <td>{fmtDateTime(i.created_at)}</td><td>{status(i)}</td>
                  <td>{status(i) === "Chờ đăng nhập" && (
                    <form action={revokeInvitationAction}><input type="hidden" name="id" value={i.id} /><button className="btn-ghost py-1 text-red-700">Thu hồi</button></form>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {data.members.length > 0 && (
        <section className="card mt-3 overflow-x-auto">
          <h2 className="mb-2 font-semibold text-navy">Nhân viên đang có quyền</h2>
          <table className="min-w-full">
            <thead><tr><th>Họ tên</th><th>Vai trò</th><th>Chi nhánh</th><th>Trạng thái</th></tr></thead>
            <tbody>
              {data.members.map((m, k) => (
                <tr key={k} className="border-t border-slate-100"><td>{m.name}</td><td>{ROLE_LABEL[m.role] ?? m.role}</td><td>{m.branch ?? "Toàn hệ thống"}</td><td>{m.active ? "Đang hoạt động" : "Đã khóa"}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </StaffShell>
  );
}

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { asUser } from "@/lib/db";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { isStaff, requireViewer } from "@/lib/session";
import { EDITABLE_STATUSES, STUDENT_STATUS_LABEL, canManageBranch } from "@/lib/students";
import { saveGuardianAction, unlinkGuardianAction, updateStudentAction } from "@/lib/actions/students";
import { StaffShell } from "@/components/StaffShell";
import { EmptyState, Flash } from "@/components/ui";

export const dynamic = "force-dynamic";

const ENR_LABEL: Record<string, string> = {
  DRAFT: "Nháp", CONFIRMED: "Đang học", COMPLETED: "Hoàn thành", TRANSFERRED: "Đã chuyển bảo lưu", CANCELLED: "Đã hủy",
};

type Student = { id: string; student_code: string; full_name: string; birth_date: string | null; status: string;
  status_reason: string | null; status_changed_at: string | null; branch_id: string; branch_code: string; branch_name: string; created_at: string };
type Guardian = { id: string; full_name: string; phone: string | null; email: string | null; has_account: boolean;
  relationship: string; can_request_leave: boolean; siblings: number };
type Enr = { id: string; class_id: string; class_name: string; course_name: string; plan_name: string | null; start_date: string; status: string; quota: number | null };

function GuardianFields({ g }: { g?: Guardian }) {
  return (
    <>
      <label className="flex flex-col gap-1"><span className="label">Họ tên phụ huynh</span>
        <input name="name" required minLength={2} maxLength={120} defaultValue={g?.full_name} className="input" /></label>
      <label className="flex flex-col gap-1"><span className="label">Quan hệ</span>
        <input name="relationship" maxLength={50} defaultValue={g?.relationship} placeholder="Bố / Mẹ / Ông / Bà…" className="input" /></label>
      <label className="flex flex-col gap-1"><span className="label">Số điện thoại</span>
        <input type="tel" name="phone" maxLength={30} inputMode="tel" defaultValue={g?.phone ?? ""} className="input" /></label>
      <label className="flex flex-col gap-1"><span className="label">Email</span>
        <input type="email" name="email" maxLength={254} defaultValue={g?.email ?? ""} className="input" /></label>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="can_request_leave" defaultChecked={g?.can_request_leave ?? false} /> Được xin nghỉ cho con qua app</label>
    </>
  );
}

export default async function StudentProfilePage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const viewer = await requireViewer();
  if (!isStaff(viewer)) redirect("/");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sp = await searchParams;

  const data = await asUser(viewer.id, async (tx) => {
    const [s] = await tx<Student[]>`select s.id, s.student_code, s.full_name, to_char(s.birth_date, 'YYYY-MM-DD') birth_date, s.status::text status,
        s.status_reason, s.status_changed_at::text, s.primary_branch_id branch_id, b.code branch_code, b.name branch_name, s.created_at::text
      from students s join branches b on b.id = s.primary_branch_id where s.id = ${id}`;
    if (!s) return null;
    const guardians = await tx<Guardian[]>`select g.id, g.full_name, g.phone, g.email, g.user_id is not null has_account,
        gs.relationship, gs.can_request_leave,
        (select count(*)::int from guardian_students o where o.guardian_id = g.id and o.student_id <> ${id}) siblings
      from guardian_students gs join guardians g on g.id = gs.guardian_id where gs.student_id = ${id} order by gs.created_at`;
    const enrollments = await tx<Enr[]>`select e.id, e.class_id, c.name class_name, co.name course_name, p.name plan_name,
        to_char(e.start_date, 'YYYY-MM-DD') start_date, e.status::text status, e.snapshot_quota quota
      from enrollments e join classes c on c.id = e.class_id join courses co on co.id = e.course_id left join plans p on p.id = e.plan_id
      where e.student_id = ${id} order by e.start_date desc`;
    return { s, guardians, enrollments };
  });
  if (!data) notFound();
  const { s, guardians, enrollments } = data;
  const canEdit = canManageBranch(viewer, s.branch_id);

  return (
    <StaffShell viewer={viewer}>
      <div className="mb-1 text-sm"><Link className="text-brand hover:underline" href="/admin/students/profiles">← Danh sách học viên</Link></div>
      <h1 className="text-xl font-bold text-navy">{s.full_name} <span className="font-mono text-base font-normal text-slate-500">{s.student_code}</span></h1>
      <p className="text-sm text-slate-500">{s.branch_name} · {STUDENT_STATUS_LABEL[s.status] ?? s.status}
        {!canEdit && " · Bạn chỉ có quyền xem (sửa: quản lý chi nhánh)"}</p>
      <Flash ok={sp.ok} err={sp.err} />

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <section className="card">
          <h2 className="mb-2 font-semibold text-navy">Thông tin học viên</h2>
          {canEdit ? (
            <form action={updateStudentAction} className="grid gap-2 sm:grid-cols-2">
              <input type="hidden" name="id" value={s.id} />
              <label className="flex flex-col gap-1 sm:col-span-2"><span className="label">Họ tên</span>
                <input name="name" required minLength={2} maxLength={120} defaultValue={s.full_name} className="input" /></label>
              <label className="flex flex-col gap-1"><span className="label">Ngày sinh</span>
                <input type="date" name="birth" min="1990-01-01" defaultValue={s.birth_date ?? ""} className="input" /></label>
              <label className="flex flex-col gap-1"><span className="label">Trạng thái</span>
                <select name="status" defaultValue={s.status === "UNKNOWN" ? "ACTIVE" : s.status} className="input">
                  {EDITABLE_STATUSES.map((k) => <option key={k} value={k}>{STUDENT_STATUS_LABEL[k]}</option>)}
                </select></label>
              <label className="flex flex-col gap-1 sm:col-span-2"><span className="label">Lý do đổi trạng thái (bắt buộc khi “Đã nghỉ hẳn”)</span>
                <input name="status_reason" maxLength={300} defaultValue={s.status_reason ?? ""} className="input" /></label>
              <div className="sm:col-span-2"><button className="btn">Lưu thông tin</button></div>
            </form>
          ) : (
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="label">Ngày sinh</dt><dd>{fmtDate(s.birth_date)}</dd>
              <dt className="label">Trạng thái</dt><dd>{STUDENT_STATUS_LABEL[s.status] ?? s.status}</dd>
              {s.status_reason && <><dt className="label">Lý do</dt><dd>{s.status_reason}</dd></>}
            </dl>
          )}
          <p className="mt-2 text-xs text-slate-500">Mã và chi nhánh không sửa được vì gắn với đăng ký và sổ buổi học.
            {s.status_changed_at && <> Đổi trạng thái lần cuối: {fmtDateTime(s.status_changed_at)}.</>}</p>
        </section>

        <section className="card">
          <h2 className="mb-2 font-semibold text-navy">Phụ huynh</h2>
          {guardians.length === 0 && <p className="mb-2 text-sm text-slate-500">Chưa có phụ huynh nào.</p>}
          <ul className="space-y-2">
            {guardians.map((g) => (
              <li key={g.id} className="rounded-lg p-3 ring-1 ring-slate-200">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div><span className="font-medium">{g.full_name}</span> <span className="text-sm text-slate-500">· {g.relationship}</span></div>
                  <div className="text-sm">{g.phone ? <a className="text-brand hover:underline" href={`tel:${g.phone}`}>{g.phone}</a> : <span className="text-slate-400">Chưa có SĐT</span>}</div>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {g.email && <>{g.email} · </>}{g.has_account ? "Có tài khoản app" : "Chưa có tài khoản app"}
                  {g.can_request_leave && " · Được xin nghỉ"}
                  {g.siblings > 0 && ` · Cũng là phụ huynh của ${g.siblings} học viên khác (sửa tên/SĐT áp dụng cho cả hồ sơ chung)`}
                </div>
                {canEdit && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm text-brand">Sửa / gỡ</summary>
                    <form action={saveGuardianAction} className="mt-2 grid gap-2 sm:grid-cols-2">
                      <input type="hidden" name="student" value={s.id} /><input type="hidden" name="guardian" value={g.id} />
                      <GuardianFields g={g} />
                      <div className="sm:col-span-2"><button className="btn">Lưu phụ huynh</button></div>
                    </form>
                    <form action={unlinkGuardianAction} className="mt-2">
                      <input type="hidden" name="student" value={s.id} /><input type="hidden" name="guardian" value={g.id} />
                      <button className="btn-ghost py-1 text-red-700">Gỡ phụ huynh này khỏi học viên</button>
                    </form>
                  </details>
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <details className="mt-3" open={guardians.length === 0}>
              <summary className="cursor-pointer text-sm font-medium text-brand">+ Thêm phụ huynh</summary>
              <form action={saveGuardianAction} className="mt-2 grid gap-2 sm:grid-cols-2">
                <input type="hidden" name="student" value={s.id} />
                <GuardianFields />
                <p className="text-xs text-slate-500 sm:col-span-2">Số điện thoại trùng phụ huynh của học viên khác cùng chi nhánh thì dùng chung hồ sơ đó. Cấp tài khoản app cho phụ huynh ở trang “Người dùng & lời mời”.</p>
                <div className="sm:col-span-2"><button className="btn">Thêm phụ huynh</button></div>
              </form>
            </details>
          )}
        </section>
      </div>

      <section className="card mt-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold text-navy">Đăng ký gói học</h2>
          {canEdit && <Link href="/admin/enrollments" className="btn-ghost py-1">Đăng ký gói mới</Link>}
        </div>
        {enrollments.length === 0 ? <EmptyState title="Chưa đăng ký gói học nào" /> : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50"><tr><th>Khóa</th><th>Lớp</th><th>Gói</th><th>Bắt đầu</th><th>Số buổi</th><th>Trạng thái</th></tr></thead>
              <tbody>
                {enrollments.map((e) => (
                  <tr key={e.id} className="border-t border-slate-100">
                    <td>{e.course_name}</td>
                    <td><Link className="text-brand hover:underline" href={`/admin/classes/${e.class_id}`}>{e.class_name}</Link></td>
                    <td>{e.plan_name ?? "—"}</td><td>{fmtDate(e.start_date)}</td><td>{e.quota ?? "Theo lượt"}</td>
                    <td>{ENR_LABEL[e.status] ?? e.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </StaffShell>
  );
}

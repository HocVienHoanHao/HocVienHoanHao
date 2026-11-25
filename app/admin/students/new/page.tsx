import Link from "next/link";
import { redirect } from "next/navigation";
import { asUser } from "@/lib/db";
import { requireViewer } from "@/lib/session";
import { managedBranchIds } from "@/lib/students";
import { createStudentProfileAction } from "@/lib/actions/students";
import { StaffShell } from "@/components/StaffShell";
import { Flash } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewStudentPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const viewer = await requireViewer();
  const managed = managedBranchIds(viewer);
  if (managed && managed.length === 0) redirect("/admin/students");
  const sp = await searchParams;
  const branches = (await asUser(viewer.id, (tx) => tx<{ id: string; code: string; name: string }[]>`
    select id, code, name from branches where status = 'ACTIVE' order by code`)).filter((b) => !managed || managed.includes(b.id));

  return (
    <StaffShell viewer={viewer}>
      <div className="mb-1 text-sm"><Link className="text-brand hover:underline" href="/admin/students/profiles">← Danh sách học viên</Link></div>
      <h1 className="text-xl font-bold text-navy">Thêm học viên</h1>
      <p className="text-sm text-slate-500">Mã học viên tự sinh theo chi nhánh (VD: QN-000084). Đăng ký gói học làm ở trang “Đăng ký & bảo lưu”.</p>
      <Flash err={sp.err} />
      <form action={createStudentProfileAction} className="mt-3 grid max-w-3xl gap-3">
        <section className="card grid gap-2 sm:grid-cols-2">
          <h2 className="font-semibold text-navy sm:col-span-2">Học viên</h2>
          <label className="flex flex-col gap-1"><span className="label">Chi nhánh</span>
            <select name="branch" required className="input">{branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}</select></label>
          <label className="flex flex-col gap-1"><span className="label">Họ tên</span>
            <input name="name" required minLength={2} maxLength={120} autoComplete="off" className="input" /></label>
          <label className="flex flex-col gap-1"><span className="label">Ngày sinh (không bắt buộc)</span>
            <input type="date" name="birth" min="1990-01-01" className="input" /></label>
        </section>
        <section className="card grid gap-2 sm:grid-cols-2">
          <h2 className="font-semibold text-navy sm:col-span-2">Phụ huynh <span className="text-sm font-normal text-slate-500">(không bắt buộc, có thể thêm sau)</span></h2>
          <label className="flex flex-col gap-1"><span className="label">Họ tên phụ huynh</span>
            <input name="g_name" maxLength={120} autoComplete="off" className="input" /></label>
          <label className="flex flex-col gap-1"><span className="label">Quan hệ</span>
            <input name="g_relationship" maxLength={50} placeholder="Bố / Mẹ / Ông / Bà…" className="input" /></label>
          <label className="flex flex-col gap-1"><span className="label">Số điện thoại</span>
            <input type="tel" name="g_phone" maxLength={30} inputMode="tel" className="input" /></label>
          <label className="flex flex-col gap-1"><span className="label">Email (không bắt buộc)</span>
            <input type="email" name="g_email" maxLength={254} className="input" /></label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="g_can_request_leave" /> Được xin nghỉ cho con qua app (khi phụ huynh có tài khoản)</label>
          <p className="text-xs text-slate-500 sm:col-span-2">Nếu số điện thoại trùng phụ huynh của học viên khác cùng chi nhánh (anh/chị/em), app dùng chung hồ sơ phụ huynh đó.</p>
        </section>
        <div className="flex gap-2"><button className="btn">Tạo học viên</button><Link href="/admin/students/profiles" className="btn-ghost">Hủy</Link></div>
      </form>
    </StaffShell>
  );
}

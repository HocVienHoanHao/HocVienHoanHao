import Link from "next/link";
import { redirect } from "next/navigation";
import { asUser } from "@/lib/db";
import { fmtVnd, todayVn } from "@/lib/format";
import { requireViewer } from "@/lib/session";
import { managedBranchIds } from "@/lib/students";
import { createStudentProfileAction } from "@/lib/actions/students";
import { StaffShell } from "@/components/StaffShell";
import { Flash } from "@/components/ui";
import { StudentDetailFields } from "@/components/StudentFields";
import { InvoiceFields } from "@/components/InvoiceFields";

export const dynamic = "force-dynamic";

const WD = [[1, "T2"], [2, "T3"], [3, "T4"], [4, "T5"], [5, "T6"], [6, "T7"], [7, "CN"]] as const;

export default async function NewStudentPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const viewer = await requireViewer();
  const managed = managedBranchIds(viewer);
  if (managed && managed.length === 0) redirect("/admin/students");
  const sp = await searchParams;
  const inScope = (b: string) => !managed || managed.includes(b);
  const { branches, classes, plans } = await asUser(viewer.id, async (tx) => ({
    branches: (await tx<{ id: string; code: string; name: string }[]>`select id, code, name from branches where status = 'ACTIVE' order by code`)
      .filter((b) => inScope(b.id)),
    classes: (await tx<{ id: string; name: string; branch_id: string; course: string; code: string }[]>`
      select c.id, c.name, c.branch_id, co.name course, b.code from classes c join courses co on co.id = c.course_id join branches b on b.id = c.branch_id
      where co.status in ('OPEN','PLANNED') order by b.code, co.start_date, c.name`).filter((c) => inScope(c.branch_id)),
    plans: (await tx<{ id: string; name: string; branch_id: string; code: string; price: string; spw: number | null; quota: number | null }[]>`
      select p.id, p.name, p.branch_id, b.code, p.price::text price, p.sessions_per_week spw, p.session_quota quota
      from plans p join branches b on b.id = p.branch_id where p.active order by b.code, p.price`).filter((p) => inScope(p.branch_id)),
  }));
  const multiBranch = branches.length > 1;

  return (
    <StaffShell viewer={viewer}>
      <div className="mb-1 text-sm"><Link className="text-brand hover:underline" href="/admin/students/profiles">← Danh sách học viên</Link></div>
      <h1 className="text-xl font-bold text-navy">Thêm học viên</h1>
      <p className="text-sm text-slate-500">Mã học viên tự sinh theo chi nhánh (VD: QN-000084). Chỉ họ tên và chi nhánh là bắt buộc, các ô khác có thể bổ sung sau.</p>
      <Flash err={sp.err} />
      <form action={createStudentProfileAction} className="mt-3 grid max-w-4xl gap-3">
        <section className="card grid gap-2 sm:grid-cols-2">
          <h2 className="font-semibold text-navy sm:col-span-2">1. Học viên</h2>
          <label className="flex flex-col gap-1"><span className="label">Chi nhánh</span>
            <select name="branch" required className="input">{branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}</select></label>
          <label className="flex flex-col gap-1"><span className="label">Họ & tên học viên</span>
            <input name="name" required minLength={2} maxLength={120} autoComplete="off" className="input" /></label>
          <StudentDetailFields />
        </section>

        <section className="card grid gap-2 sm:grid-cols-2">
          <h2 className="font-semibold text-navy sm:col-span-2">2. Phụ huynh</h2>
          <label className="flex flex-col gap-1"><span className="label">Họ & tên phụ huynh</span>
            <input name="g_name" maxLength={120} autoComplete="off" className="input" /></label>
          <label className="flex flex-col gap-1"><span className="label">Quan hệ</span>
            <input name="g_relationship" maxLength={50} placeholder="Bố / Mẹ / Ông / Bà…" className="input" /></label>
          <label className="flex flex-col gap-1"><span className="label">Số điện thoại</span>
            <input type="tel" name="g_phone" maxLength={30} inputMode="tel" className="input" /></label>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="g_has_zalo" defaultChecked /> Số này có Zalo</label>
          <label className="flex flex-col gap-1"><span className="label">Email (không bắt buộc)</span>
            <input type="email" name="g_email" maxLength={254} className="input" /></label>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="g_can_request_leave" /> Được xin nghỉ cho con qua app</label>
          <p className="text-xs text-slate-500 sm:col-span-2">Số điện thoại trùng phụ huynh của học viên khác cùng chi nhánh (anh/chị/em) thì dùng chung hồ sơ phụ huynh đó.</p>
        </section>

        <section className="card grid gap-2 sm:grid-cols-2">
          <h2 className="font-semibold text-navy sm:col-span-2">3. Đăng ký học <span className="text-sm font-normal text-slate-500">(để trống nếu chưa chốt lớp/gói)</span></h2>
          <label className="flex flex-col gap-1"><span className="label">Lớp đăng ký</span>
            <select name="class" defaultValue="" className="input">
              <option value="">Chưa đăng ký</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{multiBranch ? `${c.code} · ` : ""}{c.course} · {c.name}</option>)}
            </select></label>
          <label className="flex flex-col gap-1"><span className="label">Gói học (tháng / khóa)</span>
            <select name="plan" defaultValue="" className="input">
              <option value="">Chưa đăng ký</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{multiBranch ? `${p.code} · ` : ""}{p.name}{Number(p.price) > 0 ? ` · ${fmtVnd(Number(p.price))}` : ""}</option>)}
            </select></label>
          <label className="flex flex-col gap-1"><span className="label">Ngày bắt đầu học</span>
            <input type="date" name="start" defaultValue={todayVn()} className="input" /></label>
          <div className="flex flex-col gap-1">
            <span className="label">Ngày kết thúc</span>
            <span className="py-2 text-sm text-slate-500">App tự tính theo lịch lớp và số buổi của gói</span>
          </div>
          <fieldset className="sm:col-span-2">
            <legend className="label">Ngày học riêng (chỉ gói 1–2 buổi/tuần; để trống = theo toàn bộ lịch lớp)</legend>
            <div className="mt-1 flex flex-wrap gap-3 text-sm">
              {WD.map(([n, l]) => <label key={n} className="flex items-center gap-1"><input type="checkbox" name="weekdays" value={n} />{l}</label>)}
            </div>
          </fieldset>
          <label className="flex flex-col gap-1"><span className="label">Số buổi bảo lưu từ khóa trước</span>
            <input type="number" name="carryover" min={0} max={100} placeholder="0" className="input" /></label>
          <label className="flex flex-col gap-1"><span className="label">Ghi chú bảo lưu</span>
            <input name="carryover_reason" maxLength={300} placeholder="VD: Bảo lưu 6 buổi khóa K2" className="input" /></label>
          <p className="text-xs text-slate-500 sm:col-span-2">Buổi bảo lưu chỉ dùng trong khóa này (hết hạn khi khóa kết thúc) và mỗi học viên chỉ nhận bảo lưu 1 lần.</p>
        </section>

        <section className="card grid gap-2 sm:grid-cols-2">
          <h2 className="font-semibold text-navy sm:col-span-2">4. Thu tiền <span className="text-sm font-normal text-slate-500">(không bắt buộc, có thể ghi sau trong hồ sơ)</span></h2>
          <InvoiceFields prefix="f_" />
          <p className="text-xs text-slate-500 sm:col-span-2">Còn lại = tổng phải thu − đã thanh toán, app tự tính. Các lần đóng tiền sau ghi trong hồ sơ học viên, mục “Thu tiền”.</p>
        </section>

        <div className="flex gap-2"><button className="btn">Tạo học viên</button><Link href="/admin/students/profiles" className="btn-ghost">Hủy</Link></div>
      </form>
    </StaffShell>
  );
}

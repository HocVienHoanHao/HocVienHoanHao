import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { asUser } from "@/lib/db";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { isStaff, requireViewer } from "@/lib/session";
import { StaffShell } from "@/components/StaffShell";
import { EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;
const STATUS = { OPEN: "Mới", IN_PROGRESS: "Đang xử lý", RESOLVED: "Đã xử lý", CLOSED: "Đóng" } as const;
const TYPE = { ABSENCE_STREAK: "Vắng liên tiếp", RENEWAL: "Hết quyền học", OTHER: "Khác" } as const;

type CaseRow = {
  id: string; type: keyof typeof TYPE; priority: string; status: keyof typeof STATUS; reason: string;
  due_at: string | null; created_at: string; student_code: string; student_name: string; branch_code: string;
  assignee_name: string | null; absence_reason: string | null; expected_return_date: string | null;
  last_note: string | null;
};

async function updateCase(formData: FormData) {
  "use server";
  const viewer = await requireViewer();
  const id = String(formData.get("id"));
  const status = String(formData.get("status") || "");
  const assignee = String(formData.get("assignee") || "");
  const note = String(formData.get("note") || "").trim().slice(0, 2000);
  const reason = String(formData.get("absence_reason") || "").trim().slice(0, 200);
  const ret = String(formData.get("expected_return") || "");
  if (!UUID.test(id)) throw new Error("Hồ sơ không hợp lệ");
  if (status && !(status in STATUS)) throw new Error("Trạng thái không hợp lệ");
  if (assignee && !UUID.test(assignee)) throw new Error("Người phụ trách không hợp lệ");
  if (ret && !/^\d{4}-\d{2}-\d{2}$/.test(ret)) throw new Error("Ngày không hợp lệ");
  await asUser(viewer.id, (tx) => tx`select public.update_care_case(${id}::uuid, ${status || null}::care_status,
    ${assignee || null}::uuid, ${note || null}, 'PHONE', null, ${reason || null}, ${ret || null}::date)`);
  revalidatePath("/admin/care");
}

export default async function CarePage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const viewer = await requireViewer();
  if (!isStaff(viewer)) redirect("/");
  const showAll = (await searchParams).all === "1";

  const { cases, staff } = await asUser(viewer.id, async (tx) => ({
    cases: await tx<CaseRow[]>`
      select c.id, c.type::text, c.priority::text, c.status::text, c.reason, c.due_at, c.created_at,
             s.student_code, s.full_name student_name, b.code branch_code, p.full_name assignee_name,
             c.absence_reason, c.expected_return_date::text,
             (select note from care_interactions i where i.case_id = c.id and note is not null order by created_at desc limit 1) last_note
      from care_cases c join students s on s.id = c.student_id join branches b on b.id = c.branch_id
      left join profiles p on p.id = c.assignee
      where ${showAll} or c.status in ('OPEN','IN_PROGRESS')
      order by (c.priority = 'HIGH') desc, c.due_at nulls last, c.created_at desc
      limit 200`,
    // người có thể nhận việc: nhân sự chi nhánh mà quản lý xem được
    staff: await tx<{ id: string; full_name: string; role: string }[]>`
      select distinct p.id, p.full_name, m.role::text role from branch_memberships m join profiles p on p.id = m.user_id
      where m.active and m.role in ('CARE_STAFF','COACH','BRANCH_MANAGER') order by p.full_name`,
  }));

  return (
    <StaffShell viewer={viewer}>
      <h1 className="mb-1 text-xl font-bold text-navy">Chăm sóc học viên</h1>
      <p className="mb-4 text-sm text-slate-500">
        Tự tạo khi vắng không phép 2 buổi liên tiếp (3 buổi: ưu tiên cao) và khi hết quyền học. Ghi chú ở đây là nội bộ, không gửi phụ huynh.
      </p>
      <a className="btn-ghost mb-3" href={showAll ? "/admin/care" : "/admin/care?all=1"}>{showAll ? "Chỉ việc đang mở" : "Xem cả việc đã đóng"}</a>
      {cases.length === 0 ? <EmptyState title="Không có việc chăm sóc cần xử lý" /> : (
        <div className="space-y-3">
          {cases.map((c) => (
            <article key={c.id} className={`card ${c.priority === "HIGH" ? "ring-2 ring-rose-300" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-xs text-slate-500">{c.branch_code} · {TYPE[c.type]} · tạo {fmtDateTime(String(c.created_at))}</div>
                  <div className="font-semibold text-navy">{c.student_name} <span className="font-mono text-xs text-slate-500">{c.student_code}</span></div>
                  <div className="text-sm">{c.reason}</div>
                </div>
                <div className="text-right text-sm">
                  {c.priority === "HIGH" && <div className="font-semibold text-rose-700">Ưu tiên cao</div>}
                  <div>{STATUS[c.status]}</div>
                  <div className="text-xs text-slate-500">Hạn liên hệ {fmtDateTime(c.due_at ? String(c.due_at) : null)}</div>
                </div>
              </div>
              <div className="mt-2 text-xs text-slate-600">
                Phụ trách: {c.assignee_name ?? "chưa giao"}
                {c.absence_reason && <> · Lý do nghỉ: {c.absence_reason}</>}
                {c.expected_return_date && <> · Dự kiến trở lại: {fmtDate(c.expected_return_date)}</>}
                {c.last_note && <div className="mt-1 italic">“{c.last_note}”</div>}
              </div>
              <form action={updateCase} className="mt-3 grid gap-2 sm:grid-cols-6">
                <input type="hidden" name="id" value={c.id} />
                <select name="status" defaultValue="" className="input sm:col-span-1" aria-label="Trạng thái">
                  <option value="">Giữ trạng thái</option>
                  {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <select name="assignee" defaultValue="" className="input sm:col-span-1" aria-label="Giao cho">
                  <option value="">Giữ người phụ trách</option>
                  {staff.map((s) => <option key={s.id + s.role} value={s.id}>{s.full_name}</option>)}
                </select>
                <input name="absence_reason" placeholder="Lý do nghỉ" className="input sm:col-span-1" />
                <input name="expected_return" type="date" className="input sm:col-span-1" aria-label="Ngày dự kiến trở lại" />
                <input name="note" placeholder="Ghi chú liên hệ (nội bộ)" className="input sm:col-span-1" />
                <button className="btn sm:col-span-1">Cập nhật</button>
              </form>
            </article>
          ))}
        </div>
      )}
    </StaffShell>
  );
}

import Link from "next/link";
import { revalidatePath } from "next/cache";
import { asUser } from "@/lib/db";
import { fmtDate, fmtDateTime, isIsoDate, todayVn } from "@/lib/format";
import { classProgress, type ClassProgress } from "@/lib/progress";
import { requireViewer } from "@/lib/session";
import { StaffShell } from "@/components/StaffShell";
import { EmptyState, MilestoneDate, ProgressBar } from "@/components/ui";

export const dynamic = "force-dynamic";

const STATUSES = [
  ["PRESENT", "Có mặt"], ["ABSENT_EXCUSED", "Nghỉ có phép"], ["ABSENT_UNEXCUSED", "Nghỉ không phép"],
  ["TRIAL", "Học thử"], ["NOT_MARKED", "Chưa điểm danh"],
] as const;
const UUID = /^[0-9a-f-]{36}$/i;

async function saveAttendance(formData: FormData) {
  "use server";
  const viewer = await requireViewer();
  const sessionId = String(formData.get("session"));
  if (!UUID.test(sessionId)) throw new Error("Buổi không hợp lệ");
  const entries = [...formData.entries()].filter(([k]) => k.startsWith("st_"));
  await asUser(viewer.id, async (tx) => {
    for (const [k, v] of entries) {
      const studentId = k.slice(3);
      const status = String(v);
      if (!UUID.test(studentId) || !STATUSES.some(([s]) => s === status)) throw new Error("Dữ liệu điểm danh không hợp lệ");
      // quyền kiểm tra trong RPC (HLV được phân công / quản lý chi nhánh)
      await tx`select public.record_attendance(${sessionId}::uuid, ${studentId}::uuid, ${status}::attendance_status, null, null)`;
    }
  });
  revalidatePath("/coach");
}

async function confirmSession(formData: FormData) {
  "use server";
  const viewer = await requireViewer();
  const sessionId = String(formData.get("session"));
  if (!UUID.test(sessionId)) throw new Error("Buổi không hợp lệ");
  await asUser(viewer.id, async (tx) => {
    const [s] = await tx`select scheduled_start from sessions where id = ${sessionId}`;
    if (!s) throw new Error("Không tìm thấy buổi");
    await tx`select public.confirm_session(${sessionId}::uuid, ${s.scheduled_start}::timestamptz, null)`;
  });
  revalidatePath("/coach");
}

export default async function CoachPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const date = isIsoDate(sp.date) ? sp.date : todayVn();

  const data = await asUser(viewer.id, async (tx) => {
    // chỉ lớp được phân công (RLS + app.is_class_coach); quản lý chi nhánh cũng xem được
    const classes = await tx<{ id: string; name: string }[]>`select c.id, c.name from classes c
      where app.can_mark_attendance(c.id) order by c.name`;
    const out: { cls: { id: string; name: string }; progress: ClassProgress;
      sessions: { id: string; status: string; scheduled_start: string; actual_start: string | null;
        roster: { id: string; code: string; name: string; status: string | null }[] }[] }[] = [];
    for (const cls of classes) {
      const progress = await classProgress(tx, cls.id, date);
      const sessions = await tx<{ id: string; status: string; scheduled_start: string; actual_start: string | null }[]>`
        select id, status::text, scheduled_start, actual_start from sessions s
        where s.class_id = ${cls.id} and app.session_date(s) = ${date}::date and s.status <> 'cancelled'
        order by coalesce(actual_start, scheduled_start), id`;
      const withRoster = [];
      for (const s of sessions) {
        const roster = await tx<{ id: string; code: string; name: string; status: string | null }[]>`
          select st.id, st.student_code code, st.full_name name, a.status::text status
          from enrollments e join students st on st.id = e.student_id
          left join attendance a on a.session_id = ${s.id} and a.student_id = st.id
          where e.class_id = ${cls.id} and e.status in ('CONFIRMED','COMPLETED','TRANSFERRED') and e.start_date <= ${date}::date
          order by st.full_name`;
        withRoster.push({ ...s, roster });
      }
      out.push({ cls, progress, sessions: withRoster });
    }
    return out;
  });

  return (
    <StaffShell viewer={viewer}>
      <h1 className="mb-1 text-xl font-bold text-navy">Lịch hôm nay & điểm danh</h1>
      <form method="get" className="mb-4 flex items-end gap-2">
        <label className="flex flex-col gap-1"><span className="label">Ngày</span><input type="date" name="date" defaultValue={date} className="input" /></label>
        <button className="btn">Xem</button>
      </form>
      {data.length === 0 && <EmptyState title="Chưa được phân công lớp nào" />}
      <div className="space-y-4">
        {data.map(({ cls, progress, sessions }) => (
          <section key={cls.id} className="card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-navy">{cls.name}</h2>
              <div className="text-sm"><b>{progress.class_completed_sessions}/{progress.class_target_sessions}</b> buổi · tháng học {progress.current_month ?? "—"} · kết thúc khóa <MilestoneDate m={progress.course_end} /></div>
            </div>
            <div className="mt-2"><ProgressBar value={progress.class_completed_sessions} max={progress.class_target_sessions} label="Tiến độ lớp" /></div>
            {sessions.length === 0 && <p className="mt-3 text-sm text-slate-500">Không có buổi tập ngày {fmtDate(date)}.</p>}
            {sessions.map((s) => (
              <div key={s.id} className="mt-4 rounded-lg border border-slate-200 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium">Buổi {fmtDateTime(s.actual_start ?? s.scheduled_start)} · {s.status === "completed" ? "Đã xác nhận tổ chức" : "Chưa xác nhận tổ chức"}</div>
                  {s.status === "scheduled" && (
                    <form action={confirmSession}><input type="hidden" name="session" value={s.id} /><button className="btn-ghost">Xác nhận buổi đã diễn ra</button></form>
                  )}
                </div>
                {s.status === "scheduled" && <p className="mb-2 text-xs text-amber-800">Điểm danh được lưu nhưng chỉ trừ buổi sau khi xác nhận buổi đã diễn ra.</p>}
                <form action={saveAttendance} className="space-y-2">
                  <input type="hidden" name="session" value={s.id} />
                  {s.roster.map((r) => (
                    <fieldset key={r.id} className="flex flex-col gap-1 border-t border-slate-100 pt-2 sm:flex-row sm:items-center sm:justify-between">
                      <legend className="sr-only">{r.name}</legend>
                      <span className="text-sm"><span className="font-mono text-xs text-slate-500">{r.code}</span> {r.name}</span>
                      <select name={`st_${r.id}`} defaultValue={r.status ?? "NOT_MARKED"} className="input" aria-label={`Trạng thái ${r.name}`}>
                        {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </fieldset>
                  ))}
                  {s.roster.length > 0 && <button className="btn w-full sm:w-auto">Lưu điểm danh ({s.roster.length} em)</button>}
                </form>
              </div>
            ))}
            <Link className="mt-3 inline-block text-sm text-brand underline" href={`/admin/classes/${cls.id}?asOf=${date}`}>Xem chi tiết tiến độ lớp</Link>
          </section>
        ))}
      </div>
    </StaffShell>
  );
}

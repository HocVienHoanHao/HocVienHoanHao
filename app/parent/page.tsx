import Link from "next/link";
import { asUser } from "@/lib/db";
import { fmtCount, fmtDate, todayVn } from "@/lib/format";
import { classProgress, studentProgressList, type StudentProgress } from "@/lib/progress";
import { requireViewer } from "@/lib/session";
import { DemoBanner, EmptyState, Flash, MilestoneDate, ProgressBar, StatusBadge } from "@/components/ui";
import { requestLeaveAction } from "@/lib/actions/leaves";

export const dynamic = "force-dynamic";

const ATT: Record<string, string> = { PRESENT: "Có mặt", ABSENT_EXCUSED: "Nghỉ có phép", ABSENT_UNEXCUSED: "Nghỉ không phép", TRIAL: "Học thử", NOT_MARKED: "Chưa điểm danh" };

const LEAVE: Record<string, string> = { REQUESTED: "Chờ duyệt", APPROVED: "Đã duyệt", REJECTED: "Không duyệt", CANCELLED: "Đã hủy" };

export default async function ParentPage({ searchParams }: { searchParams: Promise<{ child?: string; ok?: string; err?: string }> }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const asOf = todayVn();

  const data = await asUser(viewer.id, async (tx) => {
    // RPC chỉ trả các đăng ký của con đã được liên kết + xác minh
    const all = await studentProgressList(tx, asOf);
    const children = [...new Map(all.map((p) => [p.student_id, p.student_name])).entries()];
    const childId = children.find(([id]) => id === sp.child)?.[0] ?? children[0]?.[0];
    const mine = all.filter((p) => p.student_id === childId);
    const current: StudentProgress | undefined =
      mine.find((p) => p.enrollment_status === "CONFIRMED" && p.start_date <= asOf) ?? mine[0];
    if (!current) return { children, current: null };
    const cls = await classProgress(tx, current.class_id, asOf);
    const history = await tx<{ d: string; status: string }[]>`select app.session_date(s)::text d, a.status::text status
      from attendance a join sessions s on s.id = a.session_id
      where a.student_id = ${current.student_id} and s.status = 'completed' order by s.actual_start desc limit 10`;
    const upcoming = await tx<{ d: string; status: string }[]>`select app.session_date(s)::text d, s.status::text status from sessions s
      where s.class_id = ${current.class_id} and s.status = 'scheduled' and app.session_date(s) >= ${asOf}::date
      order by s.scheduled_start limit 8`;
    const notes = await tx<{ id: string; content: string; d: string }[]>`select id, content,
      to_char(shared_at at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') d from notes
      where student_id = ${current.student_id} and visibility = 'PARENT' order by shared_at desc limit 5`;
    const alerts = await tx<{ id: string; title: string; body: string; d: string }[]>`select id, title, body,
      to_char(created_at at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') d from notifications
      where student_id = ${current.student_id} order by created_at desc limit 5`;
    const [perm] = await tx<{ can: boolean }[]>`select gs.can_request_leave can from guardian_students gs
      join guardians g on g.id = gs.guardian_id
      where g.user_id = ${viewer.id} and gs.student_id = ${current.student_id} and gs.verified_at is not null`;
    const leaves = await tx<{ id: string; from_date: string; to_date: string; status: string }[]>`select id, from_date::text from_date,
      to_date::text to_date, status::text status from student_leaves where student_id = ${current.student_id}
      order by from_date desc limit 5`;
    return { children, current, cls, history, upcoming, notes, alerts, enrollments: mine, canLeave: Boolean(perm?.can), leaves };
  });

  const p = data.current;
  return (
    <div className="min-h-screen pb-20">
      <DemoBanner />
      <header className="bg-navy px-4 py-3 text-white">
        <div className="font-extrabold">HOÀN HẢO <span className="text-accent">FOOTBALL</span></div>
        <div className="text-xs text-slate-300">Xin chào {viewer.fullName} · số liệu tới hôm nay {fmtDate(asOf)}</div>
      </header>
      <main className="mx-auto max-w-xl space-y-3 p-4">
        {data.children.length > 1 && (
          <nav className="flex gap-2 overflow-x-auto" aria-label="Chọn con">
            {data.children.map(([id, name]) => (
              <Link key={id} href={`/parent?child=${id}`} className={`rounded-full px-3 py-1 text-sm ring-1 ${id === p?.student_id ? "bg-brand text-white ring-brand" : "bg-white ring-slate-300"}`}>{name}</Link>
            ))}
          </nav>
        )}
        <Flash ok={sp.ok} err={sp.err} />
        {!p ? <EmptyState title="Chưa có học viên được liên kết">Liên kết cần được học viện xác minh trước khi hiển thị.</EmptyState> : (
          <>
            <section className="card">
              <div className="text-lg font-bold text-navy">{p.student_name}</div>
              <div className="text-sm text-slate-500">{p.class_name} · bắt đầu {fmtDate(p.start_date)} · gói {p.quota ?? "theo lượt"} buổi</div>
              {p.data_status === "NO_DATA" && <p className="mt-2 rounded bg-slate-100 p-2 text-sm">Học viện đang đối chiếu dữ liệu điểm danh: Chưa đủ dữ liệu.</p>}
            </section>
            <section className="grid grid-cols-3 gap-2 text-center">
              <div className="card p-3"><div className="label">Lớp đã tập</div><div className="text-2xl font-extrabold text-navy">{data.cls?.class_completed_sessions}<span className="text-sm font-medium text-slate-500">/{data.cls?.class_target_sessions}</span></div></div>
              <div className="card p-3"><div className="label">Con đã học</div><div className="text-2xl font-extrabold text-navy">{fmtCount(p.present_sessions)}</div></div>
              <div className="card p-3"><div className="label">Con còn quyền học</div><div className={`text-2xl font-extrabold ${p.available_sessions != null && p.available_sessions <= 3 ? "text-rose-700" : "text-navy"}`}>{fmtCount(p.available_sessions)}</div></div>
            </section>
            {p.renewal_alert && (
              <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
                {p.renewal_alert === "RENEW_0" ? "Con đã dùng hết buổi học của gói. Vui lòng liên hệ học viện để đăng ký tiếp." : `Con còn ${p.available_sessions} buổi học. Phụ huynh có thể đăng ký gói mới khi thuận tiện.`}
              </div>
            )}
            {data.alerts && data.alerts.length > 0 && (
              <section className="card text-sm">
                <h2 className="mb-2 font-semibold text-navy">Thông báo</h2>
                {data.alerts.map((a) => (
                  <div key={a.id} className="border-t border-slate-100 py-1"><b>{a.title}</b> <span className="text-xs text-slate-400">({fmtDate(a.d)})</span><div className="text-slate-600">{a.body}</div></div>
                ))}
              </section>
            )}
            <section className="card space-y-2 text-sm">
              <h2 className="font-semibold text-navy">Tiến độ của con</h2>
              <ProgressBar value={p.present_sessions} max={p.quota ?? 1} label="Số buổi con đã học" />
              <div className="flex justify-between"><span>Đã cấp / đã trừ</span><span>{fmtCount(p.granted_sessions)} / {fmtCount(p.charged_sessions)}</span></div>
              {(p.carryover_available ?? 0) > 0 && <div className="flex justify-between"><span>Buổi bảo lưu (đã gồm trong số còn lại)</span><span>{p.carryover_available}</span></div>}
              <div className="flex justify-between"><span>Đi học gần nhất</span><span>{fmtDate(p.last_attended_date)}</span></div>
              <div className="flex justify-between"><span>Tháng học hiện tại</span><span>{p.current_month ? `Tháng ${p.current_month}` : "—"}</span></div>
              <div className="flex justify-between"><span>Dự kiến hết tháng học</span><MilestoneDate m={p.current_month_milestone} /></div>
              <div className="flex justify-between"><span>Dự kiến hết gói</span><MilestoneDate m={p.package_end} /></div>
              <div className="flex justify-between"><span>Dự kiến hết quyền học</span>
                {p.entitlement_exhaustion.estimated_date ? <span>{fmtDate(p.entitlement_exhaustion.estimated_date)}</span> : <StatusBadge status={p.entitlement_exhaustion.status} label={p.entitlement_exhaustion.label} />}</div>
              {p.invoice_due_date && <div className="flex justify-between"><span>Hạn thanh toán hóa đơn</span><span>{fmtDate(p.invoice_due_date)}</span></div>}
              <p className="text-xs text-slate-500">Ngày dự kiến tính theo lịch tập đã xác nhận, giả định con đi học đủ; có thể thay đổi khi lịch hoặc điểm danh thay đổi.</p>
            </section>
            <section className="card text-sm">
              <h2 className="mb-2 font-semibold text-navy">Lịch tập sắp tới</h2>
              {data.upcoming?.length ? <ul className="space-y-1">{data.upcoming.map((u) => <li key={u.d}>{fmtDate(u.d)}</li>)}</ul> : <p className="text-slate-500">Chưa có lịch tập mới.</p>}
            </section>
            <section id="xin-nghi" className="card text-sm">
              <h2 className="mb-2 font-semibold text-navy">Xin nghỉ</h2>
              {data.canLeave ? (
                <form action={requestLeaveAction} className="grid grid-cols-2 gap-2">
                  <input type="hidden" name="student" value={p.student_id} />
                  <input type="hidden" name="back" value={`/parent?child=${p.student_id}#xin-nghi`} />
                  <label className="flex flex-col gap-1"><span className="label">Từ ngày</span><input type="date" name="from" required min={asOf} className="input" /></label>
                  <label className="flex flex-col gap-1"><span className="label">Đến ngày</span><input type="date" name="to" min={asOf} className="input" /></label>
                  <label className="col-span-2 flex flex-col gap-1"><span className="label">Lý do</span><input name="reason" required maxLength={500} className="input" /></label>
                  <p className="col-span-2 text-xs text-slate-500">Theo quy định của học viện, buổi nghỉ không được bảo lưu và vẫn tính vào gói. Trường hợp đặc biệt, phụ huynh vui lòng liên hệ học viện.</p>
                  <div className="col-span-2"><button className="btn w-full">Gửi đơn xin nghỉ</button></div>
                </form>
              ) : <p className="text-slate-500">Vui lòng liên hệ học viện để xin nghỉ cho con.</p>}
              {data.leaves && data.leaves.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-slate-100 pt-2">
                  {data.leaves.map((l) => (
                    <li key={l.id} className="flex justify-between">
                      <span>{fmtDate(l.from_date)}{l.to_date !== l.from_date && ` – ${fmtDate(l.to_date)}`}</span>
                      <span>{LEAVE[l.status] ?? l.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="card text-sm">
              <h2 className="mb-2 font-semibold text-navy">Lịch sử điểm danh</h2>
              {data.history?.length ? <ul className="space-y-1">{data.history.map((h) => <li key={h.d + h.status} className="flex justify-between"><span>{fmtDate(h.d)}</span><span>{ATT[h.status]}</span></li>)}</ul> : <p className="text-slate-500">Chưa có.</p>}
            </section>
            {data.notes && data.notes.length > 0 && (
              <section className="card text-sm">
                <h2 className="mb-2 font-semibold text-navy">Nhận xét của HLV</h2>
                {data.notes.map((n) => <p key={n.id} className="border-t border-slate-100 py-1">{n.content} <span className="text-xs text-slate-400">({fmtDate(n.d)})</span></p>)}
              </section>
            )}
          </>
        )}
      </main>
      <nav className="fixed inset-x-0 bottom-0 flex justify-around border-t border-slate-200 bg-white py-2 text-xs" aria-label="Điều hướng phụ huynh">
        <Link href="/parent" className="font-semibold text-brand">Tiến độ</Link>
        <span className="text-slate-400" aria-disabled>Hóa đơn</span>
        <Link href={p ? `/parent?child=${p.student_id}#xin-nghi` : "/parent"} className="text-slate-600">Xin nghỉ</Link>
        <Link href="/login" className="text-slate-600">Tài khoản</Link>
      </nav>
    </div>
  );
}

/**
 * Dữ liệu GIẢ (synthetic) cho test và demo. Không phải học viên/phụ huynh thật.
 * Tên dạng "HV Demo 01", không có số điện thoại thật.
 */
import type { Sql } from "./harness";
import { rpc, asUser } from "./harness";

export const ID = {
  branch: { QN: "10000000-0000-0000-0000-000000000001", PY: "10000000-0000-0000-0000-000000000002", PM: "10000000-0000-0000-0000-000000000003" },
  user: {
    superAdmin: "20000000-0000-0000-0000-000000000001",
    managerQN: "20000000-0000-0000-0000-000000000002",
    coachQN: "20000000-0000-0000-0000-000000000003",
    coachPM: "20000000-0000-0000-0000-000000000004",
    accountantQN: "20000000-0000-0000-0000-000000000005",
    careQN: "20000000-0000-0000-0000-000000000006",
    parentA: "20000000-0000-0000-0000-000000000007",
    parentB: "20000000-0000-0000-0000-000000000008",
    managerPM: "20000000-0000-0000-0000-000000000009",
  },
  course: { QN_K3: "30000000-0000-0000-0000-000000000001", PM_K1: "30000000-0000-0000-0000-000000000002", QN_K4: "30000000-0000-0000-0000-000000000003" },
  class: { QN_U10: "40000000-0000-0000-0000-000000000001", PM_U8: "40000000-0000-0000-0000-000000000002", QN_K4_U10: "40000000-0000-0000-0000-000000000003" },
  plan: {
    std3m: "50000000-0000-0000-0000-000000000001",
    std1m: "50000000-0000-0000-0000-000000000002",
    twice2m: "50000000-0000-0000-0000-000000000003",
    std4m: "50000000-0000-0000-0000-000000000004",
    perSession: "50000000-0000-0000-0000-000000000005",
    pm3m: "50000000-0000-0000-0000-000000000006",
  },
  venue: { QN: "60000000-0000-0000-0000-000000000001", PM: "60000000-0000-0000-0000-000000000002" },
};

/** Thứ 2/4/6 (ISO 1,3,5) <= endDate, lấy n ngày gần nhất, tăng dần. */
export function mwfDatesBack(endDate: string, n: number): string[] {
  const out: string[] = [];
  const t = new Date(`${endDate}T00:00:00Z`);
  while (out.length < n) {
    const dow = t.getUTCDay(); // 0=CN
    if (dow === 1 || dow === 3 || dow === 5) out.unshift(t.toISOString().slice(0, 10));
    t.setUTCDate(t.getUTCDate() - 1);
  }
  return out;
}

/** 17:30 giờ VN (UTC+7) của một ngày */
export const vnAt = (date: string, hhmm = "17:30") => `${date}T${hhmm}:00+07:00`;

export async function seedBase(sql: Sql) {
  const u = ID.user;
  await sql`insert into branches (id, code, name) values
    (${ID.branch.QN}, 'QN', 'Quy Nhơn'), (${ID.branch.PY}, 'PY', 'Phú Yên'), (${ID.branch.PM}, 'PM', 'Phù Mỹ')`;
  const profiles: [string, string][] = [
    [u.superAdmin, "Admin Demo"], [u.managerQN, "QL Quy Nhơn Demo"], [u.coachQN, "HLV QN Demo"],
    [u.coachPM, "HLV PM Demo"], [u.accountantQN, "Kế toán QN Demo"], [u.careQN, "CSKH QN Demo"],
    [u.parentA, "Phụ huynh A Demo"], [u.parentB, "Phụ huynh B Demo"], [u.managerPM, "QL Phù Mỹ Demo"],
  ];
  for (const [id, name] of profiles) await sql`insert into profiles (id, full_name) values (${id}, ${name})`;
  await sql`insert into branch_memberships (user_id, branch_id, role) values
    (${u.superAdmin}, null, 'SUPER_ADMIN'),
    (${u.managerQN}, ${ID.branch.QN}, 'BRANCH_MANAGER'),
    (${u.coachQN}, ${ID.branch.QN}, 'COACH'),
    (${u.coachPM}, ${ID.branch.PM}, 'COACH'),
    (${u.accountantQN}, ${ID.branch.QN}, 'ACCOUNTANT'),
    (${u.careQN}, ${ID.branch.QN}, 'CARE_STAFF'),
    (${u.managerPM}, ${ID.branch.PM}, 'BRANCH_MANAGER')`;

  await sql`insert into venues (id, branch_id, name) values
    (${ID.venue.QN}, ${ID.branch.QN}, 'Sân Demo QN'), (${ID.venue.PM}, ${ID.branch.PM}, 'Sân Demo PM')`;
  await sql`insert into courses (id, branch_id, code, name, year, start_date, end_date, status) values
    (${ID.course.QN_K3}, ${ID.branch.QN}, 'K3', 'Khóa 3/2026', 2026, '2026-09-18', '2026-12-31', 'OPEN'),
    (${ID.course.QN_K4}, ${ID.branch.QN}, 'K4', 'Khóa 4/2026', 2026, '2026-12-14', '2027-03-31', 'PLANNED'),
    (${ID.course.PM_K1}, ${ID.branch.PM}, 'K1', 'Khóa 1/2026', 2026, '2026-10-05', '2026-12-31', 'OPEN')`;
  const mwf = sql.json({ weekdays: [1, 3, 5], start: "17:30", end: "19:00" });
  await sql`insert into classes (id, branch_id, course_id, venue_id, name, age_group, schedule, planned_session_count, monthly_session_targets, attendance_tracked_from) values
    (${ID.class.QN_U10}, ${ID.branch.QN}, ${ID.course.QN_K3}, ${ID.venue.QN}, 'U10 Chiều 2-4-6', 'U10', ${mwf}, 36, '{12,24,36}', '2026-09-18'),
    (${ID.class.QN_K4_U10}, ${ID.branch.QN}, ${ID.course.QN_K4}, ${ID.venue.QN}, 'U10 K4 2-4-6', 'U10', ${mwf}, 36, '{12,24,36}', '2026-12-14'),
    (${ID.class.PM_U8}, ${ID.branch.PM}, ${ID.course.PM_K1}, ${ID.venue.PM}, 'U8 Sáng 2-4-6', 'U8', ${mwf}, 36, '{12,24,36}', '2026-10-05')`;
  await sql`insert into coach_assignments (class_id, coach_id, start_date) values
    (${ID.class.QN_U10}, ${u.coachQN}, '2026-09-01'), (${ID.class.QN_K4_U10}, ${u.coachQN}, '2026-12-01'),
    (${ID.class.PM_U8}, ${u.coachPM}, '2026-09-01')`;
  await sql`insert into plans (id, branch_id, name, months, sessions_per_week, session_quota, milestone_targets, price) values
    (${ID.plan.std3m}, ${ID.branch.QN}, 'Gói 3 tháng (36 buổi)', 3, 3, 36, '{12,24,36}', 0),
    (${ID.plan.std1m}, ${ID.branch.QN}, 'Gói 1 tháng (12 buổi)', 1, 3, 12, '{12}', 0),
    (${ID.plan.twice2m}, ${ID.branch.QN}, 'Gói 2 buổi/tuần 2 tháng (16 buổi)', 2, 2, 16, '{8,16}', 0),
    (${ID.plan.std4m}, ${ID.branch.QN}, 'Gói 4 tháng (48 buổi)', 4, 3, 48, '{12,24,36,48}', 0),
    (${ID.plan.pm3m}, ${ID.branch.PM}, 'Gói 3 tháng (36 buổi)', 3, 3, 36, '{12,24,36}', 0)`;
  await sql`insert into plans (id, branch_id, name, billing_type, price) values
    (${ID.plan.perSession}, ${ID.branch.QN}, 'Theo lượt', 'PER_SESSION', 0)`;
}

let studentSeq = 0;
export async function addStudent(sql: Sql, branchId: string, name?: string): Promise<string> {
  studentSeq += 1;
  const code = `DEMO-${String(studentSeq).padStart(4, "0")}`;
  const [r] = await sql`insert into students (student_code, full_name, status, primary_branch_id, is_synthetic)
    values (${code}, ${name ?? `HV Demo ${String(studentSeq).padStart(2, "0")}`}, 'ACTIVE', ${branchId}, true) returning id`;
  return r.id as string;
}

export async function linkGuardian(sql: Sql, userId: string, studentId: string, opts: { verified?: boolean } = {}) {
  const verified = opts.verified ?? true;
  const existing = await sql`select id from guardians where user_id = ${userId}`;
  const gid = existing[0]?.id ?? (await sql`insert into guardians (user_id, full_name, verified_at)
      values (${userId}, 'Phụ huynh Demo', now()) returning id`)[0].id;
  await sql`insert into guardian_students (guardian_id, student_id, relationship, verified_at, can_request_leave)
    values (${gid}, ${studentId}, 'Phụ huynh', ${verified ? new Date().toISOString() : null}, true)`;
}

/** Tạo + xác nhận đăng ký qua RPC create_enrollment (snapshot từ gói) dưới quyền quản lý. */
export async function enroll(sql: Sql, args: {
  managerId: string; studentId: string; branchId?: string; courseId?: string; classId: string; planId: string;
  startDate: string; weekdays?: number[] | null; validUntil?: string | null; confirm?: boolean;
}): Promise<string> {
  return asUser(sql, args.managerId, async (tx) => {
    const [r] = await tx`select public.create_enrollment(${args.studentId}::uuid, ${args.classId}::uuid, ${args.planId}::uuid,
      ${args.startDate}::date, ${args.weekdays ?? null}::int[], ${args.confirm ?? true}, ${args.validUntil ?? null}::date) as id`;
    return r.id as string;
  });
}

export async function addSessions(sql: Sql, classId: string, courseId: string, dates: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const d of dates) {
    const [r] = await sql`insert into sessions (class_id, course_id, scheduled_start, scheduled_end)
      values (${classId}, ${courseId}, ${vnAt(d)}, ${vnAt(d, "19:00")}) returning id`;
    ids.push(r.id as string);
  }
  return ids;
}

export async function confirmSession(sql: Sql, actor: string, sessionId: string) {
  const [s] = await sql`select scheduled_start from sessions where id = ${sessionId}`;
  await rpc(sql, actor, "confirm_session", [sessionId, s.scheduled_start, null]);
}

export async function mark(sql: Sql, actor: string, sessionId: string, studentId: string, status: string, enrollmentId: string | null = null) {
  return rpc<{ charge: string; enrollment_id: string }>(sql, actor, "record_attendance", [sessionId, studentId, status, null, enrollmentId]);
}

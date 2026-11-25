/** Phase 2 — RPC quản lý: tạo đăng ký, sinh lịch, dời buổi, xin nghỉ. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, rpc, setClock, type Sql } from "./harness";
import { ID, addStudent, enroll, linkGuardian, seedBase } from "./fixtures";

const M = ID.user.managerQN;
let sql: Sql; let drop: () => Promise<void>;

beforeAll(async () => {
  ({ sql, drop } = await createTestDb());
  await setClock(sql, "2026-11-25T13:00:00Z");
  await seedBase(sql);
});
afterAll(async () => { await drop?.(); });

type SP = { quota: number; available_sessions: number; study_milestones: { target: number }[]; class_completed_sessions: number };

describe("create_enrollment", () => {
  it("snapshot quota/mốc từ gói; đổi gói sau đó không ảnh hưởng đăng ký cũ", async () => {
    const sid = await addStudent(sql, ID.branch.QN);
    const eid = await enroll(sql, { managerId: M, studentId: sid, classId: ID.class.QN_U10, planId: ID.plan.twice2m, startDate: "2026-11-23", weekdays: [1, 5] });
    await sql`update plans set session_quota = 99, milestone_targets = '{50,99}' where id = ${ID.plan.twice2m}`;
    const p = await rpc<SP>(sql, M, "student_progress", [eid, "2026-11-25"]);
    expect(p.quota).toBe(16);
    expect(p.available_sessions).toBe(16);
    expect(p.study_milestones.map((m) => m.target)).toEqual([8, 16]);
    await sql`update plans set session_quota = 16, milestone_targets = '{8,16}' where id = ${ID.plan.twice2m}`;
  });
  it("số ngày học cá nhân phải khớp số buổi/tuần của gói", async () => {
    const sid = await addStudent(sql, ID.branch.QN);
    await expect(enroll(sql, { managerId: M, studentId: sid, classId: ID.class.QN_U10, planId: ID.plan.twice2m, startDate: "2026-11-23", weekdays: [1] })).rejects.toThrow(/buổi\/tuần/);
  });
  it("gói chi nhánh khác, quản lý chi nhánh khác, HLV: bị từ chối", async () => {
    const sid = await addStudent(sql, ID.branch.QN);
    await expect(enroll(sql, { managerId: M, studentId: sid, classId: ID.class.QN_U10, planId: ID.plan.pm3m, startDate: "2026-11-23" })).rejects.toThrow(/chi nhánh/);
    await expect(enroll(sql, { managerId: ID.user.managerPM, studentId: sid, classId: ID.class.PM_U8, planId: ID.plan.pm3m, startDate: "2026-11-23" })).rejects.toThrow(/quyền/);
    await expect(enroll(sql, { managerId: ID.user.coachQN, studentId: sid, classId: ID.class.QN_U10, planId: ID.plan.std3m, startDate: "2026-11-23" })).rejects.toThrow(/quyền/);
  });
});

describe("generate_sessions / reschedule_session", () => {
  it("sinh buổi T2/T4/T6 theo giờ VN, chạy lại không tạo trùng; HLV không được sinh lịch", async () => {
    const n1 = await rpc<number>(sql, M, "generate_sessions", [ID.class.QN_U10, "2026-11-30", "2026-12-13"]);
    expect(n1).toBe(6);
    const n2 = await rpc<number>(sql, M, "generate_sessions", [ID.class.QN_U10, "2026-11-30", "2026-12-13"]);
    expect(n2).toBe(0);
    const rows = await sql`select to_char(scheduled_start at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:MI') t from sessions
      where class_id = ${ID.class.QN_U10} order by scheduled_start`;
    expect(rows[0].t).toBe("2026-11-30 17:30");
    expect(rows.map((r) => r.t.slice(0, 10))).toEqual(["2026-11-30", "2026-12-02", "2026-12-04", "2026-12-07", "2026-12-09", "2026-12-11"]);
    await expect(rpc(sql, ID.user.coachQN, "generate_sessions", [ID.class.QN_U10, "2026-12-14", "2026-12-20"])).rejects.toThrow(/quyền/);
    await expect(rpc(sql, M, "generate_sessions", [ID.class.QN_U10, "2026-12-14", "2027-01-20"])).rejects.toThrow(/kết thúc khóa/);
  });
  it("dời buổi làm thay đổi ngày dự kiến kết thúc", async () => {
    type CP = { milestones: { target: number; estimated_date: string | null }[] };
    await sql`update classes set planned_session_count = 6, monthly_session_targets = '{3,6}' where id = ${ID.class.QN_U10}`;
    let p = await rpc<CP>(sql, M, "class_progress", [ID.class.QN_U10, "2026-11-25"]);
    expect(p.milestones[1].estimated_date).toBe("2026-12-11");
    const [last] = await sql`select id from sessions where class_id = ${ID.class.QN_U10} order by scheduled_start desc limit 1`;
    await rpc(sql, M, "reschedule_session", [last.id, "2026-12-12T08:00:00+07:00", null]);
    p = await rpc<CP>(sql, M, "class_progress", [ID.class.QN_U10, "2026-11-25"]);
    expect(p.milestones[1].estimated_date).toBe("2026-12-12");
    await sql`update classes set planned_session_count = 36, monthly_session_targets = '{12,24,36}' where id = ${ID.class.QN_U10}`;
  });
});

describe("xin nghỉ", () => {
  it("phụ huynh được bật quyền xin nghỉ cho con mình; không cho con người khác; quản lý duyệt/từ chối", async () => {
    const mine = await addStudent(sql, ID.branch.QN);
    const other = await addStudent(sql, ID.branch.QN);
    await linkGuardian(sql, ID.user.parentA, mine);
    const lid = await rpc<string>(sql, ID.user.parentA, "request_leave", [mine, "2026-12-02", "2026-12-02", "Con đi khám"]);
    await expect(rpc(sql, ID.user.parentA, "request_leave", [other, "2026-12-02", "2026-12-02", "x"])).rejects.toThrow(/quyền/);
    await sql`update guardian_students set can_request_leave = false where student_id = ${mine}`;
    await expect(rpc(sql, ID.user.parentA, "request_leave", [mine, "2026-12-04", "2026-12-04", "x"])).rejects.toThrow(/quyền/);
    await expect(rpc(sql, ID.user.parentA, "approve_leave", [lid, false])).rejects.toThrow(/quyền/);
    await rpc(sql, M, "approve_leave", [lid, false]);
    const [l] = await sql`select status from student_leaves where id = ${lid}`;
    expect(l.status).toBe("APPROVED");
    await expect(rpc(sql, M, "reject_leave", [lid])).rejects.toThrow(/đã được xử lý/);
    await expect(rpc(sql, M, "approve_leave", [lid, true])).rejects.toThrow(/đã được xử lý/);
    await expect(asUser(sql, ID.user.careQN, (tx) => tx`insert into student_leaves (student_id, from_date, to_date, status)
      values (${mine}, '2026-12-07', '2026-12-07', 'APPROVED')`)).rejects.toThrow(/permission denied/);
    const seen = await asUser(sql, ID.user.parentA, (tx) => tx`select id from student_leaves`);
    expect(seen.map((r) => r.id)).toEqual([lid]);
  });
});

describe("create_student", () => {
  it("sinh mã theo chi nhánh, chuẩn hóa tên; HLV không được tạo", async () => {
    const id = await rpc<string>(sql, M, "create_student", [ID.branch.QN, "  HV   Demo  Mới ", null]);
    const [s] = await sql`select student_code, full_name from students where id = ${id}`;
    expect(s.student_code).toMatch(/^QN-\d{6}$/);
    expect(s.full_name).toBe("HV Demo Mới");
    await expect(rpc(sql, ID.user.coachQN, "create_student", [ID.branch.QN, "HV Demo X", null])).rejects.toThrow(/quyền/);
    await expect(rpc(sql, M, "create_student", [ID.branch.PM, "HV Demo X", null])).rejects.toThrow(/quyền/);
  });
});

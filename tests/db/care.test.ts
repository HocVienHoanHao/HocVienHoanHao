/**
 * Test 4 (mục 11) — cảnh báo 3/1/0 buổi, chuỗi vắng -> care case, job chạy lặp không trùng.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, rpc, setClock, type Sql } from "./harness";
import { ID, addSessions, addStudent, confirmSession, enroll, linkGuardian, mark, mwfDatesBack, seedBase } from "./fixtures";

const M = ID.user.managerQN, C = ID.user.coachQN;
let sql: Sql; let drop: () => Promise<void>;
let s: string[];
const DATES = mwfDatesBack("2026-11-25", 16);

beforeAll(async () => {
  ({ sql, drop } = await createTestDb());
  await setClock(sql, "2026-11-25T13:00:00Z");
  await seedBase(sql);
  s = await addSessions(sql, ID.class.QN_U10, ID.course.QN_K3, DATES);
  for (const id of s.slice(0, 14)) await confirmSession(sql, C, id); // 2 buổi cuối chưa tổ chức
  await sql`insert into plans (id, branch_id, name, months, session_quota, milestone_targets, price)
    values ('50000000-0000-0000-0000-0000000000c5', ${ID.branch.QN}, 'Gói 5 buổi (test)', 1, 5, '{}', 0)`;
});
afterAll(async () => { await drop?.(); });

const count = async (q: PromiseLike<readonly Record<string, unknown>[]>) => Number((await q)[0]?.n);

describe("Test 4 — nhắc gia hạn 3/1/0", () => {
  it("mỗi mốc/gói tạo đúng một thông báo cho mỗi người nhận; job chạy lặp không trùng", async () => {
    const sid = await addStudent(sql, ID.branch.QN);
    await linkGuardian(sql, ID.user.parentA, sid);
    const eid = await enroll(sql, { managerId: M, studentId: sid, branchId: ID.branch.QN, courseId: ID.course.QN_K3, classId: ID.class.QN_U10, planId: "50000000-0000-0000-0000-0000000000c5", startDate: DATES[0] });
    for (const id of s.slice(0, 5)) await mark(sql, C, id, sid, "PRESENT"); // 5 -> 0
    const keys = (await sql`select dedupe_key, recipient from notifications where student_id = ${sid} order by created_at`).map((r) => r.dedupe_key as string);
    // ngưỡng 3, 1, 0 × (quản lý QN + CSKH QN + phụ huynh A) = 9
    expect(keys.length).toBe(9);
    expect(keys.filter((k) => k.includes(`:${ID.user.parentA}`)).length).toBe(3);
    // gửi lại điểm danh, sửa qua lại, chạy job nhiều lần: không tăng
    await mark(sql, C, s[4], sid, "PRESENT");
    await mark(sql, C, s[4], sid, "ABSENT_EXCUSED");
    await mark(sql, C, s[4], sid, "PRESENT");
    await rpc(sql, ID.user.superAdmin, "run_care_job", []);
    const again = await rpc<{ new_notifications: number }>(sql, ID.user.superAdmin, "run_care_job", []);
    expect(again.new_notifications).toBe(0);
    expect(await count(sql`select count(*) n from notifications where student_id = ${sid}`)).toBe(9);
    // hết buổi -> một care case RENEWAL, không tự đổi trạng thái học viên, không tạo hóa đơn
    expect(await count(sql`select count(*) n from care_cases where enrollment_id = ${eid} and type = 'RENEWAL'`)).toBe(1);
    const [st] = await sql`select status from students where id = ${sid}`;
    expect(st.status).toBe("ACTIVE");
    expect(await count(sql`select count(*) n from invoices where student_id = ${sid}`)).toBe(0);
    // mua gói mới -> được cảnh báo mới
    const e2 = await enroll(sql, { managerId: M, studentId: sid, branchId: ID.branch.QN, courseId: ID.course.QN_K3, classId: ID.class.QN_U10, planId: "50000000-0000-0000-0000-0000000000c5", startDate: DATES[5] });
    for (const id of s.slice(5, 7)) await mark(sql, C, id, sid, "PRESENT", e2);
    expect(await count(sql`select count(*) n from notifications where student_id = ${sid} and dedupe_key like ${"renew:" + e2 + ":3:%"}`)).toBe(3);
  });
  it("phụ huynh opt-out không nhận thông báo; phụ huynh chỉ đọc thông báo của mình", async () => {
    const sid = await addStudent(sql, ID.branch.QN);
    await linkGuardian(sql, ID.user.parentB, sid);
    await sql`update guardians set notify_opt_out = true where user_id = ${ID.user.parentB}`;
    await enroll(sql, { managerId: M, studentId: sid, branchId: ID.branch.QN, courseId: ID.course.QN_K3, classId: ID.class.QN_U10, planId: "50000000-0000-0000-0000-0000000000c5", startDate: DATES[0] });
    for (const id of s.slice(0, 2)) await mark(sql, C, id, sid, "PRESENT");
    expect(await count(sql`select count(*) n from notifications where student_id = ${sid} and recipient = ${ID.user.parentB}`)).toBe(0);
    const mine = await asUser(sql, ID.user.parentA, (tx) => tx`select recipient from notifications`);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.recipient === ID.user.parentA)).toBe(true);
  });
});

describe("Test 4 — chuỗi vắng không phép", () => {
  let sid: string; let eid: string;
  beforeAll(async () => {
    sid = await addStudent(sql, ID.branch.QN);
    eid = await enroll(sql, { managerId: M, studentId: sid, branchId: ID.branch.QN, courseId: ID.course.QN_K3, classId: ID.class.QN_U10, planId: ID.plan.std3m, startDate: DATES[0] });
  });
  const cases = () => sql`select priority, streak_length, status from care_cases where enrollment_id = ${eid} and type = 'ABSENCE_STREAK' order by created_at`;

  it("một buổi vắng chưa tạo case; buổi chưa điểm danh không bị coi là vắng", async () => {
    await mark(sql, C, s[0], sid, "PRESENT");
    await mark(sql, C, s[1], sid, "ABSENT_UNEXCUSED");
    // s[2] chưa điểm danh, s[3] vắng -> không liên tiếp vì có buổi chưa rõ ở giữa
    await mark(sql, C, s[3], sid, "ABSENT_UNEXCUSED");
    expect((await cases()).length).toBe(0);
  });
  it("hai buổi vắng liên tiếp đã xác nhận -> một care case; buổi thứ 3 -> tăng ưu tiên", async () => {
    await mark(sql, C, s[2], sid, "ABSENT_UNEXCUSED");      // giờ s1..s3 liên tiếp = 3
    let c = await cases();
    expect(c.length).toBe(1);
    expect(c[0]).toMatchObject({ priority: "HIGH", streak_length: 3 });
    await rpc(sql, ID.user.superAdmin, "run_care_job", []);
    c = await cases();
    expect(c.length).toBe(1);
  });
  it("có mặt sau đó kết thúc chuỗi; chuỗi mới tạo case mới", async () => {
    await mark(sql, C, s[4], sid, "PRESENT");
    await mark(sql, C, s[5], sid, "ABSENT_UNEXCUSED");
    expect((await cases()).length).toBe(1);
    await mark(sql, C, s[6], sid, "ABSENT_EXCUSED");        // có phép: mặc định bỏ qua, không phá chuỗi
    await mark(sql, C, s[7], sid, "ABSENT_UNEXCUSED");
    const c = await cases();
    expect(c.length).toBe(2);
    expect(c[1]).toMatchObject({ priority: "NORMAL", streak_length: 2 });
  });
  it("điểm danh trước khi buổi được xác nhận không tính vắng cho tới khi xác nhận", async () => {
    const sid2 = await addStudent(sql, ID.branch.QN);
    const e2 = await enroll(sql, { managerId: M, studentId: sid2, branchId: ID.branch.QN, courseId: ID.course.QN_K3, classId: ID.class.QN_U10, planId: ID.plan.std3m, startDate: DATES[13] });
    await mark(sql, C, s[13], sid2, "ABSENT_UNEXCUSED");
    await mark(sql, C, s[14], sid2, "ABSENT_UNEXCUSED");      // s[14] chưa completed
    expect(await count(sql`select count(*) n from care_cases where enrollment_id = ${e2}`)).toBe(0);
    await setClock(sql, "2026-11-25T13:00:00Z");
    await confirmSession(sql, M, s[14]);
    expect(await count(sql`select count(*) n from care_cases where enrollment_id = ${e2}`)).toBe(1);
  });
  it("phân quyền: HLV chỉ thấy case được giao; CSKH cập nhật và giao việc; phụ huynh không thấy", async () => {
    const [c] = await sql`select id from care_cases where enrollment_id = ${eid} order by created_at limit 1`;
    expect((await asUser(sql, C, (tx) => tx`select id from care_cases`)).length).toBe(0);
    await expect(rpc(sql, C, "update_care_case", [c.id, "IN_PROGRESS", null, null, "PHONE", null, null, null])).rejects.toThrow(/quyền/);
    await rpc(sql, ID.user.careQN, "update_care_case", [c.id, "IN_PROGRESS", C, "Đã gọi, PH báo con ốm", "PHONE", "Liên hệ được", "Ốm", "2026-11-30"]);
    expect((await asUser(sql, C, (tx) => tx`select id from care_cases`)).map((r) => r.id)).toEqual([c.id]);
    expect((await asUser(sql, ID.user.parentA, (tx) => tx`select id from care_cases`)).length).toBe(0);
    expect((await asUser(sql, ID.user.parentA, (tx) => tx`select id from care_interactions`)).length).toBe(0);
    expect((await asUser(sql, ID.user.coachPM, (tx) => tx`select id from care_cases`)).length).toBe(0);
    await expect(rpc(sql, ID.user.parentA, "run_care_job", [])).rejects.toThrow(/quyền/);
  });
});

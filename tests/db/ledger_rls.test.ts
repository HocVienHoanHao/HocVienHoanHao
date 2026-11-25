/**
 * Test 1–3 (ledger quyền học) và test 5 (phân quyền RLS) — mục 11.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, rpc, setClock, type Sql } from "./harness";
import { ID, addSessions, addStudent, confirmSession, enroll, linkGuardian, mark, mwfDatesBack, seedBase } from "./fixtures";

const M = ID.user.managerQN, C = ID.user.coachQN;
let sql: Sql; let drop: () => Promise<void>;
let sessions: string[]; const DATES = mwfDatesBack("2026-11-23", 12);

const balance = async (eid: string) =>
  (await rpc<{ available_sessions: number; charged_sessions: number; present_sessions: number }>(sql, M, "student_progress", [eid, "2026-11-25"]));

beforeAll(async () => {
  ({ sql, drop } = await createTestDb());
  await setClock(sql, "2026-11-25T13:00:00Z");
  await seedBase(sql);
  sessions = await addSessions(sql, ID.class.QN_U10, ID.course.QN_K3, DATES);
  for (const s of sessions.slice(0, 10)) await confirmSession(sql, C, s); // 2 buổi cuối chưa xác nhận
});
afterAll(async () => { await drop?.(); });

const newEnrollment = async (planId = ID.plan.std3m, startDate = DATES[0], extra: Partial<Parameters<typeof enroll>[1]> = {}) => {
  const sid = await addStudent(sql, ID.branch.QN);
  const eid = await enroll(sql, { managerId: M, studentId: sid, branchId: ID.branch.QN, courseId: ID.course.QN_K3, classId: ID.class.QN_U10, planId, startDate, ...extra });
  return { sid, eid };
};

describe("Test 1 — quota", () => {
  it("gói 2 buổi/tuần × 2 tháng = 16 buổi theo quota đã cấp", async () => {
    const { eid } = await newEnrollment(ID.plan.twice2m);
    expect((await balance(eid)).available_sessions).toBe(16);
  });
  it("không trừ buổi trước ngày bắt đầu (vào muộn)", async () => {
    const { sid, eid } = await newEnrollment(ID.plan.std3m, DATES[6]);
    await expect(mark(sql, C, sessions[0], sid, "PRESENT")).rejects.toThrow(/chưa có đăng ký/);
    await mark(sql, C, sessions[6], sid, "PRESENT");
    expect((await balance(eid)).available_sessions).toBe(35);
  });
});

describe("Test 2 — sửa điểm danh, idempotent, không âm", () => {
  it("PRESENT -> NOT_MARKED hoàn 1 buổi; gửi lại hai lần không trừ thêm", async () => {
    const { sid, eid } = await newEnrollment();
    expect((await mark(sql, C, sessions[0], sid, "PRESENT")).charge).toBe("CHARGED");
    expect((await mark(sql, C, sessions[0], sid, "PRESENT")).charge).toBe("CHARGED");
    expect((await balance(eid)).available_sessions).toBe(35);
    await mark(sql, C, sessions[0], sid, "NOT_MARKED");
    await mark(sql, C, sessions[0], sid, "NOT_MARKED");
    expect((await balance(eid)).available_sessions).toBe(36);
    await mark(sql, C, sessions[0], sid, "PRESENT");                  // sửa lại lần nữa: bút toán mới
    const b = await balance(eid);
    expect([b.available_sessions, b.charged_sessions, b.present_sessions]).toEqual([35, 1, 1]);
    const [{ n }] = await sql`select count(*)::int n from session_ledger where enrollment_id = ${eid} and event_type in ('CONSUME','REVERSAL')`;
    expect(n).toBe(3); // CONSUME, REVERSAL, CONSUME — không sửa/xóa bút toán cũ
  });
  it("D1: nghỉ (có phép hoặc không phép) vẫn trừ buổi, không bảo lưu", async () => {
    const { sid, eid } = await newEnrollment();
    expect((await mark(sql, C, sessions[0], sid, "PRESENT")).charge).toBe("CHARGED");
    expect((await mark(sql, C, sessions[0], sid, "ABSENT_EXCUSED")).charge).toBe("CHARGED");
    expect((await mark(sql, C, sessions[1], sid, "ABSENT_UNEXCUSED")).charge).toBe("CHARGED");
    const b = await balance(eid);
    expect([b.available_sessions, b.charged_sessions, b.present_sessions]).toEqual([34, 2, 0]);
  });
  it("D1 ngoại lệ: quản lý duyệt đơn nghỉ 'không trừ buổi' -> hoàn buổi đã trừ; duyệt mặc định vẫn trừ", async () => {
    const { sid, eid } = await newEnrollment();
    await mark(sql, C, sessions[2], sid, "ABSENT_EXCUSED");
    await mark(sql, C, sessions[3], sid, "ABSENT_EXCUSED");
    expect((await balance(eid)).available_sessions).toBe(34);
    const free = await rpc<string>(sql, M, "request_leave", [sid, DATES[2], DATES[2], "Ốm dài ngày (demo)"]);
    const normal = await rpc<string>(sql, M, "request_leave", [sid, DATES[3], DATES[3], "Việc gia đình (demo)"]);
    await expect(rpc(sql, ID.user.careQN, "approve_leave", [free, false])).rejects.toThrow(/quyền/);
    await rpc(sql, M, "approve_leave", [free, false]);
    await rpc(sql, M, "approve_leave", [normal, true]);
    expect((await balance(eid)).available_sessions).toBe(35);
    // đi học thật trong ngày đã xin nghỉ miễn trừ -> vẫn trừ
    expect((await mark(sql, C, sessions[2], sid, "PRESENT")).charge).toBe("CHARGED");
    expect((await mark(sql, C, sessions[2], sid, "ABSENT_EXCUSED")).charge).toBe("NOT_CHARGEABLE");
    const [au] = await sql`select change from audit_logs where entity = 'student_leave' and entity_id = ${free} and action = 'APPROVE'`;
    expect(au.change.exception).toBe(true);
  });
  it("trial, NOT_MARKED và buổi chưa tổ chức không tự trừ; xác nhận buổi sau mới trừ", async () => {
    const { sid, eid } = await newEnrollment();
    expect((await mark(sql, C, sessions[1], sid, "TRIAL")).charge).toBe("NOT_CHARGEABLE");
    expect((await mark(sql, C, sessions[2], sid, "NOT_MARKED")).charge).toBe("NOT_CHARGEABLE");
    expect((await mark(sql, C, sessions[10], sid, "PRESENT")).charge).toBe("NOT_CHARGEABLE"); // chưa completed
    expect((await balance(eid)).available_sessions).toBe(36);
    await confirmSession(sql, C, sessions[10]);
    expect((await balance(eid)).available_sessions).toBe(35);
  });
  it("hủy buổi đã trừ -> đảo bút toán", async () => {
    const { sid, eid } = await newEnrollment();
    const [extra] = await addSessions(sql, ID.class.QN_U10, ID.course.QN_K3, ["2026-11-24"]);
    await confirmSession(sql, C, extra);
    await mark(sql, C, extra, sid, "PRESENT");
    expect((await balance(eid)).available_sessions).toBe(35);
    await expect(rpc(sql, C, "cancel_session", [extra, "Nhập nhầm"])).rejects.toThrow(/quyền/); // HLV không hủy buổi đã tổ chức
    await rpc(sql, M, "cancel_session", [extra, "Nhập nhầm"]);
    expect((await balance(eid)).available_sessions).toBe(36);
  });
  it("hết quota không âm số dư: đánh dấu PENDING_NO_ENTITLEMENT", async () => {
    const sid = await addStudent(sql, ID.branch.QN);
    await sql`insert into plans (id, branch_id, name, months, session_quota, milestone_targets, price)
      values ('50000000-0000-0000-0000-0000000000aa', ${ID.branch.QN}, 'Gói thử 1 buổi', 1, 1, '{}', 0)`;
    const eid = await enroll(sql, { managerId: M, studentId: sid, branchId: ID.branch.QN, courseId: ID.course.QN_K3, classId: ID.class.QN_U10, planId: "50000000-0000-0000-0000-0000000000aa", startDate: DATES[0] });
    expect((await mark(sql, C, sessions[3], sid, "PRESENT")).charge).toBe("CHARGED");
    expect((await mark(sql, C, sessions[4], sid, "PRESENT")).charge).toBe("PENDING_NO_ENTITLEMENT");
    const b = await balance(eid);
    expect([b.available_sessions, b.present_sessions, b.charged_sessions]).toEqual([0, 2, 1]);
  });
  it("đăng ký nháp không cấp quyền học; client không tự chèn đăng ký với quota tùy ý", async () => {
    const sid = await addStudent(sql, ID.branch.QN);
    await enroll(sql, { managerId: M, studentId: sid, classId: ID.class.QN_U10, planId: ID.plan.std3m, startDate: DATES[0], confirm: false });
    await expect(mark(sql, C, sessions[5], sid, "PRESENT")).rejects.toThrow(/chưa có đăng ký/);
    await expect(asUser(sql, M, (tx) => tx`insert into enrollments (student_id, branch_id, course_id, class_id, start_date, snapshot_quota)
      values (${sid}, ${ID.branch.QN}, ${ID.course.QN_K3}, ${ID.class.QN_U10}, ${DATES[0]}, 999)`)).rejects.toThrow(/permission denied/);
  });
});

describe("Test 3 — bảo lưu, FIFO, đổi chi nhánh", () => {
  it("chuyển 6 sang khóa mới giữ tổng 6 (không 12); dùng 2 còn 4", async () => {
    const { sid, eid } = await newEnrollment();
    for (const s of sessions.slice(0, 10)) await mark(sql, C, s, sid, "PRESENT");
    // còn 26: chuyển 6 (giả định còn lại là bảo lưu theo quyết định quản lý)
    const k4 = await enroll(sql, { managerId: M, studentId: sid, branchId: ID.branch.QN, courseId: ID.course.QN_K4, classId: ID.class.QN_K4_U10, planId: ID.plan.std1m, startDate: "2026-12-14" });
    const rid = "70000000-0000-0000-0000-0000000000b1";
    await rpc(sql, M, "transfer_carryover", [rid, eid, k4, 6, "2026-11-25", "Bảo lưu", null]);
    const [{ total }] = await sql`select sum(signed_delta)::int total from session_ledger where student_id = ${sid}`;
    expect(total).toBe(26 + 12);                       // 26 cũ (20 còn ở K3 + 6 chuyển) + 12 mua mới
    expect((await balance(eid)).available_sessions).toBe(20);
    const [{ carry }] = await sql`select sum(signed_delta)::int carry from session_ledger l join entitlements e on e.id = l.entitlement_id
      where e.enrollment_id = ${k4} and e.source = 'CARRYOVER'`;
    expect(carry).toBe(6);
    // D3: buổi bảo lưu chỉ dùng trong khóa kế tiếp -> hạn = ngày kết thúc K4
    const [{ vu }] = await sql`select valid_until::text vu from entitlements where enrollment_id = ${k4} and source = 'CARRYOVER'`;
    expect(vu).toBe("2027-03-31");
    // FIFO: quyền bảo lưu (hết hạn sớm hơn) dùng trước quyền mua mới
    await sql`update entitlements set valid_until = '2027-01-31' where enrollment_id = ${k4} and source = 'CARRYOVER'`;
    const k4s = await addSessions(sql, ID.class.QN_K4_U10, ID.course.QN_K4, ["2026-11-25", "2026-11-25"]); // 2 buổi cùng ngày
    await sql`update enrollments set start_date = '2026-11-25' where id = ${k4}`;
    // HLV chỉ được phân công lớp K4 từ 01/12 -> quản lý xác nhận
    for (const s of k4s) { await confirmSession(sql, M, s); await mark(sql, M, s, sid, "PRESENT"); }
    const [{ carryLeft }] = await sql`select sum(signed_delta)::int "carryLeft" from session_ledger l join entitlements e on e.id = l.entitlement_id
      where e.enrollment_id = ${k4} and e.source = 'CARRYOVER'`;
    expect(carryLeft).toBe(4);
    const [{ inv }] = await sql`select count(*)::int inv from invoices where student_id = ${sid}`;
    expect(inv).toBe(0);                               // bảo lưu không tạo doanh thu/hóa đơn mới
  });
  it("D3: không đặt hạn bảo lưu dài hơn khóa kế tiếp; không chuyển ngược; chỉ chuyển 1 lần", async () => {
    const { sid, eid } = await newEnrollment();
    const k4 = await enroll(sql, { managerId: M, studentId: sid, classId: ID.class.QN_K4_U10, planId: ID.plan.std1m, startDate: "2026-12-14" });
    await rpc(sql, M, "transfer_carryover", ["70000000-0000-0000-0000-0000000000c1", eid, k4, 3, "2026-11-25", "Bảo lưu", "2027-12-31"]);
    const [{ vu }] = await sql`select valid_until::text vu from entitlements where enrollment_id = ${k4} and source = 'CARRYOVER'`;
    expect(vu).toBe("2027-03-31");
    await expect(rpc(sql, M, "transfer_carryover", ["70000000-0000-0000-0000-0000000000c2", k4, eid, 2, "2026-11-25", "Chuyển ngược", null]))
      .rejects.toThrow(/khóa sau/);
    // mỗi gói chỉ chuyển bảo lưu 1 lần (không chia nhỏ thành nhiều lần chuyển)
    await expect(rpc(sql, M, "transfer_carryover", ["70000000-0000-0000-0000-0000000000c3", eid, k4, 2, "2026-11-25", "Chuyển lần 2", null]))
      .rejects.toThrow(/1 lần/);
    // gửi lại đúng yêu cầu cũ vẫn idempotent, không báo lỗi
    await rpc(sql, M, "transfer_carryover", ["70000000-0000-0000-0000-0000000000c1", eid, k4, 3, "2026-11-25", "Bảo lưu", "2027-12-31"]);
  });
  it("đổi chi nhánh cần quyền quản lý cả hai chi nhánh", async () => {
    const { sid, eid } = await newEnrollment();
    const [pmSession] = await addSessions(sql, ID.class.PM_U8, ID.course.PM_K1, ["2026-12-21"]);
    expect(pmSession).toBeTruthy();
    const pm = await enroll(sql, { managerId: ID.user.managerPM, studentId: sid, branchId: ID.branch.PM, courseId: ID.course.PM_K1, classId: ID.class.PM_U8, planId: ID.plan.pm3m, startDate: "2026-12-01" }).catch((e) => e);
    // QL Phù Mỹ không thấy học viên QN nên không tạo được đăng ký -> SUPER_ADMIN thực hiện
    expect(pm).toBeInstanceOf(Error);
    const pm2 = await enroll(sql, { managerId: ID.user.superAdmin, studentId: sid, branchId: ID.branch.PM, courseId: ID.course.PM_K1, classId: ID.class.PM_U8, planId: ID.plan.pm3m, startDate: "2026-12-01" });
    await expect(rpc(sql, M, "transfer_carryover", ["70000000-0000-0000-0000-0000000000b2", eid, pm2, 6, "2026-11-25", "Đổi chi nhánh", null])).rejects.toThrow(/quyền/);
    await rpc(sql, ID.user.superAdmin, "transfer_carryover", ["70000000-0000-0000-0000-0000000000b3", eid, pm2, 6, "2026-11-25", "Đổi chi nhánh (đã duyệt)", null]);
    expect((await balance(eid)).available_sessions).toBe(30);
  });
});

describe("Test 5 — phân quyền RLS (JWT từng người, không dùng service role)", () => {
  let childA: string; let childB: string;
  beforeAll(async () => {
    childA = (await newEnrollment()).sid; childB = (await newEnrollment()).sid;
    await linkGuardian(sql, ID.user.parentA, childA);
    await linkGuardian(sql, ID.user.parentB, childB);
    await mark(sql, C, sessions[0], childA, "PRESENT");
    await mark(sql, C, sessions[0], childB, "PRESENT");
    await sql`insert into notes (student_id, branch_id, content, visibility) values
      (${childA}, ${ID.branch.QN}, 'Ghi chú nội bộ demo', 'INTERNAL')`;
    await sql`insert into notes (student_id, branch_id, content, visibility, shared_at) values
      (${childA}, ${ID.branch.QN}, 'Nhận xét chia sẻ demo', 'PARENT', now())`;
    await sql`insert into invoices (branch_id, student_id, status) values (${ID.branch.PM}, ${childB}, 'ISSUED'), (${ID.branch.QN}, ${childA}, 'ISSUED')`;
  });

  const q = <T>(user: string, f: (tx: Parameters<Parameters<typeof asUser>[2]>[0]) => Promise<T>) => asUser(sql, user, f);

  it("phụ huynh A chỉ thấy con mình (không thấy danh sách cả lớp)", async () => {
    const students = await q(ID.user.parentA, (tx) => tx`select id from students`);
    expect(students.map((r) => r.id)).toEqual([childA]);
    const att = await q(ID.user.parentA, (tx) => tx`select student_id from attendance`);
    expect(new Set(att.map((r) => r.student_id))).toEqual(new Set([childA]));
    const byId = await q(ID.user.parentA, (tx) => tx`select * from students where id = ${childB}`);
    expect(byId.length).toBe(0);                     // đoán ID/URL cũng không đọc được
  });
  it("phụ huynh không đổi được dữ liệu, không thấy note nội bộ", async () => {
    const upd = await q(ID.user.parentA, (tx) => tx`update students set full_name = 'x' where id = ${childA} returning id`);
    expect(upd.length).toBe(0);
    await expect(q(ID.user.parentA, (tx) => tx`select public.record_attendance(${sessions[0]}, ${childA}, 'ABSENT_EXCUSED', null, null)`)).rejects.toThrow(/quyền/);
    const notes = await q(ID.user.parentA, (tx) => tx`select visibility from notes`);
    expect(notes.map((n) => n.visibility)).toEqual(["PARENT"]);
  });
  it("HLV QN không thấy lớp PM; HLV PM không điểm danh lớp QN", async () => {
    const cls = await q(C, (tx) => tx`select id from classes`);
    expect(cls.map((c) => c.id)).not.toContain(ID.class.PM_U8);
    await expect(mark(sql, ID.user.coachPM, sessions[0], childA, "PRESENT")).rejects.toThrow(/quyền/);
  });
  it("kế toán QN không xem hóa đơn chi nhánh PM; admin thấy toàn bộ", async () => {
    const inv = await q(ID.user.accountantQN, (tx) => tx`select branch_id from invoices`);
    expect(inv.every((i) => i.branch_id === ID.branch.QN)).toBe(true);
    const all = await q(ID.user.superAdmin, (tx) => tx`select branch_id from invoices`);
    expect(new Set(all.map((i) => i.branch_id))).toEqual(new Set([ID.branch.QN, ID.branch.PM]));
  });
  it("HLV không xem ledger/hóa đơn; anon không đọc được gì", async () => {
    expect((await q(C, (tx) => tx`select 1 from invoices`)).length).toBe(0);
    expect((await q(C, (tx) => tx`select 1 from session_ledger`)).length).toBe(0);
    await expect(sql.begin(async (tx) => { await tx.unsafe("set local role anon"); await tx`select 1 from students`; })).rejects.toThrow(/permission denied/);
  });
  it("role không lấy từ client: claim role giả trong JWT không có tác dụng", async () => {
    const rows = await sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ID.user.parentA, role: "SUPER_ADMIN", app_role: "SUPER_ADMIN" })}, true)`;
      await tx.unsafe("set local role authenticated");
      return tx`select id from students`;
    });
    expect(rows.length).toBe(1);
  });
  it("mọi vai trò đọc được mọi bảng mà không lỗi policy (không đệ quy)", async () => {
    const tables = (await sql`select tablename from pg_tables where schemaname = 'public'`).map((r) => r.tablename as string);
    for (const user of Object.values(ID.user)) {
      for (const t of tables) {
        await q(user, (tx) => tx.unsafe(`select count(*) from public.${t}`));
      }
    }
  });
});

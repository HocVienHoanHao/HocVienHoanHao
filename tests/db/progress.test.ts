/**
 * Test 8–9 (mục 11) — Tiến độ theo ngày chốt và dự báo ngày kết thúc (mục 5.1).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, rpc, setClock, type Sql } from "./harness";
import { ID, addSessions, addStudent, confirmSession, enroll, mark, mwfDatesBack, seedBase, linkGuardian } from "./fixtures";

type Milestone = { month: number; target: number; status: string; actual_date: string | null; estimated_date: string | null; remaining: number | null };
type ClassP = { class_completed_sessions: number; class_target_sessions: number; class_remaining_sessions: number; last_class_session_date: string | null; current_month: number | null; milestones: Milestone[]; course_end: Milestone & { planned_end_date: string }; forecast_reliable: boolean; warnings: { code: string }[] };
type StudentP = {
  present_sessions: number | null; charged_sessions: number | null; available_sessions: number | null; carryover_available: number | null;
  class_completed_sessions: number; class_sessions_since_join: number; absent_excused: number | null; absent_unexcused: number | null; not_marked: number | null;
  current_month: number | null; study_milestones: Milestone[]; entitlement_milestones: Milestone[]; package_end: Milestone | null;
  entitlement_exhaustion: { status: string; estimated_date?: string; actual_date?: string; label: string };
  last_attended_date: string | null; data_status: string; renewal_alert: string | null; invoice_due_date: string | null; warnings: { code: string }[];
};

const AS_OF = "2026-11-25";
const PAST = mwfDatesBack(AS_OF, 30);              // 30 buổi đã tập: 18/09 -> 25/11/2026
const FUTURE = ["2026-11-27", "2026-11-30", "2026-12-02", "2026-12-04", "2026-12-07", "2026-12-09"];
const M = ID.user.managerQN, C = ID.user.coachQN;

let sql: Sql; let drop: () => Promise<void>;
let pastIds: string[]; let futureIds: string[];
let full: { sid: string; eid: string }; let late: { sid: string; eid: string };

async function cp(asOf = AS_OF, user = M) { return rpc<ClassP>(sql, user, "class_progress", [ID.class.QN_U10, asOf]); }
async function sp(eid: string, asOf = AS_OF, user = M) { return rpc<StudentP>(sql, user, "student_progress", [eid, asOf]); }

beforeAll(async () => {
  ({ sql, drop } = await createTestDb());
  await setClock(sql, "2026-11-25T13:00:00Z");     // 20:00 giờ VN ngày 25/11/2026
  await seedBase(sql);
  pastIds = await addSessions(sql, ID.class.QN_U10, ID.course.QN_K3, PAST);
  futureIds = await addSessions(sql, ID.class.QN_U10, ID.course.QN_K3, FUTURE);

  full = { sid: await addStudent(sql, ID.branch.QN), eid: "" };
  full.eid = await enroll(sql, { managerId: M, studentId: full.sid, branchId: ID.branch.QN, courseId: ID.course.QN_K3, classId: ID.class.QN_U10, planId: ID.plan.std3m, startDate: PAST[0] });
  // học viên vào muộn từ buổi 7
  late = { sid: await addStudent(sql, ID.branch.QN), eid: "" };
  late.eid = await enroll(sql, { managerId: M, studentId: late.sid, branchId: ID.branch.QN, courseId: ID.course.QN_K3, classId: ID.class.QN_U10, planId: ID.plan.std3m, startDate: PAST[6] });
  await linkGuardian(sql, ID.user.parentA, late.sid);

  for (let i = 0; i < 30; i++) {
    await confirmSession(sql, C, pastIds[i]);
    await mark(sql, C, pastIds[i], full.sid, "PRESENT");
    if (i >= 6) await mark(sql, C, pastIds[i], late.sid, "PRESENT");
  }
});
afterAll(async () => { await drop?.(); });
beforeEach(async () => { await setClock(sql, "2026-11-25T13:00:00Z"); });

describe("Test 8 — tiến độ theo ngày chốt", () => {
  it("lớp 30/36 tại ngày chốt 25/11/2026, còn 6, đang ở tháng học 3", async () => {
    const p = await cp();
    expect(p.class_completed_sessions).toBe(30);
    expect(p.class_target_sessions).toBe(36);
    expect(p.class_remaining_sessions).toBe(6);
    expect(p.last_class_session_date).toBe("2026-11-25");
    expect(p.current_month).toBe(3);
  });

  it("mốc 12/24 trả đúng ngày buổi thực tế đạt ngưỡng; mốc 36 chưa có ngày thực tế", async () => {
    const p = await cp();
    expect(p.milestones[0]).toMatchObject({ target: 12, status: "REACHED", actual_date: PAST[11] });
    expect(p.milestones[1]).toMatchObject({ target: 24, status: "REACHED", actual_date: PAST[23] });
    expect(p.milestones[2].actual_date).toBeNull();
  });

  it("học viên vào muộn: 24 PRESENT/36, trừ 24, còn 12; không kế thừa 6 buổi trước khi vào", async () => {
    const s = await sp(late.eid);
    expect(s.present_sessions).toBe(24);
    expect(s.charged_sessions).toBe(24);
    expect(s.available_sessions).toBe(12);
    expect(s.class_completed_sessions).toBe(30);
    expect(s.class_sessions_since_join).toBe(24);
    expect(s.current_month).toBe(3);
    // mốc 24 của học viên = ngày buổi có mặt thứ 24 (buổi lớp thứ 30), không phải ngày chốt mặc định
    expect(s.study_milestones[1]).toMatchObject({ target: 24, status: "REACHED", actual_date: PAST[29] });
    expect(s.study_milestones[0].actual_date).toBe(PAST[17]);
    expect(s.data_status).toBe("OK");
  });

  it("học viên đủ buổi: 30 có mặt, còn 6 (test 1)", async () => {
    const s = await sp(full.eid);
    expect(s.present_sessions).toBe(30);
    expect(s.available_sessions).toBe(6);
  });

  it("ngày chốt trước buổi thứ 30 cho số đếm thấp hơn; không dùng ngày nhập điểm danh", async () => {
    // toàn bộ điểm danh đều được nhập "hôm nay" (25/11) nhưng ngày tập thực tế khác
    const asOf = PAST[19]; // ngày buổi thứ 20
    const p = await cp(asOf);
    expect(p.class_completed_sessions).toBe(20);
    expect(p.current_month).toBe(2);
    const s = await sp(late.eid, asOf);
    expect(s.present_sessions).toBe(14);
    expect(s.charged_sessions).toBe(14);
    expect(s.available_sessions).toBe(22);
  });

  it("buổi chưa xác nhận tổ chức không được tính", async () => {
    // buổi 27/11 tồn tại trong lịch nhưng chưa completed
    const p = await cp("2026-11-28");
    expect(p.class_completed_sessions).toBe(30);
    expect(p.forecast_reliable).toBe(false);
    expect(p.warnings.map((w) => w.code)).toContain("UNCONFIRMED_SESSIONS");
  });

  it("nghỉ bị trừ (D1) -> present và charged khác nhau, báo cáo đúng cả hai", async () => {
    // D1 đã duyệt: nghỉ không bảo lưu -> vắng vẫn bị trừ buổi
    try {
      await mark(sql, C, pastIds[29], late.sid, "ABSENT_UNEXCUSED");
      const s = await sp(late.eid);
      expect(s.present_sessions).toBe(23);
      expect(s.charged_sessions).toBe(24);
      expect(s.absent_unexcused).toBe(1);
      expect(s.warnings.map((w) => w.code)).toContain("PRESENT_CHARGED_DIFFER");
      expect(s.study_milestones[1].status).not.toBe("REACHED");
      expect(s.entitlement_milestones[1].status).toBe("REACHED");
    } finally {
      await mark(sql, C, pastIds[29], late.sid, "PRESENT"); // khôi phục
    }
    const s = await sp(late.eid);
    expect([s.present_sessions, s.charged_sessions, s.available_sessions]).toEqual([24, 24, 12]);
  });

  it("chưa nhập điểm danh lịch sử -> 'Chưa đủ dữ liệu' (null), không hiển thị 0", async () => {
    await sql`update classes set attendance_tracked_from = null where id = ${ID.class.QN_U10}`;
    try {
      const s = await sp(late.eid);
      expect(s.data_status).toBe("NO_DATA");
      expect(s.present_sessions).toBeNull();
      expect(s.available_sessions).toBeNull();
      expect(s.entitlement_exhaustion.status).toBe("NO_DATA");
      expect(s.entitlement_exhaustion.label).toBe("Chưa đủ dữ liệu");
    } finally {
      await sql`update classes set attendance_tracked_from = '2026-09-18' where id = ${ID.class.QN_U10}`;
    }
  });
});

describe("Test 9 — dự báo ngày kết thúc", () => {
  it("lịch 6 buổi như ví dụ -> lớp dự kiến kết thúc 09/12/2026 (không cộng cứng ngày)", async () => {
    const p = await cp();
    expect(p.milestones[2]).toMatchObject({ target: 36, status: "FORECAST", estimated_date: "2026-12-09", remaining: 6 });
    expect(p.course_end).toMatchObject({ status: "FORECAST", estimated_date: "2026-12-09", planned_end_date: "2026-12-31" });
  });

  it("học viên còn 12 nhưng chỉ có 6 lịch phù hợp -> không bịa ngày hết gói", async () => {
    const s = await sp(late.eid);
    expect(s.entitlement_exhaustion.status).toBe("INSUFFICIENT_SCHEDULE");
    expect(s.entitlement_exhaustion.estimated_date).toBeUndefined();
    expect(s.entitlement_exhaustion.label).toBe("Chưa đủ lịch để dự báo");
    expect(s.package_end?.status).toBe("INSUFFICIENT_SCHEDULE");
    expect(s.package_end?.estimated_date).toBeNull();
    // học viên đủ buổi: còn 6 -> hết quyền đúng buổi thứ 6
    const f = await sp(full.eid);
    expect(f.entitlement_exhaustion).toMatchObject({ status: "FORECAST", estimated_date: "2026-12-09" });
  });

  it("hủy buổi thì tính lại; thêm buổi bù thì tính lại", async () => {
    await rpc(sql, M, "cancel_session", [futureIds[2], "Mưa lớn"]); // hủy 02/12
    let p = await cp();
    expect(p.milestones[2].status).toBe("INSUFFICIENT_SCHEDULE");
    expect(p.milestones[2].estimated_date).toBeNull();
    const makeup = await rpc<string>(sql, M, "schedule_makeup_session", [futureIds[2], "2026-12-12T08:00:00+07:00", null]);
    p = await cp();
    expect(p.milestones[2]).toMatchObject({ status: "FORECAST", estimated_date: "2026-12-12" });
    // dọn: xóa buổi bù và khôi phục buổi gốc (dữ liệu test)
    await sql`delete from sessions where id = ${makeup}`;
    await sql`update sessions set status = 'scheduled', cancel_reason = null where id = ${futureIds[2]}`;
    p = await cp();
    expect(p.milestones[2].estimated_date).toBe("2026-12-09");
  });

  it("buổi bù không được xác nhận nếu buổi gốc chưa hủy (không đếm hai lần)", async () => {
    const [extra] = await sql`insert into sessions (class_id, course_id, scheduled_start, replacement_for_session_id)
      values (${ID.class.QN_U10}, ${ID.course.QN_K3}, '2026-11-24T08:00:00+07:00', ${futureIds[0]}) returning id`;
    await expect(rpc(sql, C, "confirm_session", [extra.id, "2026-11-24T08:00:00+07:00", null])).rejects.toThrow(/buổi gốc/);
    await sql`delete from sessions where id = ${extra.id}`;
  });

  it("ngày chốt quá khứ dùng các buổi sau ngày đó làm lịch tương lai", async () => {
    const asOf = PAST[23]; // vừa đạt 24 buổi
    const p = await cp(asOf);
    expect(p.class_completed_sessions).toBe(24);
    expect(p.milestones[1]).toMatchObject({ status: "REACHED", actual_date: PAST[23] });
    expect(p.milestones[2]).toMatchObject({ status: "FORECAST", estimated_date: FUTURE[5] });
  });

  it("nhiều buổi cùng ngày: số thứ tự theo giờ thực tế rồi ID, mốc dùng đúng buổi", async () => {
    const extra = await addSessions(sql, ID.class.QN_U10, ID.course.QN_K3, []);
    const [a] = await sql`insert into sessions (class_id, course_id, scheduled_start) values
      (${ID.class.QN_U10}, ${ID.course.QN_K3}, '2026-12-09T07:00:00+07:00') returning id`;
    // lớp có 7 buổi tương lai; buổi 36 là buổi thứ 6 -> 09/12 sáng (cùng ngày với buổi chiều)
    let p = await cp();
    expect(p.milestones[2].estimated_date).toBe("2026-12-09");
    await rpc(sql, M, "cancel_session", [futureIds[4], "Đổi lịch"]); // hủy 07/12
    p = await cp();
    expect(p.milestones[2].estimated_date).toBe("2026-12-09"); // buổi chiều 09/12 thành buổi thứ 6
    await sql`delete from sessions where id = ${a.id}`;
    p = await cp();
    expect(p.milestones[2].status).toBe("INSUFFICIENT_SCHEDULE");
    await sql`update sessions set status = 'scheduled', cancel_reason = null where id = ${futureIds[4]}`;
    expect(extra).toEqual([]);
  });

  it("ước tính theo lịch lặp chỉ khi quản lý duyệt, gắn nhãn riêng", async () => {
    let s = await sp(late.eid);
    expect(s.entitlement_exhaustion.status).toBe("INSUFFICIENT_SCHEDULE");
    await sql`insert into policy_settings (key, version, value, status, approved_at)
      values ('forecast.recurring_estimate', 1, '{"enabled":true}', 'APPROVED', now())`;
    try {
      s = await sp(late.eid);
      // 6 buổi đã xác nhận + 6 buổi ước tính theo T2/T4/T6 sau 09/12: 11,14,16,18,21,23/12
      expect(s.entitlement_exhaustion).toMatchObject({ status: "ESTIMATED_RECURRING", estimated_date: "2026-12-23", label: "Ước tính theo lịch lặp" });
    } finally {
      await sql`delete from policy_settings where key = 'forecast.recurring_estimate'`;
    }
  });

  it("lịch cá nhân 2 buổi/tuần (T2/T6), gói 16 buổi mốc 8/16", async () => {
    const sid = await addStudent(sql, ID.branch.QN);
    const eid = await enroll(sql, { managerId: M, studentId: sid, branchId: ID.branch.QN, courseId: ID.course.QN_K3, classId: ID.class.QN_U10, planId: ID.plan.twice2m, startDate: "2026-11-01", weekdays: [1, 5] });
    const mine = pastIds.filter((_, i) => PAST[i] >= "2026-11-01" && [1, 5].includes(new Date(`${PAST[i]}T00:00:00Z`).getUTCDay()));
    for (const id of mine) await mark(sql, C, id, sid, "PRESENT");
    const s = await sp(eid);
    expect(s.present_sessions).toBe(mine.length);           // 7 buổi T2/T6 trong 01–25/11
    expect(s.available_sessions).toBe(16 - mine.length);
    expect(s.study_milestones.map((m) => m.target)).toEqual([8, 16]);
    // buổi T2/T6 tương lai: 27/11(T6), 30/11(T2), 04/12(T6), 07/12(T2) -> mốc 8 = 27/11
    expect(s.study_milestones[0]).toMatchObject({ status: "FORECAST", estimated_date: "2026-11-27" });
    expect(s.study_milestones[1].status).toBe("INSUFFICIENT_SCHEDULE");
  });

  it("gói 4 tháng tạo 4 mốc theo cấu hình, không hardcode 36", async () => {
    const sid = await addStudent(sql, ID.branch.QN);
    const eid = await enroll(sql, { managerId: M, studentId: sid, branchId: ID.branch.QN, courseId: ID.course.QN_K3, classId: ID.class.QN_U10, planId: ID.plan.std4m, startDate: "2026-11-27" });
    const s = await sp(eid, "2026-11-27"); // ngày chốt = ngày bắt đầu
    expect(s.study_milestones.map((m) => m.target)).toEqual([12, 24, 36, 48]);
    expect(s.present_sessions).toBe(0);
    expect(s.available_sessions).toBe(48);
    expect(s.study_milestones.every((m) => m.status === "INSUFFICIENT_SCHEDULE")).toBe(true);
  });

  it("nghỉ có phép đã duyệt (không trừ) bị bỏ qua khi dự báo hết quyền", async () => {
    // học viên đủ buổi còn 6, xin nghỉ 30/11 -> chỉ còn 5 buổi phù hợp trong lịch
    const [l] = await sql`insert into student_leaves (student_id, from_date, to_date, status, charge)
      values (${full.sid}, '2026-11-30', '2026-11-30', 'APPROVED', false) returning id`;
    try {
      const s = await sp(full.eid);
      expect(s.entitlement_exhaustion.status).toBe("INSUFFICIENT_SCHEDULE");
    } finally {
      await sql`delete from student_leaves where id = ${l.id}`;
    }
  });

  it("quyền bảo lưu chuyển sang khóa sau: chỉ dự báo khi khóa sau có lịch", async () => {
    const k4 = await enroll(sql, { managerId: M, studentId: full.sid, branchId: ID.branch.QN, courseId: ID.course.QN_K4, classId: ID.class.QN_K4_U10, planId: ID.plan.std1m, startDate: "2026-12-14" });
    const reqId = "70000000-0000-0000-0000-000000000001";
    await rpc(sql, M, "transfer_carryover", [reqId, full.eid, k4, 6, "2026-11-25", "Bảo lưu sang K4", null]);
    await rpc(sql, M, "transfer_carryover", [reqId, full.eid, k4, 6, "2026-11-25", "Bảo lưu sang K4", null]); // gửi lại: idempotent
    const src = await sp(full.eid);
    expect(src.available_sessions).toBe(0);
    let dst = await sp(k4.toString(), "2026-12-14");
    expect(dst.available_sessions).toBe(18);          // 12 mua mới + 6 bảo lưu (không thành 12 bảo lưu)
    expect(dst.carryover_available).toBe(6);
    expect(dst.entitlement_exhaustion.status).toBe("INSUFFICIENT_SCHEDULE");
    await addSessions(sql, ID.class.QN_K4_U10, ID.course.QN_K4, mwfDatesBack("2027-01-25", 18).filter((d) => d >= "2026-12-14"));
    dst = await sp(k4.toString(), "2026-12-14");
    expect(dst.entitlement_exhaustion.status).toBe("FORECAST");
  });

  it("ngày dự kiến thay đổi không làm đổi hạn hóa đơn", async () => {
    const [inv] = await sql`insert into invoices (branch_id, student_id, enrollment_id, due_date, status)
      values (${ID.branch.QN}, ${late.sid}, ${late.eid}, '2026-12-01', 'ISSUED') returning id`;
    const before = await sp(late.eid);
    await rpc(sql, M, "cancel_session", [futureIds[5], "Sân bận"]);
    const after = await sp(late.eid);
    const [row] = await sql`select due_date::text d from invoices where id = ${inv.id}`;
    expect(row.d).toBe("2026-12-01");
    expect(before.invoice_due_date).toBe("2026-12-01");
    expect(after.invoice_due_date).toBe("2026-12-01");
    await sql`update sessions set status = 'scheduled', cancel_reason = null where id = ${futureIds[5]}`;
  });

  it("buổi hôm nay chưa điểm danh: chờ xác nhận, không tính là đã học", async () => {
    await setClock(sql, "2026-11-27T03:00:00Z"); // 10:00 VN ngày 27/11, buổi 17:30 chưa diễn ra
    const p = await cp("2026-11-27");
    expect(p.class_completed_sessions).toBe(30);
    expect((p as unknown as { pending_today_sessions: number }).pending_today_sessions).toBe(1);
    expect(p.milestones[2].estimated_date).toBe("2026-12-09");
    await expect(rpc(sql, C, "confirm_session", [futureIds[0], "2026-11-27T17:30:00+07:00", null])).rejects.toThrow(/thực sự diễn ra/);
  });
});

describe("Phân quyền view/RPC tiến độ", () => {
  it("phụ huynh A xem tiến độ con mình và tổng hợp lớp của con", async () => {
    const s = await sp(late.eid, AS_OF, ID.user.parentA);
    expect(s.available_sessions).toBe(12);
    const p = await cp(AS_OF, ID.user.parentA);
    expect(p.class_completed_sessions).toBe(30);
  });
  it("phụ huynh A không xem được học viên khác; danh sách chỉ trả con mình", async () => {
    await expect(sp(full.eid, AS_OF, ID.user.parentA)).rejects.toThrow(/quyền/);
    const list = await rpc<unknown>(sql, ID.user.parentA, "student_progress_list", [AS_OF, null, null, ID.class.QN_U10]);
    expect(list).toBeTruthy();
    const rows = await sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ID.user.parentA })}, true)`;
      await tx.unsafe("set local role authenticated");
      return tx`select r from public.student_progress_list(${AS_OF}::date, null, null, ${ID.class.QN_U10}::uuid) r`;
    });
    expect(rows.length).toBe(1);
  });
  it("phụ huynh B và HLV Phù Mỹ bị từ chối", async () => {
    await expect(sp(late.eid, AS_OF, ID.user.parentB)).rejects.toThrow(/quyền/);
    await expect(cp(AS_OF, ID.user.parentB)).rejects.toThrow(/quyền/);
    await expect(cp(AS_OF, ID.user.coachPM)).rejects.toThrow(/quyền/);
    await expect(sp(late.eid, AS_OF, ID.user.coachPM)).rejects.toThrow(/quyền/);
  });
  it("phụ huynh chưa được duyệt liên kết không xem được", async () => {
    const sid = await addStudent(sql, ID.branch.QN);
    const eid = await enroll(sql, { managerId: M, studentId: sid, branchId: ID.branch.QN, courseId: ID.course.QN_K3, classId: ID.class.QN_U10, planId: ID.plan.std1m, startDate: "2026-11-20" });
    await linkGuardian(sql, ID.user.parentB, sid, { verified: false });
    await expect(sp(eid, AS_OF, ID.user.parentB)).rejects.toThrow(/quyền/);
  });
  it("client không ghi trực tiếp được ledger/attendance; không gọi được helper nội bộ", async () => {
    const again = await rpc<{ charge: string }>(sql, M, "record_attendance", [pastIds[0], full.sid, "PRESENT", null, null]);
    expect(again.charge).toBe("CHARGED");
    expect((await sp(full.eid)).available_sessions).toBe(0); // đã chuyển 6 buổi bảo lưu ở test trước; gửi lại không trừ thêm
    await expect(sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: M })}, true)`;
      await tx.unsafe("set local role authenticated");
      await tx`insert into session_ledger (entitlement_id, enrollment_id, student_id, event_type, signed_delta, effective_date, idempotency_key)
        select id, enrollment_id, student_id, 'GRANT', 100, '2026-11-25', 'hack' from entitlements limit 1`;
    })).rejects.toThrow(/permission denied/);
    await expect(sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: M })}, true)`;
      await tx.unsafe("set local role authenticated");
      await tx`select app.apply_charge(id) from attendance limit 1`;
    })).rejects.toThrow(/permission denied/);
  });
});

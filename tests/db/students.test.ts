/** Thêm / sửa hồ sơ học viên và phụ huynh trên app (RPC create_student, update_student, save/unlink_student_guardian). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rpc, setClock, type Sql } from "./harness";
import { ID, addStudent, seedBase } from "./fixtures";

const M = ID.user.managerQN;
let sql: Sql; let drop: () => Promise<void>;

beforeAll(async () => {
  ({ sql, drop } = await createTestDb());
  await setClock(sql, "2026-11-25T13:00:00Z");
  await seedBase(sql);
});
afterAll(async () => { await drop?.(); });

type Saved = { id: string; reused: boolean };

describe("create_student", () => {
  it("bỏ qua mã đã tồn tại (dữ liệu import trực tiếp) thay vì báo trùng", async () => {
    const [{ code }] = await sql`select code from branches where id = ${ID.branch.QN}`;
    const [{ n }] = await sql`select last_value + 1 as n from student_code_seq`;
    const taken = `${code}-${String(n).padStart(6, "0")}`;
    await sql`insert into students (student_code, full_name, status, primary_branch_id, is_synthetic)
      values (${taken}, 'HV Import', 'ACTIVE', ${ID.branch.QN}, true)`;
    const id = await rpc<string>(sql, M, "create_student", [ID.branch.QN, "  Nguyễn   Văn  An ", "2016-05-01"]);
    const [s] = await sql`select student_code, full_name from students where id = ${id}`;
    expect(s.student_code).not.toBe(taken);
    expect(s.full_name).toBe("Nguyễn Văn An");
  });
  it("chỉ quản lý chi nhánh của học viên được tạo", async () => {
    await expect(rpc(sql, ID.user.managerPM, "create_student", [ID.branch.QN, "HV X", null])).rejects.toThrow(/quyền/);
    await expect(rpc(sql, ID.user.careQN, "create_student", [ID.branch.QN, "HV X", null])).rejects.toThrow(/quyền/);
    await expect(rpc(sql, M, "create_student", [ID.branch.QN, "HV X", "2030-01-01"])).rejects.toThrow(/Ngày sinh/);
  });
});

describe("update_student", () => {
  it("sửa họ tên, ngày sinh, trạng thái; Đã nghỉ hẳn cần lý do; ghi audit", async () => {
    const sid = await addStudent(sql, ID.branch.QN);
    await rpc(sql, M, "update_student", [sid, "Trần Bình", "2015-02-03", "PAUSED", null]);
    let [s] = await sql`select full_name, to_char(birth_date, 'YYYY-MM-DD') b, status, status_changed_by from students where id = ${sid}`;
    expect(s).toMatchObject({ full_name: "Trần Bình", b: "2015-02-03", status: "PAUSED", status_changed_by: M });
    await expect(rpc(sql, M, "update_student", [sid, "Trần Bình", null, "STOPPED", " "])).rejects.toThrow(/lý do/);
    await rpc(sql, M, "update_student", [sid, "Trần Bình", null, "STOPPED", "Chuyển nhà"]);
    [s] = await sql`select status, status_reason, birth_date from students where id = ${sid}`;
    expect(s).toMatchObject({ status: "STOPPED", status_reason: "Chuyển nhà", birth_date: null });
    const logs = await sql`select change from audit_logs where entity = 'student' and entity_id = ${sid} and action = 'UPDATE' order by id`;
    expect(logs).toHaveLength(2);
    expect(logs[1].change.status).toEqual(["PAUSED", "STOPPED"]);
  });
  it("HLV, CSKH, quản lý chi nhánh khác không được sửa", async () => {
    const sid = await addStudent(sql, ID.branch.QN);
    for (const u of [ID.user.coachQN, ID.user.careQN, ID.user.managerPM, ID.user.parentA]) {
      await expect(rpc(sql, u, "update_student", [sid, "Đổi tên", null, "ACTIVE", null])).rejects.toThrow(/quyền/);
    }
  });
});

describe("phụ huynh của học viên", () => {
  it("thêm, sửa, gỡ phụ huynh; anh chị em cùng SĐT dùng chung một hồ sơ", async () => {
    const a = await addStudent(sql, ID.branch.QN);
    const b = await addStudent(sql, ID.branch.QN);
    const g = await rpc<Saved>(sql, M, "save_student_guardian", [a, null, "Lê Mẹ", "0905 123.456", "", "Mẹ", true]);
    expect(g.reused).toBe(false);
    let [row] = await sql`select phone from guardians where id = ${g.id}`;
    expect(row.phone).toBe("0905123456");
    const g2 = await rpc<Saved>(sql, M, "save_student_guardian", [b, null, "Tên khác", "0905-123-456", "me@example.com", "Mẹ", false]);
    expect(g2).toEqual({ id: g.id, reused: true });
    [row] = await sql`select full_name, email from guardians where id = ${g.id}`;
    expect(row).toMatchObject({ full_name: "Lê Mẹ", email: "me@example.com" });
    await expect(rpc(sql, M, "save_student_guardian", [b, null, "Lê Mẹ", "0905123456", "", "Mẹ", false])).rejects.toThrow(/đã được liên kết/);

    await rpc(sql, M, "save_student_guardian", [a, g.id, "Lê Thị Mẹ", "0911222333", "", "Mẹ ruột", false]);
    [row] = await sql`select g.full_name, g.phone, gs.relationship, gs.can_request_leave from guardians g
      join guardian_students gs on gs.guardian_id = g.id where g.id = ${g.id} and gs.student_id = ${a}`;
    expect(row).toMatchObject({ full_name: "Lê Thị Mẹ", phone: "0911222333", relationship: "Mẹ ruột", can_request_leave: false });

    await rpc(sql, M, "unlink_student_guardian", [a, g.id]);
    expect((await sql`select 1 from guardians where id = ${g.id}`).length).toBe(1); // còn liên kết với b
    await rpc(sql, M, "unlink_student_guardian", [b, g.id]);
    expect((await sql`select 1 from guardians where id = ${g.id}`).length).toBe(0);
  });
  it("kiểm tra dữ liệu và quyền", async () => {
    const a = await addStudent(sql, ID.branch.QN);
    const other = await addStudent(sql, ID.branch.QN);
    await expect(rpc(sql, M, "save_student_guardian", [a, null, "Bố", "12ab", "", "Bố", false])).rejects.toThrow(/điện thoại/);
    await expect(rpc(sql, M, "save_student_guardian", [a, null, "Bố An", "", "x@", "Bố", false])).rejects.toThrow(/Email/);
    const g = await rpc<Saved>(sql, M, "save_student_guardian", [other, null, "Bố Khác", "", "", "Bố", false]);
    await expect(rpc(sql, M, "save_student_guardian", [a, g.id, "Bố Khác", "", "", "Bố", false])).rejects.toThrow(/không thuộc/);
    await expect(rpc(sql, ID.user.careQN, "save_student_guardian", [a, null, "Bố An", "", "", "Bố", false])).rejects.toThrow(/quyền/);
    await expect(rpc(sql, ID.user.managerPM, "unlink_student_guardian", [other, g.id])).rejects.toThrow(/quyền/);
  });
});

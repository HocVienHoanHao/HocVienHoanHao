/** Đăng nhập thật: lời mời theo email, nhận lời mời khi đăng nhập lần đầu, người chưa được mời không có quyền. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, rpc, setClock, type Sql } from "./harness";
import { ID, addStudent, seedBase } from "./fixtures";

let sql: Sql; let drop: () => Promise<void>;
const M = ID.user.managerQN;
// người dùng mới do Supabase Auth tạo (chưa có profile); email dạng example.invalid — không phải email thật
const NEW_COACH = "90000000-0000-0000-0000-000000000001";
const NEW_PARENT = "90000000-0000-0000-0000-000000000002";
const STRANGER = "90000000-0000-0000-0000-000000000003";
const claim = (uid: string, email: string) =>
  asUser(sql, uid, async (tx) => (await tx`select public.claim_my_invitations() n`)[0].n as number, { email });

beforeAll(async () => {
  ({ sql, drop } = await createTestDb());
  await setClock(sql, "2026-11-25T13:00:00Z");
  await seedBase(sql);
});
afterAll(async () => { await drop?.(); });

describe("lời mời nhân viên", () => {
  it("quản lý mời HLV chi nhánh mình; HLV đăng nhập lần đầu nhận đúng vai trò", async () => {
    await rpc(sql, M, "create_invitation", ["  HLV.Moi@Example.invalid ", "HLV Demo Mới", "STAFF", "COACH", ID.branch.QN, null, null, false, true]);
    expect(await claim(NEW_COACH, "hlv.moi@example.invalid")).toBe(1);
    const roles = await sql`select role::text, branch_id from branch_memberships where user_id = ${NEW_COACH}`;
    expect(roles).toEqual([{ role: "COACH", branch_id: ID.branch.QN }]);
    const [p] = await sql`select full_name from profiles where id = ${NEW_COACH}`;
    expect(p.full_name).toBe("HLV Demo Mới");
    expect(await claim(NEW_COACH, "hlv.moi@example.invalid")).toBe(0);           // idempotent
  });
  it("quản lý không mời được quản lý/super admin hoặc nhân viên chi nhánh khác; HLV không mời được ai", async () => {
    await expect(rpc(sql, M, "create_invitation", ["a@example.invalid", "QL Demo", "STAFF", "BRANCH_MANAGER", ID.branch.QN, null, null, false, true])).rejects.toThrow(/quyền/);
    await expect(rpc(sql, M, "create_invitation", ["a@example.invalid", "SA Demo", "STAFF", "SUPER_ADMIN", null, null, null, false, true])).rejects.toThrow(/quyền/);
    await expect(rpc(sql, M, "create_invitation", ["a@example.invalid", "HLV Demo", "STAFF", "COACH", ID.branch.PM, null, null, false, true])).rejects.toThrow(/quyền/);
    await expect(rpc(sql, ID.user.coachQN, "create_invitation", ["a@example.invalid", "HLV Demo", "STAFF", "COACH", ID.branch.QN, null, null, false, true])).rejects.toThrow(/quyền/);
    await expect(rpc(sql, M, "create_invitation", ["khong-phai-email", "HLV Demo", "STAFF", "COACH", ID.branch.QN, null, null, false, true])).rejects.toThrow(/Email/);
    const id = await rpc<string>(sql, ID.user.superAdmin, "create_invitation", ["ql.moi@example.invalid", "QL Demo Mới", "STAFF", "BRANCH_MANAGER", ID.branch.PY, null, null, false, true]);
    expect(id).toBeTruthy();
  });
});

describe("lời mời phụ huynh", () => {
  it("CSKH mời phụ huynh cho học viên; phụ huynh chỉ thấy con mình sau khi nhận", async () => {
    const mine = await addStudent(sql, ID.branch.QN);
    await addStudent(sql, ID.branch.QN);
    await rpc(sql, ID.user.careQN, "create_invitation", ["ph.moi@example.invalid", "Phụ huynh Demo Mới", "GUARDIAN", null, null, mine, "Mẹ", true, false]);
    expect(await claim(NEW_PARENT, "ph.moi@example.invalid")).toBe(1);
    const seen = await asUser(sql, NEW_PARENT, (tx) => tx`select id from students`);
    expect(seen.map((r) => r.id)).toEqual([mine]);
    const [gs] = await sql`select gs.can_request_leave, gs.can_view_finance, gs.verified_at from guardian_students gs
      join guardians g on g.id = gs.guardian_id where g.user_id = ${NEW_PARENT}`;
    expect([gs.can_request_leave, gs.can_view_finance, gs.verified_at !== null]).toEqual([true, false, true]);
  });
});

describe("người chưa được mời / lời mời hết hiệu lực", () => {
  it("đăng nhập bằng email khác không nhận được lời mời của người khác, không thấy dữ liệu", async () => {
    const inv = await rpc<string>(sql, M, "create_invitation", ["kt.moi@example.invalid", "KT Demo Mới", "STAFF", "ACCOUNTANT", ID.branch.QN, null, null, false, true]);
    expect(await claim(STRANGER, "nguoi.la@example.invalid")).toBe(0);
    expect((await sql`select count(*)::int n from profiles where id = ${STRANGER}`)[0].n).toBe(0);
    expect(await asUser(sql, STRANGER, (tx) => tx`select id from students`)).toEqual([]);
    // thu hồi rồi thì đúng email cũng không nhận được
    await rpc(sql, M, "revoke_invitation", [inv]);
    expect(await claim(STRANGER, "kt.moi@example.invalid")).toBe(0);
    // hết hạn
    await rpc(sql, M, "create_invitation", ["het.han@example.invalid", "HLV Demo Hết Hạn", "STAFF", "COACH", ID.branch.QN, null, null, false, true]);
    await sql`update user_invitations set expires_at = now() - interval '1 minute' where email = 'het.han@example.invalid'`;
    expect(await claim(STRANGER, "het.han@example.invalid")).toBe(0);
  });
  it("không có email trong phiên -> từ chối; không ai ghi thẳng vào bảng lời mời", async () => {
    await expect(asUser(sql, STRANGER, (tx) => tx`select public.claim_my_invitations()`)).rejects.toThrow(/Chưa đăng nhập/);
    await expect(asUser(sql, M, (tx) => tx`insert into user_invitations (email, full_name, kind, role, branch_id)
      values ('x@example.invalid', 'X Demo', 'STAFF', 'COACH', ${ID.branch.QN})`)).rejects.toThrow(/permission denied/);
  });
  it("RLS: quản lý chi nhánh khác không thấy lời mời của QN", async () => {
    const seen = await asUser(sql, ID.user.managerPM, (tx) => tx`select id from user_invitations`);
    expect(seen).toEqual([]);
    const qn = await asUser(sql, M, (tx) => tx`select id from user_invitations`);
    expect(qn.length).toBeGreaterThan(0);
  });
});

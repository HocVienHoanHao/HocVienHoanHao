/** Sổ thu tiền đơn giản: phiếu thu (khoản phải thu) + các lần trả, còn lại tự tính; hủy có lý do, không xóa. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, rpc, setClock, type Sql } from "./harness";
import { ID, addStudent, seedBase } from "./fixtures";

const M = ID.user.managerQN, A = ID.user.accountantQN;
let sql: Sql; let drop: () => Promise<void>;

beforeAll(async () => {
  ({ sql, drop } = await createTestDb());
  await setClock(sql, "2026-11-25T13:00:00Z");
  await seedBase(sql);
});
afterAll(async () => { await drop?.(); });

const items = (tuition: number, uniform = 0, gift = false) => JSON.stringify([
  { category: "tuition", amount: tuition, discount: 0 },
  { category: "uniform", amount: uniform, discount: gift ? uniform : 0, description: gift ? "Tặng đồng phục" : "" },
]);
const createInvoice = (user: string, sid: string, itemsJson: string, note: string | null = null) =>
  asUser(sql, user, async (tx) => (await tx`select public.create_invoice(${sid}::uuid, null, null, ${itemsJson}::jsonb, ${note}) as r`)[0].r as string);
const totals = async (inv: string) => (await sql`select * from app.invoice_totals(${inv})`)[0];

describe("sổ thu tiền", () => {
  it("phải thu, trả nhiều lần, còn lại; trạng thái tự cập nhật; tặng = giảm hết", async () => {
    const sid = await addStudent(sql, ID.branch.QN);
    const inv = await createInvoice(M, sid, items(1350000, 120000, true), "K3");
    expect(await totals(inv)).toMatchObject({ total: "1350000", paid: "0", remaining: "1350000" });
    await rpc(sql, A, "add_receipt", [inv, 675000, "2026-11-01", "TRANSFER", "50%"]);
    let [i] = await sql`select status from invoices where id = ${inv}`;
    expect(i.status).toBe("PARTIAL");
    await expect(rpc(sql, A, "add_receipt", [inv, 700000, "2026-11-20", "CASH", null])).rejects.toThrow(/vượt/);
    const r2 = await rpc<string>(sql, A, "add_receipt", [inv, 675000, "2026-11-20", "CASH", null]);
    [i] = await sql`select status from invoices where id = ${inv}`;
    expect(i.status).toBe("PAID");
    await expect(rpc(sql, A, "void_receipt", [r2, ""])).rejects.toThrow(/lý do/);
    await rpc(sql, A, "void_receipt", [r2, "Nhập nhầm"]);
    expect(await totals(inv)).toMatchObject({ paid: "675000", remaining: "675000" });
    await expect(rpc(sql, M, "void_invoice", [inv, "Sai"])).rejects.toThrow(/hủy các lần thu/);
    const [b] = await asUser(sql, M, (tx) => tx`select remaining from student_balances where student_id = ${sid}`);
    expect(b.remaining).toBe("675000");
  });
  it("kiểm tra dữ liệu và quyền", async () => {
    const sid = await addStudent(sql, ID.branch.QN);
    await expect(createInvoice(M, sid, "[]")).rejects.toThrow(/ít nhất/);
    await expect(createInvoice(M, sid, JSON.stringify([{ category: "tuition", amount: -1 }]))).rejects.toThrow(/Số tiền/);
    for (const u of [ID.user.careQN, ID.user.coachQN, ID.user.managerPM, ID.user.parentA]) {
      await expect(createInvoice(u, sid, items(100000))).rejects.toThrow(/quyền/);
    }
    const inv = await createInvoice(M, sid, items(100000), null);
    await expect(rpc(sql, M, "add_receipt", [inv, 1000, "2026-12-30", "CASH", null])).rejects.toThrow(/Ngày/);
    expect((await asUser(sql, ID.user.careQN, (tx) => tx`select 1 from receipts`)).length).toBe(0);
    expect((await asUser(sql, ID.user.managerPM, (tx) => tx`select 1 from student_balances where student_id = ${sid}`)).length).toBe(0);
    await rpc(sql, M, "void_invoice", [inv, "Tạo nhầm"]);
    const [i] = await sql`select status from invoices where id = ${inv}`;
    expect(i.status).toBe("VOID");
  });
});

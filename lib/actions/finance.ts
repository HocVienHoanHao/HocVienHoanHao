"use server";
import { revalidatePath } from "next/cache";
import { asUser } from "@/lib/db";
import { invoiceItemsFromForm, parseVnd } from "@/lib/money";
import { requireViewer } from "@/lib/session";
import { todayVn } from "@/lib/format";
import { DATE, InputError, UUID, runAction, str } from "./util";

const METHODS = ["CASH", "TRANSFER", "OTHER"];

function backFor(fd: FormData) {
  const s = str(fd, "student");
  return UUID.test(s) ? `/admin/students/${s}#thu-tien` : "/admin/students/profiles";
}

function money(raw: string) {
  try { return parseVnd(raw); } catch { throw new InputError("Số tiền không hợp lệ"); }
}

/** Tạo phiếu thu (khoản phải thu) và, nếu nhập, lần trả đầu tiên — trong một giao dịch. */
export async function createInvoiceAction(fd: FormData) {
  const v = await requireViewer();
  const student = str(fd, "student"), enrollment = str(fd, "enrollment");
  const back = backFor(fd);
  await runAction(back, "Đã tạo phiếu thu", async () => {
    if (!UUID.test(student) || (enrollment && !UUID.test(enrollment))) throw new InputError("Dữ liệu không hợp lệ");
    let items;
    try { items = invoiceItemsFromForm((k) => str(fd, k)); } catch { throw new InputError("Số tiền không hợp lệ"); }
    if (items.length === 0) throw new InputError("Nhập ít nhất một khoản phải thu");
    const paid = money(str(fd, "paid")), method = str(fd, "method") || "CASH", paidOn = str(fd, "paid_on") || todayVn();
    if (!METHODS.includes(method) || !DATE.test(paidOn)) throw new InputError("Thông tin thanh toán không hợp lệ");
    const note = str(fd, "note").slice(0, 500);
    await asUser(v.id, async (tx) => {
      const [r] = await tx`select public.create_invoice(${student}::uuid, ${enrollment || null}::uuid, null::date,
        ${JSON.stringify(items)}::jsonb, ${note || null}) as id`;
      if (paid > 0) await tx`select public.add_receipt(${r.id}::uuid, ${paid}::bigint, ${paidOn}::date, ${method}, null)`;
    });
    revalidatePath(back);
  });
}

export async function addReceiptAction(fd: FormData) {
  const v = await requireViewer();
  const invoice = str(fd, "invoice"), back = backFor(fd);
  const amount = str(fd, "amount"), paidOn = str(fd, "paid_on"), method = str(fd, "method") || "CASH", note = str(fd, "note").slice(0, 300);
  await runAction(back, "Đã ghi nhận thanh toán", async () => {
    if (!UUID.test(invoice)) throw new InputError("Phiếu thu không hợp lệ");
    const n = money(amount);
    if (n <= 0) throw new InputError("Nhập số tiền đã trả");
    if (!DATE.test(paidOn) || !METHODS.includes(method)) throw new InputError("Thông tin thanh toán không hợp lệ");
    await asUser(v.id, (tx) => tx`select public.add_receipt(${invoice}::uuid, ${n}::bigint, ${paidOn}::date, ${method}, ${note || null})`);
    revalidatePath(back);
  });
}

export async function voidReceiptAction(fd: FormData) {
  const v = await requireViewer();
  const receipt = str(fd, "receipt"), reason = str(fd, "reason").slice(0, 300), back = backFor(fd);
  await runAction(back, "Đã hủy lần thu", async () => {
    if (!UUID.test(receipt)) throw new InputError("Dữ liệu không hợp lệ");
    await asUser(v.id, (tx) => tx`select public.void_receipt(${receipt}::uuid, ${reason})`);
    revalidatePath(back);
  });
}

export async function voidInvoiceAction(fd: FormData) {
  const v = await requireViewer();
  const invoice = str(fd, "invoice"), reason = str(fd, "reason").slice(0, 300), back = backFor(fd);
  await runAction(back, "Đã hủy phiếu thu", async () => {
    if (!UUID.test(invoice)) throw new InputError("Dữ liệu không hợp lệ");
    await asUser(v.id, (tx) => tx`select public.void_invoice(${invoice}::uuid, ${reason})`);
    revalidatePath(back);
  });
}

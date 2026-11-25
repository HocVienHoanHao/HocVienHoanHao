import { fmtDate, fmtVnd, todayVn } from "@/lib/format";
import { CATEGORY_LABEL, METHOD_LABEL } from "@/lib/money";
import { addReceiptAction, createInvoiceAction, voidInvoiceAction, voidReceiptAction } from "@/lib/actions/finance";
import { InvoiceFields } from "./InvoiceFields";

export type Invoice = {
  id: string; created_at: string; status: string; note: string | null; void_reason: string | null; enrollment_label: string | null;
  total: string; paid: string; remaining: string;
  items: { category: string; amount: string; discount: string; description: string | null }[];
  receipts: { id: string; amount: string; paid_on: string; method: string; note: string | null; voided: boolean; void_reason: string | null }[];
};

const STATUS: Record<string, string> = { ISSUED: "Chưa trả", PARTIAL: "Trả một phần", PAID: "Đã trả đủ", VOID: "Đã hủy", DRAFT: "Nháp" };

/** Mục "Thu tiền" trong hồ sơ học viên: phiếu thu, các lần trả, còn lại. */
export function StudentFinance({ studentId, invoices, enrollments }: {
  studentId: string; invoices: Invoice[]; enrollments: { id: string; label: string }[];
}) {
  const live = invoices.filter((i) => i.status !== "VOID");
  const sum = (k: "total" | "paid" | "remaining") => live.reduce((a, i) => a + Number(i[k]), 0);
  return (
    <section id="thu-tien" className="card mt-3">
      <h2 className="mb-2 font-semibold text-navy">Thu tiền</h2>
      <div className="mb-3 grid grid-cols-3 gap-2 text-sm">
        <div><div className="label">Phải thu</div><div className="font-semibold">{fmtVnd(sum("total"))}</div></div>
        <div><div className="label">Đã thanh toán</div><div className="font-semibold text-emerald-700">{fmtVnd(sum("paid"))}</div></div>
        <div><div className="label">Còn lại</div><div className={`font-semibold ${sum("remaining") > 0 ? "text-rose-700" : ""}`}>{fmtVnd(sum("remaining"))}</div></div>
      </div>
      <ul className="space-y-2">
        {invoices.map((inv) => (
          <li key={inv.id} className={`rounded-lg p-3 ring-1 ring-slate-200 ${inv.status === "VOID" ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <div className="font-medium">Phiếu ngày {fmtDate(inv.created_at)}{inv.enrollment_label && <span className="font-normal text-slate-500"> · {inv.enrollment_label}</span>}</div>
              <div>{STATUS[inv.status] ?? inv.status} · còn <span className="font-semibold">{fmtVnd(Number(inv.remaining))}</span></div>
            </div>
            {inv.note && <div className="text-xs text-slate-500">{inv.note}</div>}
            {inv.void_reason && <div className="text-xs text-rose-700">Lý do hủy: {inv.void_reason}</div>}
            <table className="mt-1 min-w-full text-sm">
              <tbody>
                {inv.items.map((it, k) => (
                  <tr key={k}><td className="py-0.5">{CATEGORY_LABEL[it.category] ?? it.category}{it.description && <span className="text-slate-500"> · {it.description}</span>}</td>
                    <td className="py-0.5 text-right">{Number(it.discount) > 0 && Number(it.discount) >= Number(it.amount) ? "Tặng" : fmtVnd(Number(it.amount) - Number(it.discount))}</td></tr>
                ))}
                {inv.receipts.map((r) => (
                  <tr key={r.id} className={r.voided ? "text-slate-400 line-through" : "text-emerald-800"}>
                    <td className="py-0.5">Đã trả {fmtDate(r.paid_on)} · {METHOD_LABEL[r.method] ?? r.method}{r.note && ` · ${r.note}`}{r.voided && r.void_reason && ` (hủy: ${r.void_reason})`}</td>
                    <td className="py-0.5 text-right">−{fmtVnd(Number(r.amount))}</td></tr>
                ))}
              </tbody>
            </table>
            {inv.status !== "VOID" && (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm text-brand">Ghi thanh toán / hủy</summary>
                {Number(inv.remaining) > 0 && (
                  <form action={addReceiptAction} className="mt-2 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="student" value={studentId} /><input type="hidden" name="invoice" value={inv.id} />
                    <label className="flex flex-col gap-1"><span className="label">Số tiền (đ)</span><input name="amount" inputMode="numeric" required defaultValue={inv.remaining} className="input w-36" /></label>
                    <label className="flex flex-col gap-1"><span className="label">Ngày</span><input type="date" name="paid_on" required defaultValue={todayVn()} className="input" /></label>
                    <label className="flex flex-col gap-1"><span className="label">Hình thức</span>
                      <select name="method" className="input">{Object.entries(METHOD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                    <label className="flex flex-col gap-1"><span className="label">Ghi chú</span><input name="note" maxLength={300} className="input w-40" /></label>
                    <button className="btn">Ghi đã trả</button>
                  </form>
                )}
                {inv.receipts.filter((r) => !r.voided).map((r) => (
                  <form key={r.id} action={voidReceiptAction} className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    <input type="hidden" name="student" value={studentId} /><input type="hidden" name="receipt" value={r.id} />
                    <span>Hủy lần trả {fmtVnd(Number(r.amount))} ngày {fmtDate(r.paid_on)}:</span>
                    <input name="reason" required minLength={3} maxLength={300} placeholder="Lý do (VD: nhập nhầm)" className="input py-1" />
                    <button className="btn-ghost py-1 text-red-700">Hủy lần trả</button>
                  </form>
                ))}
                {inv.receipts.every((r) => r.voided) && (
                  <form action={voidInvoiceAction} className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    <input type="hidden" name="student" value={studentId} /><input type="hidden" name="invoice" value={inv.id} />
                    <input name="reason" required minLength={3} maxLength={300} placeholder="Lý do hủy phiếu" className="input py-1" />
                    <button className="btn-ghost py-1 text-red-700">Hủy phiếu</button>
                  </form>
                )}
              </details>
            )}
          </li>
        ))}
      </ul>
      <details className="mt-3" open={invoices.length === 0}>
        <summary className="cursor-pointer text-sm font-medium text-brand">+ Tạo phiếu thu</summary>
        <form action={createInvoiceAction} className="mt-2 grid gap-2 sm:grid-cols-2">
          <input type="hidden" name="student" value={studentId} />
          <label className="flex flex-col gap-1 sm:col-span-2"><span className="label">Thuộc đăng ký</span>
            <select name="enrollment" defaultValue={enrollments[0]?.id ?? ""} className="input">
              <option value="">Không gắn đăng ký</option>
              {enrollments.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select></label>
          <InvoiceFields />
          <label className="flex flex-col gap-1 sm:col-span-2"><span className="label">Ghi chú phiếu</span>
            <input name="note" maxLength={500} placeholder="VD: Tháng 11 thanh toán 50% còn lại" className="input" /></label>
          <div className="sm:col-span-2"><button className="btn">Tạo phiếu thu</button></div>
        </form>
      </details>
      <p className="mt-2 text-xs text-slate-500">Không xóa được tiền đã ghi; nếu nhập sai thì hủy lần trả kèm lý do (lưu lịch sử).</p>
    </section>
  );
}

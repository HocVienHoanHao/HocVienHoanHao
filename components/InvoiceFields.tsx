import { todayVn } from "@/lib/format";
import { METHOD_LABEL } from "@/lib/money";

/** Ô nhập khoản phải thu + lần trả đầu (theo cột bảng tính: học phí, đồng phục, giày, đã thanh toán). */
export function InvoiceFields({ prefix = "", tuitionHint }: { prefix?: string; tuitionHint?: string }) {
  const n = (k: string) => `${prefix}${k}`;
  return (
    <>
      <label className="flex flex-col gap-1"><span className="label">Học phí phải thu (đ)</span>
        <input name={n("tuition")} inputMode="numeric" placeholder={tuitionHint ?? "VD: 1.350.000"} className="input" /></label>
      <label className="flex flex-col gap-1"><span className="label">Ghi chú học phí</span>
        <input name={n("tuition_desc")} maxLength={200} placeholder="VD: Gói 3 tháng K3, đóng theo khóa" className="input" /></label>
      <label className="flex flex-col gap-1"><span className="label">Tiền đồng phục (đ)</span>
        <span className="flex items-center gap-3"><input name={n("uniform")} inputMode="numeric" placeholder="VD: 120.000" className="input flex-1" />
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" name={n("uniform_gift")} /> Tặng</label></span></label>
      <label className="flex flex-col gap-1"><span className="label">Tiền giày (đ)</span>
        <span className="flex items-center gap-3"><input name={n("shoes")} inputMode="numeric" placeholder="VD: 180.000" className="input flex-1" />
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" name={n("shoes_gift")} /> Tặng</label></span></label>
      <label className="flex flex-col gap-1"><span className="label">Khoản khác (đ)</span>
        <input name={n("other")} inputMode="numeric" className="input" /></label>
      <label className="flex flex-col gap-1"><span className="label">Nội dung khoản khác</span>
        <input name={n("other_desc")} maxLength={200} className="input" /></label>
      <label className="flex flex-col gap-1"><span className="label">Đã thanh toán (đ)</span>
        <input name={n("paid")} inputMode="numeric" placeholder="0" className="input" /></label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1"><span className="label">Hình thức</span>
          <select name={n("method")} className="input">{Object.entries(METHOD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="flex flex-col gap-1"><span className="label">Ngày trả</span>
          <input type="date" name={n("paid_on")} defaultValue={todayVn()} className="input" /></label>
      </div>
    </>
  );
}

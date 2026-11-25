/** Bộ lọc dạng GET form (không cần JS): chi nhánh + ngày chốt + tùy chọn thêm. */
import type { ReactNode } from "react";

export function FilterBar({ branches, branchId, asOf, children, action }: {
  branches: { id: string; code: string; name: string }[]; branchId: string | null; asOf: string;
  children?: ReactNode; action?: string;
}) {
  return (
    <form method="get" action={action} className="card mb-4 flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1">
        <span className="label">Chi nhánh</span>
        <select name="branch" defaultValue={branchId ?? ""} className="input">
          <option value="">Toàn hệ thống</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="label">Ngày chốt dữ liệu</span>
        <input type="date" name="asOf" defaultValue={asOf} className="input" required />
      </label>
      {children}
      <button className="btn">Xem</button>
    </form>
  );
}

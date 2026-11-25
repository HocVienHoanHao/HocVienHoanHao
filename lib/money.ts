/** Đọc số tiền người dùng gõ ("1.350.000", "1,350,000 ₫", "1350000") -> số đồng; rỗng -> 0. */
export function parseVnd(raw: string): number {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return 0;
  const n = Number(digits);
  if (!Number.isSafeInteger(n) || n > 100_000_000) throw new RangeError("Số tiền không hợp lệ");
  return n;
}

export type InvoiceItemInput = { category: "tuition" | "uniform" | "shoes" | "other"; amount: number; discount: number; description: string };

/** Các khoản phải thu từ form (prefix để dùng chung form thêm học viên và hồ sơ). Khoản tặng = giảm toàn bộ. */
export function invoiceItemsFromForm(get: (k: string) => string, prefix = ""): InvoiceItemInput[] {
  const f = (k: string) => get(`${prefix}${k}`);
  const items: InvoiceItemInput[] = [];
  const tuition = parseVnd(f("tuition"));
  if (tuition > 0) items.push({ category: "tuition", amount: tuition, discount: 0, description: f("tuition_desc").slice(0, 200) });
  for (const [cat, label] of [["uniform", "Đồng phục"], ["shoes", "Giày"]] as const) {
    const amt = parseVnd(f(cat)), gift = f(`${cat}_gift`) === "on";
    if (amt > 0 || gift) items.push({ category: cat, amount: amt, discount: gift ? amt : 0, description: gift ? `Tặng ${label.toLowerCase()}` : "" });
  }
  const other = parseVnd(f("other"));
  if (other > 0) items.push({ category: "other", amount: other, discount: 0, description: f("other_desc").slice(0, 200) });
  return items;
}

export const CATEGORY_LABEL: Record<string, string> = { tuition: "Học phí", uniform: "Đồng phục", shoes: "Giày", other: "Khác" };
export const METHOD_LABEL: Record<string, string> = { CASH: "Tiền mặt", TRANSFER: "Chuyển khoản", OTHER: "Khác" };

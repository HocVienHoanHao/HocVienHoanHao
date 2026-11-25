/** Định dạng hiển thị theo vi-VN. */

export const TZ = "Asia/Ho_Chi_Minh";

/** "2026-12-09" -> "09/12/2026"; null -> fallback */
export function fmtDate(iso: string | null | undefined, fallback = "—"): string {
  if (!iso) return fallback;
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function fmtDateTime(iso: string | null | undefined, fallback = "—"): string {
  if (!iso) return fallback;
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

export function fmtVnd(n: number | null | undefined): string {
  if (n == null) return "Chưa có dữ liệu";
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(n);
}

/** Số đếm: null nghĩa là thiếu dữ liệu, KHÔNG hiển thị 0 thay thế. */
export function fmtCount(n: number | null | undefined): string {
  return n == null ? "Chưa đủ dữ liệu" : String(n);
}

/** Hôm nay theo giờ VN, dạng ISO yyyy-mm-dd */
export function todayVn(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

/** Số ngày từ a đến b (ISO date) */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export const WEEKDAY_VN = ["", "T2", "T3", "T4", "T5", "T6", "T7", "CN"];

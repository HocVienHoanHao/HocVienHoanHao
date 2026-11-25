import type { Viewer } from "@/lib/session";

export const STUDENT_STATUS_LABEL: Record<string, string> = {
  LEAD: "Tiềm năng (chưa học)",
  ACTIVE: "Đang học",
  PAUSED: "Tạm dừng",
  ON_HOLD: "Đang bảo lưu",
  COMPLETED: "Đã hoàn thành",
  STOPPED: "Đã nghỉ hẳn",
  UNKNOWN: "Chưa rõ",
};
export const EDITABLE_STATUSES = ["LEAD", "ACTIVE", "PAUSED", "ON_HOLD", "COMPLETED", "STOPPED"] as const;

/** Chi nhánh người dùng được thêm/sửa học viên (null = mọi chi nhánh, SUPER_ADMIN). Kiểm tra thật nằm trong RPC. */
export function managedBranchIds(v: Viewer): string[] | null {
  return v.isSuperAdmin ? null : v.roles.filter((r) => r.role === "BRANCH_MANAGER").map((r) => r.branchId as string);
}

export function canManageBranch(v: Viewer, branchId: string): boolean {
  const m = managedBranchIds(v);
  return m === null || m.includes(branchId);
}

/** Quản lý hoặc kế toán chi nhánh: xem và ghi sổ thu tiền. */
export function canFinanceBranch(v: Viewer, branchId: string): boolean {
  return v.isSuperAdmin || v.roles.some((r) => (r.role === "BRANCH_MANAGER" || r.role === "ACCOUNTANT") && r.branchId === branchId);
}

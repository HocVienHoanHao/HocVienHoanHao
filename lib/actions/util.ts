import "server-only";
import { redirect } from "next/navigation";

export const UUID = /^[0-9a-f-]{36}$/i;
export const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** "2026-12-09T17:30" (giờ VN từ input datetime-local) -> ISO có múi giờ +07:00 */
export const vnLocal = (v: string) => `${v}:00+07:00`;

export function str(fd: FormData, k: string) { return String(fd.get(k) ?? "").trim(); }

export class InputError extends Error {}

/**
 * Chỉ hiển thị cho người dùng thông báo nghiệp vụ (RAISE trong RPC, thiếu quyền, dữ liệu nhập sai);
 * lỗi hệ thống khác thay bằng thông báo chung để không lộ chi tiết nội bộ.
 */
function userMessage(e: unknown): string {
  if (e instanceof InputError) return e.message;
  const code = (e as { code?: string })?.code;
  if (code === "P0001" || code === "42501") return (e as Error).message;
  console.error("[action]", code ?? "", (e as Error)?.message);
  return "Có lỗi xảy ra, vui lòng thử lại";
}

/** Chạy thao tác rồi quay lại trang `back` kèm ?ok=… hoặc ?err=… (redirect phải nằm ngoài try). */
export async function runAction(back: string, okMsg: string, fn: () => Promise<unknown>): Promise<never> {
  let target: string;
  try {
    await fn();
    target = withParam(back, "ok", okMsg);
  } catch (e) {
    target = withParam(back, "err", userMessage(e));
  }
  redirect(target);
}

function withParam(path: string, k: string, v: string) {
  const [base, hash] = path.split("#");
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${k}=${encodeURIComponent(v)}${hash ? `#${hash}` : ""}`;
}

/** Chỉ cho phép quay lại đường dẫn nội bộ (chống open redirect). */
export function safeBack(fd: FormData, fallback: string) {
  const b = str(fd, "back");
  return b.startsWith("/") && !b.startsWith("//") ? b : fallback;
}

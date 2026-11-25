"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { asUser } from "@/lib/db";
import { requireViewer } from "@/lib/session";
import { todayVn } from "@/lib/format";
import { invoiceItemsFromForm, parseVnd } from "@/lib/money";
import { DATE, InputError, UUID, runAction, str, userMessage, withParam } from "./util";

const STATUSES = ["LEAD", "ACTIVE", "PAUSED", "ON_HOLD", "COMPLETED", "STOPPED"] as const;

function guardianFields(fd: FormData, prefix = "") {
  return {
    name: str(fd, `${prefix}name`).slice(0, 120),
    phone: str(fd, `${prefix}phone`).slice(0, 30),
    email: str(fd, `${prefix}email`).slice(0, 254),
    relationship: str(fd, `${prefix}relationship`).slice(0, 50),
    canLeave: fd.get(`${prefix}can_request_leave`) === "on",
    hasZalo: fd.get(`${prefix}has_zalo`) === "on",
  };
}

/** Các trường hồ sơ như bảng tính tuyển sinh (năm sinh, địa chỉ, size, ghi chú). */
function detailFields(fd: FormData) {
  const yearRaw = str(fd, "birth_year");
  const year = yearRaw ? Number(yearRaw) : null;
  if (year !== null && (!Number.isInteger(year) || year < 1990 || year > 2100)) throw new InputError("Năm sinh không hợp lệ");
  return {
    year,
    address: str(fd, "address").slice(0, 300),
    uniform: str(fd, "uniform_size").slice(0, 20),
    shoe: str(fd, "shoe_size").slice(0, 20),
    note: str(fd, "note").slice(0, 1000),
  };
}

/**
 * Tạo học viên + chi tiết hồ sơ + phụ huynh + (tùy chọn) đăng ký gói và buổi bảo lưu khóa trước,
 * tất cả trong một giao dịch: lỗi ở bước nào thì không lưu gì. Thành công thì mở hồ sơ vừa tạo.
 */
export async function createStudentProfileAction(fd: FormData) {
  const v = await requireViewer();
  const branch = str(fd, "branch"), name = str(fd, "name").slice(0, 120), birth = str(fd, "birth");
  const g = guardianFields(fd, "g_");
  const cls = str(fd, "class"), plan = str(fd, "plan"), start = str(fd, "start");
  const days = fd.getAll("weekdays").map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
  const carryRaw = str(fd, "carryover"), carryReason = str(fd, "carryover_reason").slice(0, 300);
  let target: string;
  try {
    if (!UUID.test(branch)) throw new InputError("Chọn chi nhánh");
    if (birth && !DATE.test(birth)) throw new InputError("Ngày sinh không hợp lệ");
    const d = detailFields(fd);
    if (!g.name && (g.phone || g.email)) throw new InputError("Nhập họ tên phụ huynh");
    const enrolling = Boolean(cls || plan);
    if (enrolling && !(UUID.test(cls) && UUID.test(plan))) throw new InputError("Chọn cả lớp và gói học (hoặc để trống cả hai)");
    if (enrolling && !DATE.test(start)) throw new InputError("Ngày bắt đầu học không hợp lệ");
    const carry = carryRaw ? Number(carryRaw) : 0;
    if (!Number.isInteger(carry) || carry < 0 || carry > 100) throw new InputError("Số buổi bảo lưu không hợp lệ");
    if (carry > 0 && !enrolling) throw new InputError("Buổi bảo lưu cần đi kèm đăng ký lớp và gói");
    let items, paid;
    try { items = invoiceItemsFromForm((k) => str(fd, k), "f_"); paid = parseVnd(str(fd, "f_paid")); }
    catch { throw new InputError("Số tiền không hợp lệ"); }
    const method = str(fd, "f_method") || "CASH", paidOn = str(fd, "f_paid_on") || todayVn();
    if (paid > 0 && items.length === 0) throw new InputError("Nhập khoản phải thu (học phí, đồng phục…) trước khi ghi đã thanh toán");
    if (!["CASH", "TRANSFER", "OTHER"].includes(method) || !DATE.test(paidOn)) throw new InputError("Thông tin thanh toán không hợp lệ");
    const id = await asUser(v.id, async (tx) => {
      const [r] = await tx`select public.create_student(${branch}::uuid, ${name}, ${birth || null}::date) as id`;
      await tx`select public.update_student(${r.id}::uuid, ${name}, ${birth || null}::date, 'ACTIVE'::student_status, null,
        ${d.year}::int, ${d.address}, ${d.uniform}, ${d.shoe}, ${d.note})`;
      if (g.name) {
        await tx`select public.save_student_guardian(${r.id}::uuid, null, ${g.name}, ${g.phone}, ${g.email}, ${g.relationship},
          ${g.canLeave}, ${g.hasZalo})`;
      }
      let enrollmentId: string | null = null;
      if (enrolling) {
        const [e] = await tx`select public.create_enrollment(${r.id}::uuid, ${cls}::uuid, ${plan}::uuid, ${start}::date,
          ${days.length ? days : null}::int[], true, null::date) as id`;
        enrollmentId = e.id as string;
        if (carry > 0) await tx`select public.add_opening_carryover(${e.id}::uuid, ${carry}::int, ${carryReason || null})`;
      }
      if (items.length > 0) {
        const [inv] = await tx`select public.create_invoice(${r.id}::uuid, ${enrollmentId}::uuid, null::date,
          ${JSON.stringify(items)}::jsonb, null) as id`;
        if (paid > 0) await tx`select public.add_receipt(${inv.id}::uuid, ${paid}::bigint, ${paidOn}::date, ${method}, null)`;
      }
      return r.id as string;
    });
    revalidatePath("/admin/students");
    target = withParam(`/admin/students/${id}`, "ok", "Đã tạo học viên");
  } catch (e) {
    target = withParam("/admin/students/new", "err", userMessage(e));
  }
  redirect(target);
}

export async function updateStudentAction(fd: FormData) {
  const v = await requireViewer();
  const id = str(fd, "id"), name = str(fd, "name").slice(0, 120), birth = str(fd, "birth");
  const status = str(fd, "status"), reason = str(fd, "status_reason").slice(0, 300);
  const back = UUID.test(id) ? `/admin/students/${id}` : "/admin/students/profiles";
  await runAction(back, "Đã lưu thông tin học viên", async () => {
    if (!UUID.test(id)) throw new InputError("Học viên không hợp lệ");
    if (birth && !DATE.test(birth)) throw new InputError("Ngày sinh không hợp lệ");
    if (!(STATUSES as readonly string[]).includes(status)) throw new InputError("Chọn trạng thái học viên");
    const d = detailFields(fd);
    await asUser(v.id, (tx) => tx`select public.update_student(${id}::uuid, ${name}, ${birth || null}::date,
      ${status}::student_status, ${reason || null}, ${d.year}::int, ${d.address}, ${d.uniform}, ${d.shoe}, ${d.note})`);
    revalidatePath(back);
  });
}

export async function addOpeningCarryoverAction(fd: FormData) {
  const v = await requireViewer();
  const student = str(fd, "student"), enrollment = str(fd, "enrollment");
  const n = Number(str(fd, "sessions")), reason = str(fd, "reason").slice(0, 300);
  const back = UUID.test(student) ? `/admin/students/${student}` : "/admin/students/profiles";
  await runAction(back, `Đã cộng ${n} buổi bảo lưu từ khóa trước`, async () => {
    if (!UUID.test(enrollment)) throw new InputError("Đăng ký không hợp lệ");
    if (!Number.isInteger(n) || n <= 0 || n > 100) throw new InputError("Số buổi bảo lưu không hợp lệ");
    await asUser(v.id, (tx) => tx`select public.add_opening_carryover(${enrollment}::uuid, ${n}::int, ${reason || null})`);
    revalidatePath(back);
  });
}

export async function saveGuardianAction(fd: FormData) {
  const v = await requireViewer();
  const student = str(fd, "student"), guardian = str(fd, "guardian");
  const g = guardianFields(fd);
  const back = UUID.test(student) ? `/admin/students/${student}` : "/admin/students/profiles";
  let target: string;
  try {
    if (!UUID.test(student) || (guardian && !UUID.test(guardian))) throw new InputError("Dữ liệu không hợp lệ");
    const [r] = await asUser(v.id, (tx) => tx`select public.save_student_guardian(${student}::uuid, ${guardian || null}::uuid,
      ${g.name}, ${g.phone}, ${g.email}, ${g.relationship}, ${g.canLeave}, ${g.hasZalo}) as r`);
    revalidatePath(back);
    const msg = guardian ? "Đã lưu thông tin phụ huynh"
      : r.r?.reused ? "Đã liên kết phụ huynh có sẵn cùng số điện thoại (anh/chị/em của học viên khác)" : "Đã thêm phụ huynh";
    target = withParam(back, "ok", msg);
  } catch (e) {
    target = withParam(back, "err", userMessage(e));
  }
  redirect(target);
}

export async function unlinkGuardianAction(fd: FormData) {
  const v = await requireViewer();
  const student = str(fd, "student"), guardian = str(fd, "guardian");
  const back = UUID.test(student) ? `/admin/students/${student}` : "/admin/students/profiles";
  await runAction(back, "Đã gỡ phụ huynh khỏi học viên", async () => {
    if (!UUID.test(student) || !UUID.test(guardian)) throw new InputError("Dữ liệu không hợp lệ");
    await asUser(v.id, (tx) => tx`select public.unlink_student_guardian(${student}::uuid, ${guardian}::uuid)`);
    revalidatePath(back);
  });
}

"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { asUser } from "@/lib/db";
import { requireViewer } from "@/lib/session";
import { DATE, InputError, UUID, runAction, str, userMessage, withParam } from "./util";

const STATUSES = ["LEAD", "ACTIVE", "PAUSED", "ON_HOLD", "COMPLETED", "STOPPED"] as const;

function guardianFields(fd: FormData, prefix = "") {
  return {
    name: str(fd, `${prefix}name`).slice(0, 120),
    phone: str(fd, `${prefix}phone`).slice(0, 30),
    email: str(fd, `${prefix}email`).slice(0, 254),
    relationship: str(fd, `${prefix}relationship`).slice(0, 50),
    canLeave: fd.get(`${prefix}can_request_leave`) === "on",
  };
}

/** Tạo học viên (+ phụ huynh đầu tiên nếu nhập) trong một giao dịch, rồi mở hồ sơ học viên vừa tạo. */
export async function createStudentProfileAction(fd: FormData) {
  const v = await requireViewer();
  const branch = str(fd, "branch"), name = str(fd, "name").slice(0, 120), birth = str(fd, "birth");
  const g = guardianFields(fd, "g_");
  let target: string;
  try {
    if (!UUID.test(branch)) throw new InputError("Chọn chi nhánh");
    if (birth && !DATE.test(birth)) throw new InputError("Ngày sinh không hợp lệ");
    if (!g.name && (g.phone || g.email)) throw new InputError("Nhập họ tên phụ huynh");
    const id = await asUser(v.id, async (tx) => {
      const [r] = await tx`select public.create_student(${branch}::uuid, ${name}, ${birth || null}::date) as id`;
      if (g.name) {
        await tx`select public.save_student_guardian(${r.id}::uuid, null, ${g.name}, ${g.phone}, ${g.email}, ${g.relationship}, ${g.canLeave})`;
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
    await asUser(v.id, (tx) => tx`select public.update_student(${id}::uuid, ${name}, ${birth || null}::date,
      ${status}::student_status, ${reason || null})`);
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
      ${g.name}, ${g.phone}, ${g.email}, ${g.relationship}, ${g.canLeave}) as r`);
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

"use server";
import { revalidatePath } from "next/cache";
import { asUser } from "@/lib/db";
import { requireViewer } from "@/lib/session";
import { DATE, InputError, UUID, runAction, str } from "./util";

const BACK = "/admin/enrollments";

export async function createStudentAction(fd: FormData) {
  const v = await requireViewer();
  const branch = str(fd, "branch"), name = str(fd, "name").slice(0, 120), birth = str(fd, "birth");
  await runAction(BACK, "Đã tạo học viên", async () => {
    if (!UUID.test(branch)) throw new InputError("Chọn chi nhánh");
    if (birth && !DATE.test(birth)) throw new InputError("Ngày sinh không hợp lệ");
    await asUser(v.id, (tx) => tx`select public.create_student(${branch}::uuid, ${name}, ${birth || null}::date)`);
    revalidatePath(BACK);
  });
}

export async function createEnrollmentAction(fd: FormData) {
  const v = await requireViewer();
  const student = str(fd, "student"), cls = str(fd, "class"), plan = str(fd, "plan"), start = str(fd, "start");
  const validUntil = str(fd, "valid_until");
  const days = fd.getAll("weekdays").map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
  await runAction(BACK, "Đã tạo và xác nhận đăng ký", async () => {
    if (![student, cls, plan].every((x) => UUID.test(x))) throw new InputError("Chọn học viên, lớp và gói");
    if (!DATE.test(start)) throw new InputError("Ngày bắt đầu không hợp lệ");
    if (validUntil && !DATE.test(validUntil)) throw new InputError("Hạn dùng không hợp lệ");
    await asUser(v.id, (tx) => tx`select public.create_enrollment(${student}::uuid, ${cls}::uuid, ${plan}::uuid, ${start}::date,
      ${days.length ? days : null}::int[], true, ${validUntil || null}::date)`);
    revalidatePath(BACK);
  });
}

export async function transferCarryoverAction(fd: FormData) {
  const v = await requireViewer();
  const req = str(fd, "request"), from = str(fd, "from"), to = str(fd, "to"), date = str(fd, "date");
  const reason = str(fd, "reason").slice(0, 300), validUntil = str(fd, "valid_until");
  const n = Number(str(fd, "sessions"));
  await runAction(BACK, `Đã chuyển ${n} buổi bảo lưu`, async () => {
    if (![req, from, to].every((x) => UUID.test(x))) throw new InputError("Chọn đăng ký nguồn và đích");
    if (from === to) throw new InputError("Đăng ký nguồn và đích phải khác nhau");
    if (!Number.isInteger(n) || n <= 0 || n > 500) throw new InputError("Số buổi không hợp lệ");
    if (!DATE.test(date) || (validUntil && !DATE.test(validUntil))) throw new InputError("Ngày không hợp lệ");
    if (!reason) throw new InputError("Cần lý do bảo lưu");
    await asUser(v.id, (tx) => tx`select public.transfer_carryover(${req}::uuid, ${from}::uuid, ${to}::uuid, ${n}, ${date}::date,
      ${reason}, ${validUntil || null}::date)`);
    revalidatePath(BACK);
  });
}

"use server";
import { revalidatePath } from "next/cache";
import { asUser } from "@/lib/db";
import { requireViewer } from "@/lib/session";
import { DATE, InputError, UUID, runAction, safeBack, str } from "./util";

export async function requestLeaveAction(fd: FormData) {
  const v = await requireViewer();
  const back = safeBack(fd, "/parent");
  const student = str(fd, "student"), from = str(fd, "from"), to = str(fd, "to") || str(fd, "from");
  const reason = str(fd, "reason").slice(0, 500);
  await runAction(back, "Đã gửi đơn xin nghỉ, chờ học viện duyệt", async () => {
    if (!UUID.test(student) || !DATE.test(from) || !DATE.test(to)) throw new InputError("Ngày nghỉ không hợp lệ");
    if (!reason) throw new InputError("Cần lý do nghỉ");
    await asUser(v.id, (tx) => tx`select public.request_leave(${student}::uuid, ${from}::date, ${to}::date, ${reason})`);
    revalidatePath(back.split("?")[0]);
  });
}

export async function decideLeaveAction(fd: FormData) {
  const v = await requireViewer();
  const back = "/admin/leaves";
  const id = str(fd, "leave"), decision = str(fd, "decision");
  await runAction(back, decision === "reject" ? "Đã từ chối đơn" : decision === "approve_free" ? "Đã duyệt ngoại lệ: không trừ buổi" : "Đã duyệt đơn (buổi nghỉ vẫn trừ theo quy định)", async () => {
    if (!UUID.test(id)) throw new InputError("Đơn không hợp lệ");
    if (decision === "reject") {
      await asUser(v.id, (tx) => tx`select public.reject_leave(${id}::uuid)`);
    } else if (decision === "approve" || decision === "approve_free") {
      // D1: nghỉ không bảo lưu -> mặc định trừ buổi; "approve_free" là ngoại lệ quản lý thỏa thuận riêng với phụ huynh
      await asUser(v.id, (tx) => tx`select public.approve_leave(${id}::uuid, ${decision === "approve"})`);
    } else throw new InputError("Thao tác không hợp lệ");
    revalidatePath(back);
  });
}

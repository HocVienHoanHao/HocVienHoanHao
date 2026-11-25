"use server";
import { revalidatePath } from "next/cache";
import { asUser } from "@/lib/db";
import { requireViewer } from "@/lib/session";
import { DATE, DT, InputError, UUID, runAction, str, vnLocal } from "./util";

function classPath(fd: FormData) {
  const cls = str(fd, "class");
  if (!UUID.test(cls)) throw new InputError("Lớp không hợp lệ");
  return { cls, back: `/admin/classes/${cls}` };
}

export async function generateSessionsAction(fd: FormData) {
  const v = await requireViewer();
  const { cls, back } = classPath(fd);
  const from = str(fd, "from"), to = str(fd, "to");
  let n = 0;
  await runAction(back, "Đã tạo lịch", async () => {
    if (!DATE.test(from) || !DATE.test(to)) throw new InputError("Ngày không hợp lệ");
    const [r] = await asUser(v.id, (tx) => tx`select public.generate_sessions(${cls}::uuid, ${from}::date, ${to}::date) n`);
    n = Number(r.n);
    revalidatePath(back);
    if (n === 0) throw new InputError("Không có buổi mới (các ngày đã có lịch hoặc không trùng thứ học)");
  });
}

export async function cancelSessionAction(fd: FormData) {
  const v = await requireViewer();
  const { back } = classPath(fd);
  const id = str(fd, "session"), reason = str(fd, "reason").slice(0, 300);
  await runAction(back, "Đã hủy buổi", async () => {
    if (!UUID.test(id)) throw new InputError("Buổi không hợp lệ");
    if (!reason) throw new InputError("Cần lý do hủy");
    await asUser(v.id, (tx) => tx`select public.cancel_session(${id}::uuid, ${reason})`);
    revalidatePath(back);
  });
}

export async function rescheduleSessionAction(fd: FormData) {
  const v = await requireViewer();
  const { back } = classPath(fd);
  const id = str(fd, "session"), at = str(fd, "at");
  await runAction(back, "Đã dời buổi", async () => {
    if (!UUID.test(id) || !DT.test(at)) throw new InputError("Giờ không hợp lệ");
    await asUser(v.id, (tx) => tx`select public.reschedule_session(${id}::uuid, ${vnLocal(at)}::timestamptz, null)`);
    revalidatePath(back);
  });
}

export async function makeupSessionAction(fd: FormData) {
  const v = await requireViewer();
  const { back } = classPath(fd);
  const id = str(fd, "session"), at = str(fd, "at");
  await runAction(back, "Đã xếp buổi bù", async () => {
    if (!UUID.test(id) || !DT.test(at)) throw new InputError("Giờ không hợp lệ");
    await asUser(v.id, (tx) => tx`select public.schedule_makeup_session(${id}::uuid, ${vnLocal(at)}::timestamptz, null)`);
    revalidatePath(back);
  });
}

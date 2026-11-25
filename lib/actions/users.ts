"use server";
import { revalidatePath } from "next/cache";
import { asUser } from "@/lib/db";
import { requireViewer } from "@/lib/session";
import { InputError, UUID, runAction, str } from "./util";

const BACK = "/admin/users";
const STAFF_ROLES = ["SUPER_ADMIN", "BRANCH_MANAGER", "ACCOUNTANT", "COACH", "CARE_STAFF"];

export async function inviteStaffAction(fd: FormData) {
  const v = await requireViewer();
  const email = str(fd, "email").slice(0, 254), name = str(fd, "name").slice(0, 120), role = str(fd, "role"), branch = str(fd, "branch");
  await runAction(BACK, "Đã tạo lời mời. Nhắn người được mời đăng nhập bằng đúng email này.", async () => {
    if (!STAFF_ROLES.includes(role)) throw new InputError("Vai trò không hợp lệ");
    if (role !== "SUPER_ADMIN" && !UUID.test(branch)) throw new InputError("Chọn chi nhánh");
    await asUser(v.id, (tx) => tx`select public.create_invitation(${email}, ${name}, 'STAFF', ${role}::app_role,
      ${role === "SUPER_ADMIN" ? null : branch}::uuid, null, null, false, true)`);
    revalidatePath(BACK);
  });
}

export async function inviteGuardianAction(fd: FormData) {
  const v = await requireViewer();
  const email = str(fd, "email").slice(0, 254), name = str(fd, "name").slice(0, 120), student = str(fd, "student");
  const relationship = str(fd, "relationship").slice(0, 50);
  const canLeave = fd.get("can_request_leave") === "on", canFinance = fd.get("can_view_finance") === "on";
  await runAction(BACK, "Đã tạo lời mời phụ huynh. Nhắn phụ huynh đăng nhập bằng đúng email này.", async () => {
    if (!UUID.test(student)) throw new InputError("Chọn học viên");
    await asUser(v.id, (tx) => tx`select public.create_invitation(${email}, ${name}, 'GUARDIAN', null, null, ${student}::uuid,
      ${relationship}, ${canLeave}, ${canFinance})`);
    revalidatePath(BACK);
  });
}

export async function revokeInvitationAction(fd: FormData) {
  const v = await requireViewer();
  const id = str(fd, "id");
  await runAction(BACK, "Đã thu hồi lời mời", async () => {
    if (!UUID.test(id)) throw new InputError("Lời mời không hợp lệ");
    await asUser(v.id, (tx) => tx`select public.revoke_invitation(${id}::uuid)`);
    revalidatePath(BACK);
  });
}

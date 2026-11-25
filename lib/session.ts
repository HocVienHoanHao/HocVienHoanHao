import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { asUser } from "./db";

export const DEV_COOKIE = "hh_dev_user";

export function devSwitcherEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.DEV_IDENTITY_SWITCHER === "1";
}

export type Viewer = {
  id: string;
  fullName: string;
  isSuperAdmin: boolean;
  roles: { role: string; branchId: string | null; branchCode: string | null }[];
  isParent: boolean;
};

/**
 * Người dùng hiện tại. Bản này chỉ có chế độ DEV (cookie chọn tài khoản demo).
 * TODO(Phase 1): thay bằng Supabase Auth session (JWT ký bởi Supabase) trước khi dùng thật.
 */
export async function getViewer(): Promise<Viewer | null> {
  if (!devSwitcherEnabled()) return null;
  const id = (await cookies()).get(DEV_COOKIE)?.value;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return asUser(id, async (tx) => {
    const [p] = await tx`select full_name from profiles where id = ${id}`;
    if (!p) return null;
    const roles = await tx`select m.role::text as role, m.branch_id, b.code
      from branch_memberships m left join branches b on b.id = m.branch_id
      where m.user_id = ${id} and m.active`;
    const [g] = await tx`select 1 from guardians where user_id = ${id}`;
    return {
      id,
      fullName: p.full_name as string,
      isSuperAdmin: roles.some((r) => r.role === "SUPER_ADMIN"),
      roles: roles.map((r) => ({ role: r.role as string, branchId: r.branch_id as string | null, branchCode: r.code as string | null })),
      isParent: Boolean(g),
    };
  });
}

export async function requireViewer(): Promise<Viewer> {
  const v = await getViewer();
  if (!v) redirect("/login");
  return v;
}

export function homeFor(v: Viewer): string {
  if (v.isSuperAdmin || v.roles.some((r) => ["BRANCH_MANAGER", "ACCOUNTANT", "CARE_STAFF"].includes(r.role))) return "/admin";
  if (v.roles.some((r) => r.role === "COACH")) return "/coach";
  if (v.isParent) return "/parent";
  return "/login";
}

export function isStaff(v: Viewer): boolean {
  return v.isSuperAdmin || v.roles.some((r) => ["BRANCH_MANAGER", "ACCOUNTANT", "CARE_STAFF"].includes(r.role));
}

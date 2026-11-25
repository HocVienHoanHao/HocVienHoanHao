import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { asUser, assertDemoDatabase } from "./db";
import { authConfigured, supabaseServer } from "./supabase";
import { demoMode } from "./demo";

export const DEV_COOKIE = "hh_dev_user";

export function devSwitcherEnabled(): boolean {
  if (demoMode()) return true;
  return process.env.NODE_ENV !== "production" && process.env.DEV_IDENTITY_SWITCHER === "1";
}

export type Viewer = {
  id: string;
  fullName: string;
  isSuperAdmin: boolean;
  roles: { role: string; branchId: string | null; branchCode: string | null }[];
  isParent: boolean;
};

/** Danh tính đã xác thực: phiên Supabase (getUser kiểm tra với Auth server) hoặc cookie DEV (chỉ khi bật). */
export type Identity = { id: string; email: string | null; source: "supabase" | "dev" };

export const getIdentity = cache(async (): Promise<Identity | null> => {
  if (devSwitcherEnabled()) {
    const id = (await cookies()).get(DEV_COOKIE)?.value;
    if (id && /^[0-9a-f-]{36}$/i.test(id)) {
      if (demoMode()) await assertDemoDatabase();
      return { id, email: null, source: "dev" };
    }
  }
  if (authConfigured()) {
    const { data, error } = await (await supabaseServer()).auth.getUser();
    if (!error && data.user) return { id: data.user.id, email: data.user.email ?? null, source: "supabase" };
  }
  return null;
});

/**
 * Người dùng hiện tại (đã có profile = đã được mời và nhận lời mời).
 * Đăng nhập Supabase nhưng chưa được mời -> null (trang đăng nhập báo "chưa được cấp quyền").
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const ident = await getIdentity();
  if (!ident) return null;
  const id = ident.id;
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
});

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

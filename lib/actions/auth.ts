"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { claimInvitations } from "@/lib/auth/finish";
import { DEV_COOKIE, devSwitcherEnabled } from "@/lib/session";
import { assertDemoDatabase, listDemoIdentities } from "@/lib/db";
import { demoMode } from "@/lib/demo";
import { authConfigured, siteUrl, supabaseServer } from "@/lib/supabase";
import { str } from "./util";

const EMAIL_COOKIE = "hh_login_email";
const EMAIL = /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/;

export async function sendLoginCodeAction(fd: FormData) {
  if (!authConfigured()) redirect("/login");
  const email = str(fd, "email").toLowerCase().slice(0, 254);
  if (!EMAIL.test(email)) redirect("/login?err=" + encodeURIComponent("Email không hợp lệ"));
  const { error } = await (await supabaseServer()).auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${siteUrl()}/auth/callback` },
  });
  if (error && error.status === 429) redirect("/login?err=" + encodeURIComponent("Gửi quá nhiều lần, vui lòng thử lại sau ít phút"));
  if (error) console.error("[auth] signInWithOtp", error.status, error.code);
  // Không tiết lộ email có tồn tại hay không; giữ email trong cookie httpOnly ngắn hạn thay vì URL.
  (await cookies()).set(EMAIL_COOKIE, email, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/login", maxAge: 900 });
  redirect("/login?step=code");
}

export async function verifyLoginCodeAction(fd: FormData) {
  if (!authConfigured()) redirect("/login");
  const store = await cookies();
  const email = store.get(EMAIL_COOKIE)?.value ?? "";
  const token = str(fd, "code").replace(/\s+/g, "");
  if (!EMAIL.test(email)) redirect("/login?err=" + encodeURIComponent("Phiên nhập mã đã hết, vui lòng nhập lại email"));
  if (!/^\d{6,10}$/.test(token)) redirect("/login?step=code&err=" + encodeURIComponent("Mã gồm các chữ số trong email"));
  const { data, error } = await (await supabaseServer()).auth.verifyOtp({ email, token, type: "email" });
  if (error || !data.user) redirect("/login?step=code&err=" + encodeURIComponent("Mã không đúng hoặc đã hết hạn"));
  store.delete({ name: EMAIL_COOKIE, path: "/login" });
  await claimInvitations(data.user);
  redirect("/");
}

export async function logoutAction() {
  const store = await cookies();
  store.delete(DEV_COOKIE);
  if (authConfigured()) await (await supabaseServer()).auth.signOut();
  redirect("/login");
}

export async function chooseDevIdentityAction(fd: FormData) {
  if (!devSwitcherEnabled()) throw new Error("Chế độ DEV đang tắt");
  const id = str(fd, "id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Danh tính không hợp lệ");
  if (demoMode()) {
    await assertDemoDatabase();
    if (!(await listDemoIdentities()).some((p) => p.id === id)) throw new Error("Danh tính không hợp lệ");
  }
  (await cookies()).set(DEV_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
  redirect("/");
}

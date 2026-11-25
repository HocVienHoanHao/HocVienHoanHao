import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { listDemoIdentities } from "@/lib/db";
import { DEV_COOKIE, devSwitcherEnabled } from "@/lib/session";

export const dynamic = "force-dynamic";

async function chooseIdentity(formData: FormData) {
  "use server";
  if (!devSwitcherEnabled()) throw new Error("Chế độ DEV đang tắt");
  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Danh tính không hợp lệ");
  (await cookies()).set(DEV_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", secure: false });
  redirect("/");
}

async function logout() {
  "use server";
  (await cookies()).delete(DEV_COOKIE);
  redirect("/login");
}

export default async function LoginPage() {
  if (!devSwitcherEnabled()) {
    return (
      <main className="mx-auto max-w-md p-6">
        <div className="card">
          <h1 className="text-lg font-bold text-navy">Đăng nhập</h1>
          <p className="mt-2 text-sm text-slate-600">
            Đăng nhập Supabase Auth chưa được cấu hình trong bản này. Không có tài khoản nào hoạt động.
          </p>
        </div>
      </main>
    );
  }
  const people = await listDemoIdentities();
  return (
    <main className="mx-auto max-w-lg p-4 sm:p-8">
      <div className="mb-6 text-center">
        <div className="text-2xl font-extrabold text-navy">Hoàn Hảo Football CRM</div>
        <div className="text-sm text-slate-500">Chọn tài khoản demo (dữ liệu giả)</div>
      </div>
      <div className="card space-y-2">
        {people.length === 0 && <p className="text-sm text-slate-600">Chưa có dữ liệu demo. Chạy <code>npm run db:reset</code>.</p>}
        {people.map((p) => (
          <form key={p.id} action={chooseIdentity}>
            <input type="hidden" name="id" value={p.id} />
            <button className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left hover:border-brand hover:bg-blue-50">
              <span className="font-medium">{p.full_name}</span>
              <span className="text-xs text-slate-500">{p.roles}</span>
            </button>
          </form>
        ))}
        <form action={logout}><button className="btn-ghost mt-2 w-full">Đăng xuất</button></form>
      </div>
    </main>
  );
}

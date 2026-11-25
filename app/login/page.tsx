import Link from "next/link";
import { listDemoIdentities } from "@/lib/db";
import { devSwitcherEnabled, getIdentity, getViewer, homeFor } from "@/lib/session";
import { authConfigured } from "@/lib/supabase";
import { Flash } from "@/components/ui";
import { chooseDevIdentityAction, logoutAction, sendLoginCodeAction, verifyLoginCodeAction } from "@/lib/actions/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ step?: string; err?: string }> }) {
  const sp = await searchParams;
  const auth = authConfigured(), dev = devSwitcherEnabled();
  const ident = await getIdentity();
  const viewer = ident ? await getViewer() : null;
  const people = dev ? await listDemoIdentities() : [];

  return (
    <main className="mx-auto max-w-md p-4 sm:p-8">
      <div className="mb-6 text-center">
        <div className="text-2xl font-extrabold text-navy">HOÀN HẢO <span className="text-accent">FOOTBALL</span></div>
        <div className="text-sm text-slate-500">Đăng nhập hệ thống học viện</div>
      </div>
      <Flash err={sp.err} />

      {ident && (
        <div className="card mb-3 space-y-2 text-sm">
          {viewer ? (
            <>
              <p>Đang đăng nhập: <b>{viewer.fullName}</b>{ident.source === "dev" && " (tài khoản demo)"}</p>
              <Link href={homeFor(viewer)} className="btn w-full">Vào trang của tôi</Link>
            </>
          ) : (
            <p className="rounded-lg bg-amber-50 p-3 text-amber-900 ring-1 ring-amber-200">
              Email {ident.email ? <b>{ident.email}</b> : "này"} đã đăng nhập nhưng chưa được học viện cấp quyền.
              Vui lòng liên hệ quản lý chi nhánh để được gửi lời mời, sau đó đăng nhập lại.
            </p>
          )}
          <form action={logoutAction}><button className="btn-ghost w-full">Đăng xuất</button></form>
        </div>
      )}

      {auth && !viewer && (
        <div className="card">
          {sp.step === "code" ? (
            <form action={verifyLoginCodeAction} className="space-y-3">
              <h1 className="font-semibold text-navy">Nhập mã đăng nhập</h1>
              <p className="text-sm text-slate-600">Nếu email đã được học viện mời, chúng tôi vừa gửi mã và link đăng nhập. Nhập mã, hoặc bấm link trong email.</p>
              <input name="code" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9 ]{6,12}" maxLength={12} className="input w-full text-center text-lg tracking-widest" aria-label="Mã đăng nhập" />
              <button className="btn w-full">Đăng nhập</button>
              <Link href="/login" className="block text-center text-sm text-brand underline">Dùng email khác / gửi lại mã</Link>
            </form>
          ) : (
            <form action={sendLoginCodeAction} className="space-y-3">
              <h1 className="font-semibold text-navy">Đăng nhập bằng email</h1>
              <label className="flex flex-col gap-1"><span className="label">Email</span>
                <input type="email" name="email" required autoComplete="email" maxLength={254} className="input" /></label>
              <button className="btn w-full">Gửi mã đăng nhập</button>
              <p className="text-xs text-slate-500">Không dùng mật khẩu. Chỉ email đã được học viện mời mới vào được hệ thống.</p>
            </form>
          )}
        </div>
      )}

      {!auth && !dev && (
        <div className="card text-sm text-slate-600">Đăng nhập chưa được cấu hình (thiếu NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).</div>
      )}

      {dev && (
        <div className="card mt-3 space-y-2">
          <div className="label">Tài khoản demo (chỉ môi trường phát triển, dữ liệu giả)</div>
          {people.length === 0 && <p className="text-sm text-slate-600">Chưa có dữ liệu demo. Chạy <code>npm run db:reset</code>.</p>}
          {people.map((p) => (
            <form key={p.id} action={chooseDevIdentityAction}>
              <input type="hidden" name="id" value={p.id} />
              <button className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left hover:border-brand hover:bg-blue-50">
                <span className="font-medium">{p.full_name}</span>
                <span className="text-xs text-slate-500">{p.roles}</span>
              </button>
            </form>
          ))}
        </div>
      )}
    </main>
  );
}

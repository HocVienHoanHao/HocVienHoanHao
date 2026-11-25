import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { claimInvitations } from "@/lib/auth/finish";
import { authConfigured, siteUrl, supabaseServer } from "@/lib/supabase";

/** Link đăng nhập trong email: ?code= (PKCE) hoặc ?token_hash=&type= (mẫu email tùy chỉnh). */
export async function GET(req: NextRequest) {
  const base = siteUrl();
  if (!authConfigured()) return NextResponse.redirect(`${base}/login`);
  const q = req.nextUrl.searchParams;
  const sb = await supabaseServer();
  const code = q.get("code"), tokenHash = q.get("token_hash"), type = q.get("type") as EmailOtpType | null;
  const res = code
    ? await sb.auth.exchangeCodeForSession(code)
    : tokenHash && type && ["email", "magiclink", "signup", "invite"].includes(type)
      ? await sb.auth.verifyOtp({ token_hash: tokenHash, type })
      : null;
  if (!res || res.error || !res.data.user) {
    return NextResponse.redirect(`${base}/login?err=${encodeURIComponent("Link đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng nhập mã trong email hoặc gửi lại.")}`);
  }
  await claimInvitations(res.data.user);
  return NextResponse.redirect(`${base}/`);
}

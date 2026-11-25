import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Supabase Auth bật khi có URL + anon key (khóa công khai, không phải service role). */
export function authConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/** Địa chỉ gốc của app cho link đăng nhập — lấy từ cấu hình, không tin Host header. */
export function siteUrl(): string {
  const u = process.env.APP_URL;
  if (u && /^https?:\/\//.test(u)) return u.replace(/\/+$/, "");
  if (process.env.NODE_ENV === "production") throw new Error("Chưa cấu hình APP_URL");
  return "http://localhost:3000";
}

/** Client Supabase phía server, phiên lưu trong cookie httpOnly do @supabase/ssr quản lý. */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        // Server Component không ghi được cookie; proxy.ts đã làm mới phiên trước khi render.
        try { for (const { name, value, options } of list) store.set(name, value, options); } catch { /* bỏ qua */ }
      },
    },
  });
}

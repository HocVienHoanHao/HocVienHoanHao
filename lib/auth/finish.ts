import "server-only";
import { asUser } from "@/lib/db";

/**
 * Sau khi Supabase xác nhận đăng nhập: áp dụng lời mời còn hiệu lực cho email này (tạo profile + vai trò).
 * Email lấy từ đối tượng user Supabase đã xác minh, không từ input người dùng.
 */
export async function claimInvitations(user: { id: string; email?: string | null }): Promise<void> {
  if (!user.email) return;
  await asUser(user.id, (tx) => tx`select public.claim_my_invitations()`, { email: user.email });
}

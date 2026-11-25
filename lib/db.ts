import "server-only";
import postgres from "postgres";

/**
 * Kết nối Postgres phía server. Mọi truy vấn dữ liệu nghiệp vụ chạy qua `asUser`:
 * role `authenticated` + JWT claims của người dùng → RLS và kiểm tra quyền trong RPC luôn áp dụng.
 * Không có đường truy vấn "bỏ qua RLS" nào được export cho UI.
 */
const globalForDb = globalThis as unknown as { __hhSql?: postgres.Sql };

function getSql(): postgres.Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Chưa cấu hình DATABASE_URL (xem .env.example)");
  globalForDb.__hhSql ??= postgres(url, { max: 5, onnotice: () => {}, prepare: false });
  return globalForDb.__hhSql;
}

export type Tx = postgres.TransactionSql;

/**
 * `email` chỉ truyền khi đã lấy từ phiên Supabase đã xác minh (getUser) — dùng cho nhận lời mời.
 */
export async function asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>, claims: { email?: string | null } = {}): Promise<T> {
  const sql = getSql();
  const jwt = { sub: userId, role: "authenticated", ...(claims.email ? { email: claims.email.toLowerCase() } : {}) };
  return (await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify(jwt)}, true)`;
    await tx.unsafe("set local role authenticated");
    return fn(tx);
  })) as T;
}

/** DEMO_MODE chỉ chạy trên DB demo (có bảng đánh dấu hh_demo_marker); DB thật không có bảng này -> dừng ngay. */
let demoDbChecked = false;
export async function assertDemoDatabase(): Promise<void> {
  if (demoDbChecked) return;
  const [r] = await getSql()`select to_regclass('public.hh_demo_marker') is not null as ok`;
  if (!r?.ok) throw new Error("DEMO_MODE bật nhưng database không phải database demo (thiếu bảng hh_demo_marker)");
  demoDbChecked = true;
}

/** Danh sách tài khoản demo cho trang chọn danh tính DEV (chỉ dữ liệu giả). */
export async function listDemoIdentities(): Promise<{ id: string; full_name: string; roles: string }[]> {
  const sql = getSql();
  return sql`
    select p.id, p.full_name,
      coalesce(string_agg(distinct m.role::text || coalesce(' ' || b.code, ''), ', '),
               case when g.id is not null then 'PARENT' end, '') as roles
    from profiles p
    left join branch_memberships m on m.user_id = p.id and m.active
    left join branches b on b.id = m.branch_id
    left join guardians g on g.user_id = p.id
    where p.full_name like '%Demo%'
    group by p.id, p.full_name, g.id
    order by p.full_name`;
}

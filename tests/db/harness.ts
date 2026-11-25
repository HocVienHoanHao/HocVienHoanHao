/**
 * Test harness: tạo database PostgreSQL tạm, chạy bootstrap giả lập Supabase + toàn bộ migrations.
 * Gọi RPC dưới vai trò `authenticated` với JWT claims của từng user (cơ chế giống PostgREST),
 * KHÔNG dùng superuser/service role cho các kiểm tra nghiệp vụ và quyền.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const ROOT = join(import.meta.dirname, "..", "..");

function baseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  return execFileSync(join(ROOT, "scripts", "local-db.sh"), ["start"], { encoding: "utf8" }).trim();
}

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

export async function createTestDb(): Promise<{ sql: Sql; drop: () => Promise<void> }> {
  const url = baseUrl();
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  const name = `hh_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await admin.unsafe(`create database ${name}`);
  const dbUrl = url.replace(/\/[^/]*$/, `/${name}`);
  const sql = postgres(dbUrl, { max: 4, onnotice: () => {} });
  await sql.unsafe(readFileSync(join(ROOT, "supabase/tests/bootstrap_local.sql"), "utf8"));
  const dir = join(ROOT, "supabase/migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await sql.unsafe(readFileSync(join(dir, f), "utf8"));
  }
  return {
    sql,
    drop: async () => {
      await sql.end();
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.end();
    },
  };
}

/** Chạy fn trong transaction với role authenticated + JWT sub = userId. */
export async function asUser<T>(sql: Sql, userId: string, fn: (tx: Tx) => Promise<T>, extraClaims: Record<string, unknown> = {}): Promise<T> {
  return (await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ ...extraClaims, sub: userId, role: "authenticated" })}, true)`;
    await tx.unsafe("set local role authenticated");
    return fn(tx);
  })) as T;
}

/** Gọi RPC như client đã đăng nhập. */
export async function rpc<T = unknown>(sql: Sql, userId: string, fn: string, args: unknown[] = []): Promise<T> {
  return asUser(sql, userId, async (tx) => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await tx.unsafe(`select public.${fn}(${placeholders}) as r`, args as never[]);
    return rows[0].r as T;
  });
}

export async function setClock(sql: Sql, isoUtc: string | null) {
  await sql`truncate app.clock_override`;
  if (isoUtc) await sql`insert into app.clock_override (fixed_at) values (${isoUtc})`;
}

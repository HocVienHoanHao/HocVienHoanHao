/**
 * Tạo lại database DEV với migrations + dữ liệu GIẢ để demo giao diện.
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:54329/hoanhao_dev npm run db:reset
 * Từ chối chạy nếu DATABASE_URL không phải localhost (tránh xóa nhầm DB thật).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { ID, addSessions, addStudent, confirmSession, enroll, linkGuardian, mark, seedBase } from "../tests/db/fixtures";

const ROOT = join(import.meta.dirname, "..");
const url = process.env.DATABASE_URL;
if (!url) throw new Error("Thiếu DATABASE_URL");
const u = new URL(url);
if (!["127.0.0.1", "localhost"].includes(u.hostname)) throw new Error("db:reset chỉ chạy với database localhost");
const dbName = u.pathname.slice(1);
if (!/^[a-z0-9_]+$/.test(dbName) || dbName === "postgres") throw new Error("Tên database không hợp lệ cho reset");

const TZ = "Asia/Ho_Chi_Minh";
const todayVn = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

function mwf(fromIso: string, dir: 1 | -1, n: number, inclusive: boolean): string[] {
  const out: string[] = [];
  const t = new Date(`${fromIso}T00:00:00Z`);
  if (!inclusive) t.setUTCDate(t.getUTCDate() + dir);
  while (out.length < n) {
    if ([1, 3, 5].includes(t.getUTCDay())) out.push(t.toISOString().slice(0, 10));
    t.setUTCDate(t.getUTCDate() + dir);
  }
  return dir === -1 ? out.reverse() : out;
}

async function main() {
  const adminUrl = new URL(url!); adminUrl.pathname = "/postgres";
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists ${dbName} with (force)`);
  await admin.unsafe(`create database ${dbName}`);
  await admin.end();

  const sql = postgres(url!, { max: 2, onnotice: () => {} });
  await sql.unsafe(readFileSync(join(ROOT, "supabase/tests/bootstrap_local.sql"), "utf8"));
  for (const f of readdirSync(join(ROOT, "supabase/migrations")).sort()) {
    await sql.unsafe(readFileSync(join(ROOT, "supabase/migrations", f), "utf8"));
  }
  await seedBase(sql);

  const past = mwf(todayVn, -1, 30, false);          // 30 buổi đã tập trước hôm nay
  const future = mwf(todayVn, 1, 6, true);           // 6 buổi đã xếp lịch từ hôm nay
  await sql`update courses set start_date = ${past[0]}, end_date = (${future[5]}::date + 21) where id = ${ID.course.QN_K3}`;
  await sql`update classes set attendance_tracked_from = ${past[0]} where id = ${ID.class.QN_U10}`;
  await sql`update coach_assignments set start_date = ${past[0]} where class_id = ${ID.class.QN_U10}`;

  const M = ID.user.managerQN, C = ID.user.coachQN;
  const pastIds = await addSessions(sql, ID.class.QN_U10, ID.course.QN_K3, past);
  await addSessions(sql, ID.class.QN_U10, ID.course.QN_K3, future);
  const base = { managerId: M, branchId: ID.branch.QN, courseId: ID.course.QN_K3, classId: ID.class.QN_U10 };

  const s1 = await addStudent(sql, ID.branch.QN);   // đủ buổi từ đầu
  await enroll(sql, { ...base, studentId: s1, planId: ID.plan.std3m, startDate: past[0] });
  const s2 = await addStudent(sql, ID.branch.QN);   // vào muộn buổi 7 (con phụ huynh A)
  await enroll(sql, { ...base, studentId: s2, planId: ID.plan.std3m, startDate: past[6] });
  await linkGuardian(sql, ID.user.parentA, s2);
  const s3 = await addStudent(sql, ID.branch.QN);   // 2 buổi/tuần (T2/T6)
  await enroll(sql, { ...base, studentId: s3, planId: ID.plan.twice2m, startDate: past[18], weekdays: [1, 5] });
  const s4 = await addStudent(sql, ID.branch.QN);   // gói 1 tháng sắp hết
  await enroll(sql, { ...base, studentId: s4, planId: ID.plan.std1m, startDate: past[20] });
  const s5 = await addStudent(sql, ID.branch.QN);   // có nghỉ có phép/không phép
  await enroll(sql, { ...base, studentId: s5, planId: ID.plan.std3m, startDate: past[0] });

  for (let i = 0; i < 30; i++) {
    const sid = pastIds[i];
    await confirmSession(sql, C, sid);
    await mark(sql, C, sid, s1, "PRESENT");
    if (i >= 6) await mark(sql, C, sid, s2, "PRESENT");
    if (i >= 18 && [1, 5].includes(new Date(`${past[i]}T00:00:00Z`).getUTCDay())) await mark(sql, C, sid, s3, "PRESENT");
    if (i >= 20) await mark(sql, C, sid, s4, "PRESENT");
    await mark(sql, C, sid, s5, i === 10 ? "ABSENT_EXCUSED" : i === 25 || i === 26 ? "ABSENT_UNEXCUSED" : "PRESENT");
  }
  await sql`insert into notes (student_id, branch_id, author, content, visibility, shared_at) values
    (${s2}, ${ID.branch.QN}, ${C}, 'Con tiến bộ tốt ở kỹ thuật dẫn bóng (nhận xét demo).', 'PARENT', now()),
    (${s2}, ${ID.branch.QN}, ${C}, 'Ghi chú nội bộ demo — không hiển thị cho phụ huynh.', 'INTERNAL', null)`;

  // Phù Mỹ: lớp đang chạy 10 buổi; Phú Yên: chưa có dữ liệu
  const pmPast = past.slice(-10);
  await sql`update courses set start_date = ${pmPast[0]} where id = ${ID.course.PM_K1}`;
  await sql`update classes set attendance_tracked_from = ${pmPast[0]} where id = ${ID.class.PM_U8}`;
  const pmIds = await addSessions(sql, ID.class.PM_U8, ID.course.PM_K1, pmPast);
  await addSessions(sql, ID.class.PM_U8, ID.course.PM_K1, mwf(todayVn, 1, 12, true));
  const pmBase = { managerId: ID.user.managerPM, branchId: ID.branch.PM, courseId: ID.course.PM_K1, classId: ID.class.PM_U8, planId: ID.plan.pm3m, startDate: pmPast[0] };
  const p1 = await addStudent(sql, ID.branch.PM); await enroll(sql, { ...pmBase, studentId: p1 });
  const p2 = await addStudent(sql, ID.branch.PM); await enroll(sql, { ...pmBase, studentId: p2 });
  await linkGuardian(sql, ID.user.parentB, p2);
  for (const sid of pmIds) {
    await confirmSession(sql, ID.user.coachPM, sid);
    await mark(sql, ID.user.coachPM, sid, p1, "PRESENT");
    await mark(sql, ID.user.coachPM, sid, p2, "PRESENT");
  }
  await sql.end();
  console.log(`Đã tạo database ${dbName} với dữ liệu demo (hôm nay ${todayVn}).`);
}

main().catch((e) => { console.error(e); process.exit(1); });

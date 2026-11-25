import { NextResponse, type NextRequest } from "next/server";
import { asUser } from "@/lib/db";
import { isIsoDate, todayVn } from "@/lib/format";
import { studentProgressList } from "@/lib/progress";
import { applyFilter, EXPORT_HEADERS, parseFilter, toCsv, toRow } from "@/lib/progress-filters";
import { getViewer, isStaff } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Export tiến độ theo quyền (RLS/RPC) và ngày chốt. Phụ huynh/HLV không dùng được endpoint này. */
export async function GET(req: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  if (!isStaff(viewer)) return NextResponse.json({ error: "Không có quyền xuất dữ liệu" }, { status: 403 });
  const p = req.nextUrl.searchParams;
  const asOf = isIsoDate(p.get("asOf")) ? p.get("asOf")! : todayVn();
  const uuid = (v: string | null) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
  const rows = await asUser(viewer.id, async (tx) => {
    const list = await studentProgressList(tx, asOf, { branchId: uuid(p.get("branch")), classId: uuid(p.get("class")) });
    await tx`select public.log_export('student_progress', ${uuid(p.get("branch"))}::uuid,
      ${JSON.stringify({ asOf, filter: p.get("filter"), class: uuid(p.get("class")), count: list.length })}::jsonb)`;
    return list;
  });
  const shown = applyFilter(rows, parseFilter(p.get("filter")), asOf);
  const csv = toCsv([EXPORT_HEADERS, ...shown.map(toRow)]);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tien-do-hoc-vien-${asOf}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}

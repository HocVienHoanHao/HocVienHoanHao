/** Lọc/xuất danh sách tiến độ học viên — hàm thuần, dùng chung cho trang và export. */
import { daysBetween, fmtDate } from "./format";
import type { Milestone, StudentProgress } from "./progress";

export type ProgressFilter = "all" | "low" | "end7" | "end14" | "end30" | "noschedule" | "nodata";

export const FILTER_LABEL: Record<ProgressFilter, string> = {
  all: "Tất cả",
  low: "Sắp hết buổi (≤3)",
  end7: "Dự kiến hết quyền trong 7 ngày",
  end14: "Dự kiến hết quyền trong 14 ngày",
  end30: "Dự kiến hết quyền trong 30 ngày",
  noschedule: "Chưa đủ lịch dự báo",
  nodata: "Chưa đủ dữ liệu",
};

export function parseFilter(v: unknown): ProgressFilter {
  return typeof v === "string" && v in FILTER_LABEL ? (v as ProgressFilter) : "all";
}

function exhaustDate(p: StudentProgress): string | null {
  return p.entitlement_exhaustion.estimated_date ?? p.entitlement_exhaustion.actual_date ?? null;
}

export function applyFilter(rows: StudentProgress[], f: ProgressFilter, asOf: string): StudentProgress[] {
  const within = (days: number) => (p: StudentProgress) => {
    const d = p.entitlement_exhaustion.estimated_date;
    return d != null && daysBetween(asOf, d) <= days;
  };
  switch (f) {
    case "low": return rows.filter((p) => p.available_sessions != null && p.available_sessions <= 3);
    case "end7": return rows.filter(within(7));
    case "end14": return rows.filter(within(14));
    case "end30": return rows.filter(within(30));
    case "noschedule": return rows.filter((p) => p.entitlement_exhaustion.status === "INSUFFICIENT_SCHEDULE"
      || p.study_milestones.some((m) => m.status === "INSUFFICIENT_SCHEDULE"));
    case "nodata": return rows.filter((p) => p.data_status === "NO_DATA");
    default: return rows;
  }
}

function msText(m: Milestone | null | undefined): string {
  if (!m) return "";
  if (m.status === "REACHED") return `${fmtDate(m.actual_date)} (thực tế)`;
  if (m.estimated_date) return `${fmtDate(m.estimated_date)} (${m.status === "ESTIMATED_RECURRING" ? "ước tính lịch lặp" : "dự kiến"})`;
  return m.status === "NO_DATA" ? "Chưa đủ dữ liệu" : "Chưa đủ lịch để dự báo";
}

const n = (v: number | null | undefined) => (v == null ? "Chưa đủ dữ liệu" : String(v));

export const EXPORT_HEADERS = [
  "Ngày chốt", "Mã HV", "Họ tên", "Lớp", "Ngày bắt đầu", "Gói (buổi)", "Buổi lớp đã tổ chức", "Buổi lớp từ khi vào",
  "Có mặt", "Nghỉ có phép", "Nghỉ không phép", "Chưa điểm danh", "Đã trừ", "Còn lại", "Bảo lưu đang có",
  "Ngày đi học gần nhất", "Tháng học hiện tại", "Hết tháng học", "Hết gói", "Hết quyền học", "Hạn hiệu lực",
  "Hạn hóa đơn", "Trạng thái dữ liệu", "Cảnh báo",
];

export function toRow(p: StudentProgress): string[] {
  const ex = p.entitlement_exhaustion;
  return [
    fmtDate(p.as_of_date), p.student_code, p.student_name, p.class_name, fmtDate(p.start_date),
    p.quota == null ? "Theo lượt" : String(p.quota), String(p.class_completed_sessions), String(p.class_sessions_since_join),
    n(p.present_sessions), n(p.absent_excused), n(p.absent_unexcused), n(p.not_marked), n(p.charged_sessions),
    n(p.available_sessions), n(p.carryover_available), fmtDate(p.last_attended_date, ""),
    p.current_month ? `Tháng ${p.current_month}` : "", msText(p.current_month_milestone), msText(p.package_end),
    ex.status === "EXHAUSTED" ? `Đã hết (${fmtDate(exhaustDate(p))})` : ex.estimated_date ? `${fmtDate(ex.estimated_date)} (${ex.label})` : ex.label,
    fmtDate(p.valid_until, ""), fmtDate(p.invoice_due_date, ""),
    p.data_status === "OK" ? "Đủ dữ liệu" : p.data_status === "NO_DATA" ? "Chưa đủ dữ liệu" : "Chờ xác nhận",
    p.warnings.map((w) => w.message).join("; "),
  ];
}

/** CSV an toàn cho Excel: BOM UTF-8, escape dấu nháy, chặn công thức (CSV injection). */
export function toCsv(rows: string[][]): string {
  const cell = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

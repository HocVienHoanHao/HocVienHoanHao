import "server-only";
import type { Tx } from "./db";

export type ForecastStatus =
  | "REACHED" | "FORECAST" | "ESTIMATED_RECURRING" | "INSUFFICIENT_SCHEDULE" | "NO_DATA" | "EXHAUSTED";

export type Milestone = {
  month: number; target: number; status: ForecastStatus; remaining: number | null;
  actual_date: string | null; estimated_date: string | null;
};
export type Warning = { code: string; message: string };

export type ClassProgress = {
  class_id: string; class_name: string; branch_id: string; course_id: string; course_code: string; course_name: string;
  as_of_date: string; generated_at: string;
  class_completed_sessions: number; class_target_sessions: number; class_remaining_sessions: number;
  last_class_session_date: string | null; current_month: number | null; current_month_milestone: Milestone | null;
  milestones: Milestone[]; course_end: Milestone & { planned_end_date: string | null };
  future_sessions_known: number; pending_today_sessions: number; unconfirmed_past_sessions: number;
  forecast_reliable: boolean; warnings: Warning[]; updated_at: string | null;
};

export type StudentProgress = {
  enrollment_id: string; student_id: string; student_code: string; student_name: string;
  class_id: string; class_name: string; branch_id: string; course_id: string;
  start_date: string; enrollment_status: string; billing_type: string; quota: number | null; months: number | null;
  as_of_date: string; generated_at: string; data_status: "OK" | "PENDING_CONFIRMATION" | "NO_DATA";
  class_completed_sessions: number; class_sessions_since_join: number;
  present_sessions: number | null; absent_excused: number | null; absent_unexcused: number | null; trial: number | null;
  not_marked: number | null; charged_sessions: number | null; granted_sessions: number | null; transferred_out: number | null;
  available_sessions: number | null; carryover_available: number | null;
  last_class_session_date: string | null; last_attended_date: string | null; last_attendance_update_at: string | null;
  current_month: number | null; current_month_milestone: Milestone | null;
  study_milestones: Milestone[]; entitlement_milestones: Milestone[]; package_end: Milestone | null;
  entitlement_exhaustion: { status: ForecastStatus; label: string; estimated_date?: string; actual_date?: string; sessions_needed?: number; sessions_scheduled?: number };
  valid_until: string | null; renewal_alert: "RENEW_3" | "RENEW_1" | "RENEW_0" | null; invoice_due_date: string | null;
  forecast_reliable: boolean; warnings: Warning[];
};

export async function classProgress(tx: Tx, classId: string, asOf: string): Promise<ClassProgress> {
  const [r] = await tx`select public.class_progress(${classId}::uuid, ${asOf}::date) as p`;
  return r.p as ClassProgress;
}

export async function studentProgress(tx: Tx, enrollmentId: string, asOf: string): Promise<StudentProgress> {
  const [r] = await tx`select public.student_progress(${enrollmentId}::uuid, ${asOf}::date) as p`;
  return r.p as StudentProgress;
}

export async function studentProgressList(
  tx: Tx, asOf: string, f: { branchId?: string | null; courseId?: string | null; classId?: string | null } = {},
): Promise<StudentProgress[]> {
  const rows = await tx`select p from public.student_progress_list(${asOf}::date, ${f.branchId ?? null}::uuid,
    ${f.courseId ?? null}::uuid, ${f.classId ?? null}::uuid) p`;
  return rows.map((r) => r.p as StudentProgress);
}

/** Ngày "hiệu lực" của mốc để lọc/sort: thực tế nếu đã đạt, dự kiến nếu có. */
export function milestoneDate(m: Milestone | null | undefined): string | null {
  if (!m) return null;
  return m.actual_date ?? m.estimated_date ?? null;
}

export function exhaustionDate(p: StudentProgress): string | null {
  return p.entitlement_exhaustion.estimated_date ?? p.entitlement_exhaustion.actual_date ?? null;
}

export const STATUS_LABEL: Record<string, string> = {
  REACHED: "Đã đạt",
  FORECAST: "Dự kiến",
  ESTIMATED_RECURRING: "Ước tính theo lịch lặp",
  INSUFFICIENT_SCHEDULE: "Chưa đủ lịch để dự báo",
  NO_DATA: "Chưa đủ dữ liệu",
  EXHAUSTED: "Đã hết quyền học",
};

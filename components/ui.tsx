import type { ReactNode } from "react";
import { fmtDate } from "@/lib/format";
import { STATUS_LABEL, type Milestone, type Warning } from "@/lib/progress";

const STATUS_STYLE: Record<string, string> = {
  REACHED: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  FORECAST: "bg-blue-50 text-blue-800 ring-blue-200",
  ESTIMATED_RECURRING: "bg-amber-50 text-amber-800 ring-amber-200",
  INSUFFICIENT_SCHEDULE: "bg-slate-100 text-slate-700 ring-slate-300",
  NO_DATA: "bg-slate-100 text-slate-700 ring-slate-300",
  EXHAUSTED: "bg-rose-50 text-rose-800 ring-rose-200",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${STATUS_STYLE[status] ?? "bg-slate-100 text-slate-700 ring-slate-300"}`}>
      {label ?? STATUS_LABEL[status] ?? status}
    </span>
  );
}

/** Ngày của mốc: thực tế nếu đã đạt, dự kiến nếu có lịch, ngược lại nhãn trạng thái. */
export function MilestoneDate({ m }: { m: Milestone | null | undefined }) {
  if (!m) return <span className="text-slate-400">—</span>;
  if (m.status === "REACHED") return <span>{fmtDate(m.actual_date)} <span className="text-xs text-emerald-700">(thực tế)</span></span>;
  if (m.estimated_date) return (
    <span>{fmtDate(m.estimated_date)} <span className={`text-xs ${m.status === "ESTIMATED_RECURRING" ? "text-amber-700" : "text-blue-700"}`}>
      ({m.status === "ESTIMATED_RECURRING" ? "ước tính lịch lặp" : "dự kiến"})</span></span>
  );
  return <StatusBadge status={m.status} />;
}

export function ProgressBar({ value, max, label }: { value: number | null; max: number; label: string }) {
  const pct = value == null ? 0 : Math.min(100, Math.round((value / Math.max(max, 1)) * 100));
  return (
    <div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-label={label}
        aria-valuemin={0} aria-valuemax={max} aria-valuenow={value ?? undefined}>
        <div className={`h-full rounded-full ${value != null && value > max ? "bg-amber-500" : "bg-brand"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="mt-1 text-2xl font-bold text-navy">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function Warnings({ items }: { items: Warning[] }) {
  if (!items?.length) return null;
  return (
    <ul className="mt-2 space-y-1">
      {items.map((w) => (
        <li key={w.code} className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900 ring-1 ring-amber-200">⚠ {w.message}</li>
      ))}
    </ul>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card text-center">
      <div className="font-semibold text-navy">{title}</div>
      {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function DemoBanner() {
  // chỉ hiện ở chế độ chọn danh tính DEV (không bao giờ ở production)
  if (process.env.NODE_ENV === "production" || process.env.DEV_IDENTITY_SWITCHER !== "1") return null;
  return (
    <div className="bg-accent/90 px-4 py-1 text-center text-xs font-medium text-navy">
      Bản phát triển · dữ liệu GIẢ để demo · đăng nhập bằng chế độ chọn danh tính DEV
    </div>
  );
}

/** Thông báo kết quả thao tác (từ ?ok= / ?err= sau server action). */
export function Flash({ ok, err }: { ok?: string; err?: string }) {
  if (!ok && !err) return null;
  return (
    <div data-flash role={err ? "alert" : "status"} className={`my-2 rounded-lg px-3 py-2 text-sm ring-1 ${err ? "bg-red-50 text-red-800 ring-red-200" : "bg-emerald-50 text-emerald-800 ring-emerald-200"}`}>
      {(err ?? ok)?.slice(0, 300)}
    </div>
  );
}

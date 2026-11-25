import Link from "next/link";
import type { ReactNode } from "react";
import type { Viewer } from "@/lib/session";
import { DemoBanner } from "./ui";

const NAV = [
  { href: "/admin", label: "Tổng quan" },
  { href: "/admin/students", label: "Học viên & tiến độ" },
  { href: "/admin/care", label: "Chăm sóc" },
  { href: "/coach", label: "Giao diện HLV" },
];
const LATER = ["Lịch & điểm danh", "Đăng ký & bảo lưu", "Thu chi", "Tạm ứng", "Kho", "Nhân sự/Lương", "Import/Export", "Cài đặt & Audit"];

export function StaffShell({ viewer, children }: { viewer: Viewer; children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <DemoBanner />
      <div className="lg:flex">
        <aside className="bg-navy text-white lg:min-h-screen lg:w-60 lg:shrink-0">
          <div className="flex items-center justify-between px-4 py-3 lg:block">
            <div className="font-extrabold tracking-tight">HOÀN HẢO <span className="text-accent">CRM</span></div>
            <div className="text-xs text-slate-300 lg:mt-1">{viewer.fullName}</div>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-2 pb-2 lg:block lg:space-y-1 lg:overflow-visible" aria-label="Điều hướng">
            {NAV.filter((n) => n.href === "/coach" || viewer.isSuperAdmin || viewer.roles.some((r) => r.role !== "COACH")).map((n) => (
              <Link key={n.href} href={n.href} className="block whitespace-nowrap rounded-md px-3 py-2 text-sm hover:bg-white/10">{n.label}</Link>
            ))}
            <div className="hidden px-3 pt-4 text-[11px] uppercase tracking-wide text-slate-400 lg:block">Sắp có (Phase 2–3)</div>
            {LATER.map((l) => (
              <span key={l} className="hidden cursor-not-allowed px-3 py-1.5 text-sm text-slate-400 lg:block" aria-disabled>{l}</span>
            ))}
            <Link href="/login" className="block whitespace-nowrap rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-white/10">Đổi tài khoản</Link>
          </nav>
        </aside>
        <main className="min-w-0 flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}

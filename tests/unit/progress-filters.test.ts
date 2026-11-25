import { describe, expect, it } from "vitest";
import { toCsv } from "../../lib/progress-filters";
import { fmtCount, fmtDate } from "../../lib/format";

describe("định dạng & export", () => {
  it("ngày dd/MM/yyyy, thiếu dữ liệu không hiển thị 0", () => {
    expect(fmtDate("2026-12-09")).toBe("09/12/2026");
    expect(fmtCount(null)).toBe("Chưa đủ dữ liệu");
    expect(fmtCount(0)).toBe("0");
  });
  it("CSV có BOM, escape và chặn công thức", () => {
    const csv = toCsv([["a,b", "=HYPERLINK(1)", 'x"y']]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"a,b"');
    expect(csv).toContain("'=HYPERLINK(1)");
    expect(csv).toContain('"x""y"');
  });
});

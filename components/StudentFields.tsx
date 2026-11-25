/** Ô nhập chi tiết hồ sơ học viên dùng chung cho form thêm và sửa (theo cột bảng tính tuyển sinh). */
export type StudentDetails = {
  birth_date?: string | null; birth_year?: number | null; address?: string | null;
  uniform_size?: string | null; shoe_size?: string | null; note?: string | null;
};

export function StudentDetailFields({ s }: { s?: StudentDetails }) {
  return (
    <>
      <label className="flex flex-col gap-1"><span className="label">Ngày sinh (nếu biết)</span>
        <input type="date" name="birth" min="1990-01-01" defaultValue={s?.birth_date ?? ""} className="input" /></label>
      <label className="flex flex-col gap-1"><span className="label">Hoặc năm sinh</span>
        <input type="number" name="birth_year" min={1990} max={2100} placeholder="VD: 2015" defaultValue={s?.birth_year ?? ""} className="input" /></label>
      <label className="flex flex-col gap-1 sm:col-span-2"><span className="label">Địa chỉ hiện tại</span>
        <input name="address" maxLength={300} defaultValue={s?.address ?? ""} className="input" /></label>
      <label className="flex flex-col gap-1"><span className="label">Size đồng phục</span>
        <input name="uniform_size" maxLength={20} placeholder="VD: 13, S, M" defaultValue={s?.uniform_size ?? ""} className="input" /></label>
      <label className="flex flex-col gap-1"><span className="label">Size giày</span>
        <input name="shoe_size" maxLength={20} placeholder="VD: 34" defaultValue={s?.shoe_size ?? ""} className="input" /></label>
      <label className="flex flex-col gap-1 sm:col-span-2"><span className="label">Ghi chú</span>
        <textarea name="note" maxLength={1000} rows={2} defaultValue={s?.note ?? ""} className="input" /></label>
    </>
  );
}

/** "2015" hoặc "2015 (11 tuổi)" để hiển thị. */
export function ageLabel(birthYear: number | null | undefined, currentYear: number): string {
  if (!birthYear) return "—";
  return `${birthYear} (${currentYear - birthYear} tuổi)`;
}

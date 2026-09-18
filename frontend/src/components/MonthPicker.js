import React from "react";

const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/**
 * Dropdown-based month picker (pilih Bulan + Tahun dari dropdown, tanpa ketik manual,
 * tanpa harus pilih sampai tanggal). Value contract tetap "YYYY-MM" (atau "" bila allowEmpty).
 *
 * Props:
 *  - value: "YYYY-MM" | ""
 *  - onChange: (value: string) => void   // menerima string, BUKAN event
 *  - allowEmpty: bila true, ada opsi "— Semua —" dan value bisa ""
 *  - yearsBack / yearsForward: rentang tahun relatif tahun berjalan
 *  - testId: prefix untuk data-testid
 */
export default function MonthPicker({
  value,
  onChange,
  allowEmpty = false,
  yearsBack = 6,
  yearsForward = 1,
  className = "",
  disabled = false,
  testId = "month-picker",
}) {
  const now = new Date();
  const nowY = now.getFullYear();
  const nowM = now.getMonth() + 1;

  const hasVal = typeof value === "string" && /^\d{4}-\d{2}/.test(value);
  const [y, m] = hasVal ? value.slice(0, 7).split("-").map(Number) : ["", ""];

  const years = [];
  for (let yr = nowY + yearsForward; yr >= nowY - yearsBack; yr--) years.push(yr);
  // Pastikan tahun dari value lama tetap muncul walau di luar rentang
  if (hasVal && !years.includes(y)) years.push(y);
  years.sort((a, b) => b - a);

  const emit = (yy, mm) => {
    if (!yy || !mm) return onChange("");
    onChange(`${yy}-${String(mm).padStart(2, "0")}`);
  };

  const onMonth = (val) => {
    if (val === "") return onChange("");
    emit(y || nowY, Number(val));
  };
  const onYear = (val) => {
    if (val === "") return onChange("");
    emit(Number(val), m || nowM);
  };

  const cls =
    "rounded-md border border-slate-300 px-3 py-2 text-sm bg-white text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-500";

  return (
    <div className={`flex gap-2 ${className}`} data-testid={testId}>
      <select
        data-testid={`${testId}-month`}
        className={`${cls} flex-1`}
        value={m}
        disabled={disabled}
        onChange={(e) => onMonth(e.target.value)}
      >
        {allowEmpty && <option value="">— Semua —</option>}
        {!allowEmpty && !hasVal && <option value="">Bulan</option>}
        {MONTHS.map((name, i) => (
          <option key={i} value={i + 1}>{name}</option>
        ))}
      </select>
      <select
        data-testid={`${testId}-year`}
        className={`${cls} w-24`}
        value={y}
        disabled={disabled}
        onChange={(e) => onYear(e.target.value)}
      >
        {allowEmpty && <option value="">—</option>}
        {!allowEmpty && !hasVal && <option value="">Tahun</option>}
        {years.map((yr) => (
          <option key={yr} value={yr}>{yr}</option>
        ))}
      </select>
    </div>
  );
}

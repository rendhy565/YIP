import React from "react";

/**
 * NumberInput — text input yang menampilkan angka dengan pemisah ribuan (id-ID: 1.000.000)
 * dan mengembalikan nilai numerik ke onChange handler.
 *
 * Prinsip:
 * - `value`: numerik/string angka mentah (mis. "1500000" atau 1500000)
 * - `onChange(e)`: `e.target.value` selalu string berisi digit murni (tanpa titik/koma)
 *   sehingga logic parent (parseFloat / Number) tetap kompatibel dengan Input biasa.
 *
 * Catatan:
 * - Integer-only (khusus IDR). Untuk desimal (kg, %), pakai <Input type="number"/> biasa.
 */
export default function NumberInput({ value, onChange, className = "", ...rest }) {
  const raw = value === null || value === undefined || value === "" ? "" : String(value).replace(/[^\d]/g, "");
  const display = raw === "" ? "" : Number(raw).toLocaleString("id-ID");

  const handleChange = (e) => {
    const cleaned = (e.target.value || "").replace(/[^\d]/g, "");
    if (onChange) {
      // Kirim event synthetic dengan value bersih (digit-only string)
      onChange({ ...e, target: { ...e.target, value: cleaned } });
    }
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      value={display}
      onChange={handleChange}
      className={`w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-500 ${className}`}
      {...rest}
    />
  );
}

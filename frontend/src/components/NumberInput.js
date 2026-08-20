import React from "react";

/**
 * NumberInput — text input dengan pemisah ribuan LIVE (format id-ID: 1.000.000)
 * dan mengembalikan nilai numerik bersih ke onChange handler.
 *
 * Prinsip:
 * - `value`: numerik/string angka mentah (mis. "1500000" atau 1500000)
 * - `onChange(e)`: `e.target.value` selalu string numerik "murni" (pakai titik "." sebagai
 *   desimal internal, tanpa pemisah ribuan) → kompatibel dengan parseFloat/Number di parent.
 *
 * Mode:
 * - default (integer, untuk RUPIAH): hanya digit, grup ribuan pakai titik → "1.000.000"
 * - `decimal` (untuk QTY/KG): izinkan 1 desimal. Tampilan pakai KOMA utk desimal → "1.234,5".
 *   User mengetik desimal dengan KOMA (sesuai locale Indonesia). Titik dianggap pemisah ribuan.
 */
export default function NumberInput({ value, onChange, className = "", decimal = false, ...rest }) {
  const display = React.useMemo(() => {
    if (value === null || value === undefined || value === "") return "";
    const s = String(value);
    if (!decimal) {
      const raw = s.replace(/[^\d]/g, "");
      return raw === "" ? "" : Number(raw).toLocaleString("id-ID");
    }
    // decimal mode: value internal pakai "." sbg desimal
    let [intp, decp] = s.split(".");
    intp = (intp || "").replace(/[^\d]/g, "");
    const grouped = intp === "" ? (decp !== undefined ? "0" : "") : Number(intp).toLocaleString("id-ID");
    if (decp !== undefined) return grouped + "," + decp.replace(/[^\d]/g, "");
    return grouped;
  }, [value, decimal]);

  const handleChange = (e) => {
    let v = e.target.value || "";
    let cleaned;
    if (!decimal) {
      cleaned = v.replace(/[^\d]/g, "");
    } else {
      // buang pemisah ribuan (titik), sisakan digit + koma
      v = v.replace(/\./g, "").replace(/[^\d,]/g, "");
      const i = v.indexOf(",");
      if (i !== -1) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/,/g, "");
      cleaned = v.replace(",", "."); // desimal internal pakai titik
    }
    if (onChange) {
      onChange({ ...e, target: { ...e.target, value: cleaned } });
    }
  };

  return (
    <input
      type="text"
      inputMode={decimal ? "decimal" : "numeric"}
      value={display}
      onChange={handleChange}
      className={`w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-500 ${className}`}
      {...rest}
    />
  );
}

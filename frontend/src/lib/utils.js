export const fmtIDR = (n) => {
  const v = Number(n || 0);
  return "Rp " + v.toLocaleString("id-ID", { maximumFractionDigits: 0 });
};

export const fmtDate = (s) => {
  if (!s) return "-";
  try {
    return parseServerDate(s).toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return s;
  }
};

// Parse a server datetime. MongoDB returns naive datetimes (no timezone suffix),
// which JS would wrongly treat as local time. Append 'Z' so it's parsed as UTC.
export const parseServerDate = (s) => {
  if (s instanceof Date) return s;
  if (typeof s === "string" && s.includes("T") && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(s)) {
    return new Date(s + "Z");
  }
  return new Date(s);
};

export const fmtDateTime = (s) => {
  if (!s) return "-";
  try {
    return parseServerDate(s).toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Jakarta",
    });
  } catch {
    return s;
  }
};

export const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// Month-picker helpers: convert "YYYY-MM" into full boundary dates "YYYY-MM-DD".
// Tolerant of legacy full-date input ("YYYY-MM-DD") by normalizing to the month.
export const monthStart = (ym) => (ym ? `${ym.slice(0, 7)}-01` : "");
export const monthEnd = (ym) => {
  if (!ym) return "";
  const ym7 = ym.slice(0, 7);
  const [y, m] = ym7.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return `${ym7}-${String(lastDay).padStart(2, "0")}`;
};

export const errMsg = (e, fallback = "Terjadi kesalahan") => {
  const d = e?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg || JSON.stringify(x)).join(", ");
  return d?.msg || e?.message || fallback;
};

export const STATUS_LABELS = {
  Open: "Open",
  Reconciled: "Rekonsiliasi",
  Invoiced: "Invoiced",
  Paid: "Lunas",
};

export const STATUS_CLASSES = {
  Open: "bg-blue-100 text-blue-800 border-blue-200",
  Reconciled: "bg-amber-100 text-amber-800 border-amber-200",
  Invoiced: "bg-purple-100 text-purple-800 border-purple-200",
  Paid: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

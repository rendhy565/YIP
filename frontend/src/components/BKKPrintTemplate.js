import React from "react";

/**
 * BKK Print Template — Bukti Kas Keluar PT ABIRAMA MITRA PRATAMA
 * Layout dibuat mirip form fisik (portrait A5/A4).
 *
 * Props:
 *  - panjar: { number, recipient_name, purpose, amount, advance_date, awb_breakdown, notes }
 *  - approval: { steps: [{name, approved_by_name, approved_at, note}, ...], status }
 *  - requester_name: string  (nama pengaju - Diajukan Oleh)
 */
export default function BKKPrintTemplate({ panjar, approval, requesterName }) {
  if (!panjar) return null;

  const amount = Number(panjar.amount || 0);
  const breakdown = panjar.awb_breakdown || [];
  const settled = (panjar.settled_amount || 0) > 0 || breakdown.length > 0;

  // Row: Baris pertama = pengajuan positif (referensi = keperluan/purpose)
  // Rows berikutnya (kalau ada breakdown) = per-AWB dengan amount NEGATIF
  const rows = [];
  rows.push({
    ref: panjar.purpose || "Panjar Kerja",
    detail: "",
    amount: amount,
  });
  if (settled && breakdown.length > 0) {
    breakdown.forEach((b) => {
      rows.push({
        ref: b.awb_number || (b.target === "operation" ? "OPERATION" : ""),
        detail: b.description || "",
        amount: -Math.abs(Number(b.amount || 0)), // NEGATIF karena pengurang
      });
    });
  }

  // Pad to minimum 7 rows (biar tabel selalu terlihat penuh seperti form fisik)
  while (rows.length < 7) rows.push({ ref: "", detail: "", amount: null });

  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  // Signatures dari approval steps
  const stepByName = {};
  (approval?.steps || []).forEach((s) => {
    // Match berdasarkan nama step
    const key = (s.name || "").toLowerCase();
    if (key.includes("cek")) stepByName.checker = s;
    else if (key.includes("approval") || key.includes("mgr") || key.includes("manager")) stepByName.approver = s;
  });

  const formatDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
  };
  const formatRp = (n) => {
    if (n == null) return "";
    const abs = Math.abs(n);
    const sign = n < 0 ? "-" : "";
    return `${sign}Rp ${abs.toLocaleString("id-ID")}`;
  };

  return (
    <div className="bkk-print bg-white text-black p-8 font-sans" style={{ width: "210mm", minHeight: "148mm" }}>
      <style>{`
        @page { size: A5 landscape; margin: 10mm; }
        @media print {
          body * { visibility: hidden; }
          .bkk-print, .bkk-print * { visibility: visible; }
          .bkk-print { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
        .bkk-print { font-family: Arial, sans-serif; color: #1a1a3a; }
        .bkk-print table { border-collapse: collapse; width: 100%; }
        .bkk-print th, .bkk-print td { border: 1px solid #1a3a8a; padding: 4px 6px; font-size: 11px; vertical-align: top; }
        .bkk-print th { background: #f0f4ff; font-weight: bold; text-align: center; }
      `}</style>

      {/* Header */}
      <div className="flex items-start justify-between border-b-2 border-blue-900 pb-2 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-full border-2 border-blue-900 flex items-center justify-center font-black text-blue-900 text-xl">
            AR<br/>CG
          </div>
          <div>
            <div className="font-black text-lg text-blue-900 tracking-tight leading-tight">PT. ABIRAMA MITRA PRATAMA</div>
            <div className="text-[10px] text-blue-800">Blok RSK 6 No. 73</div>
          </div>
        </div>
        <div className="text-right text-xs">
          <div className="font-black text-blue-900 text-lg">BUKTI KAS KELUAR</div>
          <div className="mt-1">NO. VOUCHER : <b>{panjar.number}</b></div>
          <div>TANGGAL : <b>{formatDate(panjar.advance_date)}</b></div>
        </div>
      </div>

      {/* NAMA */}
      <div className="mb-2 text-xs">
        NAMA : <b>{panjar.recipient_name}</b>
      </div>

      {/* Table */}
      <table>
        <thead>
          <tr>
            <th style={{ width: "22%" }}>REFERENSI</th>
            <th style={{ width: "48%" }}>RINCIAN PENGELUARAN</th>
            <th style={{ width: "30%" }}>JUMLAH NOMINAL (RP)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.ref || "\u00A0"}</td>
              <td>{r.detail || "\u00A0"}</td>
              <td style={{ textAlign: "right" }}>{r.amount != null ? formatRp(r.amount) : "\u00A0"}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={2} style={{ textAlign: "right", fontWeight: "bold", background: "#f0f4ff" }}>JUMLAH TOTAL</td>
            <td style={{ textAlign: "right", fontWeight: "bold", background: "#f0f4ff" }}>{formatRp(total)}</td>
          </tr>
        </tbody>
      </table>

      {/* Signatures */}
      <div className="grid grid-cols-4 gap-2 mt-4 text-xs">
        <SigBox
          label="DIAJUKAN OLEH"
          name={requesterName || "-"}
          date={panjar.advance_date}
        />
        <SigBox
          label="DI CEK OLEH"
          name={stepByName.checker?.approved_by_name || ""}
          date={stepByName.checker?.approved_at}
        />
        <SigBox
          label="APPROVEL OLEH (MGR)"
          name={stepByName.approver?.approved_by_name || ""}
          date={stepByName.approver?.approved_at}
        />
        <SigBox
          label="PENERIMAAN KLAIM"
          name={panjar.recipient_name}
          date=""
        />
      </div>

      {/* Footer notes (optional) */}
      {panjar.notes && (
        <div className="mt-3 text-[10px] text-slate-600 border-t border-slate-300 pt-1">
          <b>Catatan:</b> {panjar.notes}
        </div>
      )}
    </div>
  );
}

function SigBox({ label, name, date }) {
  const formatDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
  };
  return (
    <div className="border border-blue-900 p-2 min-h-[85px] flex flex-col">
      <div className="text-[10px] font-bold text-center text-blue-900 border-b border-blue-900 pb-1 mb-1">{label}</div>
      <div className="flex-1 flex flex-col justify-end items-center">
        {name && <div className="text-[11px] font-bold">({name})</div>}
        {!name && <div className="text-[11px] text-slate-400">(_______________)</div>}
        {date && <div className="text-[9px] text-slate-500 mt-0.5">{formatDate(date)}</div>}
      </div>
    </div>
  );
}

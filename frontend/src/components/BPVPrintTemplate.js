import React from "react";

/**
 * BPV Print Template — Bank Payment Voucher PT ABIRAMA MITRA PRATAMA
 * Menggantikan BKK. Layout mirror form fisik kuning (landscape).
 *
 * Props:
 *  - panjar: {
 *      number, advance_date, purpose, amount,
 *      recipient_name, recipient_bank, recipient_account,
 *      sender_name, sender_bank, sender_account,
 *      ppn_amount, pph_amount, reff_number, notes,
 *      settle_history, awb_breakdown, refund_amount, settled_amount,
 *    }
 *  - approval: { steps: [...], status }
 *  - requesterName: string
 *  - settings: { logo_b64, kop_address }
 */
export default function BPVPrintTemplate({ panjar, approval, requesterName, settings }) {
  if (!panjar) return null;

  const amount = Number(panjar.amount || 0);
  const ppn = Number(panjar.ppn_amount || 0);
  const pph = Number(panjar.pph_amount || 0);

  // Rows: baris pertama = description dari purpose. Row 2 = REFF#. Rows tambahan dari breakdown (kalau ada).
  const rows = [];
  rows.push({
    description: panjar.purpose || "Panjar Kerja",
    nilai: amount,
    ppn: ppn,
    pph: pph,
    total: amount + ppn - pph,
  });
  if (panjar.reff_number) {
    rows.push({ description: `REFF# ${panjar.reff_number}`, isReff: true });
  }
  // Kalau ada awb_breakdown dari settlement, tampilkan sebagai baris tambahan
  const settleHistory = panjar.settle_history || [];
  const breakdown = [];
  settleHistory.forEach((h) => (h.breakdown || []).forEach((b) => breakdown.push(b)));
  if (breakdown.length === 0 && (panjar.awb_breakdown || []).length > 0) {
    (panjar.awb_breakdown || []).forEach((b) => breakdown.push(b));
  }
  breakdown.forEach((b) => {
    rows.push({
      description: `${b.awb_number || (b.target === "operation" ? "OPERATION" : "-")}: ${b.description || ""}`.trim(),
      nilai: -Math.abs(Number(b.amount || 0)),
    });
  });

  // Pad minimum 3 empty rows
  while (rows.length < 4) rows.push({ description: "", empty: true });

  const grandTotal = rows.reduce((s, r) => s + (Number(r.total) || Number(r.nilai) || 0), 0);

  const formatDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "2-digit" });
  };
  const formatRp = (n) => {
    if (n == null || n === "" || isNaN(n)) return "";
    const abs = Math.abs(Number(n));
    const sign = Number(n) < 0 ? "-" : "";
    return `${sign}${abs.toLocaleString("id-ID")}`;
  };

  // Signatures — dynamic dari approval flow + 2 kolom FIXED "Disetujui Oleh: Amrullah" & "Disetujui Oleh: Abidin"
  const approvalSteps = approval?.steps || [];
  const dynamicSignatures = [
    { label: "Dibuat Oleh", name: requesterName || "-", date: panjar.advance_date },
    ...approvalSteps.map((s) => ({
      label: s.name || "Diperiksa Oleh",
      name: s.approved_by_name || "",
      date: s.approved_at,
    })),
  ];

  // Fixed final approvers (selalu muncul di 2 kolom terakhir untuk tanda tangan fisik)
  const FIXED_FINAL_APPROVERS = [
    { label: "Disetujui Oleh", name: "Amrullah", date: null, fixed: true },
    { label: "Disetujui Oleh", name: "Abidin", date: null, fixed: true },
  ];

  const signatures = [...dynamicSignatures, ...FIXED_FINAL_APPROVERS];

  const totalSigs = signatures.length;
  const sigCols = totalSigs <= 3 ? "grid-cols-3" :
                  totalSigs === 4 ? "grid-cols-4" :
                  totalSigs === 5 ? "grid-cols-5" : "grid-cols-6";

  const logoRaw = settings?.logo_b64 || "";
  const logoSrc = logoRaw
    ? (logoRaw.startsWith("data:") ? logoRaw : `data:image/png;base64,${logoRaw}`)
    : null;

  return (
    <div className="bpv-print bg-white text-black" style={{ width: "297mm", minHeight: "210mm", padding: "12mm", fontFamily: "Arial, sans-serif" }}>
      <style>{`
        @page { size: A4 landscape; margin: 8mm; }
        @media print {
          body * { visibility: hidden; }
          .bpv-print, .bpv-print * { visibility: visible; }
          .bpv-print { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
        .bpv-print { color: #1a1a3a; font-size: 12px; }
        .bpv-print .field-underline { border-bottom: 1px solid #1a1a3a; padding: 2px 6px; min-height: 20px; }
        .bpv-print table { border-collapse: collapse; width: 100%; }
        .bpv-print table.main th,
        .bpv-print table.main td { border: 1.2px solid #1a1a3a; padding: 6px 8px; font-size: 12px; vertical-align: middle; }
        .bpv-print table.main th { background: transparent; font-weight: bold; text-align: center; font-size: 13px; }
        .bpv-print table.sig td { border: 1.2px solid #1a1a3a; padding: 6px 8px; vertical-align: top; }
      `}</style>

      {/* ===== Header ===== */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-start gap-3" style={{ maxWidth: "55%" }}>
          {logoSrc ? (
            <img src={logoSrc} alt="Logo" style={{ height: 60, maxWidth: 120, objectFit: "contain" }}/>
          ) : (
            <div className="font-black text-red-600" style={{ fontSize: 32, lineHeight: 1 }}>
              <span style={{ color: "#d32f2f" }}>AR</span>
              <div style={{ fontSize: 11, letterSpacing: 4, color: "#d32f2f", marginTop: -2 }}>CARGO</div>
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <div className="font-black tracking-tight" style={{ fontSize: 18, color: "#1a1a3a" }}>PT. ABIRAMA MITRA PRATAMA</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="font-black tracking-tight" style={{ fontSize: 26, color: "#1a1a3a", letterSpacing: 1 }}>
            BANK PAYMENT VOUCHER
          </div>
          <div className="mt-3 flex items-center justify-end gap-2" style={{ fontSize: 12 }}>
            <span className="font-bold">NO. :</span>
            <span className="field-underline" style={{ minWidth: 120, textAlign: "left" }}>{panjar.number}</span>
          </div>
          <div className="mt-1 flex items-center justify-end gap-2" style={{ fontSize: 12 }}>
            <span className="font-bold">TANGGAL :</span>
            <span className="field-underline" style={{ minWidth: 120, textAlign: "left" }}>{formatDate(panjar.advance_date)}</span>
          </div>
        </div>
      </div>

      {/* ===== Dibayarkan kepada (left) & Dibayarkan dari (right) ===== */}
      <div className="grid grid-cols-2 gap-4 mb-3" style={{ fontSize: 12 }}>
        {/* Left: Penerima */}
        <div>
          <div className="italic mb-1" style={{ fontStyle: "italic" }}>Dibayarkan kepada :</div>
          <table style={{ width: "100%" }}>
            <tbody>
              <tr>
                <td style={{ width: 90, padding: "2px 0" }}>Penerima</td>
                <td className="field-underline">{panjar.recipient_name || ""}</td>
              </tr>
              <tr>
                <td style={{ padding: "2px 0" }}>Bank</td>
                <td className="field-underline">{panjar.recipient_bank || ""}</td>
              </tr>
              <tr>
                <td style={{ padding: "2px 0" }}>No. Account</td>
                <td className="field-underline">: {panjar.recipient_account || ""}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {/* Right: Penyetor */}
        <div>
          <div className="italic mb-1" style={{ fontStyle: "italic" }}>Dibayarkan dari :</div>
          <table style={{ width: "100%" }}>
            <tbody>
              <tr>
                <td style={{ width: 90, padding: "2px 0" }}>Penyetor</td>
                <td className="field-underline">: {panjar.sender_name || "PT. ABIRAMA MITRA PRATAMA"}</td>
              </tr>
              <tr>
                <td style={{ padding: "2px 0" }}>Bank</td>
                <td className="field-underline">: {panjar.sender_bank || ""}</td>
              </tr>
              <tr>
                <td style={{ padding: "2px 0" }}>No. Account</td>
                <td className="field-underline">: {panjar.sender_account || ""}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ===== Main Table ===== */}
      <table className="main" style={{ marginBottom: 12 }}>
        <thead>
          <tr>
            <th style={{ width: "45%" }}>DESCRIPTION</th>
            <th style={{ width: "16%" }}>NILAI</th>
            <th style={{ width: "13%" }}>PPN</th>
            <th style={{ width: "13%" }}>PPH</th>
            <th style={{ width: "13%" }}>TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ height: 30 }}>
              <td style={{ fontSize: 11 }}>{r.description || "\u00A0"}</td>
              <td style={{ textAlign: "right", fontFamily: "monospace" }}>
                {r.nilai != null ? <span><span style={{ float: "left" }}>Rp</span>{formatRp(r.nilai)}</span> : "\u00A0"}
              </td>
              <td style={{ textAlign: "right", fontFamily: "monospace" }}>{r.ppn ? formatRp(r.ppn) : "\u00A0"}</td>
              <td style={{ textAlign: "right", fontFamily: "monospace" }}>{r.pph ? formatRp(r.pph) : "\u00A0"}</td>
              <td style={{ textAlign: "right", fontFamily: "monospace" }}>
                {r.total != null ? <span><span style={{ float: "left" }}>Rp</span>{formatRp(r.total)}</span> : "\u00A0"}
              </td>
            </tr>
          ))}
          <tr style={{ background: "#fff9c4" }}>
            <td style={{ textAlign: "left", fontWeight: "bold", fontSize: 14 }}>TOTAL</td>
            <td colSpan={3}></td>
            <td style={{ textAlign: "right", fontFamily: "monospace", fontWeight: "bold" }}>
              <span style={{ float: "left" }}>Rp</span>{formatRp(grandTotal)}
            </td>
          </tr>
        </tbody>
      </table>

      {/* ===== Signatures ===== */}
      <table className="sig">
        <thead>
          <tr>
            {signatures.map((s, i) => (
              <td key={i} style={{ fontSize: 12, fontWeight: "bold", textAlign: "left", padding: "6px 10px" }}>
                {s.label},
              </td>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {signatures.map((_, i) => (
              <td key={i} style={{ height: 90, verticalAlign: "top" }}></td>
            ))}
          </tr>
          <tr>
            {signatures.map((s, i) => (
              <td key={i} style={{ textAlign: "center", fontWeight: "bold", fontSize: 13, borderTop: "1.2px solid #1a1a3a", padding: "6px 8px" }}>
                {s.name || "\u00A0"}
              </td>
            ))}
          </tr>
        </tbody>
      </table>

      {/* Optional notes */}
      {panjar.notes && (
        <div className="mt-3" style={{ fontSize: 10, color: "#555", borderTop: "1px solid #ccc", paddingTop: 4 }}>
          <b>Catatan:</b> {panjar.notes}
        </div>
      )}
    </div>
  );
}

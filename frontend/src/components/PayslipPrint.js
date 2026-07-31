/**
 * PayslipPrint - komponen tampilan Slip Gaji per karyawan (siap print A5/A4)
 * Dipanggil dari halaman HR Payroll (Simulasi & Payroll history)
 */
import React from "react";
import { X, Printer } from "lucide-react";

const fmtIDR = (n) => "Rp " + (Number(n) || 0).toLocaleString("id-ID");
const MONTH_ID = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

export default function PayslipPrint({ slip, period, periodStart, periodEnd, companyName = "PT. ABIRAMA MITRA PRATAMA", onClose }) {
  const [yy, mm] = (period || "").split("-");
  const periodLabel = mm ? `${MONTH_ID[Number(mm) - 1]} ${yy}` : period;
  const rangeLabel = (periodStart && periodEnd)
    ? `${periodStart} → ${periodEnd}`
    : `Bulan ${periodLabel}`;

  const handlePrint = () => window.print();

  return (
    <div className="fixed inset-0 bg-slate-900/70 z-[60] flex items-center justify-center p-4 overflow-y-auto" data-testid="payslip-modal">
      {/* Print styles */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #payslip-print-area, #payslip-print-area * { visibility: visible; }
          #payslip-print-area {
            position: absolute; top: 0; left: 0; width: 100%;
            background: white !important;
          }
          .no-print { display: none !important; }
          @page { size: A5 portrait; margin: 10mm; }
        }
      `}</style>

      <div className="bg-white rounded shadow-xl max-w-md w-full max-h-[95vh] overflow-y-auto">
        {/* Toolbar */}
        <div className="no-print flex items-center justify-between p-3 border-b bg-slate-50">
          <h3 className="font-bold text-sm">Slip Gaji — {slip.employee_name}</h3>
          <div className="flex gap-2">
            <button onClick={handlePrint} className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 flex items-center gap-1" data-testid="payslip-print-btn">
              <Printer size={13}/> Print / Save PDF
            </button>
            <button onClick={onClose} className="p-1.5 hover:bg-slate-200 rounded"><X size={16}/></button>
          </div>
        </div>

        {/* Print area */}
        <div id="payslip-print-area" className="p-6 text-sm text-slate-900 font-sans" style={{ minHeight: "500px" }}>
          {/* Header PT */}
          <div className="text-center border-b-2 border-slate-800 pb-2 mb-3">
            <div className="text-base font-bold uppercase tracking-wide">{companyName}</div>
            <div className="text-[11px] mt-0.5 uppercase tracking-wider text-slate-600">SLIP GAJI KARYAWAN</div>
            <div className="text-xs text-slate-700 mt-0.5">Periode: <b>{periodLabel}</b> ({rangeLabel})</div>
          </div>

          {/* Karyawan info */}
          <table className="w-full text-xs mb-3">
            <tbody>
              <tr>
                <td className="py-0.5 w-28 text-slate-600">Nama</td>
                <td className="py-0.5 font-semibold">: {slip.employee_name}</td>
              </tr>
              {slip.employee_no && (
                <tr>
                  <td className="py-0.5 text-slate-600">ID Karyawan</td>
                  <td className="py-0.5 font-mono">: {slip.employee_no}</td>
                </tr>
              )}
              {slip.position && (
                <tr>
                  <td className="py-0.5 text-slate-600">Posisi</td>
                  <td className="py-0.5">: {slip.position}</td>
                </tr>
              )}
              {slip.gaji_lumpsum && (
                <tr>
                  <td className="py-0.5 text-slate-600">Tipe Gaji</td>
                  <td className="py-0.5">
                    : <span className="inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 text-[9px] font-bold">LUMPSUM</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Kehadiran (skip kalau lumpsum) */}
          {!slip.gaji_lumpsum && (
            <div className="border border-slate-300 rounded mb-3">
              <div className="bg-slate-100 px-2 py-1 text-[10px] uppercase font-bold text-slate-700">Kehadiran</div>
              <table className="w-full text-xs">
                <tbody>
                  <tr className="border-t border-slate-200">
                    <td className="px-2 py-1 text-slate-600">Total Hari Kerja</td>
                    <td className="px-2 py-1 text-right font-mono">{slip.working_days || 0}</td>
                  </tr>
                  <tr className="border-t border-slate-200">
                    <td className="px-2 py-1 text-slate-600">Hadir</td>
                    <td className="px-2 py-1 text-right font-mono">{slip.hari_hadir || 0}</td>
                  </tr>
                  <tr className="border-t border-slate-200">
                    <td className="px-2 py-1 text-slate-600">Sakit / Izin</td>
                    <td className="px-2 py-1 text-right font-mono">{(slip.hari_sakit || 0) + (slip.hari_izin || 0)}</td>
                  </tr>
                  <tr className="border-t border-slate-200">
                    <td className="px-2 py-1 text-slate-600">Alfa</td>
                    <td className="px-2 py-1 text-right font-mono text-rose-700">{slip.hari_alfa || 0}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Penghasilan */}
          <div className="border border-slate-300 rounded mb-3">
            <div className="bg-emerald-50 border-b border-emerald-200 px-2 py-1 text-[10px] uppercase font-bold text-emerald-800">Penghasilan</div>
            <table className="w-full text-xs">
              <tbody>
                <tr>
                  <td className="px-2 py-1 text-slate-700">Gaji Pokok</td>
                  <td className="px-2 py-1 text-right font-mono">{fmtIDR(slip.gaji_pokok_net)}</td>
                </tr>
                {!slip.gaji_lumpsum && (slip.uang_makan || 0) > 0 && (
                  <tr className="border-t border-slate-200">
                    <td className="px-2 py-1 text-slate-700">
                      Uang Makan <span className="text-[9px] text-slate-500">({slip.hari_hadir}× {fmtIDR(slip.meal_allowance_per_day)})</span>
                    </td>
                    <td className="px-2 py-1 text-right font-mono">{fmtIDR(slip.uang_makan)}</td>
                  </tr>
                )}
                {(slip.lembur_total || 0) > 0 && (
                  <tr className="border-t border-slate-200">
                    <td className="px-2 py-1 text-slate-700">Lembur <span className="text-[9px] text-slate-500">({slip.lembur_jam} jam)</span></td>
                    <td className="px-2 py-1 text-right font-mono">{fmtIDR(slip.lembur_total)}</td>
                  </tr>
                )}
                <tr className="border-t border-slate-300 bg-emerald-50/50 font-bold">
                  <td className="px-2 py-1">Total Penghasilan (Gross)</td>
                  <td className="px-2 py-1 text-right font-mono">{fmtIDR(slip.gross)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Potongan */}
          {(slip.potongan_kasbon || 0) > 0 && (
            <div className="border border-slate-300 rounded mb-3">
              <div className="bg-rose-50 border-b border-rose-200 px-2 py-1 text-[10px] uppercase font-bold text-rose-800">Potongan</div>
              <table className="w-full text-xs">
                <tbody>
                  <tr>
                    <td className="px-2 py-1 text-slate-700">Kasbon</td>
                    <td className="px-2 py-1 text-right font-mono text-rose-700">−{fmtIDR(slip.potongan_kasbon)}</td>
                  </tr>
                  {(slip.kasbon_items || []).map((k, i) => (
                    <tr key={i} className="border-t border-slate-100 text-[10px] text-slate-500">
                      <td className="px-4 py-0.5 italic">↳ {k.note || "kasbon"}</td>
                      <td className="px-2 py-0.5 text-right font-mono">−{fmtIDR(k.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Take Home Pay */}
          <div className="border-2 border-slate-800 rounded p-3 bg-emerald-50/40 mb-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold uppercase text-slate-700">Take Home Pay</div>
              <div className="text-lg font-black font-mono text-emerald-900">{fmtIDR(slip.net)}</div>
            </div>
          </div>

          {/* Signature */}
          <div className="grid grid-cols-2 gap-4 mt-8 text-xs">
            <div className="text-center">
              <div className="mb-10 text-slate-600">Diterima Oleh,</div>
              <div className="border-t border-slate-400 pt-1 font-semibold">{slip.employee_name}</div>
            </div>
            <div className="text-center">
              <div className="mb-10 text-slate-600">Disetujui Oleh,</div>
              <div className="border-t border-slate-400 pt-1 font-semibold">Finance / HR</div>
            </div>
          </div>

          {/* Footer note */}
          <div className="mt-4 pt-2 border-t border-slate-200 text-center text-[9px] text-slate-400 italic">
            Slip ini dibuat otomatis oleh sistem — dokumen konfidensial, harap dijaga kerahasiaannya.
          </div>
        </div>
      </div>
    </div>
  );
}

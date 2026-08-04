/**
 * ContractPrint — tampilan Kontrak Kerja / PKWT siap print (A4), meniru format lampiran.
 * Dipanggil dari halaman Kontrak Kerja (KontrakKerja.js).
 */
import React, { useEffect, useState } from "react";
import { X, Printer, FileText, FileDown } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";

const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

const fmtIDR = (n) => "Rp " + (Number(n) || 0).toLocaleString("id-ID");

const longDate = (s) => {
  if (!s) return "…………………";
  const d = new Date(s + "T00:00:00");
  if (isNaN(d)) return s;
  return `${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`;
};

const signParts = (s) => {
  if (!s) return { hari: "…………", tgl: "……", bulan: "…………", tahun: "………" };
  const d = new Date(s + "T00:00:00");
  if (isNaN(d)) return { hari: "…………", tgl: "……", bulan: "…………", tahun: "………" };
  return { hari: HARI[d.getDay()], tgl: d.getDate(), bulan: BULAN[d.getMonth()], tahun: d.getFullYear() };
};

// blank placeholder untuk field kosong
const V = (val) => (val === 0 || val ? val : <span style={{ color: "#94a3b8" }}>_____________</span>);

export default function ContractPrint({ contract, employee, onClose }) {
  const c = contract || {};
  const e = employee || {};
  const sp = signParts(c.sign_date);
  const [kop, setKop] = useState({});
  const [downloading, setDownloading] = useState("");

  useEffect(() => {
    api.get("/settings").then((r) => {
      const d = r.data;
      const m = Array.isArray(d) ? Object.fromEntries(d.map((x) => [x.key_name, x.key_value])) : d;
      setKop(m || {});
    }).catch(() => {});
  }, []);

  const empName = c.emp_name || e.full_name;
  const empKtp = c.emp_ktp || e.nik;
  const empBirthPlace = c.emp_birth_place || e.tempat_lahir;
  const empBirthDate = c.emp_birth_date || e.tanggal_lahir;
  const empAddress = c.emp_address || e.alamat_ktp || e.alamat_domisili;

  const handlePrint = async () => {
    if (!c.id) { toast.error("Simpan kontrak dulu sebelum mencetak."); return; }
    setDownloading("print");
    try {
      const res = await api.get(`/hr/contracts/${c.id}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const w = window.open(url, "_blank");
      if (!w) {
        const a = document.createElement("a");
        a.href = url;
        a.download = `Kontrak_Kerja_${(empName || "karyawan").replace(/\s+/g, "_")}.pdf`;
        document.body.appendChild(a); a.click(); a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) { await explainErr(err); }
    finally { setDownloading(""); }
  };

  const explainErr = async (err) => {
    let msg = "Gagal memproses dokumen. Coba lagi sesaat lagi.";
    try {
      const data = err?.response?.data;
      if (data instanceof Blob) {
        const txt = await data.text();
        try { msg = JSON.parse(txt).detail || msg; } catch { if (txt) msg = txt.slice(0, 200); }
      } else if (err?.message) { msg = err.message; }
    } catch (_) {}
    toast.error(msg);
  };

  const download = async (type) => {
    if (!c.id) { toast.error("Simpan kontrak dulu sebelum mengunduh."); return; }
    setDownloading(type);
    try {
      const res = await api.get(`/hr/contracts/${c.id}/${type}`, { responseType: "blob" });
      let fname = `Kontrak_Kerja_${(empName || "karyawan").replace(/\s+/g, "_")}.${type}`;
      const cd = res.headers["content-disposition"];
      if (cd) {
        const m = cd.match(/filename="?([^"]+)"?/);
        if (m) fname = m[1];
      }
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      await explainErr(err);
    } finally {
      setDownloading("");
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/70 z-[60] flex items-start justify-center p-4 overflow-y-auto" data-testid="contract-print-modal">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #contract-print-area, #contract-print-area * { visibility: visible; }
          #contract-print-area { position: absolute; top: 0; left: 0; width: 100%; background: white !important; }
          .no-print { display: none !important; }
          .pasal-block, .sign-block, .kop-block { page-break-inside: avoid; break-inside: avoid; }
          @page { size: A4 portrait; margin: 16mm 20mm; }
        }
      `}</style>

      <div className="bg-white rounded shadow-xl max-w-3xl w-full my-4">
        {/* Toolbar */}
        <div className="no-print flex items-center justify-between p-3 border-b bg-slate-50 sticky top-0 z-10">
          <h3 className="font-bold text-sm">Kontrak Kerja — {empName || "(tanpa nama)"}</h3>
          <div className="flex gap-2">
            <button onClick={() => download("docx")} disabled={!!downloading} className="px-3 py-1.5 bg-blue-700 text-white text-xs rounded hover:bg-blue-800 disabled:opacity-50 flex items-center gap-1" data-testid="contract-download-docx">
              <FileText size={13} /> {downloading === "docx" ? "Menyiapkan…" : "Word"}
            </button>
            <button onClick={() => download("pdf")} disabled={!!downloading} className="px-3 py-1.5 bg-rose-600 text-white text-xs rounded hover:bg-rose-700 disabled:opacity-50 flex items-center gap-1" data-testid="contract-download-pdf">
              <FileDown size={13} /> {downloading === "pdf" ? "Menyiapkan…" : "PDF"}
            </button>
            <button onClick={handlePrint} disabled={!!downloading} className="px-3 py-1.5 bg-slate-700 text-white text-xs rounded hover:bg-slate-800 disabled:opacity-50 flex items-center gap-1" data-testid="contract-print-btn">
              <Printer size={13} /> {downloading === "print" ? "Membuka…" : "Print"}
            </button>
            <button onClick={onClose} className="p-1.5 hover:bg-slate-200 rounded" data-testid="contract-print-close"><X size={16} /></button>
          </div>
        </div>

        {/* Print area */}
        <div id="contract-print-area" className="px-10 py-8 text-slate-900" style={{ fontFamily: "'Times New Roman', Georgia, serif", fontSize: "12pt", lineHeight: 1.5 }}>
          {/* Kop surat */}
          <div className="kop-block" style={{ display: "flex", alignItems: "center", gap: "18px", borderBottom: "3px double #1e3a8a", paddingBottom: "10px", marginBottom: "14px" }}>
            <img src={`${process.env.PUBLIC_URL || ""}/ar-cargo-logo.png`} alt="AR CARGO" style={{ height: "64px" }} />
            <div style={{ flex: 1, textAlign: "center" }}>
              <div style={{ fontSize: "15pt", fontWeight: "bold", textTransform: "uppercase", letterSpacing: ".5px" }}>{c.company_name || "PT. Abirama Mitra Pratama"}</div>
              {kop.kop_address && <div style={{ fontSize: "9pt", color: "#333" }}>{kop.kop_address}</div>}
              {(kop.kop_phone || kop.kop_email || kop.kop_website) && (
                <div style={{ fontSize: "9pt", color: "#333" }}>
                  {[kop.kop_phone && `Telp: ${kop.kop_phone}`, kop.kop_email && `Email: ${kop.kop_email}`, kop.kop_website && `Website: ${kop.kop_website}`].filter(Boolean).join(" · ")}
                </div>
              )}
              {kop.kop_tagline && <div style={{ fontSize: "8.5pt", fontStyle: "italic", color: "#555", marginTop: "2px" }}>{kop.kop_tagline}</div>}
            </div>
          </div>

          {/* Title */}
          <div className="text-center mb-1">
            <div className="font-bold uppercase" style={{ fontSize: "14pt" }}>PERJANJIAN KERJA WAKTU TERTENTU ({c.contract_type || "PKWT"})</div>
            <div className="mt-0.5">No: {V(c.contract_no)}</div>
          </div>

          <p className="mt-4 text-justify">
            Pada hari ini, <b>{sp.hari}</b>, tanggal <b>{sp.tgl}</b> bulan <b>{sp.bulan}</b> tahun <b>{sp.tahun}</b>, bertempat di {c.sign_place || "Kota Bekasi"}, yang bertanda tangan di bawah ini :
          </p>

          {/* Pihak Pertama */}
          <table className="mt-3" style={{ width: "100%" }}>
            <tbody>
              <tr><td style={{ width: "140px", verticalAlign: "top" }}>Nama</td><td style={{ width: "12px" }}>:</td><td>{V(c.rep_name)}</td></tr>
              <tr><td style={{ verticalAlign: "top" }}>Jabatan</td><td>:</td><td>{V(c.rep_position)}</td></tr>
              <tr><td style={{ verticalAlign: "top" }}>Alamat</td><td>:</td><td>{V(c.rep_address)}</td></tr>
            </tbody>
          </table>
          <p className="mt-2 text-justify">
            Dalam hal ini bertindak untuk dan atas nama <b>{c.company_name || "PT. Abirama Mitra Pratama"}</b>, selanjutnya disebut sebagai <b>PIHAK PERTAMA</b>.
          </p>

          {/* Pihak Kedua */}
          <table className="mt-3" style={{ width: "100%" }}>
            <tbody>
              <tr><td style={{ width: "140px", verticalAlign: "top" }}>Nama</td><td style={{ width: "12px" }}>:</td><td>{V(empName)}</td></tr>
              <tr><td style={{ verticalAlign: "top" }}>No. KTP</td><td>:</td><td>{V(empKtp)}</td></tr>
              <tr><td style={{ verticalAlign: "top" }}>Tempat, Tgl Lahir</td><td>:</td><td>{empBirthPlace || empBirthDate ? `${empBirthPlace || ""}${empBirthDate ? ", " + longDate(empBirthDate) : ""}` : V(null)}</td></tr>
              <tr><td style={{ verticalAlign: "top" }}>Alamat</td><td>:</td><td>{V(empAddress)}</td></tr>
            </tbody>
          </table>
          <p className="mt-2 text-justify">
            Dalam hal ini bertindak untuk dan atas nama diri sendiri, selanjutnya disebut sebagai <b>PIHAK KEDUA</b>.
          </p>

          <p className="mt-2 text-justify">PIHAK PERTAMA dan PIHAK KEDUA secara bersama-sama disebut "Para Pihak".</p>
          <p className="mt-2 text-justify">
            Para Pihak sepakat untuk mengikatkan diri dalam Perjanjian Kerja Waktu Tertentu (selanjutnya disebut "Perjanjian") dengan syarat-syarat dan ketentuan sebagai berikut :
          </p>

          {/* Pasal 1 */}
          <Article title="Pasal 1" subtitle="TUGAS DAN PENEMPATAN">
            <ol style={{ paddingLeft: "1.2rem", listStyleType: "decimal" }}>
              <li className="text-justify">PIHAK PERTAMA menerima dan mempekerjakan PIHAK KEDUA sebagai <b>{V(c.position)}</b>.</li>
              <li className="text-justify">PIHAK KEDUA akan ditempatkan di {V(c.placement) } {c.company_name ? `` : ""}.</li>
              <li className="text-justify">PIHAK PERTAMA berhak memindahkan, merotasi, atau menugaskan PIHAK KEDUA ke divisi atau lokasi kerja lain sesuai dengan kebutuhan operasional perusahaan.</li>
            </ol>
          </Article>

          {/* Pasal 2 */}
          <Article title="Pasal 2" subtitle="JANGKA WAKTU PERJANJIAN">
            <p className="text-justify">
              Perjanjian ini berlaku selama <b>{V(c.duration_text)}</b>, terhitung efektif sejak tanggal <b>{longDate(c.start_date)}</b> dan akan berakhir dengan sendirinya pada tanggal <b>{longDate(c.end_date)}</b>.
            </p>
          </Article>

          {/* Pasal 3 */}
          <Article title="Pasal 3" subtitle="WAKTU KERJA DAN TATA TERTIB">
            <ol style={{ paddingLeft: "1.2rem", listStyleType: "decimal" }}>
              <li className="text-justify">Waktu kerja dan jam kerja operasional yang berlaku bagi PIHAK KEDUA disesuaikan dengan ritme kebutuhan operasional perusahaan, yaitu <b>{V(c.work_days_text)}</b>.</li>
              <li className="text-justify">Pengaturan lebih lanjut mengenai rincian jam masuk, jam pulang, dan waktu istirahat akan diatur secara terpisah dalam Peraturan Perusahaan dan/atau Standar Operasional Prosedur (SOP) yang ditetapkan oleh PIHAK PERTAMA.</li>
              <li className="text-justify">PIHAK KEDUA wajib tunduk dan patuh pada Peraturan Perusahaan, Standar Operasional Prosedur (SOP), serta kebijakan tata tertib kehadiran yang berlaku di lingkungan {c.company_name || "PT. Abirama Mitra Pratama"}.</li>
            </ol>
          </Article>

          {/* Pasal 4 */}
          <Article title="Pasal 4" subtitle="UPAH, TUNJANGAN, DAN KERJA LEMBUR">
            <ol style={{ paddingLeft: "1.2rem", listStyleType: "decimal" }}>
              <li className="text-justify">
                Selama masa Perjanjian ini, PIHAK PERTAMA akan memberikan kompensasi kepada PIHAK KEDUA dengan rincian sebagai berikut :
                <ol style={{ paddingLeft: "1.2rem", listStyleType: "lower-alpha", marginTop: "4px" }}>
                  <li className="text-justify">Gaji Pokok : Sebesar <b>{c.gaji_pokok ? fmtIDR(c.gaji_pokok) : V(null)}</b>{c.gaji_pokok_words ? <> (<i>{c.gaji_pokok_words}</i>)</> : null} nett/bulan.</li>
                  <li className="text-justify">Tunjangan Tidak Tetap (Uang Makan): Sebesar <b>{c.uang_makan ? fmtIDR(c.uang_makan) : V(null)}</b>{c.uang_makan_words ? <> (<i>{c.uang_makan_words}</i>)</> : null} / hari kehadiran kerja.</li>
                </ol>
              </li>
              <li className="text-justify">Uang makan sebagaimana diatur pada ayat (1) huruf b bersifat fluktuatif dan hanya dibayarkan apabila PIHAK KEDUA hadir secara fisik serta menyelesaikan waktu kerja reguler pada hari tersebut. Apabila PIHAK KEDUA mangkir, sakit, cuti, atau izin, maka uang makan tidak dibayarkan.</li>
              <li className="text-justify">Upah sebagaimana dimaksud pada ayat (1) dibayarkan pada tanggal terakhir setiap bulannya melalui transfer ke rekening bank milik PIHAK KEDUA.</li>
              <li className="text-justify">Apabila terdapat kebutuhan operasional yang mendesak, PIHAK PERTAMA dapat menugaskan PIHAK KEDUA untuk melakukan Kerja Lembur. Pelaksanaan Kerja Lembur wajib didasarkan pada Surat Perintah Lembur (SPL) resmi yang disetujui dan ditandatangani terlebih dahulu oleh atasan langsung PIHAK KEDUA. Tanpa adanya SPL tertulis, segala bentuk perpanjangan waktu kerja (kehadiran di luar jam kerja operasional atas inisiatif pribadi) tidak diakui dan tidak sah dibayarkan sebagai lembur.</li>
              <li className="text-justify">Perhitungan dan pembayaran upah Kerja Lembur yang disetujui melalui SPL akan dilaksanakan sesuai dengan kebijakan internal yang sejalan dengan peraturan perundang-undangan di bidang ketenagakerjaan yang berlaku.</li>
            </ol>
          </Article>

          {/* Pasal 5 */}
          <Article title="Pasal 5" subtitle="FASILITAS DAN KERAHASIAAN PERUSAHAAN">
            <ol style={{ paddingLeft: "1.2rem", listStyleType: "decimal" }}>
              <li className="text-justify">PIHAK PERTAMA dapat meminjamkan fasilitas atau perlengkapan kerja kepada PIHAK KEDUA. Seluruh aset tersebut tetap menjadi milik sah PIHAK PERTAMA dan wajib dikembalikan dalam keadaan baik saat Perjanjian ini berakhir.</li>
              <li className="text-justify">PIHAK KEDUA diwajibkan untuk menjaga kerahasiaan seluruh data operasional, administrasi, sistem kerja, serta informasi konfidensial lainnya milik PIHAK PERTAMA, baik selama Perjanjian ini berlangsung maupun setelah berakhirnya hubungan kerja.</li>
            </ol>
          </Article>

          {/* Pasal 6 */}
          <Article title="Pasal 6" subtitle="PENGAKHIRAN PERJANJIAN">
            <ol style={{ paddingLeft: "1.2rem", listStyleType: "decimal" }}>
              <li className="text-justify">Pemutusan hubungan kerja dapat terjadi sebelum berakhirnya jangka waktu Perjanjian apabila PIHAK KEDUA melakukan pelanggaran berat, melanggar tata tertib perusahaan, atau tidak mampu memenuhi standar kinerja yang ditetapkan oleh PIHAK PERTAMA.</li>
              <li className="text-justify">Pemenuhan hak-hak normatif PIHAK KEDUA akibat berakhirnya Perjanjian ini akan diselesaikan dengan mengacu pada ketentuan perundang-undangan di bidang ketenagakerjaan yang berlaku di Republik Indonesia.</li>
            </ol>
          </Article>

          {/* Pasal 7 */}
          <Article title="Pasal 7" subtitle="PENUTUP">
            <ol style={{ paddingLeft: "1.2rem", listStyleType: "decimal" }}>
              <li className="text-justify">Perjanjian ini dibuat secara sadar, dibaca, dimengerti, dan disepakati bersama. Khusus mengenai besaran Upah sebagaimana diatur dalam Pasal 4, Para Pihak menyadari bahwa PIHAK PERTAMA diklasifikasikan sebagai Usaha Kecil berdasarkan regulasi yang berlaku, sehingga besaran upah ditetapkan murni berdasarkan kesepakatan Para Pihak.</li>
              <li className="text-justify">Dibuat rangkap 2 (dua) yang masing-masing dibubuhi meterai secukupnya dan memiliki kekuatan hukum yang sama.</li>
            </ol>
          </Article>

          {/* Signatures */}
          <div className="sign-block" style={{ display: "flex", justifyContent: "space-between", marginTop: "40px" }}>
            <div style={{ textAlign: "center", width: "45%" }}>
              <div>PIHAK PERTAMA</div>
              <div>{c.company_name || "PT. Abirama Mitra Pratama"}</div>
              <div style={{ height: "70px" }} />
              <div style={{ fontWeight: "bold", textDecoration: "underline" }}>( {c.rep_name || "……………………"} )</div>
              <div>{c.rep_position || "Direktur Utama"}</div>
            </div>
            <div style={{ textAlign: "center", width: "45%" }}>
              <div>PIHAK KEDUA</div>
              <div style={{ height: "94px" }} />
              <div style={{ fontWeight: "bold", textDecoration: "underline" }}>( {empName || "……………………"} )</div>
              <div>{c.signer2_title || "Karyawan"}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Article({ title, subtitle, children }) {
  return (
    <div className="pasal-block" style={{ marginTop: "16px" }}>
      <div className="text-center" style={{ fontWeight: "bold" }}>{title}</div>
      <div className="text-center" style={{ fontWeight: "bold", marginBottom: "6px" }}>{subtitle}</div>
      {children}
    </div>
  );
}

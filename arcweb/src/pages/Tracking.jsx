import React, { useState, useMemo } from "react";
import PageShell from "@/components/PageShell";
import { MaskLine, Reveal } from "@/components/Reveal";
import AccentButton from "@/components/AccentButton";
import { useLang } from "@/lib/i18n";
import { motion, AnimatePresence } from "framer-motion";
import axios from "axios";

// Base API URL: pakai REACT_APP_BACKEND_URL kalau diset, fallback ke same-origin.
const API = `${process.env.REACT_APP_BACKEND_URL || ""}/api`;

// ---------- Helpers ----------
function formatDate(iso, lang, opts = {}) {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime()) || d.getFullYear() < 2000) return "-";
    return d.toLocaleString(lang === "id" ? "id-ID" : "en-US", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      ...(opts.withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
    });
  } catch {
    return "-";
  }
}

function formatCurrency(v) {
  if (v == null || v === "") return "-";
  return `Rp ${Number(v).toLocaleString("id-ID")}`;
}

// Payment status → color mapping
const PAY_COLORS = {
  Paid: { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/30" },
  Invoiced: { bg: "bg-blue-500/15", text: "text-blue-400", border: "border-blue-500/30" },
  Open: { bg: "bg-[#FF5A00]/15", text: "text-[#FF5A00]", border: "border-[#FF5A00]/30" },
  Draft: { bg: "bg-zinc-500/15", text: "text-zinc-400", border: "border-zinc-500/30" },
};
function payChip(status) {
  const s = status || "Open";
  const c = PAY_COLORS[s] || PAY_COLORS.Open;
  return `inline-block px-2 py-0.5 border ${c.border} ${c.bg} ${c.text} text-[10px] font-mono uppercase tracking-wider`;
}

// Delivery step → color
const DELIV_COLORS = {
  order_received: "text-zinc-400",
  in_transit: "text-yellow-400",
  arrived: "text-blue-400",
  delivered: "text-emerald-400",
  invoiced: "text-blue-500",
  paid: "text-emerald-500",
};

// Sort direction indicator (defined outside to avoid re-creation on every render)
function SortIcon({ active, dir }) {
  if (!active) return <span className="text-[#A1A1AA]/40 ml-1">⇅</span>;
  return <span className="text-[#FF5A00] ml-1">{dir === "asc" ? "↑" : "↓"}</span>;
}

export default function Tracking() {
  const { t, lang } = useLang();
  const p = t.tracking_page;

  // Customer tracking lookup
  const [tid, setTid] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  // Table state
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [sortBy, setSortBy] = useState("pickup_date");
  const [sortDir, setSortDir] = useState("desc");
  const [expandedIdx, setExpandedIdx] = useState(null);

  // Pagination state
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);

  // Reset ke page 1 kalau filter/search berubah
  React.useEffect(() => {
    setPage(1);
    setExpandedIdx(null);
  }, [search, statusFilter, paymentFilter, pageSize, result]);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!tid || tid.trim().length < 4) {
      setError(p.no_result);
      setResult(null);
      return;
    }
    setError("");
    setLoading(true);
    setResult(null);
    setExpandedIdx(null);
    try {
      const { data } = await axios.get(
        `${API}/public/tracking/${encodeURIComponent(tid.trim().toUpperCase())}`
      );
      setResult(data);
    } catch (err) {
      const msg = err?.response?.data?.detail || p.no_result;
      setError(msg);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  // Derived: filtered + sorted rows
  const rows = useMemo(() => {
    if (!result?.awbs) return [];
    let arr = [...result.awbs];

    // Search AWB number
    const q = search.trim().toUpperCase();
    if (q) arr = arr.filter((a) => (a.awb_number || "").toUpperCase().includes(q));

    // Filter delivery status
    if (statusFilter !== "all") arr = arr.filter((a) => a.status_step === statusFilter);

    // Filter payment status
    if (paymentFilter !== "all") arr = arr.filter((a) => (a.payment_status || "Open") === paymentFilter);

    // Sort
    arr.sort((a, b) => {
      const av = a[sortBy];
      const bv = b[sortBy];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      // Date fields
      if (["pickup_date", "etd", "eta", "plan_eta_customer", "created_at"].includes(sortBy)) {
        const at = new Date(av).getTime();
        const bt = new Date(bv).getTime();
        return sortDir === "asc" ? at - bt : bt - at;
      }
      // String / numeric
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });

    return arr;
  }, [result, search, statusFilter, paymentFilter, sortBy, sortDir]);

  // Pagination derived
  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, currentPage, pageSize]);
  const rangeStart = totalRows === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd = Math.min(currentPage * pageSize, totalRows);

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortBy(col);
      setSortDir("desc");
    }
  };

  const uniqueSteps = useMemo(() => {
    const set = new Set();
    (result?.awbs || []).forEach((a) => a.status_step && set.add(a.status_step));
    return Array.from(set);
  }, [result]);

  const uniquePayments = useMemo(() => {
    const set = new Set();
    (result?.awbs || []).forEach((a) => set.add(a.payment_status || "Open"));
    return Array.from(set);
  }, [result]);

  return (
    <PageShell>
      {/* HERO */}
      <section className="pt-32 md:pt-44 pb-12 md:pb-16 border-b border-[#272A30]">
        <div className="max-w-[1400px] mx-auto px-5 md:px-10">
          <div className="flex items-center gap-3 mb-6">
            <span className="w-8 h-px bg-[#FF5A00]" />
            <span className="font-mono text-[11px] tracking-[0.2em] text-[#A1A1AA] uppercase">
              {p.overline}
            </span>
          </div>
          <h1 className="font-display text-5xl md:text-[8.5vw] leading-[0.9] tracking-tight whitespace-nowrap">
            <div className="overflow-hidden">
              <MaskLine trigger="mount">{p.title_1}</MaskLine>
            </div>
            <div className="overflow-hidden">
              <MaskLine trigger="mount" delay={0.12}>
                <span className="text-[#FF5A00] font-editorial italic font-normal">
                  {p.title_2}
                </span>
              </MaskLine>
            </div>
          </h1>
          <Reveal delay={0.35}>
            <p className="mt-8 max-w-2xl text-[#A1A1AA] text-lg leading-relaxed">
              {p.lead}
            </p>
          </Reveal>
        </div>
      </section>

      {/* FORM — Customer Tracking Code */}
      <section className="border-b border-[#272A30]">
        <div className="max-w-[1400px] mx-auto px-5 md:px-10 py-12 md:py-16">
          <form
            onSubmit={onSubmit}
            data-testid="tracking-form"
            className="border border-[#272A30] p-6 md:p-8 bg-[#1A1D24]/40"
          >
            <div className="flex items-center gap-3 mb-4">
              <span className="w-2 h-2 bg-[#FF5A00] blink" />
              <span className="font-mono text-[10px] tracking-[0.2em] text-[#A1A1AA]">
                {p.tracking_number}
              </span>
            </div>
            <div className="flex flex-col md:flex-row gap-3">
              <input
                data-testid="tracking-input"
                value={tid}
                onChange={(e) => setTid(e.target.value.toUpperCase())}
                placeholder={p.placeholder}
                className="flex-1 bg-[#0F1115] border border-[#272A30] px-4 py-4 md:py-5 text-[#F4F4F5] placeholder:text-[#A1A1AA]/60 font-mono text-lg tracking-wider focus:outline-none focus:border-[#FF5A00]"
              />
              <AccentButton
                type="submit"
                variant="solid"
                size="lg"
                data-testid="tracking-submit"
                disabled={loading}
              >
                {loading ? p.loading : p.cta}
              </AccentButton>
            </div>
            <div className="mt-3 font-mono text-[10px] text-[#A1A1AA]">
              {p.demo}
            </div>
          </form>
        </div>
      </section>

      {/* RESULT — Table View */}
      <section className="border-b border-[#272A30] min-h-[400px]">
        <div className="max-w-[1400px] mx-auto px-5 md:px-10 py-12 md:py-16">
          <AnimatePresence mode="wait">
            {loading && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="font-mono text-[#A1A1AA] text-sm"
              >
                <span className="blink">▊</span> {p.loading}
              </motion.div>
            )}

            {!loading && error && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="border border-[#FF5A00]/40 bg-[#FF5A00]/5 p-6 font-mono text-sm text-[#FF5A00]"
              >
                ! {error}
              </motion.div>
            )}

            {!loading && result && (
              <motion.div
                key={result.customer.tracking_code}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="space-y-6"
                data-testid="tracking-result"
              >
                {/* Customer Header */}
                <div className="border border-[#272A30] p-6 md:p-8 bg-[#1A1D24]/40">
                  <div className="font-mono text-[10px] text-[#A1A1AA] mb-2 tracking-[0.2em]">
                    {p.tracking_number}
                  </div>
                  <div className="flex flex-wrap items-baseline gap-4 mb-2">
                    <div className="font-display text-3xl md:text-5xl text-[#F4F4F5] tracking-tight">
                      {result.customer.name}
                    </div>
                    <div className="font-mono text-sm text-[#FF5A00]">
                      {result.customer.tracking_code}
                    </div>
                  </div>
                  <div className="font-mono text-[11px] text-[#A1A1AA]">
                    {result.awb_count} shipment{result.awb_count === 1 ? "" : "s"} · Menampilkan {rows.length}
                  </div>
                </div>

                {/* Table Controls */}
                <div className="flex flex-col md:flex-row gap-3 md:items-center">
                  <div className="relative flex-1">
                    <input
                      data-testid="table-search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Cari AWB Number..."
                      className="w-full bg-[#0F1115] border border-[#272A30] px-4 py-3 text-[#F4F4F5] placeholder:text-[#A1A1AA]/60 font-mono text-sm focus:outline-none focus:border-[#FF5A00]"
                    />
                  </div>
                  <select
                    data-testid="table-filter-status"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="bg-[#0F1115] border border-[#272A30] px-4 py-3 text-[#F4F4F5] font-mono text-sm focus:outline-none focus:border-[#FF5A00]"
                  >
                    <option value="all">Semua Status</option>
                    {uniqueSteps.map((s) => (
                      <option key={s} value={s}>
                        {s.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                  <select
                    data-testid="table-filter-payment"
                    value={paymentFilter}
                    onChange={(e) => setPaymentFilter(e.target.value)}
                    className="bg-[#0F1115] border border-[#272A30] px-4 py-3 text-[#F4F4F5] font-mono text-sm focus:outline-none focus:border-[#FF5A00]"
                  >
                    <option value="all">Semua Pembayaran</option>
                    {uniquePayments.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>

                {/* Table */}
                {result.awb_count === 0 ? (
                  <div className="border border-dashed border-[#272A30] p-10 text-center font-mono text-[#A1A1AA]">
                    Belum ada shipment untuk customer ini.
                  </div>
                ) : rows.length === 0 ? (
                  <div className="border border-dashed border-[#272A30] p-10 text-center font-mono text-[#A1A1AA]">
                    Tidak ada AWB sesuai filter.
                  </div>
                ) : (
                  <div className="border border-[#272A30] overflow-x-auto" data-testid="tracking-table">
                    <table className="w-full text-sm">
                      <thead className="bg-[#1A1D24] font-mono text-[10px] uppercase tracking-[0.15em] text-[#A1A1AA]">
                        <tr>
                          <th className="text-left px-4 py-3 cursor-pointer hover:text-[#FF5A00]" onClick={() => toggleSort("awb_number")}>
                            AWB <SortIcon active={sortBy === "awb_number"} dir={sortDir} />
                          </th>
                          <th className="text-left px-4 py-3 cursor-pointer hover:text-[#FF5A00]" onClick={() => toggleSort("origin")}>
                            Origin <SortIcon active={sortBy === "origin"} dir={sortDir} />
                          </th>
                          <th className="text-left px-4 py-3 cursor-pointer hover:text-[#FF5A00]" onClick={() => toggleSort("destination")}>
                            Destination <SortIcon active={sortBy === "destination"} dir={sortDir} />
                          </th>
                          <th className="text-left px-4 py-3 cursor-pointer hover:text-[#FF5A00]" onClick={() => toggleSort("pickup_date")}>
                            Pickup / ETD <SortIcon active={sortBy === "pickup_date"} dir={sortDir} />
                          </th>
                          <th className="text-left px-4 py-3 cursor-pointer hover:text-[#FF5A00]" onClick={() => toggleSort("plan_eta_customer")}>
                            ETA <SortIcon active={sortBy === "plan_eta_customer"} dir={sortDir} />
                          </th>
                          <th className="text-left px-4 py-3">Status</th>
                          <th className="text-left px-4 py-3">Pembayaran</th>
                          <th className="text-right px-4 py-3 cursor-pointer hover:text-[#FF5A00]" onClick={() => toggleSort("grand_total")}>
                            Nilai <SortIcon active={sortBy === "grand_total"} dir={sortDir} />
                          </th>
                        </tr>
                      </thead>
                      <tbody className="font-mono text-[12px] text-[#F4F4F5]">
                        {pagedRows.map((awb, idx) => {
                          const globalIdx = (currentPage - 1) * pageSize + idx;
                          const isOpen = expandedIdx === globalIdx;
                          const delivClass = DELIV_COLORS[awb.status_step] || "text-[#FF5A00]";
                          return (
                            <React.Fragment key={awb.awb_number || idx}>
                              <tr
                                data-testid={`tracking-row-${idx}`}
                                onClick={() => setExpandedIdx(isOpen ? null : globalIdx)}
                                className={`border-t border-[#272A30] hover:bg-[#1A1D24]/60 cursor-pointer transition-colors ${isOpen ? "bg-[#1A1D24]/60" : ""}`}
                              >
                                <td className="px-4 py-3 font-semibold whitespace-nowrap">
                                  <span className="text-[#A1A1AA] mr-1">{isOpen ? "▾" : "▸"}</span>
                                  {awb.awb_number}
                                </td>
                                <td className="px-4 py-3">{awb.origin || "-"}</td>
                                <td className="px-4 py-3">{awb.destination || "-"}</td>
                                <td className="px-4 py-3 whitespace-nowrap">{formatDate(awb.pickup_date || awb.etd, lang)}</td>
                                <td className="px-4 py-3 whitespace-nowrap">{formatDate(awb.plan_eta_customer || awb.eta, lang)}</td>
                                <td className={`px-4 py-3 ${delivClass}`}>{awb.status_label}</td>
                                <td className="px-4 py-3">
                                  <span className={payChip(awb.payment_status)}>{awb.payment_status || "Open"}</span>
                                </td>
                                <td className="px-4 py-3 text-right whitespace-nowrap">{formatCurrency(awb.grand_total)}</td>
                              </tr>
                              {isOpen && (
                                <tr className="bg-[#0F1115] border-t border-[#272A30]">
                                  <td colSpan={8} className="px-4 py-6">
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                      {/* Detail */}
                                      <div className="space-y-3 text-[11px]">
                                        <div className="font-mono text-[10px] text-[#FF5A00] tracking-[0.2em] mb-2">DETAIL</div>
                                        <Row label="Service" value={awb.service} />
                                        <Row label="Armada" value={awb.armada} />
                                        <Row label="Berat" value={awb.qty_kg ? `${awb.qty_kg} Kg` : null} />
                                        <Row label="Koli" value={awb.koli_count} />
                                        <Row label="Barang" value={awb.item_description} />
                                        <Row label="Invoice No" value={awb.invoice_number} mono />
                                        <Row label="PO No" value={awb.po_number} mono />
                                        {awb.paid_at && <Row label="Tanggal Bayar" value={formatDate(awb.paid_at, lang)} />}
                                      </div>

                                      {/* Timeline */}
                                      <div className="md:col-span-2">
                                        <div className="font-mono text-[10px] text-[#FF5A00] tracking-[0.2em] mb-4">
                                          {p.history}
                                        </div>
                                        <div className="relative pl-6">
                                          <div className="absolute left-[6px] top-1 bottom-1 w-px bg-[#272A30]" />
                                          {(awb.tracking_history || []).length === 0 ? (
                                            <div className="font-mono text-[11px] text-[#A1A1AA] italic pl-2">
                                              Belum ada catatan tracking.
                                            </div>
                                          ) : (
                                            [...(awb.tracking_history || [])].reverse().map((ev, i) => (
                                              <div
                                                key={i}
                                                className="relative pb-5 last:pb-0"
                                                data-testid={`tracking-event-${idx}-${i}`}
                                              >
                                                <span className={`absolute -left-[24px] top-1 w-3 h-3 border ${i === 0 ? "bg-[#FF5A00] border-[#FF5A00] shadow-[0_0_20px_#FF5A00]" : "bg-[#0F1115] border-[#A1A1AA]"}`} />
                                                <div className="font-mono text-[10px] text-[#A1A1AA]">
                                                  {formatDate(ev.date, lang, { withTime: true })} · {ev.location || "-"}
                                                </div>
                                                <div className="text-sm text-[#F4F4F5] mt-1">
                                                  {ev.status || "Update"}
                                                </div>
                                                {ev.note && (
                                                  <div className="text-[11px] text-[#A1A1AA] mt-1 max-w-lg">
                                                    {ev.note}
                                                  </div>
                                                )}
                                              </div>
                                            ))
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Pagination Bar */}
                {rows.length > 0 && (
                  <div className="flex flex-col md:flex-row items-center justify-between gap-4 border border-[#272A30] px-4 py-3 bg-[#1A1D24]/40" data-testid="pagination-bar">
                    <div className="font-mono text-[11px] text-[#A1A1AA]">
                      Menampilkan <span className="text-[#F4F4F5]">{rangeStart}-{rangeEnd}</span> dari <span className="text-[#F4F4F5]">{totalRows}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 font-mono text-[11px] text-[#A1A1AA]">
                        <span>Per halaman:</span>
                        <select
                          data-testid="pagination-size"
                          value={pageSize}
                          onChange={(e) => setPageSize(Number(e.target.value))}
                          className="bg-[#0F1115] border border-[#272A30] px-2 py-1 text-[#F4F4F5] font-mono text-xs focus:outline-none focus:border-[#FF5A00]"
                        >
                          <option value={10}>10</option>
                          <option value={25}>25</option>
                          <option value={50}>50</option>
                          <option value={100}>100</option>
                        </select>
                      </div>
                      <div className="flex items-center gap-1 font-mono text-[11px]">
                        <button
                          data-testid="pagination-prev"
                          onClick={() => setPage((pg) => Math.max(1, pg - 1))}
                          disabled={currentPage <= 1}
                          className="px-3 py-1 border border-[#272A30] text-[#F4F4F5] hover:border-[#FF5A00] hover:text-[#FF5A00] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-[#272A30] disabled:hover:text-[#F4F4F5]"
                        >
                          ← Prev
                        </button>
                        <div className="px-3 py-1 text-[#A1A1AA]">
                          <span className="text-[#F4F4F5]">{currentPage}</span> / {totalPages}
                        </div>
                        <button
                          data-testid="pagination-next"
                          onClick={() => setPage((pg) => Math.min(totalPages, pg + 1))}
                          disabled={currentPage >= totalPages}
                          className="px-3 py-1 border border-[#272A30] text-[#F4F4F5] hover:border-[#FF5A00] hover:text-[#FF5A00] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-[#272A30] disabled:hover:text-[#F4F4F5]"
                        >
                          Next →
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {!loading && !result && !error && (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="border border-dashed border-[#272A30] p-10 text-center"
              >
                <div className="font-display text-3xl md:text-5xl text-[#F4F4F5]/40 mb-3">
                  ARC—XXXXX
                </div>
                <div className="font-mono text-[11px] text-[#A1A1AA]">
                  {p.demo}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>
    </PageShell>
  );
}

function Row({ label, value, mono }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex items-start gap-3">
      <div className="text-[#A1A1AA] w-28 shrink-0 font-mono text-[10px] tracking-wider uppercase">{label}</div>
      <div className={`text-[#F4F4F5] ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

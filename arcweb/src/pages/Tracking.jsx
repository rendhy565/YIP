import React, { useState } from "react";
import PageShell from "@/components/PageShell";
import { MaskLine, Reveal } from "@/components/Reveal";
import AccentButton from "@/components/AccentButton";
import { useLang } from "@/lib/i18n";
import { motion, AnimatePresence } from "framer-motion";
import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

function formatDate(iso, lang) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(lang === "id" ? "id-ID" : "en-US", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

export default function Tracking() {
  const { t, lang } = useLang();
  const p = t.tracking_page;
  const [tid, setTid] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!tid || tid.trim().length < 6) {
      setError(p.no_result);
      setResult(null);
      return;
    }
    setError("");
    setLoading(true);
    setResult(null);
    try {
      await new Promise((r) => setTimeout(r, 500));
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

      {/* FORM */}
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

      {/* RESULT */}
      <section className="border-b border-[#272A30] min-h-[400px]">
        <div className="max-w-[1400px] mx-auto px-5 md:px-10 py-16 md:py-24">
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
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="space-y-10"
                data-testid="tracking-result"
              >
                {/* Customer Header */}
                <div className="border border-[#272A30] p-6 md:p-8 bg-[#1A1D24]/40">
                  <div className="font-mono text-[10px] text-[#A1A1AA] mb-2 tracking-[0.2em]">
                    {p.tracking_number}
                  </div>
                  <div className="flex flex-wrap items-baseline gap-4 mb-4">
                    <div className="font-display text-3xl md:text-5xl text-[#F4F4F5] tracking-tight">
                      {result.customer.name}
                    </div>
                    <div className="font-mono text-sm text-[#FF5A00]">
                      {result.customer.tracking_code}
                    </div>
                  </div>
                  <div className="font-mono text-[11px] text-[#A1A1AA]">
                    {result.awb_count} shipment{result.awb_count === 1 ? "" : "s"} ditemukan
                  </div>
                </div>

                {result.awb_count === 0 && (
                  <div className="border border-dashed border-[#272A30] p-10 text-center font-mono text-[#A1A1AA]">
                    Belum ada shipment untuk customer ini.
                  </div>
                )}

                {result.awbs.map((awb, idx) => (
                  <motion.div
                    key={awb.awb_number}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: idx * 0.08, ease: [0.22, 1, 0.36, 1] }}
                    className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-12 border-t border-[#272A30] pt-10"
                    data-testid={`tracking-awb-${idx}`}
                  >
                    {/* Summary */}
                    <div className="md:col-span-5 md:sticky md:top-28 h-fit">
                      <div className="border border-[#272A30] p-6 md:p-8">
                        <div className="font-mono text-[10px] text-[#A1A1AA] mb-2 tracking-[0.2em]">AWB</div>
                        <div className="font-display text-2xl md:text-4xl text-[#F4F4F5] mb-6 tracking-tight">
                          {awb.awb_number}
                        </div>
                        <div className="grid grid-cols-2 gap-6 font-mono text-[11px]">
                          <div>
                            <div className="text-[#A1A1AA] mb-1">{p.status}</div>
                            <div className="text-[#FF5A00] text-sm">{awb.status_label}</div>
                          </div>
                          <div>
                            <div className="text-[#A1A1AA] mb-1">{p.service}</div>
                            <div className="text-[#F4F4F5] text-sm">{awb.service || "-"}</div>
                          </div>
                          <div className="col-span-2">
                            <div className="text-[#A1A1AA] mb-1">{p.route}</div>
                            <div className="text-[#F4F4F5] text-sm">{awb.origin} → {awb.destination}</div>
                          </div>
                          <div className="col-span-2">
                            <div className="text-[#A1A1AA] mb-1">{p.eta}</div>
                            <div className="text-[#F4F4F5] text-sm">{formatDate(awb.plan_eta_customer || awb.eta, lang) || "-"}</div>
                          </div>
                          <div>
                            <div className="text-[#A1A1AA] mb-1">Berat</div>
                            <div className="text-[#F4F4F5] text-sm">{awb.qty_kg ? `${awb.qty_kg} Kg` : "-"}</div>
                          </div>
                          <div>
                            <div className="text-[#A1A1AA] mb-1">Koli</div>
                            <div className="text-[#F4F4F5] text-sm">{awb.koli_count || "-"}</div>
                          </div>
                          {awb.item_description && (
                            <div className="col-span-2">
                              <div className="text-[#A1A1AA] mb-1">Barang</div>
                              <div className="text-[#F4F4F5] text-sm">{awb.item_description}</div>
                            </div>
                          )}
                          {awb.invoice_number && (
                            <div>
                              <div className="text-[#A1A1AA] mb-1">Invoice No</div>
                              <div className="text-[#F4F4F5] text-sm font-mono">{awb.invoice_number}</div>
                            </div>
                          )}
                          {awb.po_number && (
                            <div>
                              <div className="text-[#A1A1AA] mb-1">PO No</div>
                              <div className="text-[#F4F4F5] text-sm font-mono">{awb.po_number}</div>
                            </div>
                          )}
                          {awb.grand_total && (
                            <div className="col-span-2">
                              <div className="text-[#A1A1AA] mb-1">Nilai</div>
                              <div className="text-[#F4F4F5] text-sm">Rp {Number(awb.grand_total).toLocaleString("id-ID")}</div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Timeline */}
                    <div className="md:col-span-7">
                      <div className="font-mono text-[10px] text-[#FF5A00] mb-6 tracking-[0.2em]">
                        {p.history}
                      </div>
                      <div className="relative pl-8">
                        <div className="absolute left-[6px] top-1 bottom-1 w-px bg-[#272A30]" />
                        {[...(awb.tracking_history || [])].reverse().map((ev, i) => (
                          <motion.div
                            key={i}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.6, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
                            className="relative pb-10 last:pb-0"
                            data-testid={`tracking-event-${idx}-${i}`}
                          >
                            <span className={`absolute -left-[30px] top-1 w-3 h-3 border ${i === 0 ? "bg-[#FF5A00] border-[#FF5A00] shadow-[0_0_20px_#FF5A00]" : "bg-[#0F1115] border-[#A1A1AA]"}`} />
                            <div className="font-mono text-[10px] text-[#A1A1AA]">
                              {formatDate(ev.date, lang)} · {ev.location || "-"}
                            </div>
                            <div className="font-display text-xl md:text-2xl text-[#F4F4F5] mt-1">
                              {ev.status || "Update"}
                            </div>
                            <div className="text-sm text-[#A1A1AA] mt-1 max-w-md">
                              {ev.note}
                            </div>
                          </motion.div>
                        ))}
                        {(!awb.tracking_history || awb.tracking_history.length === 0) && (
                          <div className="font-mono text-[11px] text-[#A1A1AA] italic pl-2">
                            Belum ada catatan tracking. Status: <span className="text-[#FF5A00]">{awb.status_label}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}
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

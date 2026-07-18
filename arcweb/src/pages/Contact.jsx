import React, { useState } from "react";
import PageShell from "@/components/PageShell";
import { MaskLine, Reveal } from "@/components/Reveal";
import AccentButton from "@/components/AccentButton";
import { useLang } from "@/lib/i18n";
import { toast } from "sonner";
import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const WHATSAPP = "https://wa.me/622156928104";

const inputCls =
  "w-full bg-[#1A1D24] border border-[#272A30] px-3 md:px-4 py-3 text-[#F4F4F5] placeholder:text-[#A1A1AA]/60 focus:outline-none focus:border-[#FF5A00] transition-colors font-body text-sm";
const labelCls =
  "block font-mono text-[10px] text-[#A1A1AA] mb-1.5 uppercase tracking-[0.14em]";

export default function Contact() {
  const { t } = useLang();
  const c = t.contact_page;
  const [contactForm, setContactForm] = useState({
    name: "",
    email: "",
    phone: "",
    subject: "",
    message: "",
  });
  const [quoteForm, setQuoteForm] = useState({
    name: "",
    company: "",
    email: "",
    phone: "",
    origin: "",
    destination: "",
    service_type: "sea",
    cargo_type: "",
    weight: "",
    dimensions: "",
    notes: "",
  });
  const [loading, setLoading] = useState({ contact: false, quote: false });

  const onSubmitContact = async (e) => {
    e.preventDefault();
    setLoading((s) => ({ ...s, contact: true }));
    try {
      await axios.post(`${API}/contact`, contactForm);
      toast.success(c.f.sent);
      setContactForm({ name: "", email: "", phone: "", subject: "", message: "" });
    } catch (err) {
      toast.error("Error: " + (err?.response?.data?.detail || err.message));
    } finally {
      setLoading((s) => ({ ...s, contact: false }));
    }
  };

  const onSubmitQuote = async (e) => {
    e.preventDefault();
    setLoading((s) => ({ ...s, quote: true }));
    try {
      await axios.post(`${API}/quote`, quoteForm);
      toast.success(c.f.sent);
      setQuoteForm({
        name: "",
        company: "",
        email: "",
        phone: "",
        origin: "",
        destination: "",
        service_type: "sea",
        cargo_type: "",
        weight: "",
        dimensions: "",
        notes: "",
      });
    } catch (err) {
      toast.error("Error: " + (err?.response?.data?.detail || err.message));
    } finally {
      setLoading((s) => ({ ...s, quote: false }));
    }
  };

  return (
    <PageShell>
      {/* HERO */}
      <section className="pt-32 md:pt-44 pb-16 md:pb-24 border-b border-[#272A30]">
        <div className="max-w-[1400px] mx-auto px-5 md:px-10">
          <div className="flex items-center gap-3 mb-6">
            <span className="w-8 h-px bg-[#FF5A00]" />
            <span className="font-mono text-[11px] tracking-[0.2em] text-[#A1A1AA] uppercase">
              {c.overline}
            </span>
          </div>
          <h1 className="font-display text-5xl md:text-[8.5vw] leading-[0.9] tracking-tight whitespace-nowrap">
            <div className="overflow-hidden">
              <MaskLine trigger="mount">{c.title_1}</MaskLine>
            </div>
            <div className="overflow-hidden">
              <MaskLine trigger="mount" delay={0.12}>
                <span className="text-[#FF5A00] font-editorial italic font-normal">
                  {c.title_2}
                </span>
              </MaskLine>
            </div>
          </h1>
          <Reveal delay={0.35}>
            <p className="mt-8 max-w-2xl text-[#A1A1AA] text-lg leading-relaxed">
              {c.lead}
            </p>
          </Reveal>
        </div>
      </section>

      {/* CONTACT DETAILS */}
      <section className="border-b border-[#272A30]">
        <div className="max-w-[1400px] mx-auto grid grid-cols-1 md:grid-cols-3 border-t border-l border-[#272A30]">
          <div className="border-r border-b border-[#272A30] p-6 md:p-10">
            <div className="font-mono text-[10px] text-[#FF5A00] mb-4 tracking-[0.2em]">
              {c.addr_title}
            </div>
            <p className="text-[#F4F4F5] leading-relaxed">{c.addr}</p>
          </div>
          <div className="border-r border-b border-[#272A30] p-6 md:p-10">
            <div className="font-mono text-[10px] text-[#FF5A00] mb-4 tracking-[0.2em]">
              PHONE / WA
            </div>
            <a
              href="tel:+622156928104"
              data-testid="contact-phone"
              className="block font-display text-2xl md:text-3xl text-[#F4F4F5] link-line mb-2"
            >
              {c.phone}
            </a>
            <a
              href={WHATSAPP}
              target="_blank"
              rel="noreferrer"
              data-testid="contact-whatsapp"
              className="font-mono text-[11px] text-[#FF5A00] link-line"
            >
              → {c.wa}
            </a>
          </div>
          <div className="border-r border-b border-[#272A30] p-6 md:p-10">
            <div className="font-mono text-[10px] text-[#FF5A00] mb-4 tracking-[0.2em]">
              {c.hours_title}
            </div>
            <p className="text-[#F4F4F5]">{c.hours}</p>
          </div>
        </div>
      </section>

      {/* FORMS */}
      <section className="border-b border-[#272A30]">
        <div className="max-w-[1400px] mx-auto px-5 md:px-10 py-16 md:py-24 grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-16">
          {/* CONTACT FORM */}
          <form
            data-testid="contact-form"
            onSubmit={onSubmitContact}
            className="border border-[#272A30] p-6 md:p-10"
          >
            <div className="flex items-center justify-between mb-6">
              <div className="font-mono text-[10px] text-[#FF5A00] tracking-[0.2em]">
                {c.form_title}
              </div>
              <span className="font-mono text-[10px] text-[#A1A1AA]">01</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>{c.f.name}</label>
                <input
                  required
                  data-testid="contact-name"
                  className={inputCls}
                  value={contactForm.name}
                  onChange={(e) =>
                    setContactForm({ ...contactForm, name: e.target.value })
                  }
                />
              </div>
              <div>
                <label className={labelCls}>{c.f.email}</label>
                <input
                  required
                  type="email"
                  data-testid="contact-email"
                  className={inputCls}
                  value={contactForm.email}
                  onChange={(e) =>
                    setContactForm({ ...contactForm, email: e.target.value })
                  }
                />
              </div>
              <div>
                <label className={labelCls}>{c.f.phone}</label>
                <input
                  data-testid="contact-phone-input"
                  className={inputCls}
                  value={contactForm.phone}
                  onChange={(e) =>
                    setContactForm({ ...contactForm, phone: e.target.value })
                  }
                />
              </div>
              <div>
                <label className={labelCls}>{c.f.subject}</label>
                <input
                  data-testid="contact-subject"
                  className={inputCls}
                  value={contactForm.subject}
                  onChange={(e) =>
                    setContactForm({ ...contactForm, subject: e.target.value })
                  }
                />
              </div>
              <div className="md:col-span-2">
                <label className={labelCls}>{c.f.message}</label>
                <textarea
                  required
                  rows={5}
                  data-testid="contact-message"
                  className={`${inputCls} resize-none`}
                  value={contactForm.message}
                  onChange={(e) =>
                    setContactForm({ ...contactForm, message: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="mt-6">
              <AccentButton
                type="submit"
                variant="solid"
                data-testid="contact-submit-btn"
                disabled={loading.contact}
              >
                {loading.contact ? c.f.sending : c.f.submit_contact}
              </AccentButton>
            </div>
          </form>

          {/* QUOTE FORM */}
          <form
            data-testid="quote-form"
            onSubmit={onSubmitQuote}
            className="border border-[#272A30] p-6 md:p-10 bg-[#1A1D24]/40"
          >
            <div className="flex items-center justify-between mb-6">
              <div className="font-mono text-[10px] text-[#FF5A00] tracking-[0.2em]">
                {c.quote_title}
              </div>
              <span className="font-mono text-[10px] text-[#A1A1AA]">02</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>{c.f.name}</label>
                <input
                  required
                  data-testid="quote-name"
                  className={inputCls}
                  value={quoteForm.name}
                  onChange={(e) =>
                    setQuoteForm({ ...quoteForm, name: e.target.value })
                  }
                />
              </div>
              <div>
                <label className={labelCls}>{c.f.company}</label>
                <input
                  data-testid="quote-company"
                  className={inputCls}
                  value={quoteForm.company}
                  onChange={(e) =>
                    setQuoteForm({ ...quoteForm, company: e.target.value })
                  }
                />
              </div>
              <div>
                <label className={labelCls}>{c.f.email}</label>
                <input
                  required
                  type="email"
                  data-testid="quote-email"
                  className={inputCls}
                  value={quoteForm.email}
                  onChange={(e) =>
                    setQuoteForm({ ...quoteForm, email: e.target.value })
                  }
                />
              </div>
              <div>
                <label className={labelCls}>{c.f.phone}</label>
                <input
                  required
                  data-testid="quote-phone"
                  className={inputCls}
                  value={quoteForm.phone}
                  onChange={(e) =>
                    setQuoteForm({ ...quoteForm, phone: e.target.value })
                  }
                />
              </div>
              <div>
                <label className={labelCls}>{c.f.origin}</label>
                <input
                  required
                  data-testid="quote-origin"
                  className={inputCls}
                  value={quoteForm.origin}
                  onChange={(e) =>
                    setQuoteForm({ ...quoteForm, origin: e.target.value })
                  }
                />
              </div>
              <div>
                <label className={labelCls}>{c.f.destination}</label>
                <input
                  required
                  data-testid="quote-destination"
                  className={inputCls}
                  value={quoteForm.destination}
                  onChange={(e) =>
                    setQuoteForm({ ...quoteForm, destination: e.target.value })
                  }
                />
              </div>
              <div>
                <label className={labelCls}>{c.f.service}</label>
                <select
                  data-testid="quote-service"
                  className={inputCls}
                  value={quoteForm.service_type}
                  onChange={(e) =>
                    setQuoteForm({ ...quoteForm, service_type: e.target.value })
                  }
                >
                  <option value="sea">Via Laut / Sea Freight</option>
                  <option value="land">Via Darat / Land Freight</option>
                  <option value="air">Via Udara / Air Freight</option>
                  <option value="additional">Layanan Tambahan</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>{c.f.cargo}</label>
                <input
                  data-testid="quote-cargo"
                  className={inputCls}
                  value={quoteForm.cargo_type}
                  onChange={(e) =>
                    setQuoteForm({ ...quoteForm, cargo_type: e.target.value })
                  }
                />
              </div>
              <div>
                <label className={labelCls}>{c.f.weight}</label>
                <input
                  data-testid="quote-weight"
                  placeholder="e.g. 500 kg"
                  className={inputCls}
                  value={quoteForm.weight}
                  onChange={(e) =>
                    setQuoteForm({ ...quoteForm, weight: e.target.value })
                  }
                />
              </div>
              <div>
                <label className={labelCls}>{c.f.dimensions}</label>
                <input
                  data-testid="quote-dimensions"
                  placeholder="LxWxH cm"
                  className={inputCls}
                  value={quoteForm.dimensions}
                  onChange={(e) =>
                    setQuoteForm({ ...quoteForm, dimensions: e.target.value })
                  }
                />
              </div>
              <div className="md:col-span-2">
                <label className={labelCls}>{c.f.notes}</label>
                <textarea
                  rows={4}
                  data-testid="quote-notes"
                  className={`${inputCls} resize-none`}
                  value={quoteForm.notes}
                  onChange={(e) =>
                    setQuoteForm({ ...quoteForm, notes: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <AccentButton
                type="submit"
                variant="solid"
                data-testid="quote-submit-btn"
                disabled={loading.quote}
              >
                {loading.quote ? c.f.sending : c.f.submit_quote}
              </AccentButton>
              <AccentButton
                href={WHATSAPP}
                target="_blank"
                rel="noreferrer"
                variant="outline"
                data-testid="quote-wa-btn"
              >
                {c.wa}
              </AccentButton>
            </div>
          </form>
        </div>
      </section>

      {/* Floating WA */}
      <a
        href={WHATSAPP}
        target="_blank"
        rel="noreferrer"
        data-testid="floating-wa"
        className="fixed bottom-6 right-6 z-40 bg-[#FF5A00] text-[#0F1115] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.14em] hover:bg-[#E04F00] transition-colors shadow-2xl"
      >
        WhatsApp →
      </a>
    </PageShell>
  );
}

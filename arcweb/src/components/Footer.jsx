import React from "react";
import { Link } from "react-router-dom";
import { useLang } from "@/lib/i18n";
import { motion } from "framer-motion";

export default function Footer() {
  const { t } = useLang();
  return (
    <footer
      data-testid="site-footer"
      className="border-t border-[#272A30] bg-[#0F1115]"
    >
      <div className="max-w-[1400px] mx-auto px-5 md:px-10 pt-16 md:pt-24 pb-8">
        <motion.h2
          initial={{ y: 40, opacity: 0 }}
          whileInView={{ y: 0, opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          className="font-display text-[16vw] md:text-[13vw] leading-[0.9] text-outline pb-8"
        >
          {t.footer.talk}
        </motion.h2>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 pt-10 border-t border-[#272A30]">
          <div className="md:col-span-5">
            <div className="font-mono text-[10px] text-[#A1A1AA] mb-3">
              {t.footer.about}
            </div>
            <p className="text-[#F4F4F5] text-sm md:text-base leading-relaxed max-w-md">
              {t.footer.about_body}
            </p>
            <div className="mt-6 flex items-center gap-2">
              <span className="w-2 h-2 bg-[#FF5A00]" />
              <span className="font-display text-lg">AR CARGO</span>
              <span className="font-mono text-[10px] text-[#A1A1AA]">
                / PT. ABIRAMA MITRA PRATAMA
              </span>
            </div>
          </div>

          <div className="md:col-span-3">
            <div className="font-mono text-[10px] text-[#A1A1AA] mb-3">
              {t.footer.quick}
            </div>
            <ul className="flex flex-col gap-2 text-sm">
              <li>
                <Link to="/" className="link-line" data-testid="ft-home">
                  {t.nav.home}
                </Link>
              </li>
              <li>
                <Link to="/services" className="link-line" data-testid="ft-services">
                  {t.nav.services}
                </Link>
              </li>
              <li>
                <Link to="/about" className="link-line" data-testid="ft-about">
                  {t.nav.about}
                </Link>
              </li>
              <li>
                <Link to="/gallery" className="link-line" data-testid="ft-gallery">
                  {t.nav.gallery}
                </Link>
              </li>
              <li>
                <Link to="/tracking" className="link-line" data-testid="ft-tracking">
                  {t.nav.tracking}
                </Link>
              </li>
              <li>
                <Link to="/contact" className="link-line" data-testid="ft-contact">
                  {t.nav.contact}
                </Link>
              </li>
            </ul>
          </div>

          <div className="md:col-span-4">
            <div className="font-mono text-[10px] text-[#A1A1AA] mb-3">
              {t.footer.contact}
            </div>
            <p className="text-[#F4F4F5] text-sm leading-relaxed">
              Ruko Grand Galaxy City Blok RSK 6 No. 73
              <br />
              Jaka Setia, Bekasi Selatan
            </p>
            <a
              href="tel:+622156928104"
              data-testid="ft-phone"
              className="mt-3 inline-block font-mono text-[13px] text-[#FF5A00] link-line"
            >
              +62 21 569 28104
            </a>
            <div className="mt-3">
              <a
                href="https://wa.me/622156928104"
                target="_blank"
                rel="noreferrer"
                data-testid="ft-whatsapp"
                className="inline-flex border border-[#272A30] hover:border-[#FF5A00] px-3 py-2 font-mono text-[11px]"
              >
                WhatsApp →
              </a>
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 text-[10px] font-mono text-[#A1A1AA]">
          <span>{t.footer.rights}</span>
          <span>
            LAT −6.2601 · LON 106.9887 · BEKASI
          </span>
        </div>
      </div>
    </footer>
  );
}

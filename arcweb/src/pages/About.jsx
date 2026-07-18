import React from "react";
import PageShell from "@/components/PageShell";
import { MaskLine, Reveal } from "@/components/Reveal";
import Ticker from "@/components/Ticker";
import { useLang } from "@/lib/i18n";
import { motion, useScroll, useTransform } from "framer-motion";

const IMG_EDITORIAL =
  "https://images.pexels.com/photos/262353/pexels-photo-262353.jpeg";
const IMG_PORT =
  "https://images.pexels.com/photos/32810636/pexels-photo-32810636.jpeg";

export default function About() {
  const { t } = useLang();
  const a = t.about;
  const { scrollY } = useScroll();
  const y1 = useTransform(scrollY, [0, 1200], ["0%", "20%"]);

  return (
    <PageShell>
      {/* HERO */}
      <section className="relative pt-32 md:pt-44 pb-16 md:pb-24 border-b border-[#272A30] overflow-hidden">
        <motion.div
          style={{ y: y1 }}
          className="absolute right-[-10%] top-[-10%] w-[60%] h-[120%] -z-10 opacity-40"
        >
          <img
            src={IMG_PORT}
            alt=""
            className="w-full h-full object-cover grayscale"
          />
        </motion.div>

        <div className="max-w-[1400px] mx-auto px-5 md:px-10">
          <div className="flex items-center gap-3 mb-6">
            <span className="w-8 h-px bg-[#FF5A00]" />
            <span className="font-mono text-[11px] tracking-[0.2em] text-[#A1A1AA] uppercase">
              {a.overline}
            </span>
          </div>
          <h1 className="font-display text-5xl md:text-[8.5vw] leading-[0.9] tracking-tight whitespace-nowrap">
            <div className="overflow-hidden">
              <MaskLine trigger="mount">{a.title_1}</MaskLine>
            </div>
            <div className="overflow-hidden">
              <MaskLine trigger="mount" delay={0.15}>
                <span className="text-[#FF5A00] font-editorial italic font-normal">
                  {a.title_2}
                </span>
              </MaskLine>
            </div>
          </h1>
        </div>
      </section>

      {/* LEAD */}
      <section className="border-b border-[#272A30]">
        <div className="max-w-[1400px] mx-auto px-5 md:px-10 py-20 md:py-32 grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-16">
          <div className="md:col-span-4">
            <div className="font-mono text-[10px] text-[#FF5A00] mb-4 tracking-[0.2em]">
              MANIFESTO
            </div>
          </div>
          <div className="md:col-span-8">
            <Reveal>
              <p className="font-editorial italic text-3xl md:text-5xl leading-[1.1] text-[#F4F4F5]">
                {a.lead}
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* CHAPTERS */}
      <section className="border-b border-[#272A30]">
        <div className="max-w-[1400px] mx-auto px-5 md:px-10 py-20 md:py-32">
          <div className="flex flex-col">
            {a.chapters.map((c, i) => (
              <motion.div
                key={c.n}
                data-testid={`chapter-${c.n}`}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                className="border-t border-[#272A30] py-10 md:py-14 grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-10 group hover:bg-[#1A1D24]/40 transition-colors"
              >
                <div className="md:col-span-2">
                  <span className="font-display text-6xl md:text-7xl text-[#FF5A00] leading-none">
                    {c.n}
                  </span>
                </div>
                <div className="md:col-span-5">
                  <h3 className="font-display text-3xl md:text-5xl leading-tight">
                    <MaskLine>{c.title}</MaskLine>
                  </h3>
                </div>
                <div className="md:col-span-5">
                  <p className="text-[#A1A1AA] leading-relaxed">{c.body}</p>
                </div>
              </motion.div>
            ))}
            <div className="border-t border-[#272A30]" />
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="border-b border-[#272A30]">
        <div className="grid grid-cols-2 md:grid-cols-4 border-t border-l border-[#272A30]">
          {a.stats.map((s, i) => (
            <motion.div
              key={s.k}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7, delay: i * 0.08 }}
              className="border-r border-b border-[#272A30] p-6 md:p-12 flex flex-col justify-between min-h-[220px] md:min-h-[280px]"
            >
              <div className="font-mono text-[10px] text-[#A1A1AA] tracking-[0.2em]">
                0{i + 1} / STAT
              </div>
              <div>
                <div className="font-display text-5xl md:text-7xl text-[#F4F4F5] leading-none">
                  {s.v}
                </div>
                <div className="mt-3 text-[#A1A1AA] font-mono text-[11px] uppercase tracking-[0.14em]">
                  {s.k}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* IMAGE + MARQUEE */}
      <section className="relative min-h-[420px] md:min-h-[600px] overflow-hidden border-b border-[#272A30]">
        <img
          src={IMG_EDITORIAL}
          alt="AR Cargo Editorial"
          className="absolute inset-0 w-full h-full object-cover grayscale-[35%]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0F1115] via-[#0F1115]/40 to-transparent" />
        <div className="relative max-w-[1400px] mx-auto px-5 md:px-10 h-full flex flex-col justify-end py-16 md:py-24 min-h-[420px] md:min-h-[600px]">
          <div className="font-mono text-[10px] text-[#F4F4F5]/80 mb-4">
            PLATE 07 · TANJUNG PRIOK · 04:48
          </div>
          <h2 className="font-display text-4xl md:text-7xl leading-[0.95] max-w-3xl">
            <MaskLine>Logistik adalah</MaskLine>{" "}
            <MaskLine delay={0.1}>
              <span className="text-[#FF5A00] font-editorial italic font-normal">
                seni ketepatan.
              </span>
            </MaskLine>
          </h2>
        </div>
      </section>

      <Ticker text={t.marquee} outline speed={26} />
    </PageShell>
  );
}

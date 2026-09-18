import React from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { Link } from "react-router-dom";
import PageShell from "@/components/PageShell";
import Ticker from "@/components/Ticker";
import AccentButton from "@/components/AccentButton";
import { MaskLine, Reveal } from "@/components/Reveal";
import { useLang } from "@/lib/i18n";

const HERO_IMG =
  "https://images.pexels.com/photos/32810636/pexels-photo-32810636.jpeg";
const SEA_IMG =
  "https://images.pexels.com/photos/32810636/pexels-photo-32810636.jpeg";
const LAND_IMG =
  "https://images.pexels.com/photos/27099095/pexels-photo-27099095.jpeg";
const AIR_IMG =
  "https://images.pexels.com/photos/11935282/pexels-photo-11935282.jpeg";
const EDITORIAL_IMG =
  "https://images.pexels.com/photos/262353/pexels-photo-262353.jpeg";

export default function Home() {
  const { t } = useLang();
  const { scrollY } = useScroll();
  const heroImgY = useTransform(scrollY, [0, 800], ["0%", "18%"]);
  const heroTextY = useTransform(scrollY, [0, 800], ["0%", "-8%"]);

  const services = t.services.items;

  return (
    <PageShell>
      {/* ---------- HERO ---------- */}
      <section
        data-testid="hero"
        className="relative h-[100vh] min-h-[720px] w-full overflow-hidden border-b border-[#272A30] isolate"
      >
        <motion.div
          style={{ y: heroImgY }}
          className="absolute inset-0 z-0"
        >
          <img
            src={HERO_IMG}
            alt="Cargo ship"
            className="w-full h-full object-cover grayscale-[40%] opacity-90"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0F1115] via-[#0F1115]/40 to-[#0F1115]/60" />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,#0F1115_0%,rgba(15,17,21,0.3)_35%,rgba(15,17,21,0.2)_65%,#0F1115_100%)]" />
        </motion.div>

        <div className="relative z-10 max-w-[1400px] mx-auto h-full px-5 md:px-10 pt-28 md:pt-32 flex flex-col justify-between">
          <motion.div
            style={{ y: heroTextY }}
            className="flex-1 flex flex-col justify-center"
          >
            <div className="flex items-center gap-3 mb-6 md:mb-8">
              <span className="w-8 h-px bg-[#FF5A00]" />
              <span className="font-mono text-[10px] md:text-[11px] tracking-[0.2em] text-[#A1A1AA] uppercase">
                {t.hero.overline}
              </span>
            </div>

            <h1 className="font-display text-[13vw] md:text-[8.5vw] leading-[0.9] tracking-[-0.04em] whitespace-nowrap">
              <div className="overflow-hidden">
                <MaskLine trigger="mount" delay={0.05}>{t.hero.title_1}</MaskLine>
              </div>
              <div className="overflow-hidden">
                <MaskLine trigger="mount" delay={0.15}>
                  <span className="text-[#FF5A00] font-editorial italic font-normal">
                    {t.hero.title_2}
                  </span>
                </MaskLine>
              </div>
              <div className="overflow-hidden">
                <MaskLine trigger="mount" delay={0.28}>{t.hero.title_3}</MaskLine>
              </div>
            </h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.9, duration: 0.9 }}
              className="mt-8 md:mt-10 max-w-xl text-[#A1A1AA] text-[15px] md:text-[17px] leading-relaxed"
            >
              {t.hero.sub}
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.1, duration: 0.9 }}
              className="mt-8 md:mt-10 flex flex-wrap items-center gap-4"
            >
              <AccentButton
                to="/tracking"
                variant="solid"
                size="lg"
                data-testid="hero-track-btn"
              >
                {t.hero.cta_primary}
              </AccentButton>
              <AccentButton
                to="/contact"
                variant="outline"
                size="lg"
                data-testid="hero-contact-btn"
              >
                {t.hero.cta_secondary}
              </AccentButton>
            </motion.div>
          </motion.div>

          {/* Manifest data block */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.3, duration: 0.9 }}
            className="pb-6 md:pb-10 border-t border-[#272A30] pt-6 grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-10 font-mono text-[10px]"
          >
            <div>
              <div className="text-[#A1A1AA] mb-1">{t.hero.manifest_label} /</div>
              <div className="text-[#FF5A00]">ARC—2026 · LIVE</div>
            </div>
            <div>
              <div className="text-[#A1A1AA] mb-1">{t.hero.base}</div>
              <div className="text-[#F4F4F5]">{t.hero.base_val}</div>
            </div>
            <div>
              <div className="text-[#A1A1AA] mb-1">{t.hero.network}</div>
              <div className="text-[#F4F4F5]">{t.hero.network_val}</div>
            </div>
            <div>
              <div className="text-[#A1A1AA] mb-1">{t.hero.lanes}</div>
              <div className="text-[#F4F4F5]">{t.hero.lanes_val}</div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ---------- MARQUEE ---------- */}
      <Ticker text={t.marquee} outline speed={30} />

      {/* ---------- SERVICES ---------- */}
      <section
        data-testid="services-section"
        className="relative border-b border-[#272A30]"
      >
        <div className="max-w-[1400px] mx-auto px-5 md:px-10 pt-20 md:pt-32 pb-8">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-10">
            <div className="md:col-span-4">
              <div className="font-mono text-[10px] tracking-[0.2em] text-[#FF5A00] mb-4">
                {t.services.overline}
              </div>
            </div>
            <div className="md:col-span-8">
              <h2 className="font-display text-4xl md:text-6xl lg:text-7xl leading-[1.02] tracking-tight">
                <MaskLine>{t.services.title}</MaskLine>
              </h2>
              <Reveal delay={0.15}>
                <p className="mt-6 text-[#A1A1AA] max-w-2xl leading-relaxed">
                  {t.services.sub}
                </p>
              </Reveal>
            </div>
          </div>
        </div>

        <div className="max-w-[1400px] mx-auto md:px-10 md:pb-24">
          <div className="grid grid-cols-1 md:grid-cols-2 border-t border-l border-[#272A30]">
            {services.map((s, i) => {
              const imgs = { sea: SEA_IMG, land: LAND_IMG, air: AIR_IMG, additional: EDITORIAL_IMG };
              return (
                <motion.article
                  key={s.k}
                  data-testid={`service-card-${s.k}`}
                  initial={{ opacity: 0, y: 40 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={{ duration: 0.9, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }}
                  className="group relative border-r border-b border-[#272A30] p-6 md:p-10 flex flex-col overflow-hidden"
                >
                  <div className="flex items-center justify-between font-mono text-[10px] text-[#A1A1AA] mb-4 md:mb-6">
                    <span>{s.num}</span>
                    <span>{s.en}</span>
                  </div>

                  <div className="relative aspect-[16/10] overflow-hidden mb-6 md:mb-8 border border-[#272A30]">
                    <img
                      src={imgs[s.k]}
                      alt={s.title}
                      className="w-full h-full object-cover grayscale group-hover:grayscale-0 group-hover:scale-105 transition-all duration-700"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0F1115] via-transparent to-transparent opacity-70" />
                    <div className="absolute top-3 left-3 flex gap-1.5">
                      {s.tags.map((tg) => (
                        <span
                          key={tg}
                          className="bg-[#0F1115]/90 border border-[#272A30] text-[9px] font-mono px-1.5 py-0.5"
                        >
                          {tg}
                        </span>
                      ))}
                    </div>
                  </div>

                  <h3 className="font-display text-3xl md:text-5xl leading-none mb-3">
                    {s.title}
                  </h3>
                  <p className="text-[#A1A1AA] text-sm md:text-base leading-relaxed">
                    {s.desc}
                  </p>

                  <div className="mt-6 flex items-center justify-between">
                    <Link
                      to="/services"
                      data-testid={`service-more-${s.k}`}
                      className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#FF5A00] link-line"
                    >
                      Detail →
                    </Link>
                    <span className="font-mono text-[10px] text-[#A1A1AA]">
                      0{i + 1}/04
                    </span>
                  </div>
                </motion.article>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---------- WHY US MANIFESTO ---------- */}
      <section
        data-testid="why-section"
        className="border-b border-[#272A30]"
      >
        <div className="max-w-[1400px] mx-auto px-5 md:px-10 pt-24 md:pt-36 pb-24 md:pb-36">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-10 mb-16 md:mb-24">
            <div className="md:col-span-4">
              <div className="font-mono text-[10px] tracking-[0.2em] text-[#FF5A00] mb-4">
                {t.why.overline}
              </div>
            </div>
            <div className="md:col-span-8">
              <h2 className="font-display text-5xl md:text-7xl lg:text-[7.5rem] leading-[0.95] tracking-tight">
                <MaskLine>{t.why.title}</MaskLine>
              </h2>
            </div>
          </div>

          <div className="flex flex-col gap-12 md:gap-20">
            {t.why.items.map((it, i) => (
              <motion.div
                key={it.id}
                data-testid={`why-item-${it.id}`}
                initial={{ opacity: 0, y: 60 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
                className={`grid grid-cols-1 md:grid-cols-12 gap-6 items-start ${
                  i % 2 === 1 ? "md:pl-24 lg:pl-48" : ""
                }`}
              >
                <div className="md:col-span-2">
                  <span className="font-display text-6xl md:text-8xl text-[#FF5A00] leading-none">
                    {it.id}
                  </span>
                </div>
                <div className="md:col-span-6">
                  <h3 className="font-display text-3xl md:text-5xl leading-tight mb-4">
                    {it.title}
                  </h3>
                </div>
                <div className="md:col-span-4">
                  <p className="text-[#A1A1AA] leading-relaxed text-[15px] md:text-base">
                    {it.desc}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- COVERAGE / EDITORIAL SPLIT ---------- */}
      <section
        data-testid="coverage-section"
        className="border-b border-[#272A30]"
      >
        <div className="grid grid-cols-1 md:grid-cols-12">
          <div className="md:col-span-6 relative min-h-[420px] md:min-h-[720px] overflow-hidden border-r border-[#272A30]">
            <motion.img
              initial={{ scale: 1.15 }}
              whileInView={{ scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 1.8, ease: [0.22, 1, 0.36, 1] }}
              src={EDITORIAL_IMG}
              alt="Coverage"
              className="absolute inset-0 w-full h-full object-cover grayscale-[40%]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0F1115] via-transparent to-transparent" />
            <div className="absolute bottom-6 left-6 right-6 font-mono text-[10px] text-[#F4F4F5]/80">
              PLATE 03 · JAKARTA PORT · 06:12 GMT+7
            </div>
          </div>

          <div className="md:col-span-6 p-6 md:p-16 flex flex-col justify-center">
            <div className="font-mono text-[10px] tracking-[0.2em] text-[#FF5A00] mb-4">
              {t.coverage.overline}
            </div>
            <h2 className="font-display text-4xl md:text-6xl leading-[1.02] tracking-tight mb-6">
              <MaskLine>{t.coverage.title}</MaskLine>
            </h2>
            <Reveal delay={0.15}>
              <p className="text-[#A1A1AA] max-w-lg leading-relaxed mb-10">
                {t.coverage.sub}
              </p>
            </Reveal>
            <div className="flex flex-wrap gap-2">
              {t.coverage.cities.map((c, i) => (
                <motion.span
                  key={c}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: i * 0.03 }}
                  className="border border-[#272A30] px-3 py-1.5 font-mono text-[11px] text-[#F4F4F5] hover:border-[#FF5A00] hover:text-[#FF5A00] transition-colors cursor-default"
                >
                  {c}
                </motion.span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---------- SECURITY ---------- */}
      <section
        data-testid="security-section"
        className="border-b border-[#272A30]"
      >
        <div className="max-w-[1400px] mx-auto px-5 md:px-10 py-24 md:py-36 grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-16">
          <div className="md:col-span-5">
            <div className="font-mono text-[10px] tracking-[0.2em] text-[#FF5A00] mb-4">
              {t.security.overline}
            </div>
            <h2 className="font-display text-4xl md:text-6xl leading-[1.02] tracking-tight">
              <MaskLine>{t.security.title}</MaskLine>
            </h2>
          </div>
          <div className="md:col-span-7">
            <Reveal delay={0.1}>
              <p className="text-[#A1A1AA] leading-relaxed mb-10 max-w-xl">
                {t.security.sub}
              </p>
            </Reveal>
            <ul className="divide-y divide-[#272A30] border-y border-[#272A30]">
              {t.security.points.map((p, i) => (
                <motion.li
                  key={i}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.7, delay: i * 0.08 }}
                  className="py-5 flex items-start gap-6 group"
                >
                  <span className="font-mono text-[10px] text-[#FF5A00] pt-1 min-w-[40px]">
                    0{i + 1}
                  </span>
                  <span className="text-[#F4F4F5] text-lg md:text-xl leading-snug flex-1">
                    {p}
                  </span>
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity font-mono text-[10px] text-[#A1A1AA]">
                    ▸
                  </span>
                </motion.li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ---------- TRUSTED BY ---------- */}
      <section
        data-testid="trust-section"
        className="border-b border-[#272A30]"
      >
        <div className="max-w-[1400px] mx-auto px-5 md:px-10 pt-20 md:pt-28 pb-16 md:pb-20">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-10 mb-12 md:mb-16">
            <div className="md:col-span-4">
              <div className="font-mono text-[10px] tracking-[0.2em] text-[#FF5A00] mb-4">
                {t.trust.overline}
              </div>
            </div>
            <div className="md:col-span-8">
              <h2 className="font-display text-3xl md:text-5xl leading-[1.05] tracking-tight max-w-2xl">
                <MaskLine>{t.trust.title}</MaskLine>
              </h2>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 border-t border-l border-[#272A30]">
            {[
              "HMNS",
              "JPC",
              "HME",
              "BIPMed",
              "GOKOMOFO",
              "FRANKLIN",
              "LOGOS",
            ].map((c) => (
              <div
                key={c}
                className="aspect-[3/2] border-r border-b border-[#272A30] flex items-center justify-center text-[#A1A1AA] hover:text-[#FF5A00] transition-colors font-display text-lg md:text-xl tracking-widest"
              >
                {c}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- CTA ---------- */}
      <section className="border-b border-[#272A30]">
        <div className="max-w-[1400px] mx-auto px-5 md:px-10 py-24 md:py-32 grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-10 items-end">
          <div className="md:col-span-8">
            <h2 className="font-display text-5xl md:text-8xl leading-[0.95] tracking-tight">
              <MaskLine>
                {t.cta.title}{" "}
                <span className="text-[#FF5A00] font-editorial italic font-normal">
                  →
                </span>
              </MaskLine>
            </h2>
            <Reveal delay={0.15}>
              <p className="mt-6 max-w-lg text-[#A1A1AA]">{t.cta.sub}</p>
            </Reveal>
          </div>
          <div className="md:col-span-4 flex flex-col gap-3">
            <AccentButton
              to="/contact"
              variant="solid"
              size="lg"
              data-testid="cta-quote-btn"
            >
              {t.cta.quote}
            </AccentButton>
            <AccentButton
              href="https://wa.me/622156928104"
              target="_blank"
              rel="noreferrer"
              variant="outline"
              size="lg"
              data-testid="cta-wa-btn"
            >
              {t.cta.whatsapp}
            </AccentButton>
          </div>
        </div>
      </section>
    </PageShell>
  );
}

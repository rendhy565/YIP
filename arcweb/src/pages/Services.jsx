import React from "react";
import PageShell from "@/components/PageShell";
import { MaskLine, Reveal } from "@/components/Reveal";
import AccentButton from "@/components/AccentButton";
import { useLang } from "@/lib/i18n";
import { motion } from "framer-motion";

const IMG_SEA =
  "https://images.pexels.com/photos/32810636/pexels-photo-32810636.jpeg";
const IMG_LAND =
  "https://images.pexels.com/photos/27099095/pexels-photo-27099095.jpeg";
const IMG_AIR =
  "https://images.pexels.com/photos/11935282/pexels-photo-11935282.jpeg";
const IMG_ADD =
  "https://images.pexels.com/photos/262353/pexels-photo-262353.jpeg";

export default function Services() {
  const { t } = useLang();
  const s = t.services_page;
  const items = t.services.items;
  const imgs = { sea: IMG_SEA, land: IMG_LAND, air: IMG_AIR, additional: IMG_ADD };

  return (
    <PageShell>
      <section className="pt-32 md:pt-44 pb-16 md:pb-24 border-b border-[#272A30]">
        <div className="max-w-[1400px] mx-auto px-5 md:px-10">
          <div className="flex items-center gap-3 mb-6">
            <span className="w-8 h-px bg-[#FF5A00]" />
            <span className="font-mono text-[11px] tracking-[0.2em] text-[#A1A1AA] uppercase">
              {s.overline}
            </span>
          </div>
          <h1 className="font-display text-5xl md:text-[8.5vw] leading-[0.9] tracking-tight whitespace-nowrap">
            <div className="overflow-hidden">
              <MaskLine trigger="mount">{s.title_1}</MaskLine>
            </div>
            <div className="overflow-hidden">
              <MaskLine trigger="mount" delay={0.12}>
                <span className="text-[#FF5A00] font-editorial italic font-normal">
                  {s.title_2}
                </span>
              </MaskLine>
            </div>
          </h1>
          <Reveal delay={0.35}>
            <p className="mt-8 max-w-2xl text-[#A1A1AA] text-lg leading-relaxed">
              {s.lead}
            </p>
          </Reveal>
        </div>
      </section>

      {items.map((it, i) => (
        <section
          key={it.k}
          data-testid={`service-detail-${it.k}`}
          className="border-b border-[#272A30]"
        >
          <div
            className={`max-w-[1400px] mx-auto grid grid-cols-1 md:grid-cols-12 gap-0 ${
              i % 2 === 1 ? "md:[&>*:first-child]:order-2" : ""
            }`}
          >
            <div className="md:col-span-6 relative min-h-[360px] md:min-h-[600px] overflow-hidden border-r border-[#272A30]">
              <motion.img
                initial={{ scale: 1.15 }}
                whileInView={{ scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }}
                src={imgs[it.k]}
                alt={it.title}
                className="absolute inset-0 w-full h-full object-cover grayscale-[30%]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0F1115] via-transparent to-transparent" />
              <div className="absolute top-6 left-6 font-mono text-[10px] text-[#F4F4F5]/80">
                {it.num} · {it.en.toUpperCase()}
              </div>
              <div className="absolute bottom-6 left-6 font-display text-4xl md:text-6xl text-[#F4F4F5]/80">
                0{i + 1}
              </div>
            </div>

            <div className="md:col-span-6 p-6 md:p-16 flex flex-col justify-center">
              <div className="font-mono text-[10px] text-[#FF5A00] mb-4 tracking-[0.2em]">
                {it.num}
              </div>
              <h2 className="font-display text-4xl md:text-6xl leading-[1.02] tracking-tight mb-4">
                <MaskLine>{it.title}</MaskLine>
              </h2>
              <Reveal delay={0.12}>
                <p className="text-[#A1A1AA] leading-relaxed mb-8 max-w-lg">
                  {it.desc}
                </p>
              </Reveal>

              <ul className="divide-y divide-[#272A30] border-y border-[#272A30] mb-10">
                {s.details[it.k].map((d, k) => (
                  <motion.li
                    key={k}
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6, delay: k * 0.06 }}
                    className="py-4 flex gap-4 items-start"
                  >
                    <span className="font-mono text-[10px] text-[#FF5A00] pt-1">
                      0{k + 1}
                    </span>
                    <span className="text-[#F4F4F5] text-base md:text-lg leading-snug">
                      {d}
                    </span>
                  </motion.li>
                ))}
              </ul>

              <div className="flex flex-wrap gap-2 mb-8">
                {it.tags.map((tg) => (
                  <span
                    key={tg}
                    className="border border-[#272A30] px-3 py-1.5 font-mono text-[10px] text-[#A1A1AA]"
                  >
                    {tg}
                  </span>
                ))}
              </div>

              <AccentButton
                to="/contact"
                variant="outline"
                data-testid={`service-detail-cta-${it.k}`}
              >
                {t.cta.quote}
              </AccentButton>
            </div>
          </div>
        </section>
      ))}
    </PageShell>
  );
}

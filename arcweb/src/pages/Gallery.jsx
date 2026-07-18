import React from "react";
import PageShell from "@/components/PageShell";
import { MaskLine, Reveal } from "@/components/Reveal";
import { useLang } from "@/lib/i18n";
import { motion } from "framer-motion";

const GALLERY_IMAGES = [
  {
    src: "https://images.pexels.com/photos/32810636/pexels-photo-32810636.jpeg",
    caption: "Container Ship / South China Sea",
    tag: "SEA",
    tall: true,
  },
  {
    src: "https://images.pexels.com/photos/27099095/pexels-photo-27099095.jpeg",
    caption: "Freight Truck / Trans-Java Highway",
    tag: "LAND",
    tall: false,
  },
  {
    src: "https://images.pexels.com/photos/11935282/pexels-photo-11935282.jpeg",
    caption: "Air Freighter / Departing SUB",
    tag: "AIR",
    tall: false,
  },
  {
    src: "https://images.pexels.com/photos/262353/pexels-photo-262353.jpeg",
    caption: "Sunset Port / Tanjung Priok",
    tag: "EDITORIAL",
    tall: true,
  },
  {
    src: "https://images.pexels.com/photos/1427541/pexels-photo-1427541.jpeg",
    caption: "Warehouse Operation / Bekasi",
    tag: "WAREHOUSE",
    tall: false,
  },
  {
    src: "https://images.pexels.com/photos/1427107/pexels-photo-1427107.jpeg",
    caption: "Container Yard / Batam",
    tag: "SEA",
    tall: true,
  },
  {
    src: "https://images.pexels.com/photos/1427541/pexels-photo-1427541.jpeg",
    caption: "Loading Dock / Jakarta",
    tag: "OPERATION",
    tall: false,
  },
  {
    src: "https://images.pexels.com/photos/906982/pexels-photo-906982.jpeg",
    caption: "Highway Fleet / Sumatra",
    tag: "LAND",
    tall: false,
  },
];

export default function Gallery() {
  const { t } = useLang();
  const g = t.gallery;
  return (
    <PageShell>
      <section className="pt-32 md:pt-44 pb-16 md:pb-20 border-b border-[#272A30]">
        <div className="max-w-[1400px] mx-auto px-5 md:px-10">
          <div className="flex items-center gap-3 mb-6">
            <span className="w-8 h-px bg-[#FF5A00]" />
            <span className="font-mono text-[11px] tracking-[0.2em] text-[#A1A1AA] uppercase">
              {g.overline}
            </span>
          </div>
          <h1 className="font-display text-5xl md:text-[8.5vw] leading-[0.9] tracking-tight whitespace-nowrap">
            <div className="overflow-hidden">
              <MaskLine trigger="mount">{g.title_1}</MaskLine>
            </div>
            <div className="overflow-hidden">
              <MaskLine trigger="mount" delay={0.12}>
                <span className="text-[#FF5A00] font-editorial italic font-normal">
                  {g.title_2}
                </span>
              </MaskLine>
            </div>
          </h1>
          <Reveal delay={0.35}>
            <p className="mt-8 max-w-2xl text-[#A1A1AA] text-lg leading-relaxed">
              {g.lead}
            </p>
          </Reveal>
        </div>
      </section>

      <section className="border-b border-[#272A30]">
        <div className="max-w-[1400px] mx-auto px-5 md:px-10 py-16 md:py-24">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
            {GALLERY_IMAGES.map((img, i) => (
              <motion.figure
                key={i}
                data-testid={`gallery-item-${i}`}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.15 }}
                transition={{
                  duration: 0.9,
                  delay: (i % 3) * 0.08,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className={`group relative overflow-hidden border border-[#272A30] ${
                  img.tall ? "md:row-span-2 md:aspect-[3/5]" : "aspect-[4/3]"
                }`}
              >
                <img
                  src={img.src}
                  alt={img.caption}
                  className="w-full h-full object-cover grayscale-[30%] group-hover:grayscale-0 group-hover:scale-105 transition-all duration-700"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0F1115] via-transparent to-transparent opacity-70 pointer-events-none" />
                <div className="absolute top-4 left-4 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-[#FF5A00]" />
                  <span className="font-mono text-[9px] text-[#F4F4F5] bg-[#0F1115]/80 px-1.5 py-0.5">
                    {img.tag}
                  </span>
                </div>
                <figcaption className="absolute bottom-0 left-0 right-0 p-4 font-mono text-[10px] text-[#F4F4F5] flex items-center justify-between">
                  <span>{img.caption}</span>
                  <span className="text-[#A1A1AA]">
                    {String(i + 1).padStart(2, "0")}/
                    {String(GALLERY_IMAGES.length).padStart(2, "0")}
                  </span>
                </figcaption>
              </motion.figure>
            ))}
          </div>
        </div>
      </section>
    </PageShell>
  );
}

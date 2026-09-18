import React from "react";
import Marquee from "react-fast-marquee";

export default function Ticker({ text, speed = 40, outline = false }) {
  const items = new Array(6).fill(text);
  return (
    <div className="marquee-mask border-y border-[#272A30] py-6 md:py-8 bg-[#0F1115]">
      <Marquee gradient={false} speed={speed} pauseOnHover={false}>
        {items.map((t, i) => (
          <span
            key={i}
            className={`font-display text-[14vw] md:text-[9vw] leading-none mx-6 ${
              outline ? "text-outline" : "text-[#F4F4F5]"
            }`}
          >
            {t}
            <span className="text-[#FF5A00]"> ★ </span>
          </span>
        ))}
      </Marquee>
    </div>
  );
}

import React from "react";
import { motion } from "framer-motion";

export function Reveal({
  children,
  delay = 0,
  y = 40,
  duration = 0.9,
  className = "",
  as: Comp = "div",
  once = true,
  amount = 0.2,
}) {
  return (
    <motion.div
      initial={{ y, opacity: 0 }}
      whileInView={{ y: 0, opacity: 1 }}
      viewport={{ once, amount }}
      transition={{ duration, ease: [0.22, 1, 0.36, 1], delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function MaskLine({
  children,
  delay = 0,
  duration = 1.0,
  className = "",
  trigger = "inView", // 'mount' or 'inView'
}) {
  const motionProps =
    trigger === "mount"
      ? {
          initial: { y: "100%" },
          animate: { y: "0%" },
        }
      : {
          initial: { y: "100%" },
          whileInView: { y: "0%" },
          viewport: { once: true, margin: "-10% 0px -10% 0px" },
        };
  return (
    <span className={`mask-hidden ${className}`}>
      <motion.span
        {...motionProps}
        transition={{
          duration,
          ease: [0.83, 0, 0.17, 1],
          delay,
        }}
        className="inline-block will-change-transform"
      >
        {children}
      </motion.span>
    </span>
  );
}

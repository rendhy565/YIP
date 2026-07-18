// Shared framer-motion variants
export const fadeUp = {
  hidden: { opacity: 0, y: 40 },
  show: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.9,
      ease: [0.22, 1, 0.36, 1],
      delay: i * 0.06,
    },
  }),
};

export const stagger = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.08, delayChildren: 0.1 },
  },
};

export const maskUp = {
  hidden: { y: "110%" },
  show: (i = 0) => ({
    y: "0%",
    transition: {
      duration: 1.0,
      ease: [0.83, 0, 0.17, 1],
      delay: 0.1 + i * 0.09,
    },
  }),
};

export const inViewOnce = {
  initial: "hidden",
  whileInView: "show",
  viewport: { once: true, amount: 0.2 },
};

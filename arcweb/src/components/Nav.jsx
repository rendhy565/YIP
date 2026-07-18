import React, { useState, useEffect } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X } from "lucide-react";
import { useLang } from "@/lib/i18n";

export default function Nav() {
  const { lang, setLang, t } = useLang();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const links = [
    { to: "/", label: t.nav.home, id: "home" },
    { to: "/services", label: t.nav.services, id: "services" },
    { to: "/about", label: t.nav.about, id: "about" },
    { to: "/gallery", label: t.nav.gallery, id: "gallery" },
    { to: "/tracking", label: t.nav.tracking, id: "tracking" },
    { to: "/contact", label: t.nav.contact, id: "contact" },
  ];

  return (
    <>
      <header
        data-testid="site-nav"
        className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${
          scrolled
            ? "backdrop-blur-xl bg-[#0F1115]/70 border-b border-[#272A30]"
            : "bg-transparent"
        }`}
      >
        <div className="max-w-[1400px] mx-auto flex items-center justify-between px-5 md:px-10 h-16 md:h-20">
          <Link
            to="/"
            data-testid="nav-logo"
            className="flex items-center gap-2 group"
          >
            <span className="w-2 h-2 bg-[#FF5A00] block group-hover:scale-125 transition-transform" />
            <span className="font-display text-[15px] md:text-[17px] tracking-tight">
              AR CARGO
            </span>
            <span className="font-mono text-[10px] text-[#A1A1AA] hidden md:inline">
              / EST. 2020
            </span>
          </Link>

          <nav className="hidden lg:flex items-center gap-8">
            {links.map((l) => (
              <NavLink
                key={l.id}
                to={l.to}
                data-testid={`nav-${l.id}-link`}
                className={({ isActive }) =>
                  `font-mono text-[11px] uppercase tracking-[0.14em] link-line ${
                    isActive ? "text-[#FF5A00]" : "text-[#F4F4F5]"
                  }`
                }
                end={l.to === "/"}
              >
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <div
              data-testid="lang-toggle"
              className="hidden md:flex items-center border border-[#272A30] font-mono text-[11px]"
            >
              <button
                data-testid="lang-id-btn"
                onClick={() => setLang("id")}
                className={`px-2.5 py-1.5 transition-colors ${
                  lang === "id"
                    ? "bg-[#FF5A00] text-[#0F1115]"
                    : "text-[#A1A1AA] hover:text-[#F4F4F5]"
                }`}
              >
                ID
              </button>
              <button
                data-testid="lang-en-btn"
                onClick={() => setLang("en")}
                className={`px-2.5 py-1.5 transition-colors ${
                  lang === "en"
                    ? "bg-[#FF5A00] text-[#0F1115]"
                    : "text-[#A1A1AA] hover:text-[#F4F4F5]"
                }`}
              >
                EN
              </button>
            </div>

            <Link
              to="/contact"
              data-testid="nav-cta-btn"
              className="hidden md:inline-flex items-center gap-2 border border-[#FF5A00] text-[#FF5A00] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] hover:bg-[#FF5A00] hover:text-[#0F1115] transition-colors"
            >
              [ {t.nav.cta} ]
            </Link>

            <button
              data-testid="mobile-menu-btn"
              onClick={() => setOpen((o) => !o)}
              className="lg:hidden p-2 border border-[#272A30]"
              aria-label="menu"
            >
              {open ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {open && (
          <motion.div
            data-testid="mobile-menu"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 top-16 z-40 bg-[#0F1115] lg:hidden"
          >
            <div className="p-6 flex flex-col gap-1">
              {links.map((l, i) => (
                <NavLink
                  key={l.id}
                  to={l.to}
                  data-testid={`mnav-${l.id}-link`}
                  end={l.to === "/"}
                  className={({ isActive }) =>
                    `border-b border-[#272A30] py-5 font-display text-3xl ${
                      isActive ? "text-[#FF5A00]" : "text-[#F4F4F5]"
                    }`
                  }
                >
                  <span className="font-mono text-[10px] text-[#A1A1AA] mr-3">
                    0{i + 1}
                  </span>
                  {l.label}
                </NavLink>
              ))}

              <div className="mt-6 flex items-center gap-3">
                <div className="flex items-center border border-[#272A30] font-mono text-[11px]">
                  <button
                    data-testid="mlang-id-btn"
                    onClick={() => setLang("id")}
                    className={`px-3 py-2 ${
                      lang === "id"
                        ? "bg-[#FF5A00] text-[#0F1115]"
                        : "text-[#A1A1AA]"
                    }`}
                  >
                    ID
                  </button>
                  <button
                    data-testid="mlang-en-btn"
                    onClick={() => setLang("en")}
                    className={`px-3 py-2 ${
                      lang === "en"
                        ? "bg-[#FF5A00] text-[#0F1115]"
                        : "text-[#A1A1AA]"
                    }`}
                  >
                    EN
                  </button>
                </div>
                <Link
                  to="/contact"
                  data-testid="mnav-cta-btn"
                  className="border border-[#FF5A00] text-[#FF5A00] px-4 py-2 font-mono text-[11px]"
                >
                  [ {t.nav.cta} ]
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

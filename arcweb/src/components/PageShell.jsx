import React, { useEffect } from "react";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import useLenis from "@/lib/useLenis";
import { useLocation } from "react-router-dom";

export default function PageShell({ children }) {
  useLenis();
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [pathname]);

  return (
    <div className="relative min-h-screen bg-[#0F1115] text-[#F4F4F5]">
      <div className="grain-overlay" aria-hidden />
      <Nav />
      <main data-testid="page-main" className="relative">
        {children}
      </main>
      <Footer />
    </div>
  );
}

import React from "react";
import { HashRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import "@/App.css";
import { LangProvider } from "@/lib/i18n";
import Home from "@/pages/Home";
import Services from "@/pages/Services";
import About from "@/pages/About";
import Gallery from "@/pages/Gallery";
import Contact from "@/pages/Contact";
import Tracking from "@/pages/Tracking";

function App() {
  return (
    <div className="App">
      <LangProvider>
        <HashRouter>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/services" element={<Services />} />
            <Route path="/about" element={<About />} />
            <Route path="/gallery" element={<Gallery />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/tracking" element={<Tracking />} />
          </Routes>
        </HashRouter>
        <Toaster
          position="bottom-right"
          theme="dark"
          toastOptions={{
            style: {
              background: "#1A1D24",
              border: "1px solid #272A30",
              color: "#F4F4F5",
              borderRadius: "0px",
              fontFamily: "IBM Plex Sans, sans-serif",
            },
          }}
        />
      </LangProvider>
    </div>
  );
}

export default App;

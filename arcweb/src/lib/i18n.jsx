import React, { createContext, useContext, useEffect, useState } from "react";

const dict = {
  id: {
    nav: {
      home: "Beranda",
      services: "Layanan",
      about: "Tentang",
      gallery: "Galeri",
      contact: "Kontak",
      tracking: "Lacak",
      cta: "Minta Penawaran",
    },
    hero: {
      overline: "PT. ABIRAMA MITRA PRATAMA — Sejak 2020",
      title_1: "Logistik",
      title_2: "presisi tinggi,",
      title_3: "tanpa kompromi.",
      sub: "Solusi kargo laut, darat & udara untuk industri yang menuntut kecepatan, keamanan, dan keandalan — dari Bekasi ke seluruh dunia.",
      cta_primary: "Lacak Kiriman",
      cta_secondary: "Hubungi Kami",
      manifest_label: "MANIFEST",
      base: "BASIS OPERASI",
      base_val: "Bekasi, Indonesia",
      network: "JARINGAN",
      network_val: "Domestik + Global",
      lanes: "MODA",
      lanes_val: "Laut · Darat · Udara",
    },
    marquee: "AR CARGO — LOGISTIK PRESISI — SEJAK 2020 — LAUT · DARAT · UDARA — ",
    services: {
      overline: "01 / LAYANAN",
      title: "Empat pilar operasi kami.",
      sub: "Kami menangani seluruh rantai pengiriman — dari pickup hingga last-mile — dengan penanganan khusus untuk setiap kategori kargo.",
      items: [
        {
          k: "sea",
          num: "SVC-01",
          title: "Via Laut",
          en: "Sea Freight",
          desc:
            "Layanan kargo laut skala global. FCL, LCL, dan project cargo dengan konsolidasi terjadwal di pelabuhan utama Indonesia dan Asia.",
          tags: ["FCL", "LCL", "PROJECT", "REEFER"],
        },
        {
          k: "land",
          num: "SVC-02",
          title: "Via Darat",
          en: "Land Freight",
          desc:
            "Distribusi domestik lintas kota dengan armada modern. Real-time tracking, penjadwalan fleksibel, dan penanganan barang khusus.",
          tags: ["TRUCKING", "FTL", "LTL", "EXPRESS"],
        },
        {
          k: "air",
          num: "SVC-03",
          title: "Via Udara",
          en: "Air Freight",
          desc:
            "Pengiriman udara prioritas untuk kargo time-critical. General cargo, DG, perishable, dan charter atas permintaan.",
          tags: ["PRIORITY", "DG", "PERISHABLE", "CHARTER"],
        },
        {
          k: "additional",
          num: "SVC-04",
          title: "Layanan Tambahan",
          en: "Additional Services",
          desc:
            "Customs clearance, pergudangan, packing, fumigasi, asuransi kargo & konsultasi rantai pasok — satu pintu, satu tim.",
          tags: ["CUSTOMS", "WAREHOUSE", "INSURANCE", "PACKING"],
        },
      ],
    },
    why: {
      overline: "02 / MANIFESTO",
      title: "Mengapa AR Cargo.",
      items: [
        {
          id: "01",
          title: "Fast Delivery",
          desc:
            "Kecepatan bukan bonus — itu janji. Setiap rute dirancang agar barang tiba tepat waktu, di mana pun tujuannya.",
        },
        {
          id: "02",
          title: "Special Handling",
          desc:
            "Kami menangani kargo yang tidak bisa ditangani sembarang orang. Peralatan berat, fragile, DG, hingga temperature-controlled.",
        },
        {
          id: "03",
          title: "Cost Efficiency",
          desc:
            "Konsolidasi cerdas dan rute optimal — biaya turun tanpa mengorbankan kecepatan dan keamanan.",
        },
      ],
    },
    coverage: {
      overline: "03 / JANGKAUAN",
      title: "Dari Bekasi, menjangkau dunia.",
      sub:
        "Kami mengoperasikan jaringan multimodal yang menghubungkan pelabuhan, bandara, dan pusat distribusi utama — didukung mitra global tepercaya.",
      cities: [
        "Jakarta", "Surabaya", "Semarang", "Medan", "Makassar",
        "Denpasar", "Balikpapan", "Palembang", "Batam", "Pontianak",
        "Singapore", "Shanghai", "Hong Kong", "Manila", "Kuala Lumpur",
      ],
    },
    security: {
      overline: "04 / PENGAMANAN",
      title: "Setiap kargo dijaga seperti milik sendiri.",
      sub:
        "Prosedur handling, pengemasan, dan monitoring dirancang untuk meminimalkan risiko — dari titik jemput hingga tangan penerima.",
      points: [
        "Real-time GPS tracking di seluruh armada domestik",
        "Prosedur sealing & documentation bertingkat",
        "Asuransi kargo all-risk tersedia untuk semua rute",
        "Tim QC berpengalaman menangani DG, fragile, dan project cargo",
      ],
    },
    trust: {
      overline: "05 / DIPERCAYA",
      title: "Dipilih oleh perusahaan yang menuntut standar tinggi.",
    },
    cta: {
      title: "Siap kirim?",
      sub: "Bicara langsung dengan tim kami dan dapatkan penawaran dalam 24 jam.",
      quote: "Minta Penawaran",
      whatsapp: "WhatsApp Kami",
    },
    footer: {
      talk: "MARI BICARA.",
      quick: "TAUTAN CEPAT",
      contact: "KONTAK",
      about: "TENTANG",
      about_body:
        "PT. ABIRAMA MITRA PRATAMA (AR CARGO) adalah solusi terpercaya di industri kargo & logistik. Fokus kami: kecepatan, keamanan, dan keandalan.",
      rights: "© 2026 AR Cargo. Semua hak dilindungi.",
    },
    about: {
      overline: "TENTANG KAMI",
      title_1: "Kami memindahkan",
      title_2: "yang penting.",
      lead:
        "PT. ABIRAMA MITRA PRATAMA — dikenal sebagai AR CARGO — hadir sebagai solusi terpercaya di industri kargo dan logistik. Dengan fokus pada kecepatan, keamanan, dan keandalan, kami menyediakan layanan pengiriman yang efisien dan inovatif untuk pelanggan di seluruh Indonesia dan dunia.",
      chapters: [
        {
          n: "01",
          title: "Presisi sebagai standar",
          body:
            "Setiap kiriman diperlakukan sebagai satu-satunya. Prosedur, dokumentasi, dan handling kami dirancang agar akurasi menjadi default, bukan pengecualian.",
        },
        {
          n: "02",
          title: "Manusia di setiap sambungan",
          body:
            "Teknologi mempercepat, tetapi manusia yang menjamin. Tim kami tersedia 24/7 untuk memastikan komunikasi tidak pernah putus.",
        },
        {
          n: "03",
          title: "Jaringan lintas moda",
          body:
            "Laut, darat, udara — dan sambungan customs yang mulus. Kami menyusun rute yang bekerja untuk kargo Anda, bukan yang paling mudah bagi kami.",
        },
        {
          n: "04",
          title: "Bertumbuh bersama klien",
          body:
            "Dari UMKM hingga korporasi. Kami menyesuaikan skala, prosedur, dan biaya agar layanan tetap relevan sepanjang perjalanan bisnis Anda.",
        },
      ],
      stats: [
        { k: "Tahun Beroperasi", v: "5+" },
        { k: "Kota Terhubung", v: "60+" },
        { k: "Klien Aktif", v: "120+" },
        { k: "Kiriman / Bulan", v: "1.2K+" },
      ],
    },
    services_page: {
      overline: "LAYANAN LENGKAP",
      title_1: "Empat pilar,",
      title_2: "satu operasi.",
      lead:
        "Portofolio layanan lengkap yang mencakup seluruh rantai logistik — dirancang modular agar bisa disesuaikan dengan kebutuhan bisnis Anda.",
      details: {
        sea: [
          "FCL & LCL dengan konsolidasi mingguan",
          "Project cargo & heavy lift",
          "Reefer container untuk cold chain",
          "Dokumen pelabuhan lengkap (B/L, SI, ekspor/impor)",
        ],
        land: [
          "FTL & LTL antar kota di Indonesia",
          "Armada box, wingbox, flatbed, hingga tronton",
          "Layanan same-day & next-day untuk Jabodetabek",
          "Kawalan khusus untuk kargo bernilai tinggi",
        ],
        air: [
          "General cargo & express",
          "Dangerous Goods (DG) tersertifikasi",
          "Perishable & pharma cold chain",
          "Charter flight atas permintaan",
        ],
        additional: [
          "Customs clearance (impor & ekspor)",
          "Pergudangan & bonded warehouse",
          "Packing, crating & fumigasi",
          "Asuransi kargo all-risk",
        ],
      },
    },
    gallery: {
      overline: "GALERI",
      title_1: "Fragment",
      title_2: "operasi kami.",
      lead:
        "Kilasan dari lapangan — pelabuhan, gudang, armada, dan momen ketika logistik menjadi seni.",
    },
    contact_page: {
      overline: "KONTAK",
      title_1: "Mari mulai",
      title_2: "percakapan.",
      lead:
        "Kirim detail kebutuhan Anda, atau langsung WhatsApp tim kami. Kami merespons dalam waktu kerja.",
      form_title: "KIRIM PESAN",
      quote_title: "MINTA PENAWARAN",
      f: {
        name: "Nama",
        email: "Email",
        phone: "No. Telepon",
        subject: "Subjek",
        message: "Pesan",
        company: "Perusahaan",
        origin: "Asal",
        destination: "Tujuan",
        service: "Jenis Layanan",
        cargo: "Jenis Kargo",
        weight: "Berat",
        dimensions: "Dimensi",
        notes: "Catatan",
        submit_contact: "Kirim Pesan",
        submit_quote: "Minta Penawaran",
        sending: "Mengirim…",
        sent: "Terkirim. Kami akan menghubungi Anda segera.",
      },
      addr_title: "ALAMAT",
      addr:
        "Ruko Grand Galaxy City Blok RSK 6 No. 73, Jaka Setia, Bekasi Selatan",
      phone: "+62 21 569 28104",
      wa: "WhatsApp",
      hours_title: "JAM OPERASIONAL",
      hours: "Senin – Jumat, 09:00 – 18:00 WIB",
    },
    tracking_page: {
      overline: "LACAK KIRIMAN",
      title_1: "Di mana",
      title_2: "kargo Anda?",
      lead:
        "Masukkan Kode Perusahaan Anda. Sistem kami akan menampilkan seluruh daftar shipment aktif beserta status pengirimannya.",
      placeholder: "Contoh: ARC-XXXXX",
      cta: "Lacak",
      tracking_number: "KODE PERUSAHAAN",
      status: "STATUS",
      service: "MODA",
      route: "RUTE",
      eta: "ETA",
      history: "RIWAYAT PERJALANAN",
      no_result: "Kode perusahaan tidak ditemukan. Periksa kembali atau hubungi tim kami.",
      loading: "Mencari data kiriman…",
      demo: "",
    },
  },
  en: {
    nav: {
      home: "Home",
      services: "Services",
      about: "About",
      gallery: "Gallery",
      contact: "Contact",
      tracking: "Track",
      cta: "Request Quote",
    },
    hero: {
      overline: "PT. ABIRAMA MITRA PRATAMA — Since 2020",
      title_1: "High-precision",
      title_2: "logistics,",
      title_3: "no compromise.",
      sub: "Sea, land & air freight for industries that demand speed, security, and reliability — from Bekasi to the world.",
      cta_primary: "Track Shipment",
      cta_secondary: "Contact Us",
      manifest_label: "MANIFEST",
      base: "BASE OF OPERATIONS",
      base_val: "Bekasi, Indonesia",
      network: "NETWORK",
      network_val: "Domestic + Global",
      lanes: "LANES",
      lanes_val: "Sea · Land · Air",
    },
    marquee: "AR CARGO — PRECISION LOGISTICS — SINCE 2020 — SEA · LAND · AIR — ",
    services: {
      overline: "01 / SERVICES",
      title: "Four pillars of our operation.",
      sub:
        "We handle the full shipping chain — from pickup to last-mile — with dedicated handling for every cargo category.",
      items: [
        {
          k: "sea",
          num: "SVC-01",
          title: "Sea Freight",
          en: "Via Laut",
          desc:
            "Global-scale ocean freight. FCL, LCL, and project cargo with scheduled consolidation across major Indonesian and Asian ports.",
          tags: ["FCL", "LCL", "PROJECT", "REEFER"],
        },
        {
          k: "land",
          num: "SVC-02",
          title: "Land Freight",
          en: "Via Darat",
          desc:
            "Nationwide distribution with a modern fleet. Real-time tracking, flexible scheduling, and specialty cargo handling.",
          tags: ["TRUCKING", "FTL", "LTL", "EXPRESS"],
        },
        {
          k: "air",
          num: "SVC-03",
          title: "Air Freight",
          en: "Via Udara",
          desc:
            "Priority air shipping for time-critical cargo. General cargo, DG, perishable, and charter on demand.",
          tags: ["PRIORITY", "DG", "PERISHABLE", "CHARTER"],
        },
        {
          k: "additional",
          num: "SVC-04",
          title: "Additional Services",
          en: "Layanan Tambahan",
          desc:
            "Customs clearance, warehousing, packing, fumigation, cargo insurance & supply chain consulting — one door, one team.",
          tags: ["CUSTOMS", "WAREHOUSE", "INSURANCE", "PACKING"],
        },
      ],
    },
    why: {
      overline: "02 / MANIFESTO",
      title: "Why AR Cargo.",
      items: [
        {
          id: "01",
          title: "Fast Delivery",
          desc:
            "Speed isn't a bonus — it's a promise. Every route is designed so your cargo arrives on time, wherever it's headed.",
        },
        {
          id: "02",
          title: "Special Handling",
          desc:
            "We handle cargo not everyone can. Heavy equipment, fragile, DG, and temperature-controlled — all done properly.",
        },
        {
          id: "03",
          title: "Cost Efficiency",
          desc:
            "Smart consolidation and optimal routes — costs come down without giving up on speed or safety.",
        },
      ],
    },
    coverage: {
      overline: "03 / REACH",
      title: "From Bekasi, we reach the world.",
      sub:
        "We operate a multimodal network connecting major ports, airports, and distribution hubs — backed by trusted global partners.",
      cities: [
        "Jakarta", "Surabaya", "Semarang", "Medan", "Makassar",
        "Denpasar", "Balikpapan", "Palembang", "Batam", "Pontianak",
        "Singapore", "Shanghai", "Hong Kong", "Manila", "Kuala Lumpur",
      ],
    },
    security: {
      overline: "04 / SECURITY",
      title: "Every cargo, treated like our own.",
      sub:
        "Handling procedures, packaging, and monitoring are designed to minimize risk — from pickup to recipient.",
      points: [
        "Real-time GPS tracking across the domestic fleet",
        "Layered sealing & documentation protocols",
        "All-risk cargo insurance available on every lane",
        "Experienced QC team for DG, fragile, and project cargo",
      ],
    },
    trust: {
      overline: "05 / TRUSTED BY",
      title: "Chosen by companies that demand high standards.",
    },
    cta: {
      title: "Ready to ship?",
      sub: "Talk to our team and get a quote within 24 hours.",
      quote: "Request Quote",
      whatsapp: "WhatsApp Us",
    },
    footer: {
      talk: "LET'S TALK.",
      quick: "QUICK LINKS",
      contact: "CONTACT",
      about: "ABOUT",
      about_body:
        "PT. ABIRAMA MITRA PRATAMA (AR CARGO) is a trusted partner in cargo & logistics. Our focus: speed, security, reliability.",
      rights: "© 2026 AR Cargo. All rights reserved.",
    },
    about: {
      overline: "ABOUT US",
      title_1: "We move",
      title_2: "what matters.",
      lead:
        "PT. ABIRAMA MITRA PRATAMA — known as AR CARGO — is a trusted solution in the cargo and logistics industry. Focused on speed, security, and reliability, we deliver efficient and innovative shipping services to customers across Indonesia and the world.",
      chapters: [
        {
          n: "01",
          title: "Precision as a standard",
          body:
            "Every shipment is treated as the only one. Our procedures, documentation, and handling are designed so accuracy is default — not exception.",
        },
        {
          n: "02",
          title: "Humans at every joint",
          body:
            "Technology accelerates; people guarantee. Our team is available 24/7 to keep communication uninterrupted.",
        },
        {
          n: "03",
          title: "Multimodal network",
          body:
            "Sea, land, air — and seamless customs. We build routes that work for your cargo, not the ones easiest for us.",
        },
        {
          n: "04",
          title: "Growing with our clients",
          body:
            "From SMEs to enterprises. We adapt scale, procedures, and pricing so our service stays relevant across your business journey.",
        },
      ],
      stats: [
        { k: "Years Operating", v: "5+" },
        { k: "Cities Connected", v: "60+" },
        { k: "Active Clients", v: "120+" },
        { k: "Shipments / mo", v: "1.2K+" },
      ],
    },
    services_page: {
      overline: "FULL SERVICES",
      title_1: "Four pillars,",
      title_2: "one operation.",
      lead:
        "A complete service portfolio covering the entire logistics chain — modular, so it fits your business needs.",
      details: {
        sea: [
          "FCL & LCL with weekly consolidation",
          "Project cargo & heavy lift",
          "Reefer containers for cold chain",
          "Full port documentation (B/L, SI, import/export)",
        ],
        land: [
          "FTL & LTL across Indonesian cities",
          "Box, wingbox, flatbed, and tronton fleet",
          "Same-day & next-day options for Jabodetabek",
          "Escorted transport for high-value cargo",
        ],
        air: [
          "General cargo & express",
          "Certified Dangerous Goods (DG)",
          "Perishable & pharma cold chain",
          "Charter flights on request",
        ],
        additional: [
          "Customs clearance (import & export)",
          "Warehousing & bonded warehouse",
          "Packing, crating & fumigation",
          "All-risk cargo insurance",
        ],
      },
    },
    gallery: {
      overline: "GALLERY",
      title_1: "Fragments of",
      title_2: "our operation.",
      lead:
        "Snapshots from the field — ports, warehouses, fleets, and moments when logistics becomes an art.",
    },
    contact_page: {
      overline: "CONTACT",
      title_1: "Let's start",
      title_2: "a conversation.",
      lead:
        "Send us your requirements or reach out directly via WhatsApp. We respond during working hours.",
      form_title: "SEND MESSAGE",
      quote_title: "REQUEST QUOTE",
      f: {
        name: "Name",
        email: "Email",
        phone: "Phone",
        subject: "Subject",
        message: "Message",
        company: "Company",
        origin: "Origin",
        destination: "Destination",
        service: "Service Type",
        cargo: "Cargo Type",
        weight: "Weight",
        dimensions: "Dimensions",
        notes: "Notes",
        submit_contact: "Send Message",
        submit_quote: "Request Quote",
        sending: "Sending…",
        sent: "Sent. We'll get back to you shortly.",
      },
      addr_title: "ADDRESS",
      addr:
        "Ruko Grand Galaxy City Blok RSK 6 No. 73, Jaka Setia, Bekasi Selatan",
      phone: "+62 21 569 28104",
      wa: "WhatsApp",
      hours_title: "OPERATING HOURS",
      hours: "Mon – Fri, 09:00 – 18:00 WIB",
    },
    tracking_page: {
      overline: "TRACK SHIPMENT",
      title_1: "Where is",
      title_2: "your cargo?",
      lead:
        "Enter your Company Code. Our system will list all active shipments with their delivery status.",
      placeholder: "e.g. ARC-XXXXX",
      cta: "Track",
      tracking_number: "COMPANY CODE",
      status: "STATUS",
      service: "MODE",
      route: "ROUTE",
      eta: "ETA",
      history: "JOURNEY HISTORY",
      no_result: "Company code not found. Please check again or contact our team.",
      loading: "Fetching shipment data…",
      demo: "",
    },
  },
};

const LangContext = createContext({ lang: "id", setLang: () => {}, t: dict.id });

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try {
      return localStorage.getItem("ar-cargo-lang") || "id";
    } catch {
      return "id";
    }
  });

  const setLang = (l) => {
    setLangState(l);
    try {
      localStorage.setItem("ar-cargo-lang", l);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <LangContext.Provider value={{ lang, setLang, t: dict[lang] }}>
      {children}
    </LangContext.Provider>
  );
}

export const useLang = () => useContext(LangContext);

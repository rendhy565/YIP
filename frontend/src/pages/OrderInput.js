import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Select, Label } from "../components/ui";
import SearchableSelect from "../components/SearchableSelect";
import { errMsg, fmtIDR } from "../lib/utils";
import { toast } from "sonner";
import { Calculator, Save, FileLock2, UserPlus, X, ShieldCheck } from "lucide-react";

const emptyCust = { name: "", company_details: "", address: "", npwp: "" };

// Daftar kota dasar Indonesia (starter list — format: "NAMA KOTA - SINGKATAN")
const DEFAULT_CITIES = [
  "JAKARTA - JKT", "SURABAYA - SBY", "SEMARANG - SMG", "BANDUNG - BDG", "MEDAN - MDN",
  "DENPASAR - DPS", "MAKASSAR - MKS", "BALIKPAPAN - BPN", "PALEMBANG - PLM", "PEKANBARU - PKB",
  "PONTIANAK - PNK", "BEKASI - BKS", "TANGERANG - TGR", "BOGOR - BGR", "SOLO - SOC",
  "YOGYAKARTA - JOG", "MALANG - MLG", "PURWOKERTO - PWK", "TANJUNG KARANG - TKG", "JAMBI - JBI",
  "PADANG - PDG", "PEKAN BARU - PKU", "BANDAR LAMPUNG - BLP", "BATAM - BTH", "MATARAM - MTR",
  "KENDARI - KDI", "AMBON - AMQ", "BIAK - BIK", "MANADO - MND", "TIMIKA - TIM",
  "JAYAPURA - DJB", "BANJARMASIN - BDJ", "PANGKAL PINANG - PGK", "TANJUNG PINANG - TJQ",
  "BANYUASIN - BMI", "SANGGAR - SGR",
];

const COMPANY_OPTIONS = [
  { value: "PT. Abirama Mitra Pradana", label: "PT. Abirama Mitra Pradana" },
  { value: "PT. Abirama Mitra Pratama", label: "PT. Abirama Mitra Pratama" },
];

const SERVICE_OPTIONS = ["LCL", "FCL", "LTL", "FTL", "AIR"];
const VIA_OPTIONS = [
  { value: "D", label: "Darat" },
  { value: "L", label: "Laut" },
  { value: "U", label: "Udara" },
];
const STATUS_PENGIRIMAN = ["", "Reguler", "Project"];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function OrderInput() {
  const nav = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [taxOpts, setTaxOpts] = useState([]);

  // New-customer quick-add modal
  const [showCust, setShowCust] = useState(false);
  const [newCust, setNewCust] = useState(emptyCust);
  const [savingCust, setSavingCust] = useState(false);

  const [form, setForm] = useState({
    awb_number: "",
    reff_no: "",
    company_name: COMPANY_OPTIONS[0].value,
    pickup_date: todayStr(),
    customer_id: "",
    consignee: "",
    contract_id: "",
    item_description: "",
    goods_content: "",
    origin: "",
    destination: "",
    service: "",
    via: "",
    status_pengiriman: "",
    tariff_per_kg: "",
    qty_kg: "",
    tax_percentage: "11",
    koli_count: "",
    koli_qty_per: "",
    armada: "",
    driver_name: "",
    nopol: "",
    insurance_enabled: false,
    polis_amount: "",
    insurance_amount: "",
  });

  useEffect(() => {
    Promise.all([api.get("/customers"), api.get("/settings/tax-options")])
      .then(([c, t]) => { setCustomers(c.data); setTaxOpts(t.data); });
  }, []);

  useEffect(() => {
    if (form.customer_id) {
      api.get("/contracts", { params: { customer_id: form.customer_id } })
        .then((r) => setContracts(r.data));
    } else {
      setContracts([]);
    }
    setForm((f) => ({ ...f, contract_id: "" }));
    // eslint-disable-next-line
  }, [form.customer_id]);

  const onContractChange = (cid) => {
    if (!cid) {
      setForm((f) => ({ ...f, contract_id: "", origin: "", destination: "", tariff_per_kg: "", via: "" }));
      return;
    }
    const c = contracts.find((x) => x.id === cid);
    if (c) {
      setForm((f) => ({
        ...f,
        contract_id: cid,
        origin: c.origin,
        destination: c.destination,
        tariff_per_kg: String(c.price_per_kg),
        via: c.via || f.via,
      }));
    }
  };

  const tariff = parseFloat(form.tariff_per_kg) || 0;
  const qty = parseFloat(form.qty_kg) || 0;
  const taxPct = parseFloat(form.tax_percentage) || 0;
  const polisAmt = form.insurance_enabled ? (parseFloat(form.polis_amount) || 0) : 0;
  const insAmt = form.insurance_enabled ? (parseFloat(form.insurance_amount) || 0) : 0;
  const totalTariff = useMemo(() => tariff * qty, [tariff, qty]);
  const taxAmt = useMemo(() => (totalTariff * taxPct) / 100, [totalTariff, taxPct]);
  // Grand Total order (sebelum penerimaan) = tarif × qty + PPN. Polis & Asuransi default value
  // ada di sini tapi BARU menambah nilai invoice saat di-checklist di Penerimaan.
  const grandTotal = useMemo(() => totalTariff + taxAmt, [totalTariff, taxAmt]);
  const invoiceEstimate = useMemo(() => grandTotal + polisAmt + insAmt, [grandTotal, polisAmt, insAmt]);
  const contractLocked = !!form.contract_id;

  const submit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...form,
        tariff_per_kg: tariff,
        qty_kg: qty,
        tax_percentage: taxPct,
        koli_count: form.koli_count === "" ? null : parseInt(form.koli_count, 10),
        polis_amount: form.insurance_enabled && form.polis_amount !== "" ? parseFloat(form.polis_amount) : null,
        insurance_amount: form.insurance_enabled && form.insurance_amount !== "" ? parseFloat(form.insurance_amount) : null,
        contract_id: form.contract_id || null,
      };
      const r = await api.post("/orders", payload);
      toast.success(`AWB ${r.data.awb_number} berhasil dibuat`);
      nav("/orders");
    } catch (e2) { toast.error(errMsg(e2)); }
  };

  const saveNewCustomer = async (e) => {
    e.preventDefault();
    if (savingCust) return;
    setSavingCust(true);
    try {
      const r = await api.post("/customers", newCust);
      toast.success(`Customer "${r.data.name}" dibuat`);
      const list = await api.get("/customers");
      setCustomers(list.data);
      setForm((f) => ({ ...f, customer_id: r.data.id }));
      setShowCust(false);
      setNewCust(emptyCust);
    } catch (e2) { toast.error(errMsg(e2)); }
    finally { setSavingCust(false); }
  };

  // Helper datalist id for origin/destination
  return (
    <div data-testid="order-input-page">
      <PageHeader title="Input Order AWB" subtitle="Buat order baru. Tarif terkunci jika Perjanjian Rate dipilih." />

      {/* Datalists for origin/destination — default city list, user-editable */}
      <datalist id="city-list">
        {DEFAULT_CITIES.map((c) => <option key={c} value={c} />)}
      </datalist>

      <form onSubmit={submit} className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2 p-6">
          {/* ROW: AWB + Reff + Tgl */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>No. AWB (manual) *</Label>
              <Input data-testid="order-awb-input" value={form.awb_number} onChange={(e) => setForm({ ...form, awb_number: e.target.value })} required placeholder="Mis. ABR-001234"/>
            </div>
            <div>
              <Label>Reff No (opsional)</Label>
              <Input data-testid="order-reff-input" value={form.reff_no} onChange={(e) => setForm({ ...form, reff_no: e.target.value })} placeholder="Referensi internal/eksternal"/>
            </div>
            <div>
              <Label>Tanggal Pickup *</Label>
              <Input data-testid="order-pickup-date" type="date" value={form.pickup_date} onChange={(e) => setForm({ ...form, pickup_date: e.target.value })} required />
            </div>
          </div>

          {/* ROW: Company */}
          <div className="mt-4">
            <Label>Perusahaan (Issuer) *</Label>
            <Select data-testid="order-company-select" value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} required>
              {COMPANY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
          </div>

          {/* ROW: Customer + Consignee */}
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="m-0">Customer *</Label>
                <button
                  type="button"
                  data-testid="new-customer-btn"
                  onClick={() => { setNewCust(emptyCust); setShowCust(true); }}
                  className="text-[11px] uppercase tracking-wider font-bold text-blue-700 hover:text-blue-900 inline-flex items-center gap-1"
                >
                  <UserPlus size={12}/> Customer Baru
                </button>
              </div>
              <Select data-testid="order-customer-select-legacy" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })} required className="hidden">
                <option value="">— Pilih Customer —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              <SearchableSelect
                testid="order-customer-select"
                value={form.customer_id}
                onChange={(v) => setForm({ ...form, customer_id: v })}
                options={customers.map((c) => ({ value: c.id, label: c.name, sub: c.npwp ? `NPWP ${c.npwp}` : null }))}
                placeholder="— Pilih Customer —"
                emptyText="Customer tidak ditemukan"
                required
              />
            </div>
            <div>
              <Label>Consignee (Penerima)</Label>
              <Input data-testid="order-consignee-input" value={form.consignee} onChange={(e) => setForm({ ...form, consignee: e.target.value })} placeholder="Nama / perusahaan penerima"/>
            </div>
          </div>

          {/* ROW: Perjanjian Rate */}
          <div className="mt-4">
            <Label>Perjanjian Rate (opsional)</Label>
            <Select data-testid="order-contract-select" value={form.contract_id} onChange={(e) => onContractChange(e.target.value)} disabled={!form.customer_id}>
              <option value="">— Tanpa Perjanjian (input manual) —</option>
              {contracts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.origin} → {c.destination} · {fmtIDR(c.price_per_kg)}/kg {c.via ? `· ${c.via}` : ""}
                </option>
              ))}
            </Select>
          </div>

          {/* ROW: Origin + Destination + Service + Via */}
          <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <Label>Origin *</Label>
              <Input
                data-testid="order-origin-input"
                list="city-list"
                value={form.origin}
                onChange={(e) => setForm({ ...form, origin: e.target.value })}
                required disabled={contractLocked}
                placeholder="Mis. JAKARTA - JKT"
              />
            </div>
            <div>
              <Label>Destination *</Label>
              <Input
                data-testid="order-destination-input"
                list="city-list"
                value={form.destination}
                onChange={(e) => setForm({ ...form, destination: e.target.value })}
                required disabled={contractLocked}
                placeholder="Mis. SURABAYA - SBY"
              />
            </div>
            <div>
              <Label>Service</Label>
              <Select data-testid="order-service-select" value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })}>
                <option value="">— Pilih —</option>
                {SERVICE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
            <div>
              <Label>Via</Label>
              <Select data-testid="order-via-select" value={form.via} onChange={(e) => setForm({ ...form, via: e.target.value })}>
                <option value="">— Pilih —</option>
                {VIA_OPTIONS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
              </Select>
            </div>
          </div>

          {/* ROW: Status Pengiriman */}
          <div className="mt-4">
            <Label>Status Pengiriman</Label>
            <Select data-testid="order-status-pengiriman-select" value={form.status_pengiriman} onChange={(e) => setForm({ ...form, status_pengiriman: e.target.value })}>
              {STATUS_PENGIRIMAN.map((s) => <option key={s || "blank"} value={s}>{s || "— Tidak ditampilkan di invoice —"}</option>)}
            </Select>
          </div>

          {/* ROW: Item + Goods */}
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Deskripsi Item *</Label>
              <Input data-testid="order-item-description-input" value={form.item_description} onChange={(e) => setForm({ ...form, item_description: e.target.value })} required placeholder="Mis. Spareparts elektronik" />
            </div>
            <div>
              <Label>Isi Barang *</Label>
              <Input data-testid="order-goods-content-input" value={form.goods_content} onChange={(e) => setForm({ ...form, goods_content: e.target.value })} required placeholder="Mis. General Cargo" />
            </div>
          </div>

          {/* ROW: Koli + Qty Isi Koli */}
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Koli (jumlah)</Label>
              <Input data-testid="order-koli-count-input" type="number" min="0" value={form.koli_count} onChange={(e) => setForm({ ...form, koli_count: e.target.value })} placeholder="Mis. 10"/>
            </div>
            <div>
              <Label>Qty</Label>
              <Input data-testid="order-koli-qty-input" value={form.koli_qty_per} onChange={(e) => setForm({ ...form, koli_qty_per: e.target.value })} placeholder="Mis. 5 pcs / 2.5 kg"/>
            </div>
          </div>

          {/* ROW: Tarif + Qty + PPN */}
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>
                Tarif per Kg (IDR) * {contractLocked && <span className="ml-1 text-blue-700 inline-flex items-center gap-1"><FileLock2 size={11}/> terkunci</span>}
              </Label>
              <Input data-testid="order-tariff-input" type="number" step="0.01" value={form.tariff_per_kg} onChange={(e) => setForm({ ...form, tariff_per_kg: e.target.value })} required disabled={contractLocked} />
            </div>
            <div>
              <Label>Qty (Kg) *</Label>
              <Input data-testid="order-qty-input" type="number" step="0.01" value={form.qty_kg} onChange={(e) => setForm({ ...form, qty_kg: e.target.value })} required />
            </div>
            <div>
              <Label>PPN *</Label>
              <Select data-testid="order-tax-select" value={form.tax_percentage} onChange={(e) => setForm({ ...form, tax_percentage: e.target.value })} required>
                {taxOpts.map((t) => <option key={t.key} value={t.value}>{t.label}</option>)}
              </Select>
            </div>
          </div>

          {/* ROW: Armada / Driver / Nopol */}
          <div className="mt-6 pt-4 border-t border-slate-200">
            <h4 className="text-[11px] uppercase tracking-[0.12em] font-bold text-slate-500 mb-3">Detail Armada</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>Armada</Label>
                <Input data-testid="order-armada-input" value={form.armada} onChange={(e) => setForm({ ...form, armada: e.target.value })} placeholder="Mis. CDD"/>
              </div>
              <div>
                <Label>Nama Driver</Label>
                <Input data-testid="order-driver-input" value={form.driver_name} onChange={(e) => setForm({ ...form, driver_name: e.target.value })} placeholder="Mis. Pak Budi"/>
              </div>
              <div>
                <Label>Nopol</Label>
                <Input data-testid="order-nopol-input" value={form.nopol} onChange={(e) => setForm({ ...form, nopol: e.target.value.toUpperCase() })} placeholder="Mis. B 1234 ABC"/>
              </div>
            </div>
          </div>

          {/* ROW: Asuransi */}
          <div className="mt-6 pt-4 border-t border-slate-200">
            <h4 className="text-[11px] uppercase tracking-[0.12em] font-bold text-slate-500 mb-3 inline-flex items-center gap-2">
              <ShieldCheck size={14} className="text-emerald-600"/> Asuransi
            </h4>
            <div className="flex items-center gap-4 mb-3">
              <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                <input data-testid="insurance-yes" type="radio" checked={form.insurance_enabled === true} onChange={() => setForm({ ...form, insurance_enabled: true })}/>
                <span>Ya</span>
              </label>
              <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                <input data-testid="insurance-no" type="radio" checked={form.insurance_enabled === false} onChange={() => setForm({ ...form, insurance_enabled: false })}/>
                <span>Tidak</span>
              </label>
            </div>
            {form.insurance_enabled && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Nilai Polis (IDR)</Label>
                  <Input data-testid="polis-amount" type="number" step="0.01" value={form.polis_amount} onChange={(e) => setForm({ ...form, polis_amount: e.target.value })} placeholder="0"/>
                </div>
                <div>
                  <Label>Nilai Asuransi (IDR)</Label>
                  <Input data-testid="insurance-amount" type="number" step="0.01" value={form.insurance_amount} onChange={(e) => setForm({ ...form, insurance_amount: e.target.value })} placeholder="0"/>
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card className="p-6 h-fit lg:sticky lg:top-6">
          <div className="flex items-center gap-2 mb-3">
            <Calculator size={16} className="text-blue-700" />
            <h3 className="font-heading font-bold text-lg">Kalkulasi Otomatis</h3>
          </div>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-500">Tarif × Qty</span>
              <span className="font-mono text-xs">{fmtIDR(tariff)} × {qty}</span>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-500">Total Tarif</span>
              <span data-testid="calc-total-tariff" className="font-semibold">{fmtIDR(totalTariff)}</span>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-500">PPN ({taxPct}%)</span>
              <span data-testid="calc-tax-amount" className="font-semibold">{fmtIDR(taxAmt)}</span>
            </div>
            <div className="flex justify-between pt-2 border-t-2 border-slate-900">
              <span className="font-bold uppercase text-xs tracking-wider">Grand Total AWB</span>
              <span data-testid="calc-grand-total" className="font-heading font-black text-lg text-blue-700">{fmtIDR(grandTotal)}</span>
            </div>
            {(polisAmt > 0 || insAmt > 0) && (
              <div className="mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-xs space-y-1">
                <div className="text-amber-800 font-semibold uppercase tracking-wider text-[10px]">Penambah Default (di-checklist saat Penerimaan)</div>
                {polisAmt > 0 && <div className="flex justify-between"><span>Polis</span><span className="font-mono">{fmtIDR(polisAmt)}</span></div>}
                {insAmt > 0 && <div className="flex justify-between"><span>Asuransi</span><span className="font-mono">{fmtIDR(insAmt)}</span></div>}
                <div className="flex justify-between pt-1 border-t border-amber-300 font-bold text-amber-900">
                  <span>Estimasi Invoice (max)</span><span className="font-heading">{fmtIDR(invoiceEstimate)}</span>
                </div>
              </div>
            )}
          </div>
          <Button data-testid="submit-order-btn" className="w-full mt-5" type="submit">
            <Save size={16}/> Simpan AWB
          </Button>
          <p className="text-[11px] text-slate-500 mt-3">Pastikan No. AWB unik. Status Pengiriman kosong tidak akan ditampilkan di invoice.</p>
        </Card>
      </form>

      {/* === Quick Add Customer Modal === */}
      {showCust && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="new-customer-modal">
          <Card className="w-full max-w-lg p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-heading font-bold text-xl text-slate-900">Tambah Customer Baru</h3>
                <p className="text-xs text-slate-500 mt-1">Customer akan langsung dipilih untuk order ini.</p>
              </div>
              <button type="button" onClick={() => setShowCust(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <form onSubmit={saveNewCustomer} className="space-y-3">
              <div>
                <Label>Nama *</Label>
                <Input data-testid="new-customer-name-input" value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} required autoFocus />
              </div>
              <div>
                <Label>Detail Perusahaan</Label>
                <Input value={newCust.company_details} onChange={(e) => setNewCust({ ...newCust, company_details: e.target.value })} />
              </div>
              <div>
                <Label>NPWP</Label>
                <Input value={newCust.npwp} onChange={(e) => setNewCust({ ...newCust, npwp: e.target.value })} />
              </div>
              <div>
                <Label>Alamat</Label>
                <Input value={newCust.address} onChange={(e) => setNewCust({ ...newCust, address: e.target.value })} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" type="button" onClick={() => setShowCust(false)}>Batal</Button>
                <Button data-testid="save-new-customer-btn" type="submit" disabled={savingCust}>
                  {savingCust ? "Menyimpan..." : "Simpan & Pilih"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Select, Label } from "../components/ui";
import { errMsg, fmtIDR } from "../lib/utils";
import { toast } from "sonner";
import { Calculator, Save, FileLock2, UserPlus, X } from "lucide-react";

const emptyCust = { name: "", company_details: "", address: "", npwp: "" };

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
    customer_id: "",
    contract_id: "",
    item_description: "",
    goods_content: "",
    origin: "",
    destination: "",
    tariff_per_kg: "",
    qty_kg: "",
    tax_percentage: "11",
  });

  useEffect(() => {
    Promise.all([api.get("/customers"), api.get("/settings/tax-options")])
      .then(([c, t]) => { setCustomers(c.data); setTaxOpts(t.data); });
  }, []);

  // load contracts when customer changes
  useEffect(() => {
    if (form.customer_id) {
      api.get("/contracts", { params: { customer_id: form.customer_id } })
        .then((r) => setContracts(r.data));
    } else {
      setContracts([]);
    }
    setForm((f) => ({ ...f, contract_id: "" }));
  }, [form.customer_id]);

  // when contract selected, autofill (AJAX-like)
  const onContractChange = (cid) => {
    if (!cid) {
      setForm((f) => ({ ...f, contract_id: "", origin: "", destination: "", tariff_per_kg: "" }));
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
      }));
    }
  };

  const tariff = parseFloat(form.tariff_per_kg) || 0;
  const qty = parseFloat(form.qty_kg) || 0;
  const taxPct = parseFloat(form.tax_percentage) || 0;
  const totalTariff = useMemo(() => tariff * qty, [tariff, qty]);
  const taxAmt = useMemo(() => (totalTariff * taxPct) / 100, [totalTariff, taxPct]);
  const grandTotal = useMemo(() => totalTariff + taxAmt, [totalTariff, taxAmt]);

  const contractLocked = !!form.contract_id;

  const submit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        customer_id: form.customer_id,
        contract_id: form.contract_id || null,
        item_description: form.item_description,
        goods_content: form.goods_content,
        origin: form.origin,
        destination: form.destination,
        tariff_per_kg: tariff,
        qty_kg: qty,
        tax_percentage: taxPct,
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
      // Refresh dropdown & auto-select the new one
      const list = await api.get("/customers");
      setCustomers(list.data);
      setForm((f) => ({ ...f, customer_id: r.data.id }));
      setShowCust(false);
      setNewCust(emptyCust);
    } catch (e2) { toast.error(errMsg(e2)); }
    finally { setSavingCust(false); }
  };

  return (
    <div data-testid="order-input-page">
      <PageHeader title="Input Order AWB" subtitle="Modul 1 — Buat order baru. Tarif terkunci jika kontrak dipilih." />

      <form onSubmit={submit} className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2 p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
              <Select data-testid="order-customer-select" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })} required>
                <option value="">— Pilih Customer —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
            <div>
              <Label>Kontrak (opsional)</Label>
              <Select data-testid="order-contract-select" value={form.contract_id} onChange={(e) => onContractChange(e.target.value)} disabled={!form.customer_id}>
                <option value="">— Tanpa Kontrak (input manual) —</option>
                {contracts.map((c) => (
                  <option key={c.id} value={c.id}>{c.origin} → {c.destination} · {fmtIDR(c.price_per_kg)}/kg</option>
                ))}
              </Select>
            </div>

            <div>
              <Label>Origin *</Label>
              <Input data-testid="order-origin-input" value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value.toUpperCase() })} required disabled={contractLocked} />
            </div>
            <div>
              <Label>Destination *</Label>
              <Input data-testid="order-destination-input" value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value.toUpperCase() })} required disabled={contractLocked} />
            </div>

            <div className="md:col-span-2">
              <Label>Deskripsi Item *</Label>
              <Input data-testid="order-item-description-input" value={form.item_description} onChange={(e) => setForm({ ...form, item_description: e.target.value })} required placeholder="Mis. Spareparts elektronik" />
            </div>
            <div className="md:col-span-2">
              <Label>Isi Barang (Goods Content) *</Label>
              <Input data-testid="order-goods-content-input" value={form.goods_content} onChange={(e) => setForm({ ...form, goods_content: e.target.value })} required placeholder="Mis. General Cargo" />
            </div>

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

            <div className="md:col-span-2">
              <Label>Pajak PPN *</Label>
              <Select data-testid="order-tax-select" value={form.tax_percentage} onChange={(e) => setForm({ ...form, tax_percentage: e.target.value })} required>
                {taxOpts.map((t) => <option key={t.key} value={t.value}>{t.label}</option>)}
              </Select>
            </div>
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
              <span className="font-mono">{fmtIDR(tariff)} × {qty}</span>
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
              <span className="font-bold uppercase text-xs tracking-wider">Grand Total</span>
              <span data-testid="calc-grand-total" className="font-heading font-black text-lg text-blue-700">{fmtIDR(grandTotal)}</span>
            </div>
          </div>
          <Button data-testid="submit-order-btn" className="w-full mt-5" type="submit">
            <Save size={16}/> Simpan AWB
          </Button>
          <p className="text-[11px] text-slate-500 mt-3">Nomor AWB akan otomatis ter-generate dengan format <span className="kbd">AWB-YYYYMM-XXXX</span>.</p>
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

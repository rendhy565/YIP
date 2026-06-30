import React, { useEffect, useMemo, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Label, Table, Th, Td } from "../components/ui";
import SearchableSelect from "../components/SearchableSelect";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { Plus, X, Trash2, FileSignature, MessageCircle, Edit2, ChevronDown, ChevronRight } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useCan } from "../lib/useCan";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const emptyItem = { origin: "", destination: "", armada: "", item_description: "", qty: "", harga: "", awb_id: "" };
const emptyForm = { vendor_name: "", po_date: todayStr(), notes: "", items: [{ ...emptyItem }] };

// Indonesian month names for WA template
const ID_MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function fmtIdDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  return `${dt.getDate()} ${ID_MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}

// Build WhatsApp template text from PO doc
function buildWAText(po) {
  const dateText = fmtIdDate(po.po_date).toUpperCase();
  let text = `📌SCHEDULE PICK UP TGL ${dateText}\n\n`;
  (po.items || []).forEach((it, idx) => {
    text += `${idx + 1}. ORIGIN : ${it.origin || "-"}\n`;
    text += `TUJUAN : ${it.destination || "-"}\n`;
    if (it.armada) text += `ARMADA : ${it.armada}\n`;
    if (it.item_description) text += `MATERIAL : ${it.item_description}\n`;
    if (it.qty != null && it.qty !== "") text += `QTY : ${it.qty}\n`;
    text += `\n`;
  });
  if (po.notes) text += `Catatan: ${po.notes}\n`;
  text += `(Vendor: ${po.vendor_name || "-"} · ${po.number})`;
  return text.trim();
}

function sendWA(po) {
  const text = encodeURIComponent(buildWAText(po));
  // Tanpa nomor — user pilih chat di WA sendiri
  window.open(`https://wa.me/?text=${text}`, "_blank");
}

export default function PurchaseOrders() {
  const canCreate = useCan("purchase_orders", "create");
  const canEditItem = useCan("purchase_orders", "edit_item");
  const canDelete = useCan("purchase_orders", "delete");
  const canSendWA = useCan("purchase_orders", "send_wa");
  const { user } = useAuth();
  const isAdmin = user?.role === "administrator";
  const [rows, setRows] = useState([]);
  const [allOrders, setAllOrders] = useState([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState({});
  // Inline item edit popup
  const [editItem, setEditItem] = useState(null); // { po_id, idx, item }
  const [savingItem, setSavingItem] = useState(false);

  const load = async () => {
    const [po, os] = await Promise.all([api.get("/purchase-orders"), api.get("/orders")]);
    setRows(po.data);
    setAllOrders(os.data);
  };
  useEffect(() => { load(); }, []);

  const addItemRow = () => setForm({ ...form, items: [...form.items, { ...emptyItem }] });
  const removeItemRow = (idx) => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });
  const updateItemRow = (idx, key, val) => setForm({ ...form, items: form.items.map((it, i) => i === idx ? { ...it, [key]: val } : it) });

  const submit = async (e) => {
    e.preventDefault();
    if (!form.vendor_name || !form.vendor_name.trim()) { toast.error("Vendor wajib diisi"); return; }
    if (!form.items || form.items.length === 0) { toast.error("Minimal 1 baris item wajib"); return; }
    for (let i = 0; i < form.items.length; i++) {
      const it = form.items[i];
      if (!it.origin || !it.destination) { toast.error(`Baris #${i + 1}: Origin & Destination wajib`); return; }
    }
    setSaving(true);
    try {
      const payload = {
        vendor_name: form.vendor_name,
        po_date: form.po_date,
        notes: form.notes,
        items: form.items.map((it) => ({
          origin: it.origin,
          destination: it.destination,
          armada: it.armada || null,
          item_description: it.item_description || null,
          qty: it.qty === "" ? null : parseFloat(it.qty),
          harga: it.harga === "" ? null : parseFloat(it.harga),
          awb_id: it.awb_id || null,
        })),
      };
      await api.post("/purchase-orders", payload);
      const linkedCount = form.items.filter((it) => it.awb_id && it.harga).length;
      toast.success(`PO dibuat (${form.items.length} baris${linkedCount > 0 ? `, ${linkedCount} auto-link cost ke AWB` : ""})`);
      setShow(false); setForm({ ...emptyForm, po_date: todayStr(), items: [{ ...emptyItem }] }); load();
    } catch (e2) { toast.error(errMsg(e2)); }
    finally { setSaving(false); }
  };

  const del = async (r) => {
    const linkedCount = (r.items || []).filter((it) => it.linked_cost_id).length;
    if (!window.confirm(
      `PERINGATAN: Menghapus PO ${r.number}\n\n` +
      `Efek:\n` +
      `${linkedCount > 0 ? `• ${linkedCount} cost vendor di AWB akan DIHAPUS\n• Jurnal akrual hutang dibalik\n` : ""}` +
      `• Tidak bisa jika cost sudah disettle\n\n` +
      `Lanjutkan?`
    )) return;
    try { await api.delete(`/purchase-orders/${r.id}`); toast.success("PO dihapus + akunting dibalik"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const openEditItem = (po, idx) => setEditItem({ po_id: po.id, idx, item: { ...po.items[idx] } });
  const submitEditItem = async () => {
    const it = editItem.item;
    if (!it.origin || !it.destination) { toast.error("Origin & Destination wajib"); return; }
    setSavingItem(true);
    try {
      await api.patch(`/purchase-orders/${editItem.po_id}/items/${editItem.idx}`, {
        origin: it.origin,
        destination: it.destination,
        armada: it.armada || null,
        item_description: it.item_description || null,
        qty: it.qty === "" || it.qty == null ? null : parseFloat(it.qty),
        harga: it.harga === "" || it.harga == null ? null : parseFloat(it.harga),
        awb_id: it.awb_id || null,
      });
      toast.success("Baris item diupdate" + (it.awb_id && it.harga ? " — cost auto-linked ke AWB" : ""));
      setEditItem(null);
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setSavingItem(false); }
  };

  const grandTotal = useMemo(() => rows.reduce((s, r) => s + (r.total_amount || 0), 0), [rows]);

  return (
    <div data-testid="po-page">
      <PageHeader
        title="PO / Surat Perintah Vendor (Manifest)"
        subtitle="Surat perintah ke vendor — multi-row per origin/destination. Harga & AWB bisa diisi nanti. Klik WA untuk kirim schedule ke vendor."
        action={canCreate ? <Button data-testid="add-po-btn" onClick={() => { setForm({ ...emptyForm, po_date: todayStr(), items: [{ ...emptyItem }] }); setShow(true); }}><Plus size={16}/> Buat PO</Button> : null}
      />

      <Card className="p-5 bg-blue-50 border-blue-200 mb-5">
        <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-blue-700">Total Nilai PO (semua items)</div>
        <div className="font-heading font-black text-2xl text-blue-900">{fmtIDR(grandTotal)}</div>
        <div className="text-xs text-blue-700 mt-1">{rows.length} PO · {rows.reduce((s, r) => s + (r.item_count || 0), 0)} baris item</div>
      </Card>

      <Card>
        <Table>
          <thead><tr>
            <Th></Th>
            <Th>No. PO</Th><Th>Tanggal</Th><Th>Vendor</Th>
            <Th className="text-right">Items</Th>
            <Th className="text-right">Total Harga</Th>
            <Th className="text-right">Aksi</Th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <React.Fragment key={r.id}>
                <tr data-testid={`po-row-${r.number}`}>
                  <Td>
                    <button onClick={() => setExpanded((s) => ({ ...s, [r.id]: !s[r.id] }))} className="p-1 hover:bg-slate-100 rounded">
                      {expanded[r.id] ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                    </button>
                  </Td>
                  <Td className="font-mono font-semibold">{r.number}</Td>
                  <Td className="text-xs text-slate-600">{fmtDate(r.po_date)}</Td>
                  <Td className="font-semibold">{r.vendor_name}</Td>
                  <Td className="text-right text-xs">{r.item_count} baris</Td>
                  <Td className="text-right font-semibold">{r.total_amount > 0 ? fmtIDR(r.total_amount) : <span className="text-slate-400">— belum ada harga —</span>}</Td>
                  <Td className="text-right whitespace-nowrap">
                    <div className="flex gap-1 justify-end">
                      {canSendWA && (
                        <button data-testid={`wa-po-${r.number}`} onClick={() => sendWA(r)} title="Kirim WA ke vendor" className="px-2 py-1 text-[10px] uppercase font-bold rounded bg-emerald-100 text-emerald-800 hover:bg-emerald-200 inline-flex items-center gap-1">
                          <MessageCircle size={11}/> Kirim WA
                        </button>
                      )}
                      {canDelete && (
                        <button data-testid={`delete-po-${r.number}`} onClick={() => del(r)} className="p-1.5 rounded hover:bg-red-50 text-red-600"><Trash2 size={12}/></button>
                      )}
                    </div>
                  </Td>
                </tr>
                {expanded[r.id] && (
                  <tr>
                    <Td colSpan={7} className="bg-slate-50 px-4 py-3">
                      <div className="border border-slate-200 rounded overflow-hidden bg-white">
                        <table className="w-full text-sm">
                          <thead className="bg-slate-100 text-slate-700">
                            <tr>
                              <th className="px-2 py-1.5 text-left">#</th>
                              <th className="px-2 py-1.5 text-left">Origin</th>
                              <th className="px-2 py-1.5 text-left">Destination</th>
                              <th className="px-2 py-1.5 text-left">Armada</th>
                              <th className="px-2 py-1.5 text-left">Isi Barang</th>
                              <th className="px-2 py-1.5 text-right">Qty</th>
                              <th className="px-2 py-1.5 text-right">Harga</th>
                              <th className="px-2 py-1.5 text-left">AWB</th>
                              <th className="px-2 py-1.5 text-right">Aksi</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(r.items || []).map((it, idx) => (
                              <tr key={idx} className="border-t border-slate-100" data-testid={`po-item-${r.number}-${idx}`}>
                                <td className="px-2 py-1.5 text-xs font-bold">{idx + 1}</td>
                                <td className="px-2 py-1.5 text-xs">{it.origin}</td>
                                <td className="px-2 py-1.5 text-xs">{it.destination}</td>
                                <td className="px-2 py-1.5 text-xs">{it.armada || <span className="text-slate-400">—</span>}</td>
                                <td className="px-2 py-1.5 text-xs">{it.item_description || <span className="text-slate-400">—</span>}</td>
                                <td className="px-2 py-1.5 text-right text-xs">{it.qty != null && it.qty !== "" ? it.qty : <span className="text-slate-400">—</span>}</td>
                                <td className="px-2 py-1.5 text-right font-mono text-xs">
                                  {it.harga ? <span className="font-semibold">{fmtIDR(it.harga)}</span> : <span className="text-amber-600 italic">isi nanti</span>}
                                </td>
                                <td className="px-2 py-1.5 text-xs font-mono">
                                  {it.awb_number ? (
                                    <span className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 rounded px-1.5 py-0.5">
                                      {it.awb_number}{it.linked_cost_id && <span title="Cost linked" className="text-emerald-600">●</span>}
                                    </span>
                                  ) : <span className="text-amber-600 italic">isi nanti</span>}
                                </td>
                                <td className="px-2 py-1.5 text-right">
                                  {canEditItem && (
                                    <button data-testid={`edit-item-${r.number}-${idx}`} onClick={() => openEditItem(r, idx)} className="p-1 rounded hover:bg-blue-50 text-blue-700" title="Edit baris">
                                      <Edit2 size={11}/>
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                            {(r.items || []).length === 0 && (
                              <tr><td colSpan={9} className="px-2 py-3 text-center text-xs text-slate-400">Belum ada items.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                      {r.notes && <p className="text-xs text-slate-600 mt-2 pl-2"><strong>Catatan:</strong> {r.notes}</p>}
                    </Td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {rows.length === 0 && <tr><Td colSpan={7} className="text-center text-slate-500 py-8">Belum ada PO.</Td></tr>}
          </tbody>
        </Table>
      </Card>

      {/* CREATE PO MODAL */}
      {show && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="add-po-modal">
          <Card className="w-full max-w-5xl p-6 max-h-[92vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-heading font-bold text-xl"><FileSignature className="inline mr-2" size={18}/>Buat PO Vendor — Multi Item</h3>
              <button onClick={() => setShow(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <Label>Nama Vendor *</Label>
                  <Input data-testid="po-vendor" value={form.vendor_name} onChange={(e) => setForm({ ...form, vendor_name: e.target.value })} required placeholder="Mis. PT. BIG TRUCKING"/>
                </div>
                <div>
                  <Label>Tanggal *</Label>
                  <Input data-testid="po-date" type="date" value={form.po_date} onChange={(e) => setForm({ ...form, po_date: e.target.value })} required/>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[11px] uppercase tracking-[0.12em] font-bold text-slate-500">Items / Baris ({form.items.length})</h4>
                  <button type="button" data-testid="add-po-item-btn" onClick={addItemRow} className="text-[11px] font-bold text-blue-700 hover:text-blue-900 inline-flex items-center gap-1">
                    <Plus size={12}/> Tambah Baris
                  </button>
                </div>
                <div className="space-y-3">
                  {form.items.map((it, idx) => (
                    <div key={idx} className="border border-slate-200 rounded p-3 bg-slate-50" data-testid={`po-item-row-${idx}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] uppercase font-bold text-slate-500">Baris #{idx + 1}</span>
                        {form.items.length > 1 && (
                          <button type="button" onClick={() => removeItemRow(idx)} className="p-1 rounded hover:bg-red-50 text-red-600"><Trash2 size={12}/></button>
                        )}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
                        <div>
                          <Label className="!text-[10px] !mb-1">Origin *</Label>
                          <Input data-testid={`po-item-origin-${idx}`} value={it.origin} onChange={(e) => updateItemRow(idx, "origin", e.target.value)} required placeholder="Mis. PT. SANGGAR - BANDUNG"/>
                        </div>
                        <div>
                          <Label className="!text-[10px] !mb-1">Destination *</Label>
                          <Input data-testid={`po-item-dest-${idx}`} value={it.destination} onChange={(e) => updateItemRow(idx, "destination", e.target.value)} required placeholder="Mis. PT. MNI - JABODETABEK"/>
                        </div>
                        <div>
                          <Label className="!text-[10px] !mb-1">Armada</Label>
                          <Input data-testid={`po-item-armada-${idx}`} value={it.armada} onChange={(e) => updateItemRow(idx, "armada", e.target.value)} placeholder="Mis. FUSO KELAS BERAT"/>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
                        <div>
                          <Label className="!text-[10px] !mb-1">Isi Barang / Material</Label>
                          <Input data-testid={`po-item-desc-${idx}`} value={it.item_description} onChange={(e) => updateItemRow(idx, "item_description", e.target.value)} placeholder="Mis. TIANG 7.3 (320)"/>
                        </div>
                        <div>
                          <Label className="!text-[10px] !mb-1">Qty</Label>
                          <Input data-testid={`po-item-qty-${idx}`} type="number" step="0.01" value={it.qty} onChange={(e) => updateItemRow(idx, "qty", e.target.value)} placeholder="Mis. 320"/>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <div>
                          <Label className="!text-[10px] !mb-1">Harga (IDR) <span className="text-slate-400">(boleh kosong, diisi nanti)</span></Label>
                          <Input data-testid={`po-item-harga-${idx}`} type="number" step="0.01" value={it.harga} onChange={(e) => updateItemRow(idx, "harga", e.target.value)} placeholder="Boleh kosong"/>
                        </div>
                        <div>
                          <Label className="!text-[10px] !mb-1">AWB <span className="text-slate-400">(boleh kosong)</span></Label>
                          <SearchableSelect
                            testid={`po-item-awb-${idx}`}
                            value={it.awb_id}
                            onChange={(v) => updateItemRow(idx, "awb_id", v)}
                            options={allOrders.map((o) => ({ value: o.id, label: o.awb_number, sub: `${o.status} · ${o.customer_name}` }))}
                            placeholder="— Tanpa AWB —"
                            emptyText="AWB tidak ditemukan"
                          />
                        </div>
                      </div>
                      {it.awb_id && it.harga && (
                        <p className="text-[10px] text-emerald-700 mt-2">
                          ✓ Akan auto-create Vendor cost (Accrue) di AWB ini.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div><Label>Catatan PO</Label><Input data-testid="po-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Opsional"/></div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button variant="secondary" type="button" onClick={() => setShow(false)}>Batal</Button>
                <Button data-testid="save-po-btn" type="submit" disabled={saving}>{saving ? "Menyimpan..." : "Buat PO"}</Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* EDIT ITEM MODAL */}
      {editItem && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="edit-po-item-modal">
          <Card className="w-full max-w-lg p-6 max-h-[88vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-heading font-bold text-xl">Edit Baris Item</h3>
                <p className="text-xs text-slate-500 mt-1">Isi Harga & AWB untuk auto-link cost ke AWB tersebut.</p>
              </div>
              <button onClick={() => setEditItem(null)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Origin *</Label><Input data-testid="edit-item-origin" value={editItem.item.origin} onChange={(e) => setEditItem({ ...editItem, item: { ...editItem.item, origin: e.target.value } })}/></div>
                <div><Label>Destination *</Label><Input data-testid="edit-item-dest" value={editItem.item.destination} onChange={(e) => setEditItem({ ...editItem, item: { ...editItem.item, destination: e.target.value } })}/></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Armada</Label><Input data-testid="edit-item-armada" value={editItem.item.armada || ""} onChange={(e) => setEditItem({ ...editItem, item: { ...editItem.item, armada: e.target.value } })}/></div>
                <div><Label>Isi Barang</Label><Input data-testid="edit-item-desc" value={editItem.item.item_description || ""} onChange={(e) => setEditItem({ ...editItem, item: { ...editItem.item, item_description: e.target.value } })}/></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Qty</Label><Input data-testid="edit-item-qty" type="number" step="0.01" value={editItem.item.qty || ""} onChange={(e) => setEditItem({ ...editItem, item: { ...editItem.item, qty: e.target.value } })}/></div>
                <div><Label>Harga (IDR)</Label><Input data-testid="edit-item-harga" type="number" step="0.01" value={editItem.item.harga || ""} onChange={(e) => setEditItem({ ...editItem, item: { ...editItem.item, harga: e.target.value } })}/></div>
              </div>
              <div>
                <Label>AWB</Label>
                <SearchableSelect
                  testid="edit-item-awb"
                  value={editItem.item.awb_id || ""}
                  onChange={(v) => setEditItem({ ...editItem, item: { ...editItem.item, awb_id: v } })}
                  options={allOrders.map((o) => ({ value: o.id, label: o.awb_number, sub: `${o.status} · ${o.customer_name}` }))}
                  placeholder="— Tanpa AWB —"
                  emptyText="AWB tidak ditemukan"
                />
              </div>
              {editItem.item.awb_id && editItem.item.harga && (
                <p className="text-[10px] text-emerald-700">
                  ✓ Setelah simpan: cost akan auto-link / re-link ke AWB ini.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-4 mt-4 border-t">
              <Button variant="secondary" type="button" onClick={() => setEditItem(null)}>Batal</Button>
              <Button data-testid="save-edit-item-btn" onClick={submitEditItem} disabled={savingItem}>{savingItem ? "Menyimpan..." : "Update Baris"}</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

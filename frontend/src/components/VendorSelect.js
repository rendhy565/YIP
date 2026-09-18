import React from "react";
import api from "../lib/api";
import SearchableSelect from "./SearchableSelect";
import { Button } from "./ui";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { errMsg } from "../lib/utils";

export const PPH_LABEL = {
  PPh23: "PPh 23 (2%)",
  PPh15: "PPh 15 (2%)",
  PP23UMKM: "PPh Final UMKM (0,5%)",
};

// Combobox pilih vendor dari master + tombol quick-add (Opsi B).
export default function VendorSelect({ value, onChange, vendors, onVendorsChange, testid = "vendor-select", required = false }) {
  const quickAdd = async () => {
    const name = window.prompt("Nama vendor baru:");
    if (!name || !name.trim()) return;
    try {
      const r = await api.post("/vendors/quick", { name: name.trim() });
      toast.success(`Vendor "${r.data.name}" siap dipakai — Finance perlu set jenis PPh di Master Vendor`);
      onVendorsChange?.();
      onChange?.(r.data.name);
    } catch (e) { toast.error(errMsg(e)); }
  };

  const options = (vendors || []).map((v) => ({
    value: v.name,
    label: v.name,
    sub: v.pph_type ? (PPH_LABEL[v.pph_type] || v.pph_type) : (v.pph_reviewed ? "Non-PPh" : "⚠ perlu ditinjau"),
  }));

  return (
    <div className="flex gap-2 items-start">
      <div className="flex-1 min-w-0">
        <SearchableSelect
          testid={testid}
          value={value}
          onChange={onChange}
          options={options}
          placeholder="— Pilih vendor —"
          emptyText="Vendor tidak ada — klik + Baru"
          required={required}
        />
      </div>
      <Button type="button" variant="secondary" data-testid={`${testid}-add`} onClick={quickAdd}>
        <Plus size={14} /> Baru
      </Button>
    </div>
  );
}

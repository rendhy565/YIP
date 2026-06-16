import React, { useEffect, useState } from "react";
import { Bookmark, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Card, Button, Input } from "./ui";

/**
 * Reusable filter toolbar with:
 *  • OR/AND mode toggle (controlled via props)
 *  • Save/Load/Delete filter presets (localStorage, keyed by storageKey)
 *
 * Props:
 *  storageKey      — unique key per page (e.g. "invoices", "orders", "recap")
 *  mode            — current filter mode ("OR" | "AND")
 *  setMode         — setter
 *  currentFilters  — object snapshot of filter state to save (mode + filters)
 *  onLoadPreset    — callback (filters) → applies preset state
 *  activeCount     — number of currently active filters (informational)
 *  showModeToggle  — whether to show OR/AND toggle (default true)
 */
export default function FilterPresets({
  storageKey,
  mode,
  setMode,
  currentFilters,
  onLoadPreset,
  activeCount = 0,
  showModeToggle = true,
}) {
  const lsKey = `filterPresets:${storageKey}`;
  const [presets, setPresets] = useState([]);
  const [showSave, setShowSave] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    try { setPresets(JSON.parse(localStorage.getItem(lsKey) || "[]")); }
    catch { setPresets([]); }
  }, [lsKey]);

  const persist = (next) => {
    setPresets(next);
    localStorage.setItem(lsKey, JSON.stringify(next));
  };

  const handleSave = () => {
    if (!name.trim()) { toast.error("Nama preset wajib diisi"); return; }
    const trimmed = name.trim();
    if (presets.some((p) => p.name === trimmed)) {
      if (!window.confirm(`Preset "${trimmed}" sudah ada. Timpa?`)) return;
    }
    const next = [...presets.filter((p) => p.name !== trimmed), { name: trimmed, mode, filters: currentFilters, ts: Date.now() }];
    persist(next.sort((a, b) => a.name.localeCompare(b.name)));
    toast.success(`Preset "${trimmed}" tersimpan`);
    setName(""); setShowSave(false);
  };

  const handleLoad = (e) => {
    const v = e.target.value;
    if (!v) return;
    const p = presets.find((x) => x.name === v);
    if (p) {
      if (setMode && p.mode) setMode(p.mode);
      onLoadPreset?.(p.filters || {});
      toast.success(`Preset "${p.name}" dimuat`);
    }
  };

  const handleDelete = (presetName) => {
    if (!window.confirm(`Hapus preset "${presetName}"?`)) return;
    persist(presets.filter((p) => p.name !== presetName));
    toast.success("Preset dihapus");
  };

  return (
    <div className="flex items-center gap-2 mb-3 flex-wrap" data-testid={`filter-toolbar-${storageKey}`}>
      {showModeToggle && (
        <>
          <span className="text-[11px] uppercase tracking-[0.12em] font-bold text-slate-500">Mode Filter:</span>
          <div className="inline-flex rounded border border-slate-300 overflow-hidden" data-testid={`filter-mode-toggle-${storageKey}`}>
            <button
              type="button"
              data-testid={`filter-mode-or-${storageKey}`}
              onClick={() => setMode("OR")}
              className={`px-3 py-1 text-xs font-bold uppercase ${mode === "OR" ? "bg-blue-700 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
            >OR</button>
            <button
              type="button"
              data-testid={`filter-mode-and-${storageKey}`}
              onClick={() => setMode("AND")}
              className={`px-3 py-1 text-xs font-bold uppercase border-l border-slate-300 ${mode === "AND" ? "bg-blue-700 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
            >AND</button>
          </div>
        </>
      )}

      <div className="inline-flex items-center gap-2 ml-2 pl-3 border-l border-slate-200">
        <Bookmark size={13} className="text-purple-700"/>
        <span className="text-[11px] uppercase tracking-[0.12em] font-bold text-slate-500">Preset:</span>
        <select
          data-testid={`preset-load-${storageKey}`}
          value=""
          onChange={handleLoad}
          className="h-8 rounded border border-slate-300 px-2 text-xs bg-white"
        >
          <option value="">— Muat preset —</option>
          {presets.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
        </select>
        <button
          type="button"
          data-testid={`preset-save-btn-${storageKey}`}
          onClick={() => { setName(""); setShowSave(true); }}
          className="inline-flex items-center gap-1 text-xs font-bold text-purple-700 hover:text-purple-900"
          title="Simpan filter saat ini sebagai preset"
        >
          <Save size={12}/> Simpan
        </button>
        {presets.length > 0 && (
          <div className="relative group">
            <button type="button" className="inline-flex items-center gap-1 text-xs font-bold text-rose-700 hover:text-rose-900" data-testid={`preset-manage-btn-${storageKey}`}>
              <Trash2 size={12}/> Kelola
            </button>
            <div className="absolute right-0 top-full mt-1 hidden group-hover:block bg-white border border-slate-200 shadow-lg rounded p-2 z-30 min-w-[200px]">
              <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1 px-1">Preset Tersimpan</div>
              {presets.map((p) => (
                <div key={p.name} className="flex items-center justify-between gap-2 px-1 py-1 hover:bg-slate-50 rounded">
                  <span className="text-xs">{p.name}</span>
                  <button data-testid={`preset-delete-${storageKey}-${p.name}`} onClick={() => handleDelete(p.name)} className="text-rose-600 hover:text-rose-800">
                    <Trash2 size={11}/>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <span className="text-[11px] text-slate-500 ml-auto">{activeCount > 0 ? `${activeCount} filter aktif` : "Tidak ada filter aktif"}</span>

      {showSave && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid={`preset-save-modal-${storageKey}`}>
          <Card className="w-full max-w-sm p-6">
            <div className="flex items-start justify-between mb-3">
              <h3 className="font-heading font-bold text-lg">Simpan Preset Filter</h3>
              <button type="button" onClick={() => setShowSave(false)} className="p-1 hover:bg-slate-100 rounded"><X size={16}/></button>
            </div>
            <p className="text-xs text-slate-500 mb-3">Filter saat ini akan disimpan dengan nama yang Anda beri.</p>
            <Input
              data-testid={`preset-name-input-${storageKey}`}
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              placeholder="Mis. Pradana Bulan Ini Unpaid"
            />
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="secondary" type="button" onClick={() => setShowSave(false)}>Batal</Button>
              <Button data-testid={`preset-save-confirm-${storageKey}`} onClick={handleSave}><Save size={13}/> Simpan</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

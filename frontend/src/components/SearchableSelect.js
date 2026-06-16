import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";

/**
 * Searchable Select — combobox with type-to-filter.
 * Props:
 *   value          string (selected option value)
 *   onChange       (value) => void
 *   options        Array<{ value, label, sub?, disabled? }>
 *   placeholder    string
 *   emptyText      string
 *   testid         string (sets data-testid prefix)
 *   disabled       bool
 *   required       bool — adds hidden input for native form validation
 */
export default function SearchableSelect({
  value,
  onChange,
  options = [],
  placeholder = "— Pilih —",
  emptyText = "Tidak ada hasil",
  testid = "searchable-select",
  disabled = false,
  required = false,
  allowClear = true,
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 30); }, [open]);

  const selected = useMemo(() => options.find((o) => o.value === value), [options, value]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return options;
    return options.filter((o) => `${o.label || ""} ${o.sub || ""}`.toLowerCase().includes(s));
  }, [options, q]);

  const select = (v) => { onChange?.(v); setOpen(false); setQ(""); };
  const clear = (e) => { e.stopPropagation(); onChange?.(""); };

  return (
    <div className="relative" ref={ref} data-testid={testid}>
      {required && <input tabIndex={-1} required value={value || ""} onChange={() => {}} className="absolute opacity-0 h-0 w-0 -z-10" aria-hidden="true"/>}
      <button
        type="button"
        disabled={disabled}
        data-testid={`${testid}-trigger`}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={`w-full h-10 rounded border border-slate-300 bg-white px-3 text-sm text-left flex items-center gap-2 ${disabled ? "bg-slate-50 text-slate-400 cursor-not-allowed" : "hover:border-slate-400"} focus:outline-none focus:ring-2 focus:ring-blue-600`}
      >
        <span className={`flex-1 truncate ${selected ? "" : "text-slate-400"}`}>
          {selected ? (
            <>
              {selected.label}
              {selected.sub && <span className="ml-2 text-xs text-slate-500">{selected.sub}</span>}
            </>
          ) : placeholder}
        </span>
        {allowClear && selected && !disabled && (
          <button type="button" onClick={clear} className="p-0.5 hover:bg-slate-100 rounded" tabIndex={-1}><X size={12}/></button>
        )}
        <ChevronDown size={14} className="text-slate-400"/>
      </button>
      {open && !disabled && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded shadow-lg max-h-72 overflow-hidden flex flex-col" data-testid={`${testid}-dropdown`}>
          <div className="p-2 border-b border-slate-200">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
              <input
                ref={inputRef}
                data-testid={`${testid}-search`}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Ketik untuk cari..."
                className="w-full h-8 rounded border border-slate-300 pl-7 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 && <div className="px-3 py-4 text-xs text-slate-500 text-center">{emptyText}</div>}
            {filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                data-testid={`${testid}-opt-${o.value}`}
                disabled={o.disabled}
                onClick={() => select(o.value)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 ${o.value === value ? "bg-blue-100 font-bold" : ""} ${o.disabled ? "opacity-40 cursor-not-allowed" : ""}`}
              >
                <div>{o.label}</div>
                {o.sub && <div className="text-xs text-slate-500">{o.sub}</div>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

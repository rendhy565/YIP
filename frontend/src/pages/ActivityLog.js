import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Input, Label, Table, Th, Td } from "../components/ui";
import { fmtDate, parseServerDate } from "../lib/utils";
import { Activity, ChevronDown, ChevronRight } from "lucide-react";

const ACTION_COLORS = {
  create: "bg-emerald-50 text-emerald-800 border-emerald-200",
  update: "bg-blue-50 text-blue-800 border-blue-200",
  delete: "bg-red-50 text-red-800 border-red-200",
  import: "bg-amber-50 text-amber-800 border-amber-200",
  export: "bg-purple-50 text-purple-800 border-purple-200",
  auto_create: "bg-cyan-50 text-cyan-800 border-cyan-200",
};

export default function ActivityLog() {
  const [rows, setRows] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [filters, setFilters] = useState({
    start_date: new Date(Date.now() - 7*86400000).toISOString().slice(0,10),
    end_date: new Date().toISOString().slice(0,10),
    target_type: "", action: "",
  });

  const load = () => {
    const params = {};
    Object.keys(filters).forEach((k) => { if (filters[k]) params[k] = filters[k]; });
    api.get("/activity-logs", { params }).then((r) => setRows(r.data));
  };
  useEffect(() => { load(); }, [filters.start_date, filters.end_date, filters.target_type, filters.action]);

  // module dropdown: value = raw target_type, label = friendly module_label
  const moduleOpts = [...new Map(rows.filter((r) => r.target_type).map((r) => [r.target_type, r.module_label || r.target_type])).entries()];

  return (
    <div data-testid="activity-log-page">
      <PageHeader title="Activity Log" subtitle="Audit trail semua aksi CRUD yang dilakukan user di sistem — klik baris untuk lihat detail perubahan."/>

      <Card className="p-4 mb-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[140px]"><Label>Dari</Label><Input type="date" value={filters.start_date} onChange={(e) => setFilters({...filters, start_date: e.target.value})}/></div>
          <div className="min-w-[140px]"><Label>Sampai</Label><Input type="date" value={filters.end_date} onChange={(e) => setFilters({...filters, end_date: e.target.value})}/></div>
          <div className="min-w-[170px]"><Label>Modul</Label>
            <select data-testid="activity-module-filter" value={filters.target_type} onChange={(e) => setFilters({...filters, target_type: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded text-sm">
              <option value="">Semua</option>
              {moduleOpts.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
            </select>
          </div>
          <div className="min-w-[120px]"><Label>Aksi</Label>
            <select value={filters.action} onChange={(e) => setFilters({...filters, action: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded text-sm">
              <option value="">Semua</option>
              <option value="create">Create</option><option value="update">Update</option>
              <option value="delete">Delete</option><option value="import">Import</option>
              <option value="export">Export</option>
            </select>
          </div>
          <div className="ml-auto text-right">
            <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-slate-500">Total Log</div>
            <div className="font-heading font-black text-2xl text-slate-800">{rows.length}</div>
          </div>
        </div>
      </Card>

      <Card>
        <Table>
          <thead><tr>
            <Th>Waktu</Th><Th>User</Th><Th>Role</Th><Th>Aksi</Th><Th>Modul</Th><Th>Target</Th><Th>Detail</Th>
          </tr></thead>
          <tbody>
            {rows.map((r) => {
              const isOpen = expanded === r.id;
              const detailEntries = r.details && typeof r.details === "object" ? Object.entries(r.details) : [];
              const hasDetail = detailEntries.length > 0 || r.changes;
              return (
                <React.Fragment key={r.id}>
                  <tr data-testid={`activity-row-${r.id}`} className={`${hasDetail ? "cursor-pointer hover:bg-slate-50" : ""}`} onClick={() => hasDetail && setExpanded(isOpen ? null : r.id)}>
                    <Td className="text-xs font-mono text-slate-700 whitespace-nowrap">{parseServerDate(r.timestamp).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" })} <span className="text-slate-400">{parseServerDate(r.timestamp).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" })} WIB</span></Td>
                    <Td className="font-semibold">{r.user_name || "—"}</Td>
                    <Td><span className="text-[10px] uppercase font-bold text-slate-500">{r.user_role || "—"}</span></Td>
                    <Td>
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${ACTION_COLORS[r.action] || "bg-slate-50 text-slate-700 border-slate-200"}`}>
                        {r.action_label || r.action}
                      </span>
                    </Td>
                    <Td className="text-xs font-semibold text-slate-700">{r.module_label || r.target_type}</Td>
                    <Td className="text-xs">{r.entity_label ? <span className="font-semibold text-slate-800">{r.entity_label}</span> : (r.target_id ? <span className="text-[10px] text-slate-400">#{(r.target_id||"").slice(-6)}</span> : "—")}</Td>
                    <Td className="text-xs text-slate-600 max-w-md">
                      <div className="flex items-start gap-1">
                        {hasDetail && (isOpen ? <ChevronDown size={13} className="mt-0.5 shrink-0 text-slate-400"/> : <ChevronRight size={13} className="mt-0.5 shrink-0 text-slate-400"/>)}
                        <span className={isOpen ? "" : "line-clamp-1"}>{r.changes || r.summary || `${r.method} ${r.path}`}</span>
                      </div>
                    </Td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-slate-50">
                      <Td colSpan={7} className="p-0">
                        <div className="px-6 py-3">
                          <div className="text-[11px] uppercase tracking-wide font-bold text-slate-500 mb-2">Detail Perubahan</div>
                          {detailEntries.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5">
                              {detailEntries.map(([k, v]) => (
                                <div key={k} className="text-xs flex gap-2">
                                  <span className="font-semibold text-slate-500 min-w-[110px]">{k}</span>
                                  <span className="font-mono text-slate-800 break-all">{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
                                </div>
                              ))}
                            </div>
                          ) : <div className="text-xs text-slate-500">{r.changes || "Tidak ada detail field."}</div>}
                          <div className="mt-2 text-[10px] text-slate-400 font-mono">{r.method} {r.path}</div>
                        </div>
                      </Td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {rows.length === 0 && <tr><Td colSpan={7} className="text-center text-slate-500 py-10"><Activity size={28} className="mx-auto opacity-30 mb-2"/>Belum ada aktivitas.</Td></tr>}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

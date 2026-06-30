import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button } from "../components/ui";
import { toast } from "sonner";
import { errMsg } from "../lib/utils";
import { Shield, Check, X, Save, Lock } from "lucide-react";

const ROLES = ["finance", "operation", "marketing", "viewer"];

export default function RoleMatrix() {
  const [data, setData] = useState({ modules: [], actions: [], matrix: {} });
  const [activeRole, setActiveRole] = useState("finance");
  const [dirty, setDirty] = useState({});
  const [saving, setSaving] = useState(false);

  const load = () => api.get("/rbac/matrix").then((r) => setData(r.data));
  useEffect(() => { load(); }, []);

  const currentPerms = (() => {
    const role = activeRole;
    const fromMatrix = data.matrix[role] || {};
    const merged = {};
    data.modules.forEach((m) => {
      merged[m.key] = { ...(fromMatrix[m.key] || {}), ...(dirty[role]?.[m.key] || {}) };
    });
    return merged;
  })();

  const toggle = (moduleKey, action) => {
    setDirty((d) => {
      const role = activeRole;
      const cur = (d[role]?.[moduleKey]?.[action] !== undefined)
        ? d[role][moduleKey][action]
        : (data.matrix[role]?.[moduleKey]?.[action] || false);
      return {
        ...d,
        [role]: {
          ...(d[role] || {}),
          [moduleKey]: { ...(d[role]?.[moduleKey] || {}), [action]: !cur },
        },
      };
    });
  };

  const toggleAll = (moduleKey, value) => {
    setDirty((d) => {
      const obj = {};
      data.actions.forEach((a) => { obj[a] = value; });
      return {
        ...d,
        [activeRole]: { ...(d[activeRole] || {}), [moduleKey]: obj },
      };
    });
  };

  const save = async () => {
    if (!dirty[activeRole]) { toast.info("Tidak ada perubahan"); return; }
    setSaving(true);
    try {
      // Merge with existing matrix to ensure all modules submitted
      const merged = {};
      data.modules.forEach((m) => {
        merged[m.key] = {
          ...(data.matrix[activeRole]?.[m.key] || {}),
          ...(dirty[activeRole]?.[m.key] || {}),
        };
      });
      await api.post("/rbac/update", { role: activeRole, permissions: merged });
      toast.success(`Permissions saved for ${activeRole}`);
      setDirty((d) => { const c = { ...d }; delete c[activeRole]; return c; });
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setSaving(false); }
  };

  return (
    <div data-testid="rbac-page">
      <PageHeader
        title="Role Permissions"
        subtitle="Atur per-aksi per-modul untuk setiap role. Administrator selalu full access (terkunci)."
        action={dirty[activeRole] && (
          <Button data-testid="save-rbac-btn" onClick={save} disabled={saving}><Save size={14}/> {saving ? "Saving..." : "Simpan Perubahan"}</Button>
        )}
      />

      <Card className="p-3 mb-4">
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs uppercase font-bold text-slate-500 mr-2">Role:</span>
          {ROLES.map((r) => (
            <button
              key={r}
              data-testid={`role-tab-${r}`}
              onClick={() => setActiveRole(r)}
              className={`px-3 py-1.5 rounded text-sm font-semibold uppercase transition ${activeRole === r ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
            >
              {r}{dirty[r] && <span className="ml-1 text-amber-400">●</span>}
            </button>
          ))}
          <button disabled className="px-3 py-1.5 rounded text-sm font-semibold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1 cursor-not-allowed">
            <Lock size={12}/> Administrator (full)
          </button>
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-3 py-2 font-bold text-xs uppercase text-slate-600">Modul</th>
                {data.actions.map((a) => (
                  <th key={a} className="text-center px-3 py-2 font-bold text-xs uppercase text-slate-600">{a}</th>
                ))}
                <th className="text-center px-3 py-2 font-bold text-xs uppercase text-slate-600">All</th>
              </tr>
            </thead>
            <tbody>
              {data.modules.map((m) => {
                const allOn = data.actions.every((a) => currentPerms[m.key]?.[a]);
                return (
                  <tr key={m.key} className="border-b border-slate-100 hover:bg-slate-50/50">
                    <td className="px-3 py-2"><div className="font-semibold">{m.label}</div><div className="text-[10px] font-mono text-slate-400">{m.key}</div></td>
                    {data.actions.map((a) => {
                      const v = currentPerms[m.key]?.[a] || false;
                      return (
                        <td key={a} className="text-center px-3 py-2">
                          <button
                            data-testid={`rbac-${activeRole}-${m.key}-${a}`}
                            onClick={() => toggle(m.key, a)}
                            className={`w-7 h-7 rounded transition flex items-center justify-center ${v ? "bg-emerald-500 text-white hover:bg-emerald-600" : "bg-slate-100 text-slate-400 hover:bg-slate-200"}`}
                          >
                            {v ? <Check size={14}/> : <X size={14}/>}
                          </button>
                        </td>
                      );
                    })}
                    <td className="text-center px-3 py-2">
                      <button onClick={() => toggleAll(m.key, !allOn)} className={`text-[10px] uppercase font-bold px-2 py-1 rounded ${allOn ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                        {allOn ? "OFF" : "ON"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900 flex items-start gap-2">
        <Shield size={14} className="mt-0.5"/>
        <div>
          <strong>Catatan Fase A:</strong> Permission ini di-enforce di FRONTEND (hide tombol/menu sesuai role).
          Backend tetap pakai role-level guard. Untuk enforcement penuh di backend (Fase B), perlu hook tambahan di tiap endpoint.
        </div>
      </div>
    </div>
  );
}

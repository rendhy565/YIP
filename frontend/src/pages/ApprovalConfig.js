import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Label } from "../components/ui";
import { errMsg } from "../lib/utils";
import { toast } from "sonner";
import { Plus, X, Trash2, Save, ShieldCheck } from "lucide-react";
import { useAuth } from "../lib/auth";

const DOC_TYPES = [
  { key: "cash_advance", label: "Panjar Kerja" },
  // Extend nanti: invoice, payment, etc
];

export default function ApprovalConfig() {
  const { user } = useAuth();
  const isAdmin = user?.role === "administrator";
  const [users, setUsers] = useState([]);
  const [configs, setConfigs] = useState({}); // {doc_type: config}
  const [editing, setEditing] = useState(null); // {doc_type, enabled, steps}
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const [usersRes, configsRes] = await Promise.all([
        api.get("/users"),
        api.get("/approval-configs"),
      ]);
      setUsers(usersRes.data.filter((u) => u.active !== false));
      const map = {};
      (configsRes.data || []).forEach((c) => { map[c.document_type] = c; });
      setConfigs(map);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  useEffect(() => { load(); }, []);

  const openEditor = (docType) => {
    const existing = configs[docType];
    setEditing({
      document_type: docType,
      enabled: existing ? existing.enabled : true,
      steps: existing?.steps?.length > 0
        ? existing.steps.map((s) => ({ name: s.name, approver_ids: [...(s.approver_ids || [])] }))
        : [{ name: "Di Cek Oleh", approver_ids: [] }, { name: "Approval MGR", approver_ids: [] }],
    });
  };

  const save = async () => {
    // Validate
    for (const s of editing.steps) {
      if (!s.name.trim()) return toast.error("Nama step wajib diisi");
      if (s.approver_ids.length === 0) return toast.error(`Step "${s.name}" belum punya approver`);
    }
    setSaving(true);
    try {
      await api.post("/approval-configs", editing);
      toast.success("Konfigurasi tersimpan");
      setEditing(null);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const del = async (docType) => {
    if (!window.confirm(`Hapus config approval untuk "${DOC_TYPES.find((d) => d.key === docType)?.label}"?`)) return;
    try {
      await api.delete(`/approval-configs/${docType}`);
      toast.success("Config dihapus");
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const toggleApprover = (stepIdx, userId) => {
    const steps = editing.steps.map((s, i) => {
      if (i !== stepIdx) return s;
      const has = s.approver_ids.includes(userId);
      return { ...s, approver_ids: has ? s.approver_ids.filter((x) => x !== userId) : [...s.approver_ids, userId] };
    });
    setEditing({ ...editing, steps });
  };

  const updateStepName = (idx, name) => {
    setEditing({ ...editing, steps: editing.steps.map((s, i) => i === idx ? { ...s, name } : s) });
  };

  const addStep = () => {
    setEditing({ ...editing, steps: [...editing.steps, { name: "", approver_ids: [] }] });
  };

  const removeStep = (idx) => {
    if (editing.steps.length <= 1) return toast.error("Minimal 1 step");
    setEditing({ ...editing, steps: editing.steps.filter((_, i) => i !== idx) });
  };

  if (!isAdmin) {
    return (
      <div className="p-8 text-center text-slate-500">
        Hanya administrator yang bisa mengatur konfigurasi approval.
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="approval-config-page">
      <PageHeader title="Konfigurasi Approval" subtitle="Atur workflow approval per tipe dokumen" />

      <div className="grid gap-4 md:grid-cols-2">
        {DOC_TYPES.map((dt) => {
          const cfg = configs[dt.key];
          return (
            <Card key={dt.key} className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={18} className="text-blue-600" />
                  <div>
                    <div className="font-bold text-lg">{dt.label}</div>
                    <div className="text-xs text-slate-500 font-mono">{dt.key}</div>
                  </div>
                </div>
                <div>
                  {cfg ? (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${cfg.enabled ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>
                      {cfg.enabled ? "Aktif" : "Nonaktif"}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-slate-100 text-slate-500">Belum diset</span>
                  )}
                </div>
              </div>

              {cfg ? (
                <div className="space-y-1.5 mb-3">
                  {(cfg.steps || []).map((s, i) => (
                    <div key={i} className="text-xs bg-slate-50 rounded px-2 py-1.5 border">
                      <div className="font-semibold">{i + 1}. {s.name}</div>
                      <div className="text-slate-500 text-[11px]">
                        {(s.approver_ids || []).map((uid) => users.find((u) => u.id === uid)?.full_name || users.find((u) => u.id === uid)?.username || uid).join(", ") || "(no approvers)"}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-400 italic mb-3">Belum ada workflow. Click "Set Workflow" untuk mulai.</div>
              )}

              <div className="flex gap-2">
                <Button data-testid={`edit-config-${dt.key}`} onClick={() => openEditor(dt.key)} className="text-xs">
                  {cfg ? "Edit" : "Set Workflow"}
                </Button>
                {cfg && (
                  <Button variant="secondary" onClick={() => del(dt.key)} className="text-xs">
                    <Trash2 size={12} className="mr-1" /> Hapus
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="edit-config-modal">
          <Card className="w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-heading font-bold text-xl">Konfigurasi Workflow</h3>
                <p className="text-xs text-slate-500 font-mono">{editing.document_type}</p>
              </div>
              <button onClick={() => setEditing(null)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>

            <div className="mb-4">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  data-testid="config-enabled"
                  checked={editing.enabled}
                  onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
                />
                <span className="text-sm font-semibold">Approval Aktif</span>
              </label>
              <p className="text-[11px] text-slate-500 mt-1">Kalau aktif, setiap dokumen baru harus melewati approval sebelum bisa diproses (mis. print BKK).</p>
            </div>

            <div className="space-y-3">
              {editing.steps.map((step, idx) => (
                <div key={idx} className="border rounded-lg p-3 bg-slate-50">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="font-bold text-slate-700 text-sm">Step {idx + 1}</div>
                    <Input
                      data-testid={`step-name-${idx}`}
                      value={step.name}
                      onChange={(e) => updateStepName(idx, e.target.value)}
                      placeholder="Nama Step (mis: Di Cek Oleh, Approval MGR)"
                      className="flex-1"
                    />
                    <button onClick={() => removeStep(idx)} className="p-1.5 rounded hover:bg-red-50 text-red-600"><Trash2 size={14}/></button>
                  </div>
                  <Label>Approvers (bisa multi — siapapun yang di-checklist bisa approve)</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 mt-1 max-h-48 overflow-y-auto border rounded p-2 bg-white">
                    {users.map((u) => {
                      const checked = step.approver_ids.includes(u.id);
                      return (
                        <label key={u.id} className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-sm ${checked ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                          <input
                            type="checkbox"
                            data-testid={`approver-${idx}-${u.username}`}
                            checked={checked}
                            onChange={() => toggleApprover(idx, u.id)}
                          />
                          <span className="font-semibold">{u.full_name || u.username}</span>
                          <span className="text-[10px] text-slate-400">{u.role}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex justify-between items-center">
              <Button variant="secondary" onClick={addStep}>
                <Plus size={14} className="mr-1"/> Tambah Step
              </Button>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setEditing(null)}>Batal</Button>
                <Button data-testid="save-config" onClick={save} disabled={saving}>
                  <Save size={14} className="mr-1"/> {saving ? "Menyimpan..." : "Simpan"}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

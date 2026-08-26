import React, { useEffect, useState, useCallback } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Table, Th, Td } from "../components/ui";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Clock, FileText } from "lucide-react";
import { useAuth } from "../lib/auth";
import Pagination, { usePagination } from "../components/Pagination";

const DOC_TYPE_LABELS = {
  cash_advance: "Panjar Kerja",
};

export default function Approvals() {
  const { user } = useAuth();
  const [tab, setTab] = useState("pending"); // pending | mine | all
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actioning, setActioning] = useState(null); // {approval, action}
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const scope = tab === "pending" ? "pending_for_me" : (tab === "mine" ? "mine" : "all");
      const { data } = await api.get(`/approvals?scope=${scope}`);
      setRows(data);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const pag = usePagination(rows, { resetKey: tab });

  const submitAction = async () => {
    if (!actioning) return;
    if (actioning.action === "reject" && !note.trim()) {
      toast.error("Catatan wajib diisi saat reject");
      return;
    }
    try {
      await api.post(`/approvals/${actioning.approval.id}/${actioning.action}`, { note });
      toast.success(actioning.action === "approve" ? "Disetujui" : "Ditolak");
      setActioning(null);
      setNote("");
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const tabs = [
    { key: "pending", label: "Menunggu Approval Saya", icon: Clock },
    { key: "mine", label: "Pengajuan Saya", icon: FileText },
    { key: "all", label: "Semua", icon: FileText },
  ];

  return (
    <div className="space-y-4" data-testid="approvals-page">
      <PageHeader title="Approval" subtitle="Persetujuan dokumen yang memerlukan approval" />

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            data-testid={`approval-tab-${t.key}`}
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold border transition ${
              tab === t.key
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
            }`}
          >
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        {loading ? (
          <div className="text-center py-8 text-slate-500">Memuat…</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-8 text-slate-500">Tidak ada data.</div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Dokumen</Th>
                <Th>Tipe</Th>
                <Th>Detail</Th>
                <Th className="text-right">Nilai</Th>
                <Th>Status / Step</Th>
                <Th className="text-right">Aksi</Th>
              </tr>
            </thead>
            <tbody>
              {pag.paged.map((a) => {
                const snap = a.document_snapshot || {};
                const currentStepIdx = a.current_step_idx || 0;
                const steps = a.steps || [];
                const currentStep = steps[currentStepIdx];
                const canAct = a.status === "Pending" && currentStep?.approver_ids?.includes(user?.id);
                return (
                  <tr key={a.id} data-testid={`approval-row-${a.document_number}`} className="hover:bg-slate-50">
                    <Td className="font-mono font-bold">{a.document_number}</Td>
                    <Td className="text-xs">{DOC_TYPE_LABELS[a.document_type] || a.document_type}</Td>
                    <Td className="text-xs">
                      <div className="font-semibold">{snap.recipient_name || "-"}</div>
                      <div className="text-slate-500">{snap.purpose || "-"}</div>
                      <div className="text-slate-400 text-[10px]">{fmtDate(snap.advance_date)}</div>
                    </Td>
                    <Td className="text-right font-semibold">{snap.amount ? fmtIDR(snap.amount) : "-"}</Td>
                    <Td>
                      <StatusBadge status={a.status} />
                      <div className="mt-1 space-y-0.5">
                        {steps.map((s, i) => {
                          const isCurrent = a.status === "Pending" && i === currentStepIdx;
                          const done = s.status === "Approved";
                          const rejected = s.status === "Rejected";
                          return (
                            <div key={i} className={`text-[10px] flex items-center gap-1 ${done ? "text-emerald-700" : rejected ? "text-red-700" : isCurrent ? "text-blue-700 font-bold" : "text-slate-400"}`}>
                              <span>{done ? "✓" : rejected ? "✗" : isCurrent ? "▸" : "○"}</span>
                              <span>{s.name}</span>
                              {s.approved_by_name && <span className="text-slate-500">— {s.approved_by_name}</span>}
                            </div>
                          );
                        })}
                      </div>
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      {canAct ? (
                        <div className="flex gap-1 justify-end">
                          <button data-testid={`approve-${a.document_number}`} onClick={() => { setActioning({ approval: a, action: "approve" }); setNote(""); }} className="px-2 py-1 text-[10px] uppercase font-bold rounded bg-emerald-100 text-emerald-800 hover:bg-emerald-200 inline-flex items-center gap-1">
                            <CheckCircle2 size={11} /> Approve
                          </button>
                          <button data-testid={`reject-${a.document_number}`} onClick={() => { setActioning({ approval: a, action: "reject" }); setNote(""); }} className="px-2 py-1 text-[10px] uppercase font-bold rounded bg-red-100 text-red-800 hover:bg-red-200 inline-flex items-center gap-1">
                            <XCircle size={11} /> Reject
                          </button>
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-400">—</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        {rows.length > 0 && <Pagination {...pag} testid="pagination-approvals"/>}
      </Card>

      {actioning && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="approval-action-modal">
          <Card className="w-full max-w-lg p-6">
            <h3 className="font-heading font-bold text-xl mb-3">
              {actioning.action === "approve" ? "Setujui" : "Tolak"} {actioning.approval.document_number}
            </h3>
            <div className="text-sm mb-4 space-y-1 text-slate-700">
              <div><b>Penerima:</b> {actioning.approval.document_snapshot?.recipient_name}</div>
              <div><b>Nilai:</b> {fmtIDR(actioning.approval.document_snapshot?.amount)}</div>
              <div><b>Keperluan:</b> {actioning.approval.document_snapshot?.purpose || "-"}</div>
            </div>
            <div className="mb-4">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
                Catatan {actioning.action === "reject" ? "(wajib)" : "(opsional)"}
              </label>
              <textarea
                data-testid="approval-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                placeholder={actioning.action === "reject" ? "Alasan penolakan..." : "Catatan tambahan..."}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => { setActioning(null); setNote(""); }}>Batal</Button>
              <Button data-testid="approval-submit" onClick={submitAction} className={actioning.action === "approve" ? "" : "bg-red-600 hover:bg-red-700"}>
                {actioning.action === "approve" ? "Setujui" : "Tolak"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const cls = {
    Pending: "bg-amber-100 text-amber-800 border-amber-300",
    Approved: "bg-emerald-100 text-emerald-800 border-emerald-300",
    Rejected: "bg-red-100 text-red-800 border-red-300",
  }[status] || "bg-slate-100 text-slate-700 border-slate-300";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${cls}`}>
      {status}
    </span>
  );
}

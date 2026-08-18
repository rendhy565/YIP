import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Table, Th, Td } from "../components/ui";
import { errMsg } from "../lib/utils";
import { toast } from "sonner";
import { GitMerge, AlertTriangle, RefreshCw, Users, Check, ShieldAlert } from "lucide-react";

export default function CustomerMerge() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [canonical, setCanonical] = useState({}); // norm_key -> customer id
  const [merging, setMerging] = useState(null); // norm_key currently merging

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/admin/customers/duplicates");
      setGroups(r.data.groups || []);
      const init = {};
      (r.data.groups || []).forEach((g) => { init[g.norm_key] = g.suggested_canonical_id; });
      setCanonical(init);
      setLoaded(true);
    } catch (e) { toast.error(errMsg(e)); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const merge = async (g) => {
    const canonId = canonical[g.norm_key];
    if (!canonId) { toast.error("Pilih dulu customer utama"); return; }
    const dupIds = g.members.map((m) => m.id).filter((id) => id !== canonId);
    const canonName = g.members.find((m) => m.id === canonId)?.name;
    if (!window.confirm(
      `Gabungkan ${dupIds.length} customer duplikat ke "${canonName}"?\n\n` +
      `Semua AWB, kontrak & sender dari duplikat akan dipindahkan ke customer utama, ` +
      `field kosong pada customer utama diisi dari duplikat, lalu duplikatnya DIHAPUS. ` +
      `Tindakan ini tidak bisa dibatalkan.`
    )) return;
    setMerging(g.norm_key);
    try {
      const r = await api.post("/admin/customers/merge", { canonical_id: canonId, duplicate_ids: dupIds });
      const d = r.data;
      toast.success(
        `Digabung ke "${d.canonical}": ${d.awb_moved} AWB, ${d.contract_moved} kontrak, ${d.sender_moved} sender dipindah; ${d.customers_deleted} duplikat dihapus` +
        (d.filled_fields?.length ? `; field diisi: ${d.filled_fields.join(", ")}` : "")
      );
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setMerging(null); }
  };

  return (
    <div data-testid="customer-merge-page">
      <PageHeader
        title="Gabung Customer Duplikat"
        subtitle="Satukan record customer kembar (nama sama walau beda huruf besar-kecil/spasi/tanda baca). AWB, kontrak & data lain dipindahkan ke satu customer utama, sehingga Attn & Default PPN kembali muncul di invoice."
      />

      <Card className="p-4 mb-5">
        <div className="mb-3 flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            Fitur khusus super admin. <strong>Customer utama</strong> = yang datanya dipertahankan (disarankan yang sudah ada Attn/Default PPN).
            Customer lain dalam grup akan dihapus setelah semua AWB/kontrak/sender-nya dipindahkan ke customer utama. Field kosong pada customer utama otomatis diisi dari duplikat.
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Button data-testid="refresh-duplicates-btn" variant="secondary" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> {loading ? "Memuat..." : "Muat Ulang"}
          </Button>
          <span className="text-xs text-slate-500">{groups.length} grup duplikat ditemukan</span>
        </div>
      </Card>

      {loaded && groups.length === 0 && (
        <Card className="p-10 text-center">
          <Check size={40} className="mx-auto text-emerald-500 mb-3" />
          <p className="font-semibold text-slate-700">Tidak ada customer duplikat 🎉</p>
          <p className="text-sm text-slate-500 mt-1">Semua nama customer sudah unik.</p>
        </Card>
      )}

      <div className="space-y-5">
        {groups.map((g) => {
          const canonId = canonical[g.norm_key];
          const dupCount = g.members.filter((m) => m.id !== canonId).length;
          return (
            <Card key={g.norm_key} data-testid={`dup-group-${g.norm_key}`}>
              <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
                <h3 className="font-bold inline-flex items-center gap-2">
                  <Users size={16} className="text-indigo-600" /> {g.members[0]?.name}
                </h3>
                <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 font-semibold">{g.count} record kembar</span>
                <div className="ml-auto">
                  <Button
                    data-testid={`merge-group-btn-${g.norm_key}`}
                    onClick={() => merge(g)}
                    disabled={merging === g.norm_key || dupCount === 0}
                  >
                    <GitMerge size={14} /> {merging === g.norm_key ? "Menggabung..." : `Gabung (${dupCount})`}
                  </Button>
                </div>
              </div>
              <Table>
                <thead><tr>
                  <Th className="w-16 text-center">Utama</Th>
                  <Th>Nama Customer</Th>
                  <Th>Attn</Th>
                  <Th className="text-right">Default PPN</Th>
                  <Th>Alamat / NPWP</Th>
                  <Th className="text-right">AWB</Th>
                  <Th className="text-right">Kontrak</Th>
                  <Th className="text-right">Sender</Th>
                </tr></thead>
                <tbody>
                  {g.members.map((m) => {
                    const isCanon = m.id === canonId;
                    return (
                      <tr key={m.id} data-testid={`dup-member-${m.id}`} className={isCanon ? "bg-emerald-50/60" : ""}>
                        <Td className="text-center">
                          <input
                            type="radio"
                            data-testid={`pick-canonical-${m.id}`}
                            name={`canon-${g.norm_key}`}
                            checked={isCanon}
                            onChange={() => setCanonical((c) => ({ ...c, [g.norm_key]: m.id }))}
                            className="h-4 w-4 accent-emerald-600 cursor-pointer"
                          />
                        </Td>
                        <Td className="font-medium">
                          {m.name}
                          {isCanon && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-600 text-white font-bold">UTAMA</span>}
                          {!isCanon && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 font-semibold">akan dihapus</span>}
                        </Td>
                        <Td className="text-sm">
                          {m.attn ? <span className="text-emerald-700 font-medium">{m.attn}</span> : <span className="text-slate-400">—</span>}
                        </Td>
                        <Td className="text-right text-sm">
                          {(m.default_ppn_percentage ?? null) !== null && m.default_ppn_percentage !== "" ? `${m.default_ppn_percentage}%` : <span className="text-slate-400">—</span>}
                        </Td>
                        <Td className="text-xs text-slate-600 max-w-[220px] truncate">
                          {m.address || m.npwp ? `${m.address || ""}${m.npwp ? " · NPWP " + m.npwp : ""}` : <span className="text-slate-400">—</span>}
                        </Td>
                        <Td className="text-right font-semibold">{m.awb_count}</Td>
                        <Td className="text-right">{m.contract_count}</Td>
                        <Td className="text-right">{m.sender_count}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
              {dupCount === 0 && (
                <div className="px-4 py-2 text-[11px] text-amber-700 bg-amber-50 border-t border-amber-200 inline-flex items-center gap-1">
                  <ShieldAlert size={13} /> Pilih customer utama yang berbeda agar ada yang bisa digabung.
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

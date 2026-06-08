import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Select, Label, Table, Th, Td } from "../components/ui";
import { errMsg, fmtDate } from "../lib/utils";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";
import { Plus, Trash2, X, KeyRound, Pencil, ShieldCheck, User } from "lucide-react";

const ROLE_BADGES = {
  administrator: "bg-rose-100 text-rose-800 border-rose-200",
  operation: "bg-blue-100 text-blue-800 border-blue-200",
  finance: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

const newForm = () => ({ username: "", password: "", full_name: "", role: "operation", permissions: [] });

export default function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [modules, setModules] = useState([]);
  const [openCreate, setOpenCreate] = useState(false);
  const [openEdit, setOpenEdit] = useState(null); // user obj or null
  const [openPw, setOpenPw] = useState(null);     // user obj or null
  const [form, setForm] = useState(newForm());
  const [newPw, setNewPw] = useState("");

  const load = () => api.get("/users").then((r) => setUsers(r.data));
  useEffect(() => {
    api.get("/modules").then((r) => setModules(r.data));
    load();
  }, []);

  const togglePerm = (key) => {
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(key)
        ? f.permissions.filter((p) => p !== key)
        : [...f.permissions, key],
    }));
  };

  const applyRoleDefaults = (role) => {
    const def = modules.filter((m) => m.default_roles.includes(role) || role === "administrator").map((m) => m.key);
    const all = role === "administrator" ? modules.map((m) => m.key) : def;
    setForm((f) => ({ ...f, role, permissions: all }));
  };

  const submitCreate = async (e) => {
    e.preventDefault();
    try {
      await api.post("/users", form);
      toast.success(`User '${form.username}' dibuat`);
      setOpenCreate(false); setForm(newForm()); load();
    } catch (e2) { toast.error(errMsg(e2)); }
  };

  const submitEdit = async (e) => {
    e.preventDefault();
    try {
      await api.put(`/users/${openEdit.id}`, {
        full_name: form.full_name,
        role: form.role,
        permissions: form.permissions,
      });
      toast.success("User diperbarui");
      setOpenEdit(null); load();
    } catch (e2) { toast.error(errMsg(e2)); }
  };

  const submitPw = async (e) => {
    e.preventDefault();
    try {
      await api.put(`/users/${openPw.id}/password`, { password: newPw });
      toast.success("Password direset");
      setOpenPw(null); setNewPw("");
    } catch (e2) { toast.error(errMsg(e2)); }
  };

  const toggleActive = async (u) => {
    try {
      await api.put(`/users/${u.id}`, { active: !u.active });
      toast.success(u.active ? "User dinonaktifkan" : "User diaktifkan");
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const del = async (u) => {
    if (!window.confirm(`Hapus user '${u.username}'?`)) return;
    try { await api.delete(`/users/${u.id}`); toast.success("Dihapus"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div data-testid="users-page">
      <PageHeader
        title="User Management"
        subtitle="Buat user baru, atur role & permission per modul."
        action={
          <Button data-testid="add-user-btn" onClick={() => { setForm(newForm()); applyRoleDefaults("operation"); setOpenCreate(true); }}>
            <Plus size={16}/> Tambah User
          </Button>
        }
      />

      <Card>
        <Table>
          <thead><tr>
            <Th>Username</Th><Th>Nama Lengkap</Th><Th>Role</Th>
            <Th className="text-center">Permission</Th><Th>Status</Th><Th>Dibuat</Th><Th className="text-right">Aksi</Th>
          </tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} data-testid={`user-row-${u.id}`}>
                <Td>
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs uppercase">
                      {u.username.slice(0, 2)}
                    </div>
                    <span className="font-semibold">{u.username}</span>
                    {u.id === me?.id && <span className="text-[10px] uppercase font-bold text-blue-600">(Anda)</span>}
                  </div>
                </Td>
                <Td className="text-slate-700">{u.full_name || "-"}</Td>
                <Td>
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${ROLE_BADGES[u.role] || "bg-slate-100 text-slate-700 border-slate-200"}`}>
                    {u.role === "administrator" ? <ShieldCheck size={11}/> : <User size={11}/>}
                    {u.role}
                  </span>
                </Td>
                <Td className="text-center">
                  <span className="font-mono text-xs">{(u.permissions || []).length}</span>
                  <span className="text-slate-400 text-[10px]"> / {modules.length}</span>
                </Td>
                <Td>
                  <button
                    data-testid={`toggle-active-${u.id}`}
                    onClick={() => toggleActive(u)}
                    className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase ${u.active !== false ? "text-emerald-700" : "text-red-700"}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${u.active !== false ? "bg-emerald-500" : "bg-red-500"}`}></span>
                    {u.active !== false ? "Aktif" : "Nonaktif"}
                  </button>
                </Td>
                <Td className="text-xs text-slate-500">{fmtDate(u.created_at)}</Td>
                <Td className="text-right whitespace-nowrap">
                  <button
                    data-testid={`edit-user-${u.id}`}
                    title="Edit"
                    onClick={() => { setForm({ username: u.username, password: "", full_name: u.full_name || "", role: u.role, permissions: u.permissions || [] }); setOpenEdit(u); }}
                    className="p-1.5 rounded hover:bg-slate-100 text-slate-600"
                  ><Pencil size={14}/></button>
                  <button
                    data-testid={`reset-pw-${u.id}`}
                    title="Reset password"
                    onClick={() => { setNewPw(""); setOpenPw(u); }}
                    className="p-1.5 rounded hover:bg-amber-50 text-amber-700 ml-1"
                  ><KeyRound size={14}/></button>
                  {u.id !== me?.id && (
                    <button
                      title="Hapus"
                      onClick={() => del(u)}
                      className="p-1.5 rounded hover:bg-red-50 text-red-600 ml-1"
                    ><Trash2 size={14}/></button>
                  )}
                </Td>
              </tr>
            ))}
            {users.length === 0 && <tr><Td colSpan={7} className="text-center text-slate-500 py-8">Belum ada user.</Td></tr>}
          </tbody>
        </Table>
      </Card>

      {/* Create / Edit modal */}
      {(openCreate || openEdit) && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <Card className="w-full max-w-2xl my-8 p-6">
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-heading font-bold text-xl">{openCreate ? "Tambah User Baru" : `Edit User: ${openEdit?.username}`}</h3>
              <button onClick={() => { setOpenCreate(false); setOpenEdit(null); }} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <form onSubmit={openCreate ? submitCreate : submitEdit} className="space-y-4">
              {openCreate && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label>Username *</Label>
                    <Input data-testid="user-username-input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required placeholder="min 3 karakter, lowercase"/>
                  </div>
                  <div>
                    <Label>Password *</Label>
                    <Input data-testid="user-password-input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required placeholder="min 6 karakter"/>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label>Nama Lengkap</Label>
                  <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })}/>
                </div>
                <div>
                  <Label>Role *</Label>
                  <Select data-testid="user-role-select" value={form.role} onChange={(e) => applyRoleDefaults(e.target.value)}>
                    <option value="administrator">Administrator (akses penuh)</option>
                    <option value="operation">Operation</option>
                    <option value="finance">Finance</option>
                  </Select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Permission Modul</Label>
                  <button type="button" onClick={() => applyRoleDefaults(form.role)} className="text-[11px] font-bold uppercase tracking-wider text-blue-700 hover:underline">
                    Reset ke Default Role
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 border border-slate-200 rounded p-3 bg-slate-50">
                  {modules.map((m) => (
                    <label key={m.key} className="flex items-center gap-2 p-2 rounded hover:bg-white cursor-pointer">
                      <input
                        type="checkbox"
                        data-testid={`perm-${m.key}`}
                        checked={form.permissions.includes(m.key)}
                        onChange={() => togglePerm(m.key)}
                        className="rounded border-slate-400"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-semibold text-slate-800">{m.label}</div>
                        <div className="text-[10px] text-slate-500 font-mono">{m.key}</div>
                      </div>
                    </label>
                  ))}
                </div>
                <div className="text-[11px] text-slate-500 mt-2">{form.permissions.length} dari {modules.length} modul aktif</div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <Button variant="secondary" type="button" onClick={() => { setOpenCreate(false); setOpenEdit(null); }}>Batal</Button>
                <Button data-testid="save-user-btn" type="submit">{openCreate ? "Buat User" : "Simpan"}</Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Reset password modal */}
      {openPw && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md p-6">
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-heading font-bold text-xl">Reset Password</h3>
              <button onClick={() => setOpenPw(null)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <p className="text-sm text-slate-600 mb-3">User: <span className="font-mono font-bold">{openPw.username}</span></p>
            <form onSubmit={submitPw} className="space-y-3">
              <div>
                <Label>Password Baru *</Label>
                <Input data-testid="new-pw-input" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} required placeholder="min 6 karakter"/>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" type="button" onClick={() => setOpenPw(null)}>Batal</Button>
                <Button data-testid="save-pw-btn" type="submit"><KeyRound size={14}/> Reset</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}

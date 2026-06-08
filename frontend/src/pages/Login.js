import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { errMsg } from "../lib/utils";
import { toast } from "sonner";
import { Truck, Lock, User } from "lucide-react";

export default function Login() {
  const { login, user } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) {
    nav("/", { replace: true });
  }

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await login(username.trim(), password);
      toast.success("Login berhasil");
      nav("/", { replace: true });
    } catch (e2) {
      toast.error(errMsg(e2, "Login gagal"));
    } finally {
      setBusy(false);
    }
  };

  const applyDemo = (u, p) => {
    setUsername(u);
    setPassword(p);
  };

  return (
    <div className="min-h-screen login-bg flex items-center justify-center p-6">
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-2 bg-white rounded-lg overflow-hidden shadow-2xl border border-slate-800">
        {/* Brand panel */}
        <div className="hidden lg:flex flex-col justify-between bg-slate-900 text-white p-10">
          <div>
            <div className="flex items-center gap-3 mb-10">
              <div className="h-12 w-12 rounded bg-blue-600 flex items-center justify-center">
                <Truck size={24} />
              </div>
              <div>
                <div className="font-heading font-black tracking-tight text-2xl leading-none">TMS</div>
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400 mt-1">Order to Cash</div>
              </div>
            </div>
            <h1 className="font-heading font-black text-4xl leading-tight tracking-tight">
              Kelola Logistik <br />
              <span className="text-blue-400">dari Order hingga Lunas.</span>
            </h1>
            <p className="text-slate-300 mt-4 text-sm max-w-md leading-relaxed">
              Sistem terpadu untuk input AWB, plotting biaya, rekonsiliasi bulanan, invoice, hingga laporan laba rugi —
              dengan kontrol akses berbasis peran.
            </p>
          </div>
          <div className="space-y-2 text-xs text-slate-400">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 bg-rose-400 rounded-full"></div>
              <span>Administrator: Akses penuh + manajemen user & permission</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 bg-blue-400 rounded-full"></div>
              <span>Role Operation: Input order, biaya vendor, rekap, invoice</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 bg-emerald-400 rounded-full"></div>
              <span>Role Finance: Biaya cash, settle hutang, pembayaran</span>
            </div>
          </div>
        </div>

        {/* Form panel */}
        <div className="p-8 md:p-12 bg-white">
          <h2 className="font-heading font-black text-3xl text-slate-900 tracking-tight">Masuk</h2>
          <p className="text-sm text-slate-500 mt-1 mb-8">Gunakan kredensial yang diberikan administrator.</p>

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="block text-[11px] uppercase tracking-[0.08em] font-bold text-slate-500 mb-1.5">Username</label>
              <div className="relative">
                <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  data-testid="login-username-input"
                  className="w-full rounded-md border border-slate-300 pl-9 pr-3 py-2.5 text-sm bg-white text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="operation / finance"
                  required
                  autoFocus
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-[0.08em] font-bold text-slate-500 mb-1.5">Password</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  data-testid="login-password-input"
                  type="password"
                  className="w-full rounded-md border border-slate-300 pl-9 pr-3 py-2.5 text-sm bg-white text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            <button
              data-testid="login-submit-button"
              type="submit"
              disabled={busy}
              className="w-full mt-2 rounded-md bg-blue-700 text-white px-4 py-2.5 text-sm font-semibold hover:bg-blue-800 disabled:opacity-60 transition-colors"
            >
              {busy ? "Memproses..." : "Masuk"}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-slate-200">
            <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-slate-400 mb-3">Akun Demo</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                data-testid="demo-admin-btn"
                onClick={() => applyDemo("admin", "admin123")}
                className="text-left p-3 rounded border border-slate-200 hover:border-rose-500 hover:bg-rose-50 transition-colors"
              >
                <div className="text-xs font-bold text-slate-900">Administrator</div>
                <div className="text-[11px] text-slate-500 font-mono">admin / admin123</div>
              </button>
              <button
                data-testid="demo-operation-btn"
                onClick={() => applyDemo("operation", "operation123")}
                className="text-left p-3 rounded border border-slate-200 hover:border-blue-500 hover:bg-blue-50 transition-colors"
              >
                <div className="text-xs font-bold text-slate-900">Operation</div>
                <div className="text-[11px] text-slate-500 font-mono">operation / operation123</div>
              </button>
              <button
                data-testid="demo-finance-btn"
                onClick={() => applyDemo("finance", "finance123")}
                className="text-left p-3 rounded border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50 transition-colors"
              >
                <div className="text-xs font-bold text-slate-900">Finance</div>
                <div className="text-[11px] text-slate-500 font-mono">finance / finance123</div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

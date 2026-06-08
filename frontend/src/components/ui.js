import React from "react";
import { STATUS_CLASSES, STATUS_LABELS } from "../lib/utils";

export function StatusBadge({ status }) {
  const cls = STATUS_CLASSES[status] || "bg-slate-100 text-slate-700 border-slate-200";
  return (
    <span
      data-testid={`awb-status-badge-${status}`}
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${cls}`}
    >
      {STATUS_LABELS[status] || status}
    </span>
  );
}

export function Card({ children, className = "" }) {
  return <div className={`rounded-md border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>;
}

export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="flex items-end justify-between mb-6 pb-4 border-b border-slate-200">
      <div>
        <h1 className="font-heading font-black text-3xl md:text-4xl tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

export function Button({ children, variant = "primary", className = "", ...rest }) {
  const variants = {
    primary: "bg-blue-700 text-white hover:bg-blue-800 border border-blue-700",
    secondary: "bg-white text-slate-800 hover:bg-slate-50 border border-slate-300",
    danger: "bg-red-600 text-white hover:bg-red-700 border border-red-600",
    success: "bg-emerald-600 text-white hover:bg-emerald-700 border border-emerald-600",
    ghost: "bg-transparent text-slate-700 hover:bg-slate-100 border border-transparent",
  };
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Input({ className = "", ...rest }) {
  return (
    <input
      className={`w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-500 ${className}`}
      {...rest}
    />
  );
}

export function Select({ className = "", children, ...rest }) {
  return (
    <select
      className={`w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Label({ children, htmlFor }) {
  return (
    <label htmlFor={htmlFor} className="block text-[11px] uppercase tracking-[0.08em] font-bold text-slate-500 mb-1.5">
      {children}
    </label>
  );
}

export function Table({ children, className = "" }) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full text-sm text-left">{children}</table>
    </div>
  );
}

export function Th({ children, className = "" }) {
  return (
    <th className={`bg-slate-50 border-y border-slate-200 px-3 py-2 text-[10px] uppercase tracking-[0.08em] font-bold text-slate-500 ${className}`}>
      {children}
    </th>
  );
}

export function Td({ children, className = "" }) {
  return <td className={`border-b border-slate-100 px-3 py-2.5 align-middle text-slate-800 ${className}`}>{children}</td>;
}

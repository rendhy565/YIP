import React from "react";
import { Link } from "react-router-dom";

export default function AccentButton({
  to,
  href,
  onClick,
  children,
  variant = "solid",
  size = "md",
  className = "",
  target,
  rel,
  type = "button",
  "data-testid": testId,
  disabled,
}) {
  const base =
    "inline-flex items-center gap-3 font-mono uppercase tracking-[0.14em] transition-colors group";
  const sizes = {
    sm: "text-[11px] px-3 py-2",
    md: "text-[12px] px-5 py-3",
    lg: "text-[13px] px-6 py-4",
  };
  const variants = {
    solid:
      "bg-[#FF5A00] text-[#0F1115] hover:bg-[#E04F00]",
    outline:
      "border border-[#FF5A00] text-[#FF5A00] hover:bg-[#FF5A00] hover:text-[#0F1115]",
    ghost:
      "border border-[#272A30] text-[#F4F4F5] hover:border-[#FF5A00] hover:text-[#FF5A00]",
  };
  const cls = `${base} ${sizes[size]} ${variants[variant]} ${className}`;
  const content = (
    <>
      <span>{children}</span>
      <span className="translate-x-0 group-hover:translate-x-1 transition-transform">
        →
      </span>
    </>
  );
  if (to)
    return (
      <Link to={to} className={cls} data-testid={testId}>
        {content}
      </Link>
    );
  if (href)
    return (
      <a
        href={href}
        target={target}
        rel={rel}
        className={cls}
        data-testid={testId}
      >
        {content}
      </a>
    );
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${cls} disabled:opacity-50 disabled:cursor-not-allowed`}
      data-testid={testId}
    >
      {content}
    </button>
  );
}

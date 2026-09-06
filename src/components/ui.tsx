import type { ReactNode } from "react";
import type { SafetyStatus } from "@/lib/types";

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-line bg-panel ${className}`}>
      {children}
    </div>
  );
}

export function PanelTitle({
  children,
  right,
}: {
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-line px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        {children}
      </div>
      {right}
    </div>
  );
}

export function StatusDot({ tone }: { tone: "ok" | "warn" | "danger" | "muted" }) {
  const color =
    tone === "ok"
      ? "bg-ok"
      : tone === "warn"
        ? "bg-warn"
        : tone === "danger"
          ? "bg-danger"
          : "bg-muted";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} aria-hidden />;
}

export function SafetyBadge({ status }: { status: SafetyStatus }) {
  const style =
    status === "PASS"
      ? "border-ok/40 bg-ok/10 text-ok"
      : status === "CAUTION"
        ? "border-warn/40 bg-warn/10 text-warn"
        : "border-danger/40 bg-danger/10 text-danger";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-sm font-semibold ${style}`}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full bg-current"
        aria-hidden
      />
      {status}
    </span>
  );
}

export function PhaseBadge({
  phase,
}: {
  phase: "PROPOSED" | "APPROVED" | "EXECUTED" | "SIMULATED" | "BLOCKED";
}) {
  const style =
    phase === "PROPOSED"
      ? "border-line2 bg-panel3 text-text"
      : phase === "APPROVED"
        ? "border-acc/40 bg-acc/10 text-acc"
        : phase === "EXECUTED"
          ? "border-ok/40 bg-ok/10 text-ok"
          : phase === "SIMULATED"
            ? "border-ok/40 bg-ok/10 text-ok"
            : "border-danger/40 bg-danger/10 text-danger";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium ${style}`}
    >
      {phase}
    </span>
  );
}

export function CheckGlyph({ status }: { status: "ok" | "warn" | "fail" | "skip" }) {
  if (status === "ok") return <span className="text-ok">✓</span>;
  if (status === "warn") return <span className="text-warn">!</span>;
  if (status === "fail") return <span className="text-danger">✕</span>;
  return <span className="text-muted">–</span>;
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled = false,
  className = "",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all duration-150 ease-in-out cursor-pointer select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100";
  const styles =
    variant === "primary"
      ? "bg-acc text-black shadow-sm hover:bg-accdim active:bg-accdim"
      : variant === "secondary"
        ? "border border-line2 bg-panel3 text-text shadow-sm hover:bg-panel2 active:bg-panel2"
        : variant === "danger"
          ? "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20 active:bg-danger/20"
          : "text-muted hover:bg-panel/60 hover:text-text active:bg-panel2";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${styles} ${className}`}
    >
      {children}
    </button>
  );
}
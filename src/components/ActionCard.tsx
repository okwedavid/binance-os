"use client";

import type { Proposal } from "@/lib/types";
import { Panel, SafetyBadge, PhaseBadge, CheckGlyph, Button } from "@/components/ui";
import { fmtUsd, fmtNum } from "@/lib/format";

export function ActionCard({
  proposal,
  executing,
  onApprove,
  onCancel,
}: {
  proposal: Proposal | null;
  executing: boolean;
  onApprove: () => void;
  onCancel: () => void;
}) {
  if (!proposal) {
    return (
      <Panel className="p-6 text-center">
        <div className="font-mono text-xs uppercase tracking-[0.16em] text-muted">
          Action Card
        </div>
        <p className="mt-3 text-sm text-muted">
          Prepare a buy or sell with an amount and RiskLens will build an
          evidence-backed proposal here.
        </p>
      </Panel>
    );
  }

  const { safety, phase } = proposal;
  const blocked = safety.status === "BLOCK";
  const canExecute = !blocked && phase === "PROPOSED";
  const order = proposal.order;
  const requestedLabel = order
    ? order.amountType === "base"
      ? `${fmtNum(order.amount)} ${order.baseAsset}`
      : `${fmtUsd(order.amount)} ${order.quoteAsset}`
    : `${fmtUsd(proposal.amount)} ${proposal.quote}`;

  return (
    <Panel className="rl-fadein overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
            Action proposal
          </div>
          <PhaseBadge phase={phase} />
        </div>
        <div className="mt-3 flex items-baseline justify-between gap-3">
          <div className="text-2xl font-bold tracking-tight">
            {proposal.side.toUpperCase()}{" "}
            <span className="text-acc">{proposal.symbol}</span>
          </div>
          <div className="font-mono text-lg text-muted">{requestedLabel}</div>
        </div>
        {order?.estimatedQuantity !== null && order?.estimatedQuantity !== undefined && (
          <div className="mt-1 text-[12px] text-muted">
            Est. {fmtNum(order.estimatedQuantity)} {order.baseAsset}
            {order.marketPrice !== null && order.marketPrice !== undefined
              ? ` @ ${fmtUsd(order.marketPrice)}`
              : ""}
          </div>
        )}
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            Safety status
          </div>
          <SafetyBadge status={safety.status} />
        </div>
      </div>

      <div className="border-b border-line px-4 py-3">
        <div className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
          Checks
        </div>
        <ul className="space-y-1.5">
          {safety.checks.map((check) => (
            <li key={check.id} className="flex items-start gap-2 text-[13px]">
              <span className="mt-px w-3 shrink-0 font-mono">
                <CheckGlyph status={check.status} />
              </span>
              <span className="flex-1">
                <span className="text-text">{check.label}</span>
                <span className="text-muted"> — {check.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="px-4 py-3">
        <div className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
          Why
        </div>
        <ul className="space-y-1 text-[13px] text-muted">
          {safety.reasons.map((reason, i) => (
            <li key={i} className="flex gap-2">
              <span className="font-mono text-muted/60">{i + 1}.</span>
              {reason}
            </li>
          ))}
        </ul>
      </div>

      <div className="border-t border-line px-4 py-4">
        {phase === "BLOCKED" ? (
          <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-center text-sm font-semibold text-danger">
            BLOCKED — this action cannot execute.
          </div>
        ) : phase === "EXECUTED" || phase === "SIMULATED" ? (
          <div className="rounded-lg border border-ok/30 bg-ok/10 px-3 py-2.5 text-center text-sm font-medium text-ok">
            {phase === "EXECUTED"
              ? "Submitted through Agent OS. See the timeline for the result."
              : "Simulated — no live order was submitted."}
          </div>
        ) : (
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2.5">
              <Button
                variant="primary"
                disabled={!canExecute || executing}
                onClick={onApprove}
              >
                {executing
                  ? "Executing…"
                  : proposal.mode === "demo"
                    ? "SIMULATE ACTION"
                    : "APPROVE & EXECUTE"}
              </Button>
              <Button
                variant="secondary"
                disabled={executing}
                onClick={onCancel}
              >
                CANCEL
              </Button>
            </div>
            <p className="text-center text-[11px] text-muted">
              {proposal.mode === "demo"
                ? "Demo Mode — no real order will be submitted."
                : "Live Mode — nothing executes until you click and Agent OS permission is confirmed."}
            </p>
          </div>
        )}
      </div>
    </Panel>
  );
}
"use client";

import type { ExecutionResult } from "@/lib/types";
import { Panel, PanelTitle } from "@/components/ui";
import { fmtUsd, fmtNum } from "@/lib/format";

/**
 * Execution result card, shared by Demo (SIMULATED ORDER) and Live
 * (BINANCE AGENT OS). Demo results are visually and textually unmistakable
 * as simulations.
 */
export function TradingResult({ result }: { result: ExecutionResult }) {
  const simulated = result.simulated === true;
  const title = simulated ? "SIMULATED ORDER" : "BINANCE AGENT OS";

  const rows: Array<[string, string]> = [
    ["Symbol", result.symbol ?? result.baseAsset ?? "—"],
    ["Side", (result.side ?? "").toUpperCase() || "—"],
    ["Status", result.status ?? (result.ok ? "FILLED" : "FAILED")],
    ["Order ID", result.orderId ?? "—"],
    [
      "Filled quantity",
      result.filledQuantity !== null && result.filledQuantity !== undefined
        ? `${fmtNum(result.filledQuantity)} ${result.baseAsset ?? ""}`.trim()
        : "—",
    ],
    [
      "Execution price",
      result.executionPrice !== null && result.executionPrice !== undefined
        ? fmtUsd(result.executionPrice)
        : "—",
    ],
    [
      "Quote amount",
      result.amount !== undefined ? fmtUsd(result.amount) : "—",
    ],
    [
      "Fee",
      result.fee !== null && result.fee !== undefined
        ? `${fmtUsd(result.fee)} ${result.feeAsset ?? ""}`.trim()
        : "—",
    ],
  ];

  return (
    <Panel className="rl-fadein overflow-hidden">
      <PanelTitle
        right={
          <span
            className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${
              simulated
                ? "border-warn/40 bg-warn/10 text-warn"
                : "border-ok/40 bg-ok/10 text-ok"
            }`}
          >
            {title}
          </span>
        }
      >
        Execution result
      </PanelTitle>

      <div className="px-4 py-3">
        <div className="divide-y divide-line text-[13px]">
          {rows.map(([k, v]) => (
            <div
              key={k}
              className="flex items-baseline justify-between gap-3 py-1"
            >
              <span className="shrink-0 text-muted">{k}</span>
              <span className="text-right text-text">{v}</span>
            </div>
          ))}
          {result.slippagePct !== null && result.slippagePct !== undefined && (
            <div className="flex items-baseline justify-between gap-3 py-1">
              <span className="shrink-0 text-muted">Simulated slippage</span>
              <span className="text-right text-text">
                {result.slippagePct.toFixed(2)}%
              </span>
            </div>
          )}
        </div>

        {simulated ? (
          <div className="mt-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-warn">
            Simulated — no live order was submitted.
          </div>
        ) : (
          <div className="mt-3 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-ok">
            Submitted through Binance Agent OS.
          </div>
        )}
        <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-muted">
          {result.message}
        </p>
      </div>
    </Panel>
  );
}
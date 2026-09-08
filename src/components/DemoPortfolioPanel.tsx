"use client";

import { useEffect, useState } from "react";
import type { PortfolioSnapshot } from "@/lib/types";
import { Panel, PanelTitle, Button } from "@/components/ui";
import { fmtUsd, fmtNum } from "@/lib/format";

interface PortfolioResponse {
  ok: boolean;
  label: string;
  portfolio: PortfolioSnapshot;
}

/**
 * In-memory DEMO PORTFOLIO panel. Only rendered in Demo Mode. Every number
 * is clearly labeled as a simulation; this ledger never represents a live
 * Binance account and is never persisted.
 *
 * The panel prefers the portfolio snapshot returned by the execution result
 * (`snapshot`), because the exec response is authoritative for that fill.
 * On a multi-instance deployment the shared `/api/demo/portfolio` read can
 * land on a different instance and show stale state, so the passed snapshot
 * keeps the displayed portfolio consistent with the simulated fill. When no
 * snapshot is available it falls back to the shared API read.
 */
export function DemoPortfolioPanel({
  refreshKey,
  snapshot,
}: {
  refreshKey: number;
  snapshot?: PortfolioSnapshot | null;
}) {
  const [fetched, setFetched] = useState<PortfolioSnapshot | null>(null);
  const [label, setLabel] = useState("DEMO PORTFOLIO");
  const [busy, setBusy] = useState(false);

  const portfolio = snapshot ?? fetched;

  useEffect(() => {
    if (snapshot) return;
    let active = true;
    fetch("/api/demo/portfolio")
      .then((res) => res.json() as Promise<PortfolioResponse>)
      .then((data) => {
        if (active && data.ok) {
          setFetched(data.portfolio);
          setLabel(data.label);
        }
      })
      .catch(() => {
        // best-effort read; panel stays empty until the next refresh
      });
    return () => {
      active = false;
    };
  }, [refreshKey, snapshot]);

  async function reset() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/demo/reset", { method: "POST" });
      const data = (await res.json()) as PortfolioResponse;
      if (data.ok) {
        setFetched(data.portfolio);
        setLabel(data.label);
      }
    } catch {
      // best-effort
    } finally {
      setBusy(false);
    }
  }

  const balances = portfolio ? Object.entries(portfolio.balances).sort() : [];
  const holdings = balances.filter(([, qty]) => qty > 0);

  return (
    <Panel className="rl-fadein">
      <PanelTitle
        right={
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-warn">
            simulation
          </span>
        }
      >
        {label}
      </PanelTitle>

      {!portfolio ? (
        <div className="px-4 py-6 text-center text-sm text-muted">
          Loading demo portfolio…
        </div>
      ) : (
        <div className="px-4 py-3 text-[13px]">
          <div className="divide-y divide-line">
            <div className="flex items-baseline justify-between gap-3 py-1">
              <span className="text-muted">Cash ({portfolio.quoteAsset})</span>
              <span className="font-mono text-text">
                {fmtUsd(portfolio.quoteBalance)}
              </span>
            </div>

            {holdings.length === 0 ? (
              <div className="py-2 text-[12px] text-muted">
                No assets yet. Approve a simulated buy to start the rehearsal.
              </div>
            ) : (
              holdings.map(([asset, qty]) => {
                const avgCost = portfolio.averageCosts[asset] ?? 0;
                return (
                  <div
                    key={asset}
                    className="flex items-baseline justify-between gap-3 py-1"
                  >
                    <span className="text-muted">{asset}</span>
                    <span className="font-mono text-right text-text">
                      {fmtNum(qty)} @ avg {avgCost > 0 ? fmtUsd(avgCost) : "—"}
                    </span>
                  </div>
                );
              })
            )}

            {portfolio.realizedPnl !== 0 && (
              <div className="flex items-baseline justify-between gap-3 py-1">
                <span className="text-muted">Realized P&L</span>
                <span className="font-mono text-text">
                  {fmtUsd(portfolio.realizedPnl)}
                </span>
              </div>
            )}
          </div>

          <div className="mt-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-warn">
            Demo only — not a live Binance balance.
          </div>

          <Button
            variant="secondary"
            onClick={reset}
            disabled={busy}
            className="mt-3 w-full"
          >
            {busy ? "Resetting…" : "Reset Demo Portfolio"}
          </Button>
        </div>
      )}
    </Panel>
  );
}
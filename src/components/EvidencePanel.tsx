"use client";

import type { EvidenceBundle } from "@/lib/types";
import { Panel, PanelTitle } from "@/components/ui";
import { fmtUsd, fmtPct } from "@/lib/format";

export function EvidencePanel({ evidence }: { evidence: EvidenceBundle | null }) {
  if (!evidence) return null;
  const { market, account, derived } = evidence;

  const observed: Array<[string, string]> = [
    ["Symbol", market.symbol],
    [
      "Last price",
      market.lastPrice !== null
        ? fmtUsd(market.lastPrice)
        : "Unavailable from current Agent OS permission.",
    ],
    ["24h change", fmtPct(market.priceChangePercent24h)],
    [
      "24h high / low",
      market.high24h !== null && market.low24h !== null
        ? `${fmtUsd(market.low24h)} – ${fmtUsd(market.high24h)}`
        : "Unavailable",
    ],
    [
      "24h quote volume",
      market.quoteVolume24h !== null ? fmtUsd(market.quoteVolume24h) : "Unavailable",
    ],
    [
      "Order book spread",
      market.spreadPercent !== null ? `${market.spreadPercent.toFixed(3)}%` : "Unavailable",
    ],
    [
      "Market data age",
      market.ageSeconds === null
        ? "Unavailable"
        : market.ageSeconds <= 1
          ? "< 1 second"
          : `${Math.round(market.ageSeconds)} seconds`,
    ],
    ["Provider", market.provider],
  ];

  const derivedRows: Array<[string, string]> = [
    [
      "Volatility",
      derived.volatility === "elevated"
        ? "elevated"
        : derived.volatility === "low"
          ? "contained"
          : "unknown — unavailable from current Agent OS permission.",
    ],
    [
      "Liquidity",
      derived.liquidity === "healthy"
        ? "healthy"
        : derived.liquidity === "weak"
          ? "weak"
          : "unknown — unavailable from current Agent OS permission.",
    ],
  ];

  const accountRows: Array<[string, string]> = [
    [
      "Available balance",
      account.quoteBalance !== null
        ? `${fmtUsd(account.quoteBalance)} USDT`
        : "Unavailable from current Agent OS permission.",
    ],
    [
      "Balance source",
      account.sample ? "Deterministic demo sample" : "Binance Agent OS",
    ],
  ];

  const recommendation = evidence
    ? recommendationText(evidence)
    : "";

  return (
    <Panel className="rl-fadein">
      <PanelTitle right={<span className="font-mono text-[10px] text-muted">FROM AGENT OS</span>}>Evidence</PanelTitle>
      <div className="divide-y divide-line px-4 py-3 text-[13px]">
        <Section label="Observed">
          {observed.map(([k, v]) => (
            <Row key={k} k={k} v={v} />
          ))}
        </Section>
        <Section label="Derived">
          {derivedRows.map(([k, v]) => (
            <Row key={k} k={k} v={v} />
          ))}
        </Section>
        <Section label="Account">
          {accountRows.map(([k, v]) => (
            <Row key={k} k={k} v={v} />
          ))}
        </Section>
        <Section label="Recommendation">
          <div className="text-[13px] leading-relaxed text-text">{recommendation}</div>
        </Section>
      </div>
    </Panel>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-2.5">
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
        {label}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-muted">{k}</span>
      <span className="text-right text-text">{v}</span>
    </div>
  );
}

function recommendationText(evidence: EvidenceBundle): string {
  const volUnknown = evidence.derived.volatility === "unknown";
  const liqUnknown = evidence.derived.liquidity === "unknown";
  if (volUnknown || liqUnknown) {
    return "Evidence is incomplete. RiskLens shows what is unavailable from the current Agent OS permission.";
  }
  if (
    evidence.derived.volatility === "elevated" ||
    evidence.derived.liquidity === "weak"
  ) {
    return "The action is possible, but one or more signals are outside RiskLens thresholds.";
  }
  return "All observable conditions are inside RiskLens thresholds.";
}
import type {
  AccountEvidence,
  DerivedSignals,
  Intent,
  MarketEvidence,
  SafetyResult,
} from "@/lib/types";
import { formatAmount } from "@/lib/safety/engine";

/**
 * Builds the plain-language "Why?" explanation for an Action Card.
 *
 * This is a deterministic template over observed evidence. No market
 * numbers are invented here: unavailable fields are reported as
 * unavailable, never estimated.
 */

export function explainDecision(
  intent: Intent,
  market: MarketEvidence,
  account: AccountEvidence,
  derived: DerivedSignals,
  safety: SafetyResult
): string {
  const parts: string[] = [];

  const sideLabel = intent.side === "sell" ? "sell" : "buy";

  if (intent.op === "propose") {
    parts.push(
      `Proposed ${sideLabel} of ${intent.symbol}: ${formatAmount(intent.amount ?? 0)} ${intent.quote}.`
    );
  } else {
    parts.push(`Analyzing ${market.symbol}.`);
  }

  if (market.lastPrice !== null) {
    parts.push(`${market.symbol} last price: ${formatAmount(market.lastPrice)}.`);
  }

  if (market.priceChangePercent24h !== null) {
    const sign = market.priceChangePercent24h >= 0 ? "+" : "";
    parts.push(
      `24h change: ${sign}${market.priceChangePercent24h.toFixed(2)}%.`
    );
  }

  const ageText =
    market.ageSeconds === null
      ? "Market data age: unknown."
      : market.ageSeconds <= 1
        ? "Market data age: less than 1 second."
        : `Market data age: ${Math.round(market.ageSeconds)} seconds.`;
  parts.push(ageText);

  for (const note of derived.notes) {
    parts.push(note);
  }

  if (!account.available) {
    parts.push("Account balance is unavailable from the current Agent OS permission.");
  }

  const permission = account.permission;
  if (permission && intent.op === "propose") {
    if (permission.granted === true) {
      parts.push(`Trading permission (${permission.label}) is granted.`);
    } else if (permission.granted === false) {
      parts.push(`Trading permission (${permission.label}) is not granted.`);
    } else {
      parts.push(`Trading permission (${permission.label}) could not be confirmed.`);
    }
  }

  const statusSentence: Record<string, string> = {
    PASS: "Decision: PASS — the request passed all safety checks.",
    CAUTION: "Decision: CAUTION — the action is possible but carries notable risk.",
    BLOCK: "Decision: BLOCK — the action must not proceed.",
  };

  return `${parts.join("\n")}\n${statusSentence[safety.status]}`;
}

export function decisionSummary(safety: SafetyResult): string {
  switch (safety.status) {
    case "PASS":
      return "All safety checks passed. The action can proceed with approval.";
    case "CAUTION":
      return "The action is technically possible, but RiskLens is cautious. Review the flagged checks before approving.";
    case "BLOCK":
      return "The action must not proceed. One or more safety checks failed.";
  }
}
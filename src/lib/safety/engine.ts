import type {
  SafetyCheckItem,
  SafetyResult,
  SafetyStatus,
} from "@/lib/types";

/**
 * Inputs to the deterministic safety engine.
 *
 * The engine makes no network calls and performs no randomness.
 * The LLM never produces these values: every value is derived from
 * evidence produced by an adapter (Demo adapter or the Binance Agent OS
 * adapter). The engine is the single authority for PASS / CAUTION / BLOCK.
 */
export interface SafetyEngineInput {
  /** Requested amount in quote units. `null` when no amount was requested (analysis only). */
  amount: number | null;
  /** Age of the newest observed market data in seconds. */
  marketDataAgeSeconds: number | null;
  /** Maximum acceptable age of market data. */
  freshnessTargetSeconds: number;
  volatility: "low" | "elevated" | "unknown";
  liquidity: "healthy" | "weak" | "unknown";
  /** `true` when a live/simulated account balance is actually available. */
  balanceAvailable: boolean;
  /** Available balance in quote units (only meaningful when balanceAvailable). */
  balanceQuote: number | null;
  /** `true` the required permission is confirmed granted; `false` denied; `null` unknown. */
  permissionGranted: boolean | null;
  /** Whether this operation requires a trading permission (execution intent). */
  permissionRequired: boolean;
}

export function evaluateSafety(input: SafetyEngineInput): SafetyResult {
  const checks: SafetyCheckItem[] = [];
  const reasons: string[] = [];

  const failed = (id: string, label: string, detail: string) => {
    checks.push({ id, label, status: "fail", detail });
  };
  const warned = (id: string, label: string, detail: string) => {
    checks.push({ id, label, status: "warn", detail });
  };
  const passed = (id: string, label: string, detail: string) => {
    checks.push({ id, label, status: "ok", detail });
  };
  const skipped = (id: string, label: string, detail: string) => {
    checks.push({ id, label, status: "skip", detail });
  };

  // Check 1 — Valid amount
  if (input.amount === null) {
    skipped("amount", "Valid amount", "No amount requested for this operation.");
  } else if (input.amount <= 0) {
    failed(
      "amount",
      "Valid amount",
      `Requested amount is not a positive number (${String(input.amount)}).`
    );
    reasons.push("Requested amount is invalid.");
  } else {
    passed(
      "amount",
      "Valid amount",
      `Requested amount ${formatAmount(input.amount)} is valid.`
    );
  }

  // Check 2 — Market data freshness
  const age = input.marketDataAgeSeconds;
  if (age === null) {
    failed(
      "freshness",
      "Market data freshness",
      "No market data was received. RiskLens cannot verify current conditions."
    );
    reasons.push("Market data is unavailable.");
  } else if (age <= input.freshnessTargetSeconds) {
    passed(
      "freshness",
      "Market data freshness",
      `Market data is ${formatAge(age)} old (target ≤ ${input.freshnessTargetSeconds}s).`
    );
  } else {
    failed(
      "freshness",
      "Market data freshness",
      `Market data is ${formatAge(age)} old, exceeding the ${input.freshnessTargetSeconds}s target.`
    );
    reasons.push("Market data is stale.");
  }

  // Check 3 — Account balance
  if (!input.balanceAvailable) {
    skipped(
      "balance",
      "Account balance",
      "Balance unavailable from the current Agent OS permission. RiskLens does not claim it is sufficient."
    );
  } else if (input.amount !== null && input.balanceQuote !== null && input.balanceQuote < input.amount) {
    failed(
      "balance",
      "Account balance",
      `Available balance ${formatAmount(input.balanceQuote)} is less than the requested ${formatAmount(input.amount)}.`
    );
    reasons.push("Available balance is insufficient.");
  } else {
    passed(
      "balance",
      "Account balance",
      input.balanceQuote === null
        ? "Account balance is available."
        : `Available balance ${formatAmount(input.balanceQuote)} covers the request.`
    );
  }

  // Check 4 — Volatility
  if (input.volatility === "elevated") {
    warned(
      "volatility",
      "Volatility",
      "Short-term volatility is elevated relative to RiskLens thresholds."
    );
    reasons.push("Volatility is elevated.");
  } else if (input.volatility === "unknown") {
    warned(
      "volatility",
      "Volatility",
      "Volatility could not be derived from the available Agent OS permission."
    );
    reasons.push("Volatility could not be verified.");
  } else {
    passed(
      "volatility",
      "Volatility",
      "Short-term volatility is within RiskLens thresholds."
    );
  }

  // Check 5 — Liquidity
  if (input.liquidity === "weak") {
    warned(
      "liquidity",
      "Liquidity",
      "Order-book liquidity is below the RiskLens threshold."
    );
    reasons.push("Liquidity is weak.");
  } else if (input.liquidity === "unknown") {
    warned(
      "liquidity",
      "Liquidity",
      "Liquidity could not be derived from the available Agent OS permission."
    );
    reasons.push("Liquidity could not be verified.");
  } else {
    passed(
      "liquidity",
      "Liquidity",
      "Order-book liquidity is above the RiskLens threshold."
    );
  }

  // Check 6 — Agent permission
  if (!input.permissionRequired) {
    skipped(
      "permission",
      "Agent permission",
      "No trading permission required for this operation."
    );
  } else if (input.permissionGranted === true) {
    passed(
      "permission",
      "Agent permission",
      "The required Agent OS trading permission is granted."
    );
  } else if (input.permissionGranted === false) {
    failed(
      "permission",
      "Agent permission",
      "The required Agent OS trading permission is not granted."
    );
    reasons.push("Agent OS trading permission is missing.");
  } else {
    failed(
      "permission",
      "Agent permission",
      "The Agent OS permission status is unavailable. RiskLens fails closed."
    );
    reasons.push("Agent OS permission could not be confirmed.");
  }

  const hasFail = checks.some((c) => c.status === "fail");
  const hasWarn = checks.some((c) => c.status === "warn");

  let status: SafetyStatus = "PASS";
  if (hasFail) {
    status = "BLOCK";
  } else if (hasWarn) {
    status = "CAUTION";
  }

  if (status === "PASS" && reasons.length === 0) {
    reasons.push("All safety checks passed.");
  }

  return { status, checks, reasons };
}

export function formatAmount(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatAge(seconds: number): string {
  if (seconds < 1) return "fresh";
  const rounded = Math.round(seconds);
  if (rounded === 1) return "1 second";
  return `${rounded} seconds`;
}
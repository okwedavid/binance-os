import type { MarketInfo, SafetyCheckItem, Side } from "@/lib/types";

/**
 * Order-filter validation shared by Demo and Live.
 *
 * Demo Mode applies the exact same pair status, granularity, notional and
 * balance rules the live exchange enforces, so a simulated fill is a true
 * rehearsal: if the demo accepts it, the live path should too.
 */

export interface OrderValidationInput {
  market: MarketInfo;
  side: Side;
  /** Order size in quote units (after any base→quote conversion). */
  quoteAmount: number;
  /** Effective base quantity when derivable, otherwise null. */
  baseQuantity: number | null;
  quoteBalance: number | null;
  baseHoldings: number | null;
}

export function validateOrder(input: OrderValidationInput): SafetyCheckItem[] {
  const { market, side } = input;
  const checks: SafetyCheckItem[] = [];

  const pair = checkPairStatus(market);
  checks.push(pair);

  if (input.quoteAmount <= 0) {
    checks.push({
      id: "valid-quantity",
      label: "Valid quantity",
      status: "fail",
      detail: "The requested amount must be a positive number.",
    });
  }

  const qty = input.baseQuantity;
  if (qty !== null) {
    if (!Number.isFinite(qty) || qty <= 0) {
      checks.push({
        id: "valid-quantity",
        label: "Valid quantity",
        status: "fail",
        detail: "The resulting base quantity must be a positive number.",
      });
    }

    if (market.stepSize !== null && market.stepSize > 0) {
      const step = market.stepSize;
      const grid = Math.round(qty / step);
      const offGrid = Math.abs(qty - grid * step);
      if (offGrid > step * STEP_TOLERANCE) {
        checks.push({
          id: "step-size",
          label: "Quantity step size",
          status: "fail",
          detail: `Quantity must be a multiple of ${market.stepSize}.`,
        });
      } else {
        checks.push({
          id: "step-size",
          label: "Quantity step size",
          status: "ok",
          detail: `Quantity respects the ${market.stepSize} step size.`,
        });
      }
    }

    if (market.minQty !== null) {
      const minQtyTolerance = Math.max(market.minQty, Number.EPSILON) * 1e-9;
      if (qty < market.minQty - minQtyTolerance) {
        checks.push({
          id: "min-qty",
          label: "Minimum quantity",
          status: "fail",
          detail: `Quantity below the ${market.minQty} minimum for ${market.symbol}.`,
        });
      } else {
        checks.push({
          id: "min-qty",
          label: "Minimum quantity",
          status: "ok",
          detail: `Quantity is above the ${market.minQty} minimum.`,
        });
      }
    }

    if (market.maxQty !== null && qty > market.maxQty) {
      checks.push({
        id: "max-qty",
        label: "Maximum quantity",
        status: "fail",
        detail: `Quantity exceeds the ${market.maxQty} maximum for ${market.symbol}.`,
      });
    }
  }

  if (market.minNotional !== null && input.quoteAmount < market.minNotional) {
    checks.push({
      id: "min-notional",
      label: "Minimum notional",
      status: "fail",
      detail: `Order value ${fmtQty(input.quoteAmount)} is below the ${market.minNotional} minimum for ${market.symbol}.`,
    });
  } else if (market.minNotional !== null) {
    checks.push({
      id: "min-notional",
      label: "Minimum notional",
      status: "ok",
      detail: `Order value is above the ${market.minNotional} minimum.`,
    });
  }

  if (side === "buy") {
    if (input.quoteBalance !== null && input.quoteBalance < input.quoteAmount) {
      checks.push({
        id: "balance",
        label: "Sufficient balance",
        status: "fail",
        detail: `Available ${market.quoteAsset} balance ${fmtQty(input.quoteBalance)} is below the ${fmtQty(input.quoteAmount)} order value.`,
      });
    } else if (input.quoteBalance !== null) {
      checks.push({
        id: "balance",
        label: "Sufficient balance",
        status: "ok",
        detail: `${market.quoteAsset} balance covers the order value.`,
      });
    }
  } else if (side === "sell") {
    if (input.baseHoldings !== null && qty !== null && input.baseHoldings < qty - stepTolerance(market.stepSize)) {
      checks.push({
        id: "balance",
        label: "Sufficient asset balance",
        status: "fail",
        detail: `Available ${market.baseAsset} ${fmtQty(input.baseHoldings)} is below the ${fmtQty(qty)} sell quantity.`,
      });
    } else if (input.baseHoldings !== null && qty !== null) {
      checks.push({
        id: "balance",
        label: "Sufficient asset balance",
        status: "ok",
        detail: `${market.baseAsset} balance covers the sell quantity.`,
      });
    }
  }

  return checks;
}

export function checkPairStatus(market: MarketInfo): SafetyCheckItem {
  if (market.status === "TRADING") {
    return {
      id: "pair",
      label: "Pair available",
      status: "ok",
      detail: `${market.symbol} is listed and trading.`,
    };
  }
  return {
    id: "pair",
    label: "Pair available",
    status: "fail",
    detail: `${market.symbol} is not currently trading (status: ${market.status}).`,
  };
}

export const marketInfoCheck = checkPairStatus;

/** Rounds a quantity to the given step (e.g. LOT_SIZE stepSize). */
export function roundToStep(value: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return value;
  const factor = 10 ** decimalsOf(step);
  return Math.round(value * factor) / factor;
}

/**
 * Nearest step-aligned value; used to detect step-size violations within a
 * tiny tolerance instead of by string comparison.
 */
export function alignToStep(value: number, step: number): number {
  return roundToStep(value, step);
}

function decimalsOf(value: number): number {
  const text = String(value).toLowerCase();
  if (text.includes("e")) {
    const exp = Number(text.split("e")[1]);
    const mantissa = text.split("e")[0].includes(".")
      ? text.split("e")[0].split(".")[1].length
      : 0;
    return Math.max(0, mantissa - exp);
  }
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

export const STEP_TOLERANCE = 1e-6;

function stepTolerance(step: number | null): number {
  return (step !== null && step > 0 ? step : 1) * STEP_TOLERANCE;
}

function fmtQty(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(value);
}
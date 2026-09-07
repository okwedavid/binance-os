import type { ExecutionResult, MarketEvidence, MarketInfo, PortfolioSnapshot, Side } from "@/lib/types";
import { alignToStep } from "@/lib/market/validate";
import { applyDemoBuy, applyDemoSell, baseHolding, demoOrderIdFor, nextDemoOrderSequence } from "@/lib/demo/portfolio";

/**
 * Deterministic Demo trade-lifecycle simulation.
 *
 * Implements the same phases a real order goes through — submission,
 * acceptance, fill, fee, and settlement — but produces NO network calls and
 * NO live order. Prices come from the evidence snapshot RiskLens already
 * fetched; the only adjustments are a small, clearly-labeled slippage model
 * and fee, both configurable and both described as simulated.
 */

export const DEMO_FEE_BPS = 5;
export const DEMO_SLIPPAGE_BPS = 5;
export const DEMO_FEE_RATE = 0.001;
export const DEMO_SLIPPAGE_RATE = 0.0005;

export function demoFeeRate(): number {
  const env = Number(process.env.RL_DEMO_FEE_BPS);
  return Number.isFinite(env) && env > 0 ? env / 10_000 : DEMO_FEE_RATE;
}

export function demoSlippageRate(): number {
  const env = Number(process.env.RL_DEMO_SLIPPAGE_BPS);
  return Number.isFinite(env) && env > 0 ? env / 10_000 : DEMO_SLIPPAGE_RATE;
}

export interface DemoSimulationInput {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  side: Side;
  quoteAmount: number;
  baseQuantity: number | null;
  evidence: MarketEvidence;
  market: MarketInfo;
  portfolio: PortfolioSnapshot;
}

export function simulateDemoExecution(input: DemoSimulationInput): ExecutionResult {
  const { symbol, baseAsset, quoteAsset, side, evidence, market, portfolio } = input;
  const now = Date.now();
  const slippageRate = demoSlippageRate();
  const feeRate = demoFeeRate();

  const lastPrice = evidence.lastPrice ?? null;
  const ask = evidence.askPrice ?? lastPrice;
  const bid = evidence.bidPrice ?? lastPrice;

  const executionPrice =
    side === "buy"
      ? ask !== null
        ? ask * (1 + slippageRate)
        : null
      : bid !== null
        ? bid * (1 - slippageRate)
        : null;

  if (executionPrice === null || !Number.isFinite(executionPrice)) {
    return {
      ok: false,
      simulated: true,
      orderId: null,
      status: "FAILED",
      side,
      symbol,
      baseAsset,
      quoteAsset,
      amount: input.quoteAmount,
      executionPrice: null,
      sourceLabel: "DEMO SIMULATION",
      message: "SIMULATED order could not be priced from the available demo evidence.",
    };
  }

  const step = market.stepSize && market.stepSize > 0 ? market.stepSize : 1e-8;
  const sequence = nextDemoOrderSequence();
  const orderId = demoOrderIdFor(sequence, baseAsset);

  const stepDelayMs = 40 + (sequence % 5) * 12;
  const submittedAtMs = now;
  const acceptedAtMs = now + stepDelayMs;
  const filledAtMs = acceptedAtMs + stepDelayMs;
  const settledAtMs = filledAtMs + stepDelayMs;

  let filledQuantity: number;
  let quoteSpent: number;
  let fee: number;
  let realizedPnl: number | null = null;
  let portfolioAfter: PortfolioSnapshot;

  if (side === "buy") {
    filledQuantity = alignToStep(input.quoteAmount / executionPrice, step);
    quoteSpent = round8(filledQuantity * executionPrice);
    fee = round8(quoteSpent * feeRate);
    portfolioAfter = applyDemoBuy(portfolio, {
      base: baseAsset,
      quoteSpent,
      filledQuantity,
      fee,
      feeAsset: quoteAsset,
    });
  } else {
    const avail = baseHolding(portfolio, baseAsset);
    filledQuantity = Math.min(alignToStep(input.baseQuantity ?? 0, step), avail);
    quoteSpent = round8(filledQuantity * executionPrice);
    fee = round8(quoteSpent * feeRate);
    const avgCost = portfolio.averageCosts[baseAsset] ?? 0;
    realizedPnl = round8(quoteSpent - fee - filledQuantity * avgCost);
    portfolioAfter = applyDemoSell(portfolio, {
      base: baseAsset,
      baseQty: input.baseQuantity ?? 0,
      proceeds: quoteSpent,
      fee,
      feeAsset: quoteAsset,
      avgCost,
    });
  }

  const direction = side === "buy" ? "bought" : "sold";
  const message =
    `SIMULATED ORDER FILLED\n` +
    `${symbol} ${side.toUpperCase()} ${direction === "bought" ? "(" + quoteSpent.toFixed(2) + " " + quoteAsset + ")" : ""}\n` +
    `Filled ${fmt(filledQuantity)} ${baseAsset} at ${priceText(executionPrice)} ${quoteAsset}` +
    ` — simulated fee ${fee} ${quoteAsset}, slippage ${(slippageRate * 100).toFixed(2)}%. No live order was submitted.`;

  return {
    ok: true,
    simulated: true,
    orderId,
    status: "FILLED",
    side,
    symbol,
    baseAsset,
    quoteAsset,
    amount: input.quoteAmount,
    filledQuantity,
    executionPrice,
    fee,
    feeAsset: quoteAsset,
    slippagePct: slippageRate * 100,
    sourceLabel: "DEMO SIMULATION",
    portfolio: portfolioAfter,
    submittedAtMs,
    filledAtMs,
    realizedPnl,
    message,
    steps: [
      { label: "Order submitted", detail: `${side.toUpperCase()} ${symbol} queued to the demo matching engine. No live exchange is contacted.`, atMs: submittedAtMs },
      { label: "Order accepted", detail: `Order ${orderId} accepted by the simulated matching engine.`, atMs: acceptedAtMs },
      {
        label: "Order filled",
        detail: `Filled ${fmt(filledQuantity)} ${baseAsset} at ${priceText(executionPrice)} ${quoteAsset} (simulated ${(slippageRate * 100).toFixed(2)}% slippage).`,
        atMs: filledAtMs,
      },
      { label: "Portfolio settled", detail: `Demo portfolio updated. Fee ${fee} ${quoteAsset} (${(feeRate * 100).toFixed(2)}%) applied.`, atMs: settledAtMs },
    ],
  };
}

function round8(value: number): number {
  return Math.round(value * 10 ** 8) / 10 ** 8;
}

function fmt(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 10 }).format(value);
}

function priceText(value: number): string {
  const digits = value < 0.0001 ? 10 : value < 1 ? 6 : value < 100 ? 4 : 2;
  return value.toFixed(digits);
}
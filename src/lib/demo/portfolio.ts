import type { PortfolioSnapshot } from "@/lib/types";

/**
 * In-memory deterministic DEMO PORTFOLIO.
 *
 * This is a simulation ledger for Demo Mode only. It is never persisted to
 * a database and never represents the user's Binance account. Any asset
 * encountered on the catalog can be held — nothing is hardcoded to BTC/ETH.
 * The portfolio resets to its initial state whenever the server restarts.
 */

export const DEMO_PORTFOLIO_LABEL = "DEMO PORTFOLIO";
export const INITIAL_DEMO_USDT = 10_000;

export function initialPortfolio(): PortfolioSnapshot {
  return {
    quoteAsset: "USDT",
    quoteBalance: INITIAL_DEMO_USDT,
    balances: {},
    averageCosts: {},
    realizedPnl: 0,
  };
}

export interface DemoFill {
  base: string;
  quoteSpent: number;
  filledQuantity: number;
  fee: number;
  feeAsset: string;
}

export function applyDemoBuy(state: PortfolioSnapshot, fill: DemoFill): PortfolioSnapshot {
  const next: PortfolioSnapshot = {
    ...state,
    quoteBalance: state.quoteBalance - fill.quoteSpent,
    balances: { ...state.balances },
    averageCosts: { ...state.averageCosts },
    realizedPnl: state.realizedPnl,
  };
  if (fill.feeAsset === "USDT") {
    next.quoteBalance -= fill.fee;
  }

  const heldBefore = baseHolding(state, fill.base);
  const costBefore = state.averageCosts[fill.base] ?? 0;
  const totalBefore = costBefore * heldBefore;
  const after = heldBefore + fill.filledQuantity;
  next.balances[fill.base] = roundToPrecision(after, 12);
  next.averageCosts[fill.base] = after > 0 ? roundToPrecision((totalBefore + fill.quoteSpent) / after, 12) : 0;
  next.quoteBalance = roundToPrecision(next.quoteBalance, 8);
  return next;
}

export function applyDemoSell(
  state: PortfolioSnapshot,
  sell: { base: string; baseQty: number; proceeds: number; fee: number; feeAsset: string; avgCost: number }
): PortfolioSnapshot {
  const held = baseHolding(state, sell.base);
  const sold = Math.min(held, sell.baseQty);
  const realized = sold > 0 ? sold * sell.avgCost : 0;

  const next: PortfolioSnapshot = {
    ...state,
    quoteBalance: state.quoteBalance + sell.proceeds - sell.fee,
    balances: { ...state.balances },
    averageCosts: { ...state.averageCosts },
    realizedPnl: state.realizedPnl + realized,
  };
  next.balances[sell.base] = roundToPrecision(Math.max(0, held - sold), 12);
  next.quoteBalance = roundToPrecision(next.quoteBalance, 8);
  return next;
}

export function baseHolding(state: PortfolioSnapshot, base: string): number {
  return state.balances[base.toUpperCase()] ?? 0;
}

export function unrealizedPnl(state: PortfolioSnapshot, base: string, currentPrice: number): number {
  const held = baseHolding(state, base);
  const cost = state.averageCosts[base.toUpperCase()] ?? 0;
  if (held <= 0 || cost <= 0) return 0;
  return (currentPrice - cost) * held;
}

function roundToPrecision(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

// ---------------------------------------------------------------------------
// Process-scoped store (single server instance). Reset on restart.
// ---------------------------------------------------------------------------

let store: PortfolioSnapshot = initialPortfolio();
let orderSequence = 0;

export function getDemoPortfolio(): PortfolioSnapshot {
  return cloneSnapshot(store);
}

export function resetDemoPortfolio(): PortfolioSnapshot {
  store = initialPortfolio();
  orderSequence = 0;
  return cloneSnapshot(store);
}

export function currentPortfolio(): PortfolioSnapshot {
  return store;
}

export function mutatePortfolio(mutator: (state: PortfolioSnapshot) => PortfolioSnapshot): PortfolioSnapshot {
  store = mutator(store);
  orderSequence += 1;
  return cloneSnapshot(store);
}

/** Monotonic deterministic order-id sequence (resets with the portfolio). */
export function nextDemoOrderSequence(): number {
  orderSequence += 1;
  return orderSequence;
}

export function demoOrderIdFor(sequence: number, base: string): string {
  const hash = hashCode(`${base}${sequence}`).toString(16).padStart(8, "0").slice(0, 8);
  return `DEMO-${hash}`;
}

function hashCode(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

function cloneSnapshot(state: PortfolioSnapshot): PortfolioSnapshot {
  return {
    ...state,
    balances: { ...state.balances },
    averageCosts: { ...state.averageCosts },
  };
}
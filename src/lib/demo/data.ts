import type {
  AccountEvidence,
  DerivedSignals,
  MarketEvidence,
  PermissionInfo,
} from "@/lib/types";

export type DemoScenario = "healthy" | "volatile" | "blocked";

/**
 * Deterministic demo scenarios.
 *
 * These values are fixed so the three safety states are reproducible on
 * every run. They are labelled "demo" everywhere they surface.
 */

interface DemoMarket {
  price: number;
  changePct24h: number;
  high24h: number;
  low24h: number;
  quoteVolume24h: number;
  bid: number;
  ask: number;
  spreadPct: number;
  ageSeconds: number;
}

interface DemoAccount {
  quoteBalance: number;
  tradingGranted: boolean;
}

const SCENARIO_MARKET: Record<DemoScenario, Record<string, DemoMarket>> = {
  healthy: {
    BTCUSDT: {
      price: 67240,
      changePct24h: 0.85,
      high24h: 67890,
      low24h: 66310,
      quoteVolume24h: 2_940_000_000,
      bid: 67238.5,
      ask: 67241.5,
      spreadPct: 0.0045,
      ageSeconds: 3,
    },
    ETHUSDT: {
      price: 3521,
      changePct24h: 0.6,
      high24h: 3550,
      low24h: 3488,
      quoteVolume24h: 1_520_000_000,
      bid: 3520.4,
      ask: 3521.6,
      spreadPct: 0.034,
      ageSeconds: 3,
    },
  },
  volatile: {
    BTCUSDT: {
      price: 66840,
      changePct24h: 4.6,
      high24h: 71200,
      low24h: 61200,
      quoteVolume24h: 4_100_000_000,
      bid: 66837,
      ask: 66843,
      spreadPct: 0.009,
      ageSeconds: 4,
    },
    ETHUSDT: {
      price: 3388,
      changePct24h: 5.2,
      high24h: 3690,
      low24h: 3115,
      quoteVolume24h: 2_400_000_000,
      bid: 3386.6,
      ask: 3389.4,
      spreadPct: 0.083,
      ageSeconds: 4,
    },
  },
  blocked: {
    BTCUSDT: {
      price: 66120,
      changePct24h: -1.2,
      high24h: 67010,
      low24h: 65900,
      quoteVolume24h: 1_900_000_000,
      bid: 66118.5,
      ask: 66121.5,
      spreadPct: 0.0045,
      ageSeconds: 3,
    },
    ETHUSDT: {
      price: 3480,
      changePct24h: -0.9,
      high24h: 3512,
      low24h: 3461,
      quoteVolume24h: 980_000_000,
      bid: 3479.2,
      ask: 3480.8,
      spreadPct: 0.046,
      ageSeconds: 3,
    },
  },
};

const SCENARIO_ACCOUNT: Record<DemoScenario, DemoAccount> = {
  healthy: { quoteBalance: 500, tradingGranted: true },
  // Elevated volatility scenario keeps a healthy balance so the CAUTION
  // state comes from volatility alone.
  volatile: { quoteBalance: 500, tradingGranted: true },
  // Blocked scenario: insufficient simulated balance → deterministic BLOCK.
  blocked: { quoteBalance: 10, tradingGranted: false },
};

export const SUPPORTED_SYMBOLS = ["BTCUSDT", "ETHUSDT"] as const;

const SYMBOL_ALIASES: Record<string, string> = {
  BTCUSDT: "BTCUSDT",
  BTCPERP: "BTCUSDT",
  BITCOIN: "BTCUSDT",
  BTC: "BTCUSDT",
  ETHUSDT: "ETHUSDT",
  ETHPERP: "ETHUSDT",
  ETHER: "ETHUSDT",
  ETHEREUM: "ETHUSDT",
  ETH: "ETHUSDT",
};

export function normalizeSymbol(raw: string): string | null {
  const upper = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = upper.match(/[A-Z0-9]+?USDT/);
  const candidate = match ? match[0] : upper;
  return SYMBOL_ALIASES[candidate] ?? null;
}

export function getDemoScenarioMarket(scenario: DemoScenario, symbol: string): DemoMarket | null {
  return SCENARIO_MARKET[scenario][symbol] ?? null;
}

export function getDemoAccount(scenario: DemoScenario): DemoAccount {
  return SCENARIO_ACCOUNT[scenario];
}

export function buildDemoMarketEvidence(scenario: DemoScenario, symbol: string, nowMs: number): MarketEvidence {
  const market = getDemoScenarioMarket(scenario, symbol);
  if (!market) {
    throw new Error(`Unsupported symbol for demo: ${symbol}`);
  }
  return {
    symbol,
    lastPrice: market.price,
    priceChangePercent24h: market.changePct24h,
    high24h: market.high24h,
    low24h: market.low24h,
    quoteVolume24h: market.quoteVolume24h,
    bidPrice: market.bid,
    askPrice: market.ask,
    spreadPercent: market.spreadPct,
    capturedAtMs: nowMs,
    ageSeconds: market.ageSeconds,
    source: "demo",
    provider: "Deterministic demo scenario",
    unavailable: [],
  };
}

export function buildDemoAccountEvidence(scenario: DemoScenario): AccountEvidence {
  const account = getDemoAccount(scenario);
  const permission: PermissionInfo = {
    id: "spot-trade",
    label: "Spot trading",
    granted: account.tradingGranted,
    scopeSource: "demo-configuration",
  };
  return {
    available: true,
    sample: true,
    quoteBalance: account.quoteBalance,
    permission,
    unavailable: [],
  };
}

export function deriveDemoSignals(scenario: DemoScenario, symbol: string): DerivedSignals {
  const market = getDemoScenarioMarket(scenario, symbol);
  if (!market) {
    throw new Error(`Unsupported symbol for demo: ${symbol}`);
  }
  return deriveSignalsFromMarket({
    lastPrice: market.price,
    priceChangePercent24h: market.changePct24h,
    high24h: market.high24h,
    low24h: market.low24h,
    quoteVolume24h: market.quoteVolume24h,
    spreadPercent: market.spreadPct,
  });
}

export function deriveSignalsFromMarket(market: {
  lastPrice: number;
  priceChangePercent24h: number | null;
  high24h: number | null;
  low24h: number | null;
  quoteVolume24h: number;
  spreadPercent: number;
}): DerivedSignals {
  const notes: string[] = [];
  const rangePct =
    market.high24h && market.low24h && market.lastPrice > 0
      ? ((market.high24h - market.low24h) / market.lastPrice) * 100
      : null;

  const volatilityScore =
    market.priceChangePercent24h !== null
      ? 0.5 * Math.abs(market.priceChangePercent24h) + 0.5 * (rangePct ?? 0)
      : null;

  const volatility =
    volatilityScore === null
      ? "unknown"
      : volatilityScore >= VOLATILITY_THRESHOLD
        ? "elevated"
        : "low";

  if (volatility === "elevated") {
    notes.push("Short-term volatility is elevated.");
  }

  const liquidity =
    market.quoteVolume24h >= LIQUIDITY_VOLUME_THRESHOLD &&
    market.spreadPercent < LIQUIDITY_SPREAD_THRESHOLD
      ? "healthy"
      : market.quoteVolume24h === 0
        ? "unknown"
        : "weak";

  if (liquidity === "weak") {
    notes.push("Order-book liquidity is below the RiskLens threshold.");
  }

  return { volatilityScore, volatility, liquidity, notes };
}

export const VOLATILITY_THRESHOLD = 2.5;
export const LIQUIDITY_VOLUME_THRESHOLD = 50_000_000;
export const LIQUIDITY_SPREAD_THRESHOLD = 0.15;
import type {
  AccountEvidence,
  DerivedSignals,
  MarketEvidence,
  PermissionInfo,
  PortfolioSnapshot,
} from "@/lib/types";
import type { MarketInfo } from "@/lib/types";

export type DemoScenario = "healthy" | "volatile" | "blocked";

/**
 * Deterministic demo market/account evidence.
 *
 * Demo Mode produces reproducible, clearly-labeled simulation evidence for
 * ANY catalog pair — not just a hardcoded two-coin table. Reference prices
 * exist only for well-known majors; every other symbol derives a stable
 * baseline price from a deterministic non-cryptographic hash so a newly
 * discovered Binance pair still produces a consistent rehearsal scenario.
 * Every value is labelled "demo" everywhere it surfaces.
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

interface SeedPrice {
  price: number;
  changePct24h: number;
  quoteVolume24h: number;
}

const SEED_PRICES: Record<string, SeedPrice> = {
  BTCUSDT: { price: 67240, changePct24h: 0.85, quoteVolume24h: 2_940_000_000 },
  ETHUSDT: { price: 3521, changePct24h: 0.6, quoteVolume24h: 1_520_000_000 },
  SOLUSDT: { price: 172, changePct24h: 1.1, quoteVolume24h: 890_000_000 },
  BNBUSDT: { price: 590, changePct24h: 0.7, quoteVolume24h: 410_000_000 },
  XRPUSDT: { price: 0.52, changePct24h: 1.4, quoteVolume24h: 780_000_000 },
  DOGEUSDT: { price: 0.14, changePct24h: 1.8, quoteVolume24h: 520_000_000 },
  ADAUSDT: { price: 0.38, changePct24h: 0.9, quoteVolume24h: 240_000_000 },
  AVAXUSDT: { price: 28, changePct24h: 1.2, quoteVolume24h: 190_000_000 },
  PEPEUSDT: { price: 0.0000112, changePct24h: 2.2, quoteVolume24h: 150_000_000 },
};

const SCENARIO_ANCHOR: Record<
  DemoScenario,
  { changeScale: number; rangePct: number; spreadPct: number; ageSeconds: number; volumeScale: number }
> = {
  healthy: { changeScale: 1, rangePct: 0.024, spreadPct: 0.05, ageSeconds: 3, volumeScale: 1 },
  volatile: { changeScale: 4.2, rangePct: 0.16, spreadPct: 0.2, ageSeconds: 4, volumeScale: 2.2 },
  blocked: { changeScale: 1.4, rangePct: 0.03, spreadPct: 0.06, ageSeconds: 3, volumeScale: 0.6 },
};

const SCENARIO_ACCOUNT: Record<DemoScenario, DemoAccount> = {
  healthy: { quoteBalance: 10_000, tradingGranted: true },
  volatile: { quoteBalance: 10_000, tradingGranted: true },
  // Blocked scenario: deterministic simulated balance lets users see a BLOCK.
  blocked: { quoteBalance: 10, tradingGranted: false },
};

export function getDemoAccount(scenario: DemoScenario): DemoAccount {
  return SCENARIO_ACCOUNT[scenario];
}

export function demoMarketForSymbol(symbol: string, scenario: DemoScenario): DemoMarket {
  const anchor = SCENARIO_ANCHOR[scenario];
  const seed = SEED_PRICES[symbol];
  const price = seed ? seed.price : deterministicBaselinePrice(symbol);
  const changeAbs = seed ? Math.abs(seed.changePct24h) * anchor.changeScale : 0.8 * anchor.changeScale;
  const sign = seed ? Math.sign(seed.changePct24h) : hashRatio(symbol) < 0.5 ? -1 : 1;
  const changePct24h = seed ? seed.changePct24h * anchor.changeScale : sign * changeAbs;
  const halfRange = (price * anchor.rangePct) / 2;

  const volume = seed
    ? seed.quoteVolume24h * anchor.volumeScale
    : price * (5_000_000 + hashRatio(symbol) * 25_000_000);

  const spreadPrice = (price * anchor.spreadPct) / 100;
  return {
    price,
    changePct24h: round6(changePct24h),
    high24h: roundPrice(price + halfRange),
    low24h: roundPrice(price - halfRange),
    quoteVolume24h: Math.round(volume),
    bid: roundPrice(price - spreadPrice),
    ask: roundPrice(price + spreadPrice),
    spreadPct: anchor.spreadPct,
    ageSeconds: anchor.ageSeconds,
  };
}

export function buildDemoMarketEvidence(
  symbol: string,
  scenario: DemoScenario,
  nowMs: number
): MarketEvidence {
  const market = demoMarketForSymbol(symbol, scenario);
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
    provider: "Deterministic demo scenario fixture",
    unavailable: [],
  };
}

export function buildDemoAccountEvidence(
  scenario: DemoScenario,
  portfolio?: PortfolioSnapshot | null
): AccountEvidence {
  const account = getDemoAccount(scenario);
  const isBlockedScenario = scenario === "blocked";
  const quoteBalance = isBlockedScenario ? account.quoteBalance : (portfolio?.quoteBalance ?? account.quoteBalance);
  const holdings = isBlockedScenario ? undefined : portfolio?.balances;
  const tradingGranted = isBlockedScenario ? account.tradingGranted : true;

  const permission: PermissionInfo = {
    id: "spot-trade",
    label: "Spot trading",
    granted: tradingGranted,
    scopeSource: "demo-configuration",
  };
  return {
    available: true,
    sample: true,
    quoteBalance,
    holdings,
    permission,
    unavailable: [],
  };
}

export function deriveDemoSignals(scenario: DemoScenario, symbol: string): DerivedSignals {
  const market = demoMarketForSymbol(symbol, scenario);
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

/**
 * Deterministic stable baseline price for catalog symbols without a seed
 * entry. Non-cryptographic hash → reproducible across runs and instances.
 */
export function deterministicBaselinePrice(symbol: string): number {
  const ratio = hashRatio(symbol);
  return roundPrice(0.00001 * 10 ** (1 + ratio * 5));
}

export function hashRatio(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

export function marketInfoForDemoSeeds(): MarketInfo[] {
  return Object.keys(SEED_PRICES).map((symbol) => {
    const base = symbol.slice(0, -4);
    const price = SEED_PRICES[symbol].price;
    const prec = base === "PEPE" ? 8 : 5;
    return {
      symbol,
      baseAsset: base,
      quoteAsset: "USDT",
      status: "TRADING",
      baseAssetPrecision: prec,
      quoteAssetPrecision: 8,
      minQty: 1 / 10 ** prec,
      maxQty: null,
      stepSize: 1 / 10 ** prec,
      minNotional: 5,
      tickSize: price < 1 ? 0.00001 : price < 100 ? 0.001 : 0.01,
    };
  });
}

function roundPrice(value: number): number {
  const factor = value < 0.001 ? 10 ** 10 : value < 1 ? 10 ** 6 : value < 100 ? 10 ** 4 : 10 ** 2;
  return Math.round(value * factor) / factor;
}

function round6(value: number): number {
  return Math.round(value * 10 ** 6) / 10 ** 6;
}

export const VOLATILITY_THRESHOLD = 2.5;
export const LIQUIDITY_VOLUME_THRESHOLD = 50_000_000;
export const LIQUIDITY_SPREAD_THRESHOLD = 0.15;
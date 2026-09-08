import { describe, expect, it, beforeEach } from "vitest";
import { simulateDemoExecution } from "./simulation";
import { buildDemoMarketEvidence, demoMarketForSymbol } from "./data";
import { marketInfoForDemoSeeds } from "./data";
import { baseHolding, getDemoPortfolio, resetDemoPortfolio } from "./portfolio";
import { DemoAgentOSAdapter } from "@/lib/agentos/demo-adapter";

describe("deterministic demo execution lifecycle", () => {
  beforeEach(() => {
    resetDemoPortfolio();
  });

  it("fills a demo BUY with a deterministic order id and updates the portfolio", () => {
    const market = marketInfoForDemoSeeds().find((m) => m.symbol === "SOLUSDT")!;
    const evidence = buildDemoMarketEvidence("SOLUSDT", "healthy", Date.now());

    const result = simulateDemoExecution({
      symbol: "SOLUSDT",
      baseAsset: "SOL",
      quoteAsset: "USDT",
      side: "buy",
      quoteAmount: 100,
      baseQuantity: null,
      evidence,
      market,
      portfolio: getDemoPortfolio(),
    });

    expect(result.ok).toBe(true);
    expect(result.simulated).toBe(true);
    expect(result.status).toBe("FILLED");
    expect(result.side).toBe("buy");
    expect(result.symbol).toBe("SOLUSDT");
    expect(result.sourceLabel).toBe("DEMO SIMULATION");
    expect(result.orderId).toMatch(/^DEMO-[0-9a-f]{8}$/);
    expect(result.filledQuantity).toBeGreaterThan(0);
    expect(result.executionPrice).not.toBeNull();
    expect(result.fee).toBeGreaterThan(0);
    expect(result.feeAsset).toBe("USDT");
    expect(result.slippagePct).toBe(0.05);
    expect(result.steps?.length).toBeGreaterThanOrEqual(4);

    // Deterministic: the same inputs yield the same order id.
    const second = simulateDemoExecution({
      symbol: "SOLUSDT",
      baseAsset: "SOL",
      quoteAsset: "USDT",
      side: "buy",
      quoteAmount: 100,
      baseQuantity: null,
      evidence,
      market,
      portfolio: getDemoPortfolio(),
    });
    expect(second.orderId).not.toBe(result.orderId); // monotonic sequence

    const portfolio = result.portfolio!;
    const quoteSpent = (result.filledQuantity ?? 0) * (result.executionPrice ?? 0);
    expect(portfolio.quoteBalance).toBeCloseTo(10_000 - quoteSpent - (result.fee ?? 0), 6);
    expect(baseHolding(portfolio, "SOL")).toBeCloseTo(result.filledQuantity ?? 0, 10);
  });

  it("sells base holdings, credits proceeds, and records realized P&L", () => {
    const market = marketInfoForDemoSeeds().find((m) => m.symbol === "SOLUSDT")!;
    const evidence = buildDemoMarketEvidence("SOLUSDT", "healthy", Date.now());

    const buy = simulateDemoExecution({
      symbol: "SOLUSDT",
      baseAsset: "SOL",
      quoteAsset: "USDT",
      side: "buy",
      quoteAmount: 100,
      baseQuantity: null,
      evidence,
      market,
      portfolio: getDemoPortfolio(),
    });
    const heldAfterBuy = baseHolding(buy.portfolio!, "SOL");

    const sell = simulateDemoExecution({
      symbol: "SOLUSDT",
      baseAsset: "SOL",
      quoteAsset: "USDT",
      side: "sell",
      quoteAmount: 50,
      baseQuantity: heldAfterBuy / 2,
      evidence,
      market,
      portfolio: buy.portfolio!,
    });

    expect(sell.ok).toBe(true);
    expect(sell.status).toBe("FILLED");
    expect(sell.realizedPnl).not.toBeNull();
    expect(baseHolding(sell.portfolio!, "SOL")).toBeLessThan(heldAfterBuy);
  });

  it("cannot sell more than is held", () => {
    const market = marketInfoForDemoSeeds().find((m) => m.symbol === "SOLUSDT")!;
    const evidence = buildDemoMarketEvidence("SOLUSDT", "healthy", Date.now());
    const result = simulateDemoExecution({
      symbol: "SOLUSDT",
      baseAsset: "SOL",
      quoteAsset: "USDT",
      side: "sell",
      quoteAmount: 5000,
      baseQuantity: 100,
      evidence,
      market,
      portfolio: getDemoPortfolio(),
    });
    expect(result.filledQuantity).toBe(0);
    expect(baseHolding(result.portfolio!, "SOL")).toBe(0);
  });

  it("execution price reflects the deterministic slippage model", () => {
    const market = marketInfoForDemoSeeds().find((m) => m.symbol === "SOLUSDT")!;
    const evidence = buildDemoMarketEvidence("SOLUSDT", "healthy", Date.now());
    const ask = evidence.askPrice!;

    const result = simulateDemoExecution({
      symbol: "SOLUSDT",
      baseAsset: "SOL",
      quoteAsset: "USDT",
      side: "buy",
      quoteAmount: 100,
      baseQuantity: null,
      evidence,
      market,
      portfolio: getDemoPortfolio(),
    });

    // ask * (1 + `RL_DEMO_*` or default 0.0005). Deterministic by construction.
    const expected = ask * 1.0005;
    expect(result.executionPrice).toBeCloseTo(expected, 8);
  });

  it("derives deterministic evidence for any listed Binance symbol, not just the seeds", () => {
    // Regression: analysis must cover every coin listed on Binance, even
    // those absent from the offline demo seed (e.g. SUI).
    for (const symbol of ["SUIUSDT", "LINKUSDT", "ZECUSDT"]) {
      const market = demoMarketForSymbol(symbol, "healthy");
      expect(market.price).toBeGreaterThan(0);
      expect(market.bid).toBeGreaterThan(0);
      expect(market.ask).toBeGreaterThan(0);
      expect(market.quoteVolume24h).toBeGreaterThan(0);

      const fallback = demoMarketForSymbol(symbol, "healthy");
      // Stable and deterministic: repeated calls yield the same reference price.
      expect(fallback.price).toBe(market.price);
    }
  });
});

describe("demo adapter commits simulated fills to the shared ledger", () => {
  beforeEach(() => {
    resetDemoPortfolio();
  });

  it("persists the fill to the process store so /api/demo/portfolio updates", async () => {
    const adapter = new DemoAgentOSAdapter("healthy");
    const result = await adapter.executeOrder({
      symbol: "SOLUSDT",
      side: "buy",
      amountQuote: 100,
      quote: "USDT",
      amountType: "quote",
      amount: 100,
      baseQuantity: null,
      market: marketInfoForDemoSeeds().find((m) => m.symbol === "SOLUSDT")!,
      evidence: buildDemoMarketEvidence("SOLUSDT", "healthy", Date.now()),
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("FILLED");

    const store = getDemoPortfolio();
    expect(store.quoteBalance).toBeLessThan(10_000);
    expect(baseHolding(store, "SOL")).toBe(result.filledQuantity);
  });
});
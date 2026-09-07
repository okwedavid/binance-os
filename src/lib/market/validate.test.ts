import { describe, expect, it } from "vitest";
import { alignToStep, checkPairStatus, roundToStep, validateOrder } from "./validate";
import type { MarketInfo } from "@/lib/types";

function fixtureMarket(overrides: Partial<MarketInfo> = {}): MarketInfo {
  return {
    symbol: "SOLUSDT",
    baseAsset: "SOL",
    quoteAsset: "USDT",
    status: "TRADING",
    baseAssetPrecision: 5,
    quoteAssetPrecision: 8,
    minQty: 0.001,
    maxQty: 100000,
    stepSize: 0.001,
    minNotional: 5,
    tickSize: 0.01,
    ...overrides,
  };
}

describe("roundToStep / alignToStep", () => {
  it("rounds to the step precision", () => {
    expect(roundToStep(1.23456, 0.001)).toBe(1.235);
    expect(roundToStep(1.23449, 0.001)).toBe(1.234);
    expect(roundToStep(0.000129, 0.0000001)).toBe(0.000129);
    expect(alignToStep(100 / 3, 0.001)).toBe(roundToStep(100 / 3, 0.001));
  });
});

describe("checkPairStatus", () => {
  it("passes a TRADING pair", () => {
    expect(checkPairStatus(fixtureMarket()).status).toBe("ok");
  });

  it("fails a non-trading pair", () => {
    const check = checkPairStatus(fixtureMarket({ status: "PAUSED" }));
    expect(check.status).toBe("fail");
  });
});

describe("validateOrder", () => {
  it("blocks an order under min notional", () => {
    const checks = validateOrder({
      market: fixtureMarket(),
      side: "buy",
      quoteAmount: 1,
      baseQuantity: 0.5,
      quoteBalance: 10000,
      baseHoldings: null,
    });
    expect(checks.find((c) => c.id === "min-notional")?.status).toBe("fail");
  });

  it("blocks a quantity that violates the step size", () => {
    const checks = validateOrder({
      market: fixtureMarket(),
      side: "buy",
      quoteAmount: 50,
      baseQuantity: 1.23456,
      quoteBalance: 10000,
      baseHoldings: null,
    });
    expect(checks.find((c) => c.id === "step-size")?.status).toBe("fail");
  });

  it("blocks a buy when the quote balance is insufficient", () => {
    const checks = validateOrder({
      market: fixtureMarket(),
      side: "buy",
      quoteAmount: 5000,
      baseQuantity: 10,
      quoteBalance: 100,
      baseHoldings: null,
    });
    expect(checks.find((c) => c.id === "balance")?.status).toBe("fail");
  });

  it("blocks a sell when base holdings are insufficient", () => {
    const checks = validateOrder({
      market: fixtureMarket(),
      side: "sell",
      quoteAmount: 500,
      baseQuantity: 10,
      quoteBalance: 10000,
      baseHoldings: 2,
    });
    expect(checks.find((c) => c.id === "balance")?.status).toBe("fail");
  });

  it("passes a well-formed order", () => {
    const checks = validateOrder({
      market: fixtureMarket(),
      side: "buy",
      quoteAmount: 100,
      baseQuantity: 0.58,
      quoteBalance: 10000,
      baseHoldings: null,
    });
    expect(checks.every((c) => c.status === "ok")).toBe(true);
  });

  it("blocks a quantity below min qty", () => {
    const checks = validateOrder({
      market: fixtureMarket(),
      side: "buy",
      quoteAmount: 1,
      baseQuantity: 0.0005,
      quoteBalance: 10000,
      baseHoldings: null,
    });
    expect(checks.find((c) => c.id === "min-qty")?.status).toBe("fail");
  });
});
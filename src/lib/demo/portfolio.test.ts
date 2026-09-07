import { describe, expect, it, beforeEach } from "vitest";
import {
  applyDemoBuy,
  applyDemoSell,
  baseHolding,
  getDemoPortfolio,
  initialPortfolio,
  resetDemoPortfolio,
} from "./portfolio";

describe("demo portfolio ledger", () => {
  beforeEach(() => {
    resetDemoPortfolio();
  });

  it("starts with 10,000 USDT and no assets", () => {
    const p = getDemoPortfolio();
    expect(p.quoteAsset).toBe("USDT");
    expect(p.quoteBalance).toBe(10_000);
    expect(Object.keys(p.balances)).toHaveLength(0);
  });

  it("applies a buy: spend quote + fee, accrue base, track average cost", () => {
    const before = initialPortfolio();
    const after = applyDemoBuy(before, {
      base: "SOL",
      quoteSpent: 100,
      filledQuantity: 0.58,
      fee: 0.1,
      feeAsset: "USDT",
    });
    expect(after.quoteBalance).toBeCloseTo(10_000 - 100 - 0.1, 6);
    expect(baseHolding(after, "SOL")).toBeCloseTo(0.58, 10);
    expect(after.averageCosts.SOL).toBeCloseTo(100 / 0.58, 6);
  });

  it("applies a sell: add proceeds, realize P&L, reduce base", () => {
    let p = applyDemoBuy(initialPortfolio(), {
      base: "SOL",
      quoteSpent: 100,
      filledQuantity: 1,
      fee: 0.1,
      feeAsset: "USDT",
    });
    const heldBefore = baseHolding(p, "SOL");
    const avgCost = p.averageCosts.SOL;

    p = applyDemoSell(p, {
      base: "SOL",
      baseQty: 1,
      proceeds: 120.3,
      fee: 0.12,
      feeAsset: "USDT",
      avgCost,
    });
    expect(baseHolding(p, "SOL")).toBeCloseTo(heldBefore - 1, 10);
    expect(p.realizedPnl).toBeCloseTo(1 * avgCost, 6);
    expect(p.quoteBalance).toBeCloseTo(
      10_000 - 100 - 0.1 + 120.3 - 0.12,
      6
    );
  });

  it("never sells more than is held", () => {
    const p = applyDemoSell(initialPortfolio(), {
      base: "SOL",
      baseQty: 500,
      proceeds: 100,
      fee: 0,
      feeAsset: "USDT",
      avgCost: 0,
    });
    expect(baseHolding(p, "SOL")).toBe(0);
  });

  it("resets to the initial state", () => {
    const p = applyDemoBuy(initialPortfolio(), {
      base: "BTC",
      quoteSpent: 1000,
      filledQuantity: 0.01,
      fee: 1,
      feeAsset: "USDT",
    });
    resetDemoPortfolio();
    const after = getDemoPortfolio();
    expect(after.quoteBalance).toBe(10_000);
    expect(Object.keys(after.balances)).toHaveLength(0);
    void p;
  });
});
import { describe, expect, it } from "vitest";
import { evaluateSafety } from "./engine";
import type { SafetyEngineInput } from "./engine";

const base: SafetyEngineInput = {
  amount: 20,
  marketDataAgeSeconds: 3,
  freshnessTargetSeconds: 30,
  volatility: "low",
  liquidity: "healthy",
  balanceAvailable: true,
  balanceQuote: 500,
  permissionGranted: true,
  permissionRequired: true,
};

describe("evaluateSafety", () => {
  it("returns PASS when every check passes", () => {
    const result = evaluateSafety(base);
    expect(result.status).toBe("PASS");
    expect(result.checks.every((c) => c.status === "ok")).toBe(true);
  });

  it("BLOCKs on an invalid (non-positive) amount", () => {
    const result = evaluateSafety({ ...base, amount: 0 });
    expect(result.status).toBe("BLOCK");
    expect(result.checks.find((c) => c.id === "amount")?.status).toBe("fail");
  });

  it("BLOCKs on stale market data (over the freshness target)", () => {
    const result = evaluateSafety({
      ...base,
      marketDataAgeSeconds: base.freshnessTargetSeconds + 1,
    });
    expect(result.status).toBe("BLOCK");
    expect(result.checks.find((c) => c.id === "freshness")?.status).toBe("fail");
  });

  it("BLOCKs on null market data age (no data)", () => {
    const result = evaluateSafety({ ...base, marketDataAgeSeconds: null });
    expect(result.status).toBe("BLOCK");
    expect(result.reasons.join(" ")).toContain("Market data is unavailable");
  });

  it("BLOCKs when the requested amount exceeds the available balance", () => {
    const result = evaluateSafety({ ...base, balanceQuote: 10 });
    expect(result.status).toBe("BLOCK");
    expect(result.checks.find((c) => c.id === "balance")?.status).toBe("fail");
  });

  it("does not claim balance sufficiency when no balance data was returned", () => {
    const result = evaluateSafety({
      ...base,
      balanceAvailable: false,
      balanceQuote: null,
    });
    if (result.status === "BLOCK") {
      // any other failure is fine; the balance check itself must not fail
    }
    const balance = result.checks.find((c) => c.id === "balance");
    expect(balance?.status).toBe("skip");
    expect(balance?.detail).not.toContain("covers");
  });

  it("fails closed when the permission status is unavailable but required", () => {
    const result = evaluateSafety({ ...base, permissionGranted: null });
    expect(result.status).toBe("BLOCK");
    expect(result.checks.find((c) => c.id === "permission")?.status).toBe("fail");
  });

  it("BLOCKs on a denied trading permission", () => {
    const result = evaluateSafety({ ...base, permissionGranted: false });
    expect(result.status).toBe("BLOCK");
  });

  it("does not require a permission for analysis-only operations", () => {
    const result = evaluateSafety({
      ...base,
      permissionRequired: false,
      permissionGranted: null,
    });
    expect(result.checks.find((c) => c.id === "permission")?.status).toBe("skip");
  });

  it("CAUTIONs on elevated volatility but still passes amounts and freshness", () => {
    const result = evaluateSafety({ ...base, volatility: "elevated" });
    expect(result.status).toBe("CAUTION");
    expect(result.checks.find((c) => c.id === "freshness")?.status).toBe("ok");
    expect(result.checks.find((c) => c.id === "volatility")?.status).toBe("warn");
  });

  it("CAUTIONs on weak liquidity", () => {
    const result = evaluateSafety({ ...base, liquidity: "weak" });
    expect(result.status).toBe("CAUTION");
  });

  it("CAUTIONs (not BLOCK) when volatility cannot be verified", () => {
    const result = evaluateSafety({ ...base, volatility: "unknown" });
    expect(result.status).toBe("CAUTION");
  });

  it("BLOCK takes precedence over CAUTION", () => {
    const result = evaluateSafety({
      ...base,
      volatility: "elevated",
      balanceQuote: 5,
    });
    expect(result.status).toBe("BLOCK");
  });

  it("BLOCKs when balance is REQUIRED but unavailable (live gate)", () => {
    const result = evaluateSafety({
      ...base,
      balanceAvailable: false,
      balanceQuote: null,
      balanceRequired: true,
    });
    expect(result.status).toBe("BLOCK");
    expect(result.checks.find((c) => c.id === "balance")?.status).toBe("fail");
  });

  it("skips (does not fail) the balance check when balance is unavailable and not required", () => {
    const result = evaluateSafety({
      ...base,
      balanceAvailable: false,
      balanceQuote: null,
    });
    expect(result.checks.find((c) => c.id === "balance")?.status).toBe("skip");
    expect(result.status).toBe("PASS");
  });

  it("does not require balance for analysis when no amount is present, even with balanceRequired set", () => {
    const result = evaluateSafety({
      ...base,
      amount: null,
      balanceAvailable: false,
      balanceQuote: null,
      balanceRequired: true,
    });
    expect(result.checks.find((c) => c.id === "balance")?.status).toBe("skip");
    expect(result.status).toBe("PASS");
  });
});
import { describe, expect, it, beforeEach } from "vitest";
import { handleCommand, handleExecute } from "./orchestrator";
import type { AgentOSAdapter } from "@/lib/agentos/adapter";
import { AgentOSError } from "@/lib/agentos/adapter";
import { MarketCatalog } from "@/lib/market/catalog";
import { marketInfoForDemoSeeds } from "@/lib/demo/data";
import { resetDemoPortfolio } from "@/lib/demo/portfolio";

/** Deterministic offline demo catalog shared by the tests below. */
function demoCatalog(): MarketCatalog {
  return MarketCatalog.fromList(marketInfoForDemoSeeds());
}

describe("handleCommand (demo mode)", () => {
  it("prepares a PASS proposal for a healthy buy", async () => {
    const res = await handleCommand({
      mode: "demo",
      scenario: "healthy",
      command: "Prepare a $20 BTC spot buy if all safety checks pass.",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.kind).toBe("response");
      if (res.kind === "response") {
        expect(res.proposal).toBeDefined();
        expect(res.proposal?.phase).toBe("PROPOSED");
        expect(res.proposal?.safety.status).toBe("PASS");
        expect(res.proposal?.symbol).toBe("BTCUSDT");
      }
    }
  });

  it("CAUTIONs in the elevated-volatility scenario", async () => {
    const res = await handleCommand({
      mode: "demo",
      scenario: "volatile",
      command: "Buy $20 of BTCUSDT.",
    });
    expect(res.ok).toBe(true);
    if (res.ok && res.kind === "response") {
      expect(res.proposal?.safety.status).toBe("CAUTION");
    }
  });

  it("BLOCKs when the balance is insufficient", async () => {
    const res = await handleCommand({
      mode: "demo",
      scenario: "blocked",
      command: "Buy $20 of BTCUSDT.",
    });
    expect(res.ok).toBe(true);
    if (res.ok && res.kind === "response") {
      expect(res.proposal?.safety.status).toBe("BLOCK");
    }
  });

  it("clarifies when the amount is missing", async () => {
    const res = await handleCommand({
      mode: "demo",
      scenario: "healthy",
      command: "Buy BTCUSDT",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.kind).toBe("clarify");
    }
  });

  it("analyzes without preparing an execution", async () => {
    const res = await handleCommand({
      mode: "demo",
      scenario: "healthy",
      command: "Analyze BTCUSDT",
    });
    expect(res.ok).toBe(true);
    if (res.ok && res.kind === "response") {
      expect(res.proposal).toBeUndefined();
      expect(res.timeline.some((e) => e.kind === "ANALYSIS")).toBe(true);
    }
  });
});

describe("handleExecute", () => {
  beforeEach(() => {
    resetDemoPortfolio();
  });

  it("refuses to execute without explicit approval", async () => {
    const out = await handleExecute({
      mode: "demo",
      scenario: "healthy",
      symbol: "BTCUSDT",
      side: "buy",
      amount: 20,
      quote: "USDT",
      requestText: "Buy $20 of BTCUSDT.",
      approve: false,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.blocked).toBe(true);
    }
  });

  it("simulates (never executes) in demo mode after approval", async () => {
    const out = await handleExecute({
      mode: "demo",
      scenario: "healthy",
      symbol: "BTCUSDT",
      side: "buy",
      amount: 20,
      quote: "USDT",
      requestText: "Buy $20 of BTCUSDT.",
      approve: true,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.simulated).toBe(true);
      expect(out.proposal.phase).toBe("SIMULATED");
    }
  });

  it("re-checks the safety engine server-side and BLOCKs a blocked scenario regardless of approval", async () => {
    const out = await handleExecute({
      mode: "demo",
      scenario: "blocked",
      symbol: "BTCUSDT",
      side: "buy",
      amount: 20,
      quote: "USDT",
      requestText: "Buy $20 of BTCUSDT.",
      approve: true,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.blocked).toBe(true);
      expect(out.safety?.status).toBe("BLOCK");
      expect(out.timeline.some((e) => e.kind === "BLOCKED")).toBe(true);
    }
  });

  it("rejects an invalid amount client-side even before contacting evidence", async () => {
    const out = await handleExecute({
      mode: "demo",
      scenario: "healthy",
      symbol: "BTCUSDT",
      side: "buy",
      amount: 0,
      quote: "USDT",
      requestText: "Buy $0 of BTCUSDT.",
      approve: true,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.blocked).toBe(true);
    }
  });

  it("rejects an unsupported market before execution", async () => {
    const out = await handleExecute({
      mode: "demo",
      scenario: "healthy",
      symbol: "XYZUSDT",
      side: "buy",
      amount: 20,
      quote: "USDT",
      requestText: "Buy $20 of XYZUSDT.",
      approve: true,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.blocked).toBe(true);
    }
  });
});

describe("handleExecute with a dependency seam (C2)", () => {
  function healthyAdapter(): AgentOSAdapter {
    return {
      kind: "live",
      async connectionState() {
        return {
          mode: "live",
          connected: true,
          statusText: "Connected",
          detail: "",
          permissions: [],
          supportsTrading: true,
          withdrawalsExposed: false,
        };
      },
      async marketEvidence(symbol) {
        return {
          symbol,
          lastPrice: 100,
          priceChangePercent24h: 0.5,
          high24h: 101,
          low24h: 99,
          quoteVolume24h: 1_000_000_000,
          bidPrice: 99.5,
          askPrice: 100.5,
          spreadPercent: 1,
          capturedAtMs: Date.now(),
          ageSeconds: 2,
          source: "demo" as const,
          provider: "test",
          unavailable: [],
        };
      },
      async accountEvidence(op) {
        return {
          available: true,
          sample: false,
          quoteBalance: 500,
          permission:
            op === "propose"
              ? { id: "spot-trade", label: "Spot trading", granted: true, scopeSource: "test" }
              : null,
          unavailable: [],
        };
      },
      async executeOrder() {
        return { ok: true, simulated: true, orderId: "test-1", message: "SIMULATED test order." };
      },
    };
  }

  const ctx = {
    mode: "live" as const,
    scenario: "healthy" as const,
    symbol: "BTCUSDT",
    side: "buy" as const,
    amount: 20,
    quote: "USDT",
    requestText: "Buy $20 of BTCUSDT.",
    approve: true,
  };

  it("still reports a successful submission when post-processing fails", async () => {
    const out = await handleExecute(ctx, {
      adapter: healthyAdapter(),
      catalog: demoCatalog(),
      afterExecutionStep: async () => {
        throw new Error("post-processing write failed");
      },
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.ok).toBe(true);
      expect(out.result.simulated).toBe(true);
      expect(out.timeline.some((e) => e.label === "Confirmation pending")).toBe(true);
    }
  });

  it("reports clean success when post-processing succeeds", async () => {
    const out = await handleExecute(ctx, { adapter: healthyAdapter(), catalog: demoCatalog() });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.proposal.phase).toBe("SIMULATED");
      expect(out.timeline.some((e) => e.label === "Confirmation pending")).toBe(false);
    }
  });

  it("returns the computed safety result when the adapter fails at execution time", async () => {
    const failing: AgentOSAdapter = {
      ...healthyAdapter(),
      executeOrder: async () => {
        throw new AgentOSError("NETWORK", "Agent OS timed out.");
      },
    };
    const out = await handleExecute(ctx, { adapter: failing, catalog: demoCatalog() });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.blocked).toBe(false);
      expect(out.safety).not.toBeNull();
      expect(out.timeline.some((e) => e.kind === "PAUSED")).toBe(true);
    }
  });
});
import { describe, expect, it } from "vitest";
import { handleCommand, handleExecute } from "./orchestrator";

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
      symbol: "DOGEUSDT",
      side: "buy",
      amount: 20,
      quote: "USDT",
      requestText: "Buy $20 of DOGEUSDT.",
      approve: true,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.blocked).toBe(true);
    }
  });
});
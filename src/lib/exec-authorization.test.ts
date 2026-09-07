import { describe, expect, it, vi, afterEach } from "vitest";
import {
  issueExecutionAuthorization,
  authorizeExecution,
} from "./exec-authorization";

afterEach(() => {
  vi.useRealTimers();
});

const order = {
  mode: "demo",
  symbol: "BTCUSDT",
  side: "buy",
  amount: 20,
  amountType: "quote" as const,
  requestText: "Buy $20 of BTCUSDT.",
};

describe("execution authorization", () => {
  it("accepts a freshly issued token for the exact order", () => {
    const { token } = issueExecutionAuthorization({ order, bind: "" });
    const result = authorizeExecution({ token, order, bind: "" });
    expect(result.ok).toBe(true);
  });

  it("rejects a token that was already used (one-shot)", () => {
    const { token } = issueExecutionAuthorization({ order, bind: "" });
    expect(authorizeExecution({ token, order, bind: "" }).ok).toBe(true);
    const second = authorizeExecution({ token, order, bind: "" });
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("reused");
  });

  it("rejects a tampered token", () => {
    const { token } = issueExecutionAuthorization({ order, bind: "" });
    const [body, sig] = token.split("::");
    const tampered = `${body}XX::${sig}`;
    const result = authorizeExecution({ token: tampered, order, bind: "" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("tampered");
  });

  it("rejects a token presented for a different order", () => {
    const { token } = issueExecutionAuthorization({ order, bind: "" });
    const otherOrder = { ...order, amount: 200 };
    const result = authorizeExecution({ token, order: otherOrder, bind: "" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("tampered");
  });

  it("rejects a token whose amountType was changed", () => {
    const { token } = issueExecutionAuthorization({ order, bind: "" });
    const otherOrder = { ...order, amountType: "base" };
    const result = authorizeExecution({ token, order: otherOrder, bind: "" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("tampered");
  });

  it("rejects a live token presented with the wrong session binding", () => {
    const { token } = issueExecutionAuthorization({ order, bind: "abc" });
    const result = authorizeExecution({ token, order, bind: "def" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("binding-mismatch");
  });

  it("rejects a live token without any session binding", () => {
    const { token } = issueExecutionAuthorization({ order, bind: "abc" });
    const result = authorizeExecution({ token, order, bind: "" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("binding-mismatch");
  });

  it("rejects missing tokens", () => {
    const result = authorizeExecution({ token: "", order, bind: "" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing");
  });

  it("expires tokens after the TTL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { token } = issueExecutionAuthorization({ order, bind: "" });
    vi.setSystemTime(new Date("2026-01-01T00:20:00Z"));
    const result = authorizeExecution({ token, order, bind: "" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("expired");
  });
});
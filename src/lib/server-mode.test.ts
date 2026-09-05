import { describe, expect, it } from "vitest";
import {
  resolveServerMode,
  parseRequestedScenario,
  isCrossOriginRequest,
} from "./server-mode";

describe("resolveServerMode (server-authoritative)", () => {
  it("resolves demo requests to demo regardless of session state", () => {
    const result = resolveServerMode("demo", false);
    expect(result.kind).toBe("demo");
    if (result.kind === "demo") expect(result.mode).toBe("demo");
  });

  it("resolves live requests to live when a valid session exists", () => {
    const result = resolveServerMode("live", true);
    expect(result.kind).toBe("live");
    if (result.kind === "live") expect(result.mode).toBe("live");
  });

  it("REJECTS live requests without a server-verified session (never a silent fallback)", () => {
    const result = resolveServerMode("live", false);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toContain("Agent OS");
    }
  });

  it("treats a missing/unknown requested mode as demo", () => {
    expect(resolveServerMode(null, true).kind).toBe("demo");
    expect(resolveServerMode("", false).kind).toBe("demo");
  });

  it("treats an unknown mode string as demo", () => {
    expect(resolveServerMode("dangerous-mode", false).kind).toBe("demo");
  });
});

describe("parseRequestedScenario", () => {
  it("only accepts the two supported demo scenarios", () => {
    expect(parseRequestedScenario("volatile")).toBe("volatile");
    expect(parseRequestedScenario("blocked")).toBe("blocked");
    expect(parseRequestedScenario("healthy")).toBe("healthy");
    expect(parseRequestedScenario("anything-else")).toBe("healthy");
    expect(parseRequestedScenario(undefined)).toBe("healthy");
  });
});

describe("isCrossOriginRequest", () => {
  it("allows same-origin requests", () => {
    expect(isCrossOriginRequest("https://risklens.example", "risklens.example")).toBe(false);
    expect(isCrossOriginRequest("https://risklens.example", "risklens.example:443")).toBe(false);
  });

  it("rejects cross-origin requests", () => {
    expect(isCrossOriginRequest("https://evil.example", "risklens.example")).toBe(true);
    expect(isCrossOriginRequest("https://risklens.example", "different.example")).toBe(true);
  });

  it("allows requests without an Origin header (server-to-server / top-level nav)", () => {
    expect(isCrossOriginRequest(null, "risklens.example")).toBe(false);
    expect(isCrossOriginRequest("", "risklens.example")).toBe(false);
  });

  it("rejects malformed origins", () => {
    expect(isCrossOriginRequest("not-a-url", "risklens.example")).toBe(true);
  });
});
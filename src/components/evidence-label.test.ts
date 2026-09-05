import { describe, expect, it } from "vitest";
import { sourceLabelFor } from "@/components/EvidencePanel";

describe("sourceLabelFor (B3 evidence provenance)", () => {
  it("labels demo-sourced evidence as deterministic demo", () => {
    expect(sourceLabelFor("demo", false)).toBe("DETERMINISTIC DEMO");
    expect(sourceLabelFor("demo", true)).toBe("DETERMINISTIC DEMO");
  });

  it("labels sample account evidence as deterministic demo regardless of source", () => {
    expect(sourceLabelFor("agent-os", true)).toBe("DETERMINISTIC DEMO");
  });

  it("labels genuinely live evidence as Binance Agent OS", () => {
    expect(sourceLabelFor("agent-os", false)).toBe("BINANCE AGENT OS");
  });
});
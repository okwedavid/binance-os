import { describe, expect, it } from "vitest";
import { parseAmountString, parseIntent } from "./intent";

describe("parseAmountString (thousands / decimal handling)", () => {
  it("parses plain dollar amounts", () => {
    expect(parseAmountString("20")).toBe(20);
    expect(parseAmountString("$20")).toBe(20);
    expect(parseAmountString("100")).toBe(100);
  });

  it("parses comma-thousands separators", () => {
    expect(parseAmountString("$1,000")).toBe(1000);
    expect(parseAmountString("$2,500")).toBe(2500);
    expect(parseAmountString("$10,000")).toBe(10000);
  });

  it("parses mixed thousands + decimals", () => {
    expect(parseAmountString("$10,000.50")).toBe(10000.5);
    expect(parseAmountString("1,234.5")).toBe(1234.5);
  });

  it("parses European decimal separators", () => {
    expect(parseAmountString("12,5")).toBe(12.5);
    expect(parseAmountString("12.5")).toBe(12.5);
  });

  it("REJECTS ambiguous grouping instead of guessing", () => {
    expect(parseAmountString("1.000")).toBeNull();
    expect(parseAmountString("1,0000")).toBeNull();
  });

  it("rejects non-numeric and non-positive input", () => {
    expect(parseAmountString("abc")).toBeNull();
    expect(parseAmountString("")).toBeNull();
    expect(parseAmountString("0")).toBeNull();
    expect(parseAmountString("-5")).toBeNull();
  });
});

describe("parseIntent amount extraction (integration)", () => {
  it("extracts $20 into the proposal amount", () => {
    const intent = parseIntent("Prepare a $20 BTC spot buy if all safety checks pass.");
    expect(intent.amount).toBe(20);
    expect(intent.op).toBe("propose");
  });

  it("extracts $1,000 as one thousand (B2 regression)", () => {
    const intent = parseIntent("Buy $1,000 of ETHUSDT.");
    expect(intent.amount).toBe(1000);
  });

  it("extracts $2,500 correctly", () => {
    const intent = parseIntent("Buy $2,500 of BTCUSDT.");
    expect(intent.amount).toBe(2500);
  });

  it("extracts $10,000.50 correctly", () => {
    const intent = parseIntent("Buy $10,000.50 of BTCUSDT.");
    expect(intent.amount).toBe(10000.5);
  });

  it("requests clarification on ambiguous amounts rather than guessing", () => {
    const intent = parseIntent("Buy 1.000 of BTCUSDT.");
    expect(intent.amount).toBeNull();
  });
});
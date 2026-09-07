import { describe, expect, it } from "vitest";
import {
  aliasBase,
  extractAmount,
  normalizeToken,
  parseAmountString,
  symbolWordCandidates,
} from "./aliases";

describe("normalizeToken (market resolution forms)", () => {
  it("accepts a bare base asset in any case", () => {
    expect(normalizeToken("BTC")).toEqual({ base: "BTC", quote: null });
    expect(normalizeToken("btc")).toEqual({ base: "BTC", quote: null });
    expect(normalizeToken("sol")).toEqual({ base: "SOL", quote: null });
    expect(normalizeToken("BNB")).toEqual({ base: "BNB", quote: null });
    expect(normalizeToken("XRP")).toEqual({ base: "XRP", quote: null });
    expect(normalizeToken("DOGE")).toEqual({ base: "DOGE", quote: null });
    expect(normalizeToken("ADA")).toEqual({ base: "ADA", quote: null });
    expect(normalizeToken("AVAX")).toEqual({ base: "AVAX", quote: null });
    expect(normalizeToken("PEPE")).toEqual({ base: "PEPE", quote: null });
    expect(normalizeToken("ETH")).toEqual({ base: "ETH", quote: null });
  });

  it("resolves human aliases", () => {
    expect(normalizeToken("bitcoin")).toEqual({ base: "BTC", quote: null });
    expect(normalizeToken("BITCOIN")).toEqual({ base: "BTC", quote: null });
    expect(normalizeToken("solana")).toEqual({ base: "SOL", quote: null });
    expect(normalizeToken("ethereum")).toEqual({ base: "ETH", quote: null });
    expect(normalizeToken("cardano")).toEqual({ base: "ADA", quote: null });
  });

  it("accepts full pair tokens", () => {
    expect(normalizeToken("BTCUSDT")).toEqual({ base: "BTC", quote: "USDT" });
    expect(normalizeToken("BTC-USDT")).toEqual({ base: "BTC", quote: "USDT" });
    expect(normalizeToken("BTC/USDT")).toEqual({ base: "BTC", quote: "USDT" });
    expect(normalizeToken("SOLUSDT")).toEqual({ base: "SOL", quote: "USDT" });
    expect(normalizeToken("SOL-USDT")).toEqual({ base: "SOL", quote: "USDT" });
    expect(normalizeToken("SOL/USDT")).toEqual({ base: "SOL", quote: "USDT" });
    // Cross pairs (non USD-stable quote) are NOT part of the supported
    // universe; the token stays an unresolved suggestion and the catalog
    // blocks it. Never fabricated into a pair.
    expect(normalizeToken("ETHBTC")).toEqual({ base: "ETHBTC", quote: null });
  });

  it("returns an unresolved suggestion for unknown bare assets (catalog decides)", () => {
    expect(normalizeToken("ZZZ")).toEqual({ base: "ZZZ", quote: null });
  });
});

describe("aliasBase", () => {
  it("expands well-known names", () => {
    expect(aliasBase("BITCOIN")).toBe("BTC");
    expect(aliasBase("bitcoin")).toBe("BTC");
    expect(aliasBase("BINANCE COIN")).toBe("BNB");
    expect(aliasBase("DOGECOIN")).toBe("DOGE");
    expect(aliasBase("AVALANCHE")).toBe("AVAX");
  });

  it("passes through real tickers", () => {
    expect(aliasBase("SOL")).toBe("SOL");
    expect(aliasBase("BTC")).toBe("BTC");
  });

  it("returns null for words that are not a coin name", () => {
    expect(aliasBase("NOTACOIN")).toBeNull();
  });
});

describe("extractAmount (quote vs base)", () => {
  it("parses quote amounts", () => {
    expect(extractAmount("Buy $1,000 of BTCUSDT.")).toEqual({ value: 1000, type: "quote" });
    expect(extractAmount("Buy $2,500 of BTCUSDT.")).toEqual({ value: 2500, type: "quote" });
    expect(extractAmount("Buy 1,000 USDT of ETH.")).toEqual({ value: 1000, type: "quote" });
    expect(extractAmount("Buy 100 USDT worth of SOL.")).toEqual({ value: 100, type: "quote" });
    expect(extractAmount("Buy $100 of ADA.")).toEqual({ value: 100, type: "quote" });
    expect(extractAmount("Sell $25 of XRP.")).toEqual({ value: 25, type: "quote" });
  });

  it("parses base quantities", () => {
    expect(extractAmount("Buy 0.25 BTC.")).toEqual({ value: 0.25, type: "base" });
    expect(extractAmount("Buy 1 BNB.")).toEqual({ value: 1, type: "base" });
    expect(extractAmount("Sell 0.2 BTC.")).toEqual({ value: 0.2, type: "base" });
    expect(extractAmount("Buy 10 SOL.")).toEqual({ value: 10, type: "base" });
  });

  it("returns null when no amount is present or it is ambiguous", () => {
    expect(extractAmount("Buy BTCUSDT")).toBeNull();
    expect(extractAmount("Analyze SOL")).toBeNull();
    expect(extractAmount("Buy 1.000 of BTCUSDT.")).toBeNull();
  });
});

describe("parseAmountString", () => {
  it("never misreads thousands as decimals", () => {
    expect(parseAmountString("$1,000")).toBe(1000);
    expect(parseAmountString("$2,500")).toBe(2500);
    expect(parseAmountString("1,000")).toBe(1000);
    expect(parseAmountString("10,000.50")).toBe(10000.5);
  });

  it("parses plain decimals and separators deterministically", () => {
    expect(parseAmountString("0.25")).toBe(0.25);
    expect(parseAmountString("12.5")).toBe(12.5);
    expect(parseAmountString("12,5")).toBe(12.5);
  });
});

describe("symbolWordCandidates", () => {
  it("filters stopwords and non-ticker tokens", () => {
    expect(symbolWordCandidates("Analyze SOL")).toContain("SOL");
    expect(symbolWordCandidates("buy or sell")).toEqual([]);
    expect(symbolWordCandidates("Should I buy AVAX")).toEqual(["AVAX"]);
  });
});
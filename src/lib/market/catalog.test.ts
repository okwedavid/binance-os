import { describe, expect, it } from "vitest";
import { MarketCatalog, createMarketCatalog } from "./catalog";

describe("demo market catalog (deterministic, offline)", () => {
  it("contains the well-known majors", async () => {
    const catalog = await createMarketCatalog("demo");
    for (const symbol of ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "PEPEUSDT"]) {
      expect(catalog.has(symbol)).toBe(true);
    }
  });

  it("resolves every accepted input form to a single pair", async () => {
    const catalog = await createMarketCatalog("demo");
    const expectations = [
      ["BTC", "BTCUSDT"],
      ["btc", "BTCUSDT"],
      ["bitcoin", "BTCUSDT"],
      ["BTCUSDT", "BTCUSDT"],
      ["BTC-USDT", "BTCUSDT"],
      ["BTC/USDT", "BTCUSDT"],
      ["sol", "SOLUSDT"],
      ["SOLUSDT", "SOLUSDT"],
      ["SOL-USDT", "SOLUSDT"],
      ["SOL/USDT", "SOLUSDT"],
      ["DOGE", "DOGEUSDT"],
      ["AVAX", "AVAXUSDT"],
    ];
    for (const [token, expected] of expectations) {
      expect(catalog.resolve(token, "USDT")?.symbol).toBe(expected);
    }
  });

  it("never fabricates a pair — unknown tokens resolve to null", async () => {
    const catalog = await createMarketCatalog("demo");
    expect(catalog.resolve("ZZZUSDT", "USDT")).toBeNull();
    expect(catalog.resolve("WIDGET", "USDT")).toBeNull();
  });

  it("resolves any listed Binance pair, not just the demo seeds", async () => {
    // Regression: analysis must cover every coin listed and tradeable on
    // Binance. A full binance exchangeInfo catalog resolves non-major
    // symbols (LINK, SUI, ZEC) that are absent from the offline demo seed.
    const catalog = MarketCatalog.fromExchangeInfoSymbols([
      { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", status: "TRADING", baseAssetPrecision: 8, quoteAssetPrecision: 8 },
      { symbol: "LINKUSDT", baseAsset: "LINK", quoteAsset: "USDT", status: "TRADING", baseAssetPrecision: 8, quoteAssetPrecision: 8 },
      { symbol: "SUIUSDT", baseAsset: "SUI", quoteAsset: "USDT", status: "TRADING", baseAssetPrecision: 8, quoteAssetPrecision: 8 },
      { symbol: "ZECUSDT", baseAsset: "ZEC", quoteAsset: "USDT", status: "TRADING", baseAssetPrecision: 8, quoteAssetPrecision: 8 },
    ]);
    expect(catalog.resolve("LINK", "USDT")?.symbol).toBe("LINKUSDT");
    expect(catalog.resolve("SUI", "USDT")?.symbol).toBe("SUIUSDT");
    expect(catalog.resolve("ZECUSDT", "USDT")?.symbol).toBe("ZECUSDT");
  });

  it("resolves base assets to the default quote pair", async () => {
    const catalog = await createMarketCatalog("demo");
    expect(catalog.resolveBase("SOL")?.symbol).toBe("SOLUSDT");
    expect(catalog.resolveBase("doGE")?.symbol).toBe("DOGEUSDT");
    expect(catalog.resolveBase("NOPE")).toBeNull();
  });

  it("exposes normalized instrument metadata", async () => {
    const catalog = await createMarketCatalog("demo");
    const sol = catalog.info("SOLUSDT");
    expect(sol).not.toBeNull();
    expect(sol?.baseAsset).toBe("SOL");
    expect(sol?.quoteAsset).toBe("USDT");
    expect(sol?.status).toBe("TRADING");
    expect(sol?.stepSize).toBeGreaterThan(0);
    expect(sol?.minNotional).toBe(5);
  });
});

describe("MarketCatalog.fromList", () => {
  it("builds a catalog from normalized entries", () => {
    const catalog = MarketCatalog.fromList([
      {
        symbol: "XRPUSDT",
        baseAsset: "XRP",
        quoteAsset: "USDT",
        status: "TRADING",
        baseAssetPrecision: 5,
        quoteAssetPrecision: 8,
        minQty: 1e-5,
        maxQty: null,
        stepSize: 1e-5,
        minNotional: 5,
        tickSize: 0.0001,
      },
    ]);
    expect(catalog.resolve("XRP")?.symbol).toBe("XRPUSDT");
    expect(catalog.resolve("xrp")?.symbol).toBe("XRPUSDT");
    expect(catalog.resolveBase("XRP")?.symbol).toBe("XRPUSDT");
  });
});
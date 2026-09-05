import { describe, expect, it } from "vitest";
import type { McpTool } from "@/lib/agentos/binance/mcp-session";
import {
  isCreateOrderTool,
  selectTool,
  buildOrderArgs,
  computeObservationAgeSeconds,
} from "./tool-discovery";

function tool(name: string, description: string, properties: string[], requiredInputs: string[]): McpTool {
  return { name, description, properties, requiredInputs };
}

const createSpotOrder = tool(
  "create_spot_order",
  "Create a spot order on the exchange (places a market order)",
  ["symbol", "side", "type", "quoteOrderQty", "newClientOrderId"],
  ["symbol", "side", "type", "quoteOrderQty"]
);

const ticker = tool("get_ticker_24hr", "Get the 24hr ticker price changes", ["symbol"], ["symbol"]);
const book = tool("get_orderbook_depth", "Get the current order book depth", ["symbol", "limit"], ["symbol"]);
const account = tool("get_account_balances", "Get account asset balances", ["asset"], []);
const orderStatus = tool("get_spot_order_status", "Query an existing spot order status", ["orderId"], ["orderId"]);
const cancelOrder = tool("cancel_spot_order", "Cancel an open spot order", ["orderId"], ["orderId"]);

describe("isCreateOrderTool (strict create-only predicate)", () => {
  it("accepts a real create-order tool", () => {
    expect(isCreateOrderTool(createSpotOrder)).toBe(true);
  });

  it("rejects read/query/cancel tools", () => {
    expect(isCreateOrderTool(orderStatus)).toBe(false);
    expect(isCreateOrderTool(cancelOrder)).toBe(false);
  });

  it("rejects non-order tools", () => {
    expect(isCreateOrderTool(ticker)).toBe(false);
    expect(isCreateOrderTool(book)).toBe(false);
    expect(isCreateOrderTool(account)).toBe(false);
  });

  it("rejects a tool that lacks a symbol/side/size schema even with an order verb", () => {
    const vague = tool("place_order", "Place an order with the exchange", ["whatever"], []);
    expect(isCreateOrderTool(vague)).toBe(false);
  });
});

describe("selectTool", () => {
  it("prefers the spot order tool when trading tools are present", () => {
    const pool = [createSpotOrder, tool("place_future_order", "Place a futures order", ["symbol", "side", "quantity"], ["symbol", "side"])];
    expect(selectTool("order", pool)?.name).toBe("create_spot_order");
  });

  it("returns null when no create-order tool exists", () => {
    expect(selectTool("order", [ticker, account])).toBeNull();
  });

  it("finds market, book and balance capabilities", () => {
    expect(selectTool("market", [book, ticker, account])?.name).toBe("get_ticker_24hr");
    expect(selectTool("book", [ticker, book, account])?.name).toBe("get_orderbook_depth");
    expect(selectTool("balance", [ticker, book, account])?.name).toBe("get_account_balances");
  });

  it("prefers a ticker that declares a symbol input", () => {
    const noSymbol = tool("price_lookup", "Look up prices", [], []);
    expect(selectTool("market", [noSymbol, ticker])?.name).toBe("get_ticker_24hr");
  });
});

describe("buildOrderArgs", () => {
  const request = { symbol: "BTCUSDT", side: "buy" as const, amountQuote: 20, quote: "USDT" };

  it("builds a quote-side market order using the declared camelCase schema", () => {
    const args = buildOrderArgs(createSpotOrder, request, 100);
    expect(args).toMatchObject({
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      quoteOrderQty: "20",
    });
    expect(args.newClientOrderId).toMatch(/^rl-/);
  });

  it("uses quantity (base units) when only quantity is declared", () => {
    const quantityOnly = tool("place_spot_order", "Place a spot market order", ["symbol", "side", "quantity"], ["symbol", "side", "quantity"]);
    const args = buildOrderArgs(quantityOnly, request, 100);
    expect(args).toEqual({
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.2",
    });
  });

  it("never sends keys the schema did not declare (no phantom type)", () => {
    const noType = tool("open_spot_order", "Open a spot order (execute a buy/sell)", ["symbol", "side", "quoteQty"], ["symbol", "side"]);
    const args = buildOrderArgs(noType, request, 100);
    expect(args.type).toBeUndefined();
    expect(Object.keys(args).sort()).toEqual(["quoteQty", "side", "symbol"].sort());
  });

  it("adds a clientOrderId when the schema declares it", () => {
    const withClient = tool("create_spot_order", "Place a spot order (create)", ["symbol", "side", "type", "quantity", "clientOrderId"], ["symbol", "side"]);
    const args = buildOrderArgs(withClient, request, 100);
    expect(args.clientOrderId).toMatch(/^rl-/);
  });

  it("throws when the tool has no order-size input", () => {
    const noSize = tool("place_order", "Place an order", ["symbol", "side"], ["symbol", "side"]);
    expect(() => buildOrderArgs(noSize, request, 100)).toThrow(/size/);
  });

  it("throws when symbol/side inputs are absent", () => {
    const noCore = tool("place_order", "Place an order", ["quantity"], ["quantity"]);
    expect(() => buildOrderArgs(noCore, request, 100)).toThrow(/symbol\/side/);
  });
});

describe("computeObservationAgeSeconds (freshness is never assumed)", () => {
  const now = Date.now();

  it("reports a small age for recent epoch-millis timestamps", () => {
    const age = computeObservationAgeSeconds(now, now - 5000);
    expect(age).not.toBeNull();
    expect(Math.round(age!)).toBe(5);
  });

  it("accepts epoch-seconds timestamps and converts them", () => {
    const seconds = Math.floor(now / 1000) - 5;
    const age = computeObservationAgeSeconds(now, seconds);
    expect(age).not.toBeNull();
    expect(age!).toBeGreaterThan(4);
    expect(age!).toBeLessThanOrEqual(6);
  });

  it("returns null when no timestamp is present", () => {
    expect(computeObservationAgeSeconds(now, null)).toBeNull();
  });

  it("returns null for implausible timestamps", () => {
    expect(computeObservationAgeSeconds(now, 0)).toBeNull();
    expect(computeObservationAgeSeconds(now, -1000)).toBeNull();
    expect(computeObservationAgeSeconds(now, Number.NaN)).toBeNull();
  });

  it("returns null for future timestamps (untrustworthy)", () => {
    expect(computeObservationAgeSeconds(now, now + 1000)).toBeNull();
  });

  it("returns null for observations older than 24 hours", () => {
    expect(computeObservationAgeSeconds(now, now - 25 * 3600 * 1000)).toBeNull();
  });
});
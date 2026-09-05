import type { OrderRequest } from "@/lib/agentos/adapter";
import type { McpTool } from "@/lib/agentos/binance/mcp-session";

/**
 * Schema-driven tool selection and order argument building for the live
 * Binance Agent OS MCP server.
 *
 * Tool names are never hardcoded: capabilities are matched from the
 * server's own `tools/list` response using strict keyword predicates plus
 * the tool's declared input schema. A tool is only treated as a trading
 * capability when it positively appears to CREATE an order (place /
 * submit / create / open / execute + order) AND its schema declares a
 * symbol, a side, and an order size input. Anything weaker fails closed.
 */

const ORDER_VERBS = /\b(place|submit|create|open|start|new|execute|post)\b/;
const WRITE_ONLY_ORDER = /\border\b/;
const READ_ONLY_ORDER = /\b(cancel|get|list|query|fetch|history|watch|monitor|close|status|detail|lookup|search)\b/;

const SIZE_KEYS = [
  "quantity",
  "qty",
  "quoteorderqty",
  "quoteqty",
  "ordervalue",
  "orderamount",
  "amount",
  "notional",
  "total",
];

const REQUIRED_CORE_KEYS = ["symbol", "side"];

/** Size-limit guard applied when building order arguments. */
export const MAX_ORDER_QUOTE = 1_000_000_000;

/**
 * Returns `true` when a tool positively looks like a create-order tool
 * for trading (not a read-only or cancel/management tool).
 */
export function isCreateOrderTool(tool: McpTool): boolean {
  const name = tool.name.toLowerCase();
  const desc = (tool.description ?? "").toLowerCase();
  const combined = `${name} ${desc}`;

  if (READ_ONLY_ORDER.test(name)) return false;
  if (!ORDER_VERBS.test(combined)) return false;
  if (!WRITE_ONLY_ORDER.test(combined)) return false;

  const keys = schemaKeys(tool);
  const hasCore = REQUIRED_CORE_KEYS.every((k) => keys.has(k));
  const hasSize = SIZE_KEYS.some((k) => keys.has(k));
  return hasCore && hasSize;
}

function schemaKeys(tool: McpTool): Set<string> {
  const keys = new Set<string>();
  for (const r of tool.requiredInputs) keys.add(r.toLowerCase());
  for (const p of tool.properties ?? []) keys.add(p.toLowerCase());
  return keys;
}

/**
 * Finds the original-cased property key in the tool schema for a set of
 * canonical (lowercase) candidates, preferring the first match.
 */
function findSchemaKey(
  tool: McpTool,
  candidates: string[]
): { canonical: string; original: string } | null {
  const byLower = new Map<string, string>();
  const lower = schemaKeys(tool);
  for (const r of tool.requiredInputs) byLower.set(r.toLowerCase(), r);
  for (const p of tool.properties ?? []) byLower.set(p.toLowerCase(), p);
  for (const candidate of candidates) {
    if (lower.has(candidate)) {
      return { canonical: candidate, original: byLower.get(candidate) ?? candidate };
    }
  }
  return null;
}

/**
 * Picks the most suitable tool for a capability. `kind` is defensive:
 * the biggest risk is mislabeling a read-only tool as a trading tool.
 */
export function selectTool(
  capability: "market" | "book" | "balance" | "order",
  tools: McpTool[]
): McpTool | null {
  if (capability === "order") {
    const candidates = tools.filter(isCreateOrderTool);
    if (candidates.length === 0) return null;
    const spotNamed =
      candidates.find((t) => /spot[_ ]?order/.test(t.name.toLowerCase())) ??
      candidates.find((t) => /spot/.test(t.name.toLowerCase()));
    return spotNamed ?? candidates[0];
  }

  const candidates = tools.filter((t) => {
    const name = t.name.toLowerCase();
    const desc = (t.description ?? "").toLowerCase();
    const combined = `${name} ${desc}`;
    switch (capability) {
      case "market":
        return (
          /\b(ticker|24hr|24h|price|candlestick|klines?)\b/.test(combined) &&
          !/\b(order|balance|position|account)\b/.test(name)
        );
      case "book":
        return /\b(orderbook|order book|depth|order-book)\b/.test(combined);
      case "balance":
        return (
          /\b(balance|balances|portfolio|funding)\b/.test(combined) &&
          !isCreateOrderTool(t)
        );
      default:
        return false;
    }
  });

  if (candidates.length === 0) return null;

  if (capability === "market" || capability === "book") {
    const withSymbol = candidates.find((t) => schemaKeys(t).has("symbol"));
    if (withSymbol) return withSymbol;
  }
  return candidates[0];
}

/**
 * Builds the tool arguments for a market order from the declared schema.
 * Fails closed (throws) when the schema does not expose a usable order-size
 * input or the core symbol/side inputs.
 */
export function buildOrderArgs(
  tool: McpTool,
  request: OrderRequest,
  price: number
): Record<string, unknown> {
  const keys = schemaKeys(tool);
  if (!keys.has("symbol") || !keys.has("side")) {
    throw new Error(
      `The trading tool ${tool.name} does not declare symbol/side inputs. RiskLens will not execute.`
    );
  }

  const symbolKey = findSchemaKey(tool, ["symbol"]);
  const sideKey = findSchemaKey(tool, ["side"]);
  const typeKey = findSchemaKey(tool, ["type"]);
  const size = findSchemaKey(tool, SIZE_KEYS);

  if (!size) {
    throw new Error(
      `The trading tool ${tool.name} does not declare a usable order-size input. RiskLens will not execute.`
    );
  }

  const args: Record<string, unknown> = {
    [symbolKey!.original]: request.symbol,
    [sideKey!.original]: request.side.toUpperCase(),
  };

  if (typeKey) {
    args[typeKey.original] = "MARKET";
  } else {
    args.type = "MARKET";
  }

  const canonicalSize = size.canonical;
  if (
    canonicalSize === "quoteorderqty" ||
    canonicalSize === "quoteqty" ||
    canonicalSize === "ordervalue" ||
    canonicalSize === "orderamount" ||
    canonicalSize === "notional" ||
    canonicalSize === "total"
  ) {
    args[size.original] = String(round(request.amountQuote, 2));
  } else if (canonicalSize === "amount") {
    args[size.original] = String(round(request.amountQuote, 2));
  } else {
    // quantity / qty in base units derived from the current price.
    args[size.original] = formatQuantity(request.amountQuote / price);
  }

  const clientOrderId = findSchemaKey(tool, ["clientorderid", "newclientorderid"]);
  if (clientOrderId && typeof crypto !== "undefined" && "randomUUID" in crypto) {
    args[clientOrderId.original] = `rl-${crypto.randomUUID()}`;
  }

  // Never send keys the server did not declare.
  for (const key of Object.keys(args)) {
    if (!keys.has(key.toLowerCase())) {
      delete args[key];
    }
  }

  if (Object.keys(args).length === 0) {
    throw new Error(
      `The trading tool ${tool.name} accepts none of the required order arguments. RiskLens will not execute.`
    );
  }

  return args;
}

/**
 * Computes the observation age in seconds from a candidate server-provided
 * timestamp (epoch millis). Returns `null` when the timestamp is missing,
 * implausible, or cannot be trusted — the caller MUST treat `null` as
 * "freshness unknown" and never as "fresh".
 */
export function computeObservationAgeSeconds(
  capturedAtMs: number,
  serverTs: number | null
): number | null {
  if (serverTs === null) return null;
  if (!Number.isFinite(serverTs) || serverTs <= 0) return null;

  // Support epoch seconds (10 digits) as well as epoch millis (13 digits)
  // so a units mismatch is interpreted, never silently mislabeled fresh.
  let asMs = serverTs;
  if (serverTs < 1e12) asMs = serverTs * 1000;

  const deltaMs = capturedAtMs - asMs;
  // Reject future timestamps and values older than 24 hours: those are not
  // trustworthy observations for freshness (could be stale, replayed, or in
  // the wrong units).
  if (deltaMs < 0 || deltaMs > 24 * 3600 * 1000) return null;

  return deltaMs / 1000;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatQuantity(value: number): string {
  return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "") || "0";
}
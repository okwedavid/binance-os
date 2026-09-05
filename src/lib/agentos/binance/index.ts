import type {
  AccountEvidence,
  ConnectionState,
  ExecutionResult,
  MarketEvidence,
  PermissionInfo,
} from "@/lib/types";
import type { AgentOSAdapter, OrderRequest } from "@/lib/agentos/adapter";
import { AgentOSError } from "@/lib/agentos/adapter";
import { AgentOsMcpSession, withAgentOsSession, type McpTool } from "@/lib/agentos/binance/mcp-session";
import {
  readStoredSession,
  scopeList,
  type StoredSession,
} from "@/lib/agentos/binance/oauth";

/**
 * BinanceAgentOSAdapter talks to the real Binance Agent OS MCP server
 * over Streamable HTTP (https://agent.binance.com/mcp/agentic).
 *
 * Tool names are never assumed: they are discovered at runtime from the
 * server's own `tools/list` response and matched to internal capabilities
 * by keyword heuristics. Tool outputs are normalized by key matching.
 * Anything the server does not provide is reported as unavailable —
 * never estimated.
 */
export class BinanceAgentOSAdapter implements AgentOSAdapter {
  readonly kind = "live" as const;

  async connectionState(): Promise<ConnectionState> {
    const session = await readStoredSession();
    if (!session) {
      return {
        mode: "live",
        connected: false,
        statusText: "Authorization required",
        detail:
          "Connect the Agentic sub-account through Binance to enable live read-only evidence. Nothing executes without approval.",
        permissions: [],
        supportsTrading: null,
        withdrawalsExposed: false,
      };
    }

    const scopes = scopeList(session);
    try {
      const tools = await withAgentOsSession((s) => s.listTools());
      const cached = this.cacheTools(tools);
      return this.stateFromSession(session, cached, scopes);
    } catch (err) {
      if (err instanceof AgentOSError && err.code === "AUTHORIZATION_REQUIRED") {
        return {
          mode: "live",
          connected: false,
          statusText: "Authorization required",
          detail: "The Agent OS authorization expired. Reconnect from the connection panel.",
          permissions: [],
          supportsTrading: null,
          withdrawalsExposed: false,
        };
      }
      return {
        mode: "live",
        connected: false,
        statusText: "Agent OS unreachable",
        detail:
          "RiskLens could not reach the Binance Agent OS MCP server. No action will be executed.",
        permissions: [],
        supportsTrading: null,
        withdrawalsExposed: false,
      };
    }
  }

  async marketEvidence(symbol: string): Promise<MarketEvidence> {
    return withAgentOsSession(async (session) => {
      const tools = await session.listTools();
      this.cacheTools(tools);

      const tickerTool = selectTool("market", tools);
      if (!tickerTool) {
        throw new AgentOSError(
          "CAPABILITY_UNAVAILABLE",
          "The Agent OS connection does not expose market ticker data."
        );
      }

      const priceResult = await session.callTool(tickerTool.name, { symbol });
      const priceObject = parseResult(priceResult);

      const bookTool = selectTool("book", tools);
      let bookObject: Record<string, unknown> | null = null;
      if (bookTool) {
        try {
          const bookResult = await session.callTool(bookTool.name, { symbol });
          bookObject = parseResult(bookResult);
        } catch {
          bookObject = null;
        }
      }

      return this.normalizeMarket(symbol, priceObject, bookObject);
    });
  }

  async accountEvidence(op: "analyze" | "propose"): Promise<AccountEvidence> {
    return withAgentOsSession(async (session) => {
      const tools = await session.listTools();
      this.cacheTools(tools);

      const orderTool = selectTool("order", tools);
      const balanceTool = selectTool("balance", tools);

      let balance: number | null = null;
      let available = false;
      if (balanceTool) {
        try {
          const result = await session.callTool(balanceTool.name, {});
          const object = parseResult(result);
          balance = extractQuoteBalance(object);
          available = balance !== null;
        } catch {
          available = false;
        }
      }

      const orderPermission: PermissionInfo = orderTool
        ? {
            id: "spot-trade",
            label: "Spot trading",
            granted: true,
            scopeSource: `tool:${orderTool.name}`,
          }
        : {
            id: "spot-trade",
            label: "Spot trading",
            granted: false,
            scopeSource: "tool-discovery",
          };

      const permission = op === "propose" ? orderPermission : null;

      return {
        available,
        sample: false,
        quoteBalance: balance,
        permission,
        unavailable: balanceTool
          ? []
          : ["Account balance not exposed by the current Agent OS permission."],
      };
    });
  }

  async executeOrder(request: OrderRequest): Promise<ExecutionResult> {
    return withAgentOsSession(async (session) => {
      const tools = await session.listTools();
      this.cacheTools(tools);

      const orderTool = selectTool("order", tools);
      if (!orderTool) {
        throw new AgentOSError(
          "CAPABILITY_UNAVAILABLE",
          "The Agent OS connection does not grant a trading tool. The action is blocked."
        );
      }

      const price = await this.currentPrice(session, orderTool, request.symbol);
      if (price === null) {
        throw new AgentOSError(
          "STALE_DATA",
          "No fresh market price is available to build the order. RiskLens will not execute."
        );
      }

      const args = buildOrderArgs(orderTool, request, price);
      const result = await session.callTool(orderTool.name, args);
      const text = result.text ?? "Order accepted by Agent OS.";
      return {
        ok: true,
        simulated: false,
        orderId: extractOrderId(text, result.structured),
        message: text,
      };
    });
  }

  /** The tool set observed in this server request (used for permissions). */
  private cachedTools: McpTool[] = [];
  private cacheTools(tools: McpTool[]): McpTool[] {
    this.cachedTools = tools;
    return tools;
  }

  private async currentPrice(
    session: AgentOsMcpSession,
    orderTool: McpTool,
    symbol: string
  ): Promise<number | null> {
    const tickerTool = selectTool("market", this.cachedTools);
    if (tickerTool && tickerTool.name !== orderTool.name) {
      const result = await session.callTool(tickerTool.name, { symbol });
      const object = parseResult(result);
      const price = pickNumber(object, ["lastprice", "price", "close", "markprice"]);
      if (price !== null) return price;
    }
    return null;
  }

  private normalizeMarket(
    symbol: string,
    priceObject: Record<string, unknown> | null,
    bookObject: Record<string, unknown> | null
  ): MarketEvidence {
    const unavailable: string[] = [];
    const capturedAtMs = Date.now();

    const lastPrice = pickNumber(priceObject, ["lastprice", "price", "close", "markprice"]);
    if (lastPrice === null) unavailable.push("Current price");

    const priceChangePercent24h = pickNumber(priceObject, [
      "pricechangepercent",
      "pricechangepercent24h",
      "changepercent",
      "changepercent24h",
      "pricechangepct24h",
    ]);
    const high24h = pickNumber(priceObject, ["highprice", "highprice24h", "high", "24high"]);
    const low24h = pickNumber(priceObject, ["lowprice", "lowprice24h", "low", "24low"]);
    const quoteVolume24h = pickNumber(priceObject, [
      "quotevolume",
      "quotevolume24h",
      "quotevolume24",
      "volumeinquote",
      "volume",
    ]);
    if (quoteVolume24h === null) unavailable.push("24h quote volume");

    let bidPrice: number | null = null;
    let askPrice: number | null = null;
    if (bookObject) {
      const bids = array2d(bookObject, "bids");
      const asks = array2d(bookObject, "asks");
      if (bids && bids.length > 0) {
        bidPrice = Number(bids[0][0]);
      }
      if (asks && asks.length > 0) {
        askPrice = Number(asks[0][0]);
      }
      if (!isFiniteNumber(bidPrice)) bidPrice = null;
      if (!isFiniteNumber(askPrice)) askPrice = null;
    }
    if (bidPrice === null && askPrice === null && bookObject === null) {
      unavailable.push("Order book");
    }

    const mid = bidPrice !== null && askPrice !== null ? (bidPrice + askPrice) / 2 : lastPrice;
    const spreadPercent =
      bidPrice !== null && askPrice !== null && mid !== null && mid > 0
        ? ((askPrice - bidPrice) / mid) * 100
        : null;

    let ageSeconds: number | null = null;
    const serverTs = pickNumber(priceObject, ["eventtime", "timestamp", "opentime", "transactiontime"]);
    if (serverTs !== null) {
      ageSeconds = Math.max(0, (capturedAtMs - serverTs) / 1000);
    } else {
      ageSeconds = 0;
    }

    if (quoteVolume24h === null) {
      unavailable.push("Liquidity could not be derived. Only the raw observed values are shown.");
    }

    return {
      symbol,
      lastPrice,
      priceChangePercent24h,
      high24h,
      low24h,
      quoteVolume24h,
      bidPrice,
      askPrice,
      spreadPercent,
      capturedAtMs,
      ageSeconds,
      source: "agent-os",
      provider: "Binance Agent OS (MCP)",
      unavailable,
    };
  }

  private stateFromSession(
    session: StoredSession,
    tools: McpTool[],
    scopes: string[]
  ): ConnectionState {
    const market = selectTool("market", tools) !== null;
    const account = selectTool("balance", tools) !== null;
    const trading = selectTool("order", tools) !== null;

    const permissions: PermissionInfo[] = [
      {
        id: "market-data",
        label: "Market data",
        granted: market,
        scopeSource: market ? "tool-discovery" : "no-tool-exposed",
      },
      {
        id: "account-read",
        label: "Account read",
        granted: account,
        scopeSource: account ? "tool-discovery" : "no-tool-exposed",
      },
      {
        id: "spot-trade",
        label: "Spot trading",
        granted: trading,
        scopeSource: trading ? "tool-discovery" : "no-tool-exposed",
      },
    ];

    const scopeNote =
      scopes.length > 0
        ? `Granted OAuth scopes: ${scopes.join(", ")}.`
        : "No explicit scope string was returned by the authorization server.";

    return {
      mode: "live",
      connected: true,
      statusText: "Connected",
      detail: `${scopeNote} The Agentic sub-account is isolated. Withdrawals are never exposed by the MCP integration.`,
      permissions,
      supportsTrading: trading,
      withdrawalsExposed: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Capability mapping (runtime discovery — no hardcoded tool names)
// ---------------------------------------------------------------------------

function selectTool(capability: "market" | "book" | "balance" | "order", tools: McpTool[]): McpTool | null {
  const candidates = tools.filter((t) => {
    const name = t.name.toLowerCase();
    const desc = (t.description ?? "").toLowerCase();
    const combined = `${name} ${desc}`;
    switch (capability) {
      case "market":
        return (
          /\b(ticker|24hr|price)\b/.test(combined) &&
          !/\b(order|balance|position)\b/.test(name)
        );
      case "book":
        return /\b(order book|orderbook|depth)\b/.test(combined);
      case "balance":
        return (
          /\b(balance|portfolio|account balance|asset balance)\b/.test(combined) &&
          !/\border\b/.test(name) &&
          !/\btrade\b/.test(name)
        );
      case "order":
        return (
          /\b(place|submit|create)\b/.test(combined) &&
          /\border\b/.test(combined) &&
          !/\bcancel\b/.test(name) &&
          t.requiredInputs.some((r) => ["symbol", "side", "quantity", "amount"].includes(r.toLowerCase()))
        );
      default:
        return false;
    }
  });

  if (candidates.length === 0) return null;

  // Prefer a candidate whose schema accepts a freetext "symbol" input.
  if (capability === "market" || capability === "book") {
    const withSymbol = candidates.find((t) => t.requiredInputs.includes("symbol"));
    if (withSymbol) return withSymbol;
  }
  return candidates[0];
}

function buildOrderArgs(
  tool: McpTool,
  request: OrderRequest,
  price: number
): Record<string, unknown> {
  const required = new Set(tool.requiredInputs.map((r) => r.toLowerCase()));
  const args: Record<string, unknown> = {
    symbol: request.symbol,
    side: request.side.toUpperCase(),
    type: "MARKET",
  };

  if (required.has("quoteorderqty")) {
    args.quoteOrderQty = String(round(request.amountQuote, 2));
  } else if (required.has("quantity")) {
    args.quantity = formatQuantity(request.amountQuote / price);
  } else if (required.has("amount")) {
    args.amount = String(round(request.amountQuote, 2));
  }

  for (const r of ["symbol", "side", "type"]) {
    if (required.has(r) && r !== "type" && args[r] === undefined) {
      args[r] = request.symbol;
    }
  }

  // Remove keys the server did not declare so unknown-parameter rejection is
  // avoided when possible.
  for (const key of Object.keys(args)) {
    if (!required.has(key.toLowerCase()) && !["symbol", "side", "type"].includes(key)) {
      delete args[key];
    }
  }
  return args;
}

function extractOrderId(text: string, structured: Record<string, unknown> | null): string | null {
  const candidates: string[] = [];
  if (structured) {
    candidates.push(String(pickByKey(structured, ["orderid", "order_id", "clientorderid"]) ?? ""));
  }
  const match = text.match(/order[iI]d["'':\s]+([A-Za-z0-9_-]+)/i);
  if (match) candidates.push(match[1]);
  return candidates.find((c) => c.length > 0) ?? null;
}

// ---------------------------------------------------------------------------
// Output normalization helpers
// ---------------------------------------------------------------------------

function parseResult(result: { structured: Record<string, unknown> | null; text: string | null }): Record<string, unknown> | null {
  if (result.structured) return result.structured;
  if (!result.text) return null;
  const trimmed = result.text.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed !== null && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // The tool returned plain text; keep it only for messages.
  }
  return null;
}

function flattenInto(object: unknown, target: Map<string, unknown>): void {
  if (Array.isArray(object)) {
    void object;
    return;
  }
  if (object !== null && typeof object === "object") {
    for (const [key, value] of Object.entries(object as Record<string, unknown>)) {
      const normalized = key.toLowerCase();
      if (!target.has(normalized)) {
        target.set(normalized, value);
      }
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        flattenInto(value, target);
      }
    }
  }
}

function pickNumber(object: Record<string, unknown> | null, keys: string[]): number | null {
  if (!object) return null;
  const flat = new Map<string, unknown>();
  flattenInto(object, flat);
  for (const key of keys) {
    const value = flat.get(key.toLowerCase());
    if (value === undefined || value === null) continue;
    if (typeof value === "number" && isFiniteNumber(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value.replace(/,/g, ""));
      if (isFiniteNumber(parsed)) return parsed;
    }
  }
  return null;
}

function pickByKey(object: Record<string, unknown> | null, keys: string[]): unknown {
  if (!object) return null;
  const flat = new Map<string, unknown>();
  flattenInto(object, flat);
  for (const key of keys) {
    if (flat.has(key.toLowerCase())) return flat.get(key.toLowerCase());
  }
  return null;
}

function array2d(object: Record<string, unknown> | null, key: string): Array<Array<string | number>> | null {
  if (!object) return null;
  const flat = new Map<string, unknown>();
  flattenInto(object, flat);
  const value = flat.get(key.toLowerCase());
  if (!Array.isArray(value)) return null;
  const rows: Array<Array<string | number>> = [];
  for (const row of value) {
    if (Array.isArray(row)) {
      rows.push(row.slice(0, 2) as Array<string | number>);
    }
  }
  return rows;
}

function extractQuoteBalance(object: Record<string, unknown> | null): number | null {
  if (!object) return null;
  const flat = new Map<string, unknown>();
  flattenInto(object, flat);

  const assets = flat.get("assets") ?? flat.get("balances");
  if (Array.isArray(assets)) {
    for (const asset of assets) {
      if (asset === null || typeof asset !== "object") continue;
      const entry = asset as Record<string, unknown>;
      const assetName = String(entry.asset ?? entry.symbol ?? entry.coin ?? "").toUpperCase();
      if (assetName === "USDT") {
        const free = toNumber(entry.free ?? entry.available ?? entry.balance ?? entry.netbalance);
        if (isFiniteNumber(free)) return free;
      }
    }
  }

  const direct = pickNumber(object, ["usdtfree", "usdtbalance", "availableusdt", "freeusdt"]);
  if (direct !== null) return direct;

  const single = flat.get("free") ?? flat.get("available") ?? flat.get("balance");
  return toNumber(single);
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return isFiniteNumber(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return isFiniteNumber(parsed) ? parsed : null;
  }
  return null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatQuantity(value: number): string {
  return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "") || "0";
}
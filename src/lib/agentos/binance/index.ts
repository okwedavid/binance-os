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
import {
  buildOrderArgs,
  computeObservationAgeSeconds,
  selectTool,
} from "@/lib/agentos/tool-discovery";

/**
 * BinanceAgentOSAdapter talks to the real Binance Agent OS MCP server
 * over Streamable HTTP (https://agent.binance.com/mcp/agentic).
 *
 * Tool names are never assumed: they are discovered at runtime from the
 * server's own `tools/list` response and matched to internal capabilities
 * by strict schema-driven heuristics. Tool outputs are normalized by key
 * matching. Anything the server does not provide is reported as
 * unavailable — never estimated. Unknown observation timestamps are never
 * labeled fresh; freshness that cannot be verified stays "unknown" and
 * the safety engine treats it as a BLOCK for execution.
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
    const stored = await readStoredSession();
    const scopes = scopeList(stored);
    this.cachedScopes = scopes;

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

      const orderPermission = tradingPermission(scopes, orderTool);

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
    const stored = await readStoredSession();
    const scopes = scopeList(stored);
    this.cachedScopes = scopes;

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

      const orderPermission = tradingPermission(scopes, orderTool);
      if (orderPermission.granted !== true) {
        throw new AgentOSError(
          "CAPABILITY_UNAVAILABLE",
          "Trading permission could not be confirmed for this Agent OS session. RiskLens will not execute."
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
  private cachedScopes: string[] = [];
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
    // Quote-volume candidates only: base-asset volume ("volume") is NEVER
    // labeled as quote liquidity.
    const quoteVolume24h = pickNumber(priceObject, [
      "quotevolume",
      "quotevolume24h",
      "quotevolume24",
      "volumeinquote",
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

    // Observation-time candidates only. "opentime"/"openTime" (the 24h
    // window open) is deliberately NOT a candidate. When no trustworthy
    // timestamp is available, age stays null (BLOCK for freshness).
    const observedTs = pickNumber(priceObject, [
      "eventtime",
      "e",
      "transactiontime",
      "close_time",
      "closetime",
      "c",
    ]);
    const ageSeconds = computeObservationAgeSeconds(capturedAtMs, observedTs);

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
    this.cachedScopes = scopes;

    const market = selectTool("market", tools) !== null;
    const account = selectTool("balance", tools) !== null;
    const orderTool = selectTool("order", tools);
    const trading = tradingPermission(scopes, orderTool);

    const permissions: PermissionInfo[] = [
      {
        id: "market-data",
        label: "Market data",
        granted: market,
        scopeSource: market ? "agentos-tools/list" : "no-tool-exposed",
      },
      {
        id: "account-read",
        label: "Account read",
        granted: account,
        scopeSource: account ? "agentos-tools/list" : "no-tool-exposed",
      },
      {
        id: "spot-trade",
        label: "Spot trading",
        granted: trading.granted,
        scopeSource: trading.scopeSource,
      },
    ];

    const scopeNote =
      scopes.length > 0
        ? `Granted OAuth scopes: ${scopes.join(", ")}.`
        : "No explicit scope string was returned by the authorization server; permissions are read from the Agent OS tool set.";

    return {
      mode: "live",
      connected: true,
      statusText: "Connected",
      detail: `${scopeNote} The Agentic sub-account is isolated. Withdrawals are never exposed by the MCP integration.`,
      permissions,
      supportsTrading: trading.granted === true,
      withdrawalsExposed: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Permission logic (B1): tool presence is corroborated by OAuth scope.
// ---------------------------------------------------------------------------

const TRADING_SCOPE_HINTS = /trade|spot|order|execution|margin|convert|future/i;

function tradingPermission(
  scopes: string[],
  orderTool: McpTool | null
): PermissionInfo {
  // When Binance exposes an auth scope string, corroborate the granted
  // tools against it. An explicit scope list that contains no trading-like
  // scope means trading is NOT confirmed.
  const scopeCorroboration =
    scopes.length === 0 ? null : scopes.some((s) => TRADING_SCOPE_HINTS.test(s));

  if (orderTool) {
    return {
      id: "spot-trade",
      label: "Spot trading",
      granted: true,
      scopeSource:
        scopeCorroboration === true
          ? "agentos-tools/list (create-order tool) + oauth-scope"
          : "agentos-tools/list (create-order tool)",
    };
  }

  if (scopeCorroboration === false) {
    return {
      id: "spot-trade",
      label: "Spot trading",
      granted: false,
      scopeSource: "oauth-scope: no trading scope granted",
    };
  }

  return {
    id: "spot-trade",
    label: "Spot trading",
    granted: null,
    scopeSource: "no create-order tool exposed by Agent OS",
  };
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

/**
 * Extracts the USDT (quote) balance from an account tool result. Only a
 * balance that is positively identified as USDT/quote is returned. A bare
 * "free"/"balance" number is never labeled quote balance because it could
 * be a base-asset balance — mislabeling it would make an unsafe order look
 * safe.
 */
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

  // Explicitly USDT-named fields are still legitimate.
  return pickNumber(object, ["usdtfree", "usdtbalance", "availableusdt", "freeusdt"]);
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

function extractOrderId(text: string, structured: Record<string, unknown> | null): string | null {
  const candidates: string[] = [];
  if (structured) {
    const flat = new Map<string, unknown>();
    flattenInto(structured, flat);
    const byKey =
      flat.get("orderid") ??
      flat.get("order_id") ??
      flat.get("clientorderid") ??
      flat.get("orderidstring");
    if (byKey !== undefined) candidates.push(String(byKey));
  }
  const match = text.match(/order[iI]d["'':\s]+([A-Za-z0-9_-]+)/i);
  if (match) candidates.push(match[1]);
  return candidates.find((c) => c.length > 0) ?? null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
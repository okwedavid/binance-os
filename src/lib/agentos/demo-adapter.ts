import type {
  AccountEvidence,
  ConnectionState,
  ExecutionResult,
  MarketEvidence,
} from "@/lib/types";
import {
  buildDemoAccountEvidence,
  buildDemoMarketEvidence,
  getDemoAccount,
  getDemoScenarioMarket,
  type DemoScenario,
} from "@/lib/demo/data";
import type { AgentOSAdapter, OrderRequest } from "@/lib/agentos/adapter";
import { AgentOSError } from "@/lib/agentos/adapter";

/**
 * Deterministic demo adapter. Always works, always available, and never
 * reaches a live execution path. Every value it returns is labelled as a
 * demo sample so nothing is ever presented as a live result.
 */
export class DemoAgentOSAdapter implements AgentOSAdapter {
  readonly kind = "demo" as const;

  constructor(private readonly scenario: DemoScenario) {}

  async connectionState(): Promise<ConnectionState> {
    return {
      mode: "demo",
      connected: false,
      statusText: "Demo simulation",
      detail:
        "Deterministic sample data. No real order will be submitted.",
      permissions: [
        { id: "market-data", label: "Market data", granted: true, scopeSource: "demo-configuration" },
        { id: "account-read", label: "Account read", granted: true, scopeSource: "demo-configuration" },
        { id: "spot-trade", label: "Spot trading", granted: getDemoAccount(this.scenario).tradingGranted, scopeSource: "demo-configuration" },
      ],
      supportsTrading: getDemoAccount(this.scenario).tradingGranted,
      withdrawalsExposed: false,
    };
  }

  async marketEvidence(symbol: string): Promise<MarketEvidence> {
    const market = getDemoScenarioMarket(this.scenario, symbol);
    if (!market) {
      throw new AgentOSError("INVALID_REQUEST", `Demo Mode does not know the symbol ${symbol}.`);
    }
    return buildDemoMarketEvidence(this.scenario, symbol, Date.now());
  }

  async accountEvidence(): Promise<AccountEvidence> {
    return buildDemoAccountEvidence(this.scenario);
  }

  async executeOrder(request: OrderRequest): Promise<ExecutionResult> {
    const market = getDemoScenarioMarket(this.scenario, request.symbol);
    if (!market) {
      throw new AgentOSError("INVALID_REQUEST", `Demo Mode does not know the symbol ${request.symbol}.`);
    }
    const simulatedQuantity = request.amountQuote / market.price;
    return {
      ok: true,
      simulated: true,
      orderId: null,
      message:
        `SIMULATED ${request.side.toUpperCase()} ${request.symbol} for ${request.amountQuote.toFixed(2)} ${request.quote} ` +
        `(~${simulatedQuantity.toFixed(6)} ${request.symbol.replace("USDT", "")}) at simulated price ${market.price.toFixed(2)}. ` +
        "No live order was submitted.",
    };
  }
}
import type {
  AccountEvidence,
  ConnectionState,
  ExecutionResult,
  MarketEvidence,
} from "@/lib/types";
import {
  buildDemoAccountEvidence,
  buildDemoMarketEvidence,
  demoMarketForSymbol,
  getDemoAccount,
  type DemoScenario,
} from "@/lib/demo/data";
import { getDemoPortfolio, mutatePortfolio } from "@/lib/demo/portfolio";
import { simulateDemoExecution } from "@/lib/demo/simulation";
import type { AgentOSAdapter, OrderRequest } from "@/lib/agentos/adapter";
import { AgentOSError } from "@/lib/agentos/adapter";

/**
 * Deterministic demo adapter. Always works, always available, and never
 * reaches a live execution path. Evidence is generated for ANY catalog
 * symbol (no hardcoded BTC/ETH fixture table); fills run through the full
 * simulated trade lifecycle against the in-memory DEMO PORTFOLIO. Every
 * value it returns is labelled as a demo sample so nothing is ever
 * presented as a live result.
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
    if (!symbol || !/^[A-Z0-9]+$/.test(symbol)) {
      throw new AgentOSError("INVALID_REQUEST", `Demo Mode cannot read the symbol ${symbol}.`);
    }
    return buildDemoMarketEvidence(symbol, this.scenario, Date.now());
  }

  async accountEvidence(): Promise<AccountEvidence> {
    return buildDemoAccountEvidence(this.scenario, getDemoPortfolio());
  }

  async executeOrder(request: OrderRequest): Promise<ExecutionResult> {
    if (!request.market) {
      throw new AgentOSError(
        "INVALID_REQUEST",
        `Demo Mode does not know the pair ${request.symbol}.`
      );
    }
    const input: Parameters<typeof simulateDemoExecution>[0] = {
      symbol: request.symbol,
      baseAsset: request.market.baseAsset,
      quoteAsset: request.market.quoteAsset,
      side: request.side,
      quoteAmount: request.amountQuote,
      baseQuantity: request.baseQuantity ?? null,
      evidence:
        request.evidence === null || request.evidence === undefined
          ? buildDemoMarketEvidence(request.symbol, this.scenario, Date.now())
          : request.evidence,
      market: request.market,
      portfolio: getDemoPortfolio(),
    };
    const result = simulateDemoExecution(input);
    // Commit the simulated fill to the in-memory ledger so the shared
    // /api/demo/portfolio read reflects the trade (on single-instance this
    // is the same store the panel reads; the client also prefers the exec
    // snapshot, making the panel robust across instances).
    if (result.ok && result.status === "FILLED" && result.portfolio) {
      mutatePortfolio(() => result.portfolio!);
    }
    return result;
  }

  /** Deterministic scenario market for a symbol (used by tests). */
  referenceMarket(symbol: string): { price: number; bid: number; ask: number } {
    const market = demoMarketForSymbol(symbol, this.scenario);
    return { price: market.price, bid: market.bid, ask: market.ask };
  }
}
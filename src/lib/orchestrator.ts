import type {
  AgentResponse,
  AmountType,
  DerivedSignals,
  EvidenceBundle,
  ExecutionResult,
  Intent,
  MarketInfo,
  Mode,
  OrderPreview,
  PortfolioSnapshot,
  Proposal,
  SafetyCheckItem,
  SafetyResult,
  Side,
  TimelineEvent,
  TimelineKind,
} from "@/lib/types";
import { parseIntent, requiredForOp, clarifyQuestion, supportNotes } from "@/lib/agent/intent";
import { evaluateSafety, formatAmount } from "@/lib/safety/engine";
import { checkPairStatus, validateOrder, roundToStep } from "@/lib/market/validate";
import { createMarketCatalog, type MarketCatalog } from "@/lib/market/catalog";
import { explainDecision, decisionSummary } from "@/lib/agent/explain";
import { getAdapter } from "@/lib/agentos";
import { userMessageForError, type AgentOSAdapter } from "@/lib/agentos/adapter";
import { deriveSignalsFromMarket } from "@/lib/demo/data";
import type { DemoScenario } from "@/lib/demo/data";

export const FRESHNESS_TARGET_SECONDS = 30;
export const DEFAULT_QUOTE_ASSET = "USDT";

export interface CommandContext {
  mode: Mode;
  scenario: DemoScenario;
  command: string;
}

export interface ExecuteContext {
  mode: Mode;
  scenario: DemoScenario;
  symbol: string;
  side: Side;
  /** Amount exactly as the user requested (quote or base units). */
  amount: number;
  amountType?: AmountType;
  quote: string;
  requestText: string;
  approve: boolean;
}

/**
 * Dependency seam for handleExecute. Real callers pass nothing; tests
 * inject a fake adapter, a post-execution hook, and/or a market catalog
 * so Live-mode execution checks stay hermetic.
 */
export interface ExecuteDeps {
  adapter?: AgentOSAdapter | null;
  afterExecutionStep?: (result: ExecutionResult) => Promise<void> | void;
  /** Market catalog to resolve the pair against (tests only). */
  catalog?: MarketCatalog;
}

export type ExecuteOutcome =
  | { ok: true; result: ExecutionResult; proposal: Proposal; safety: SafetyResult; timeline: TimelineEvent[] }
  | { ok: false; blocked: boolean; safety: SafetyResult | null; message: string; detail?: string; timeline: TimelineEvent[] };

function event(kind: TimelineKind, label: string, detail: string): TimelineEvent {
  return { id: crypto.randomUUID(), kind, label, detail, atMs: Date.now() };
}

// ---------------------------------------------------------------------------
// Shared symbol resolution
// ---------------------------------------------------------------------------

async function resolveMarket(mode: Mode, token: string): Promise<MarketInfo | null> {
  const catalog = await createMarketCatalog(mode);
  return catalog.resolve(token, DEFAULT_QUOTE_ASSET);
}

// ---------------------------------------------------------------------------
// Shared evidence + risk
// ---------------------------------------------------------------------------

async function buildEvidence(
  mode: Mode,
  scenario: DemoScenario,
  symbol: string,
  op: "analyze" | "propose",
  adapter?: AgentOSAdapter
): Promise<EvidenceBundle> {
  const effectiveAdapter = adapter ?? getAdapter(mode, scenario);
  const market = await effectiveAdapter.marketEvidence(symbol);
  const account = await effectiveAdapter.accountEvidence(op);

  const derived: DerivedSignals =
    market.lastPrice !== null &&
    market.quoteVolume24h !== null &&
    market.priceChangePercent24h !== null
      ? deriveSignalsFromMarket({
          lastPrice: market.lastPrice,
          priceChangePercent24h: market.priceChangePercent24h,
          high24h: market.high24h,
          low24h: market.low24h,
          quoteVolume24h: market.quoteVolume24h,
          spreadPercent: market.spreadPercent ?? Number.MAX_SAFE_INTEGER,
        })
      : {
          volatilityScore: null,
          volatility: "unknown",
          liquidity: "unknown",
          notes: [
            "Some evidence is unavailable from the current Agent OS permission.",
          ],
        };

  return { market, account, derived };
}

interface Amounts {
  quoteAmount: number;
  baseQuantity: number | null;
  marketPrice: number | null;
}

function deriveAmounts(
  amountType: AmountType,
  amount: number,
  market: MarketInfo,
  evidence: EvidenceBundle
): Amounts | null {
  const price = evidence.market.lastPrice;
  if (amountType === "base") {
    if (price === null || !Number.isFinite(price) || price <= 0) return null;
    const step = market.stepSize && market.stepSize > 0 ? market.stepSize : 1e-8;
    const baseQuantity = roundToStep(amount, step);
    return { quoteAmount: baseQuantity * price, baseQuantity, marketPrice: price };
  }
  const step = market.stepSize && market.stepSize > 0 ? market.stepSize : 1e-8;
  const baseQuantity = price !== null && price > 0 ? roundToStep(amount / price, step) : null;
  return { quoteAmount: amount, baseQuantity, marketPrice: price };
}

function safetyFor(
  intent: Intent,
  evidence: EvidenceBundle,
  op: "analyze" | "propose",
  mode: Mode,
  market: MarketInfo,
  amounts: Amounts | null
): SafetyResult {
  const propose = op === "propose";
  const orderChecks: SafetyCheckItem[] = [checkPairStatus(market)];
  if (propose && amounts) {
    orderChecks.push(
      ...validateOrder({
        market,
        side: intent.side ?? "buy",
        quoteAmount: amounts.quoteAmount,
        baseQuantity: amounts.baseQuantity,
        quoteBalance: evidence.account.quoteBalance,
        baseHoldings:
          intent.side === "sell"
            ? (evidence.account.holdings?.[market.baseAsset] ?? null)
            : null,
      })
    );
  }
  return evaluateSafety({
    amount: propose && amounts ? amounts.quoteAmount : null,
    marketDataAgeSeconds: evidence.market.ageSeconds,
    freshnessTargetSeconds: FRESHNESS_TARGET_SECONDS,
    volatility: evidence.derived.volatility,
    liquidity: evidence.derived.liquidity,
    balanceAvailable: evidence.account.available,
    balanceQuote: evidence.account.quoteBalance,
    permissionGranted: propose ? (evidence.account.permission?.granted ?? null) : null,
    permissionRequired: propose,
    balanceRequired: propose && mode === "live",
    orderChecks,
  });
}

// ---------------------------------------------------------------------------
// handleCommand
// ---------------------------------------------------------------------------

export async function handleCommand(ctx: CommandContext): Promise<AgentResponse> {
  try {
    const intent = parseIntent(ctx.command);

    if (intent.op === "unknown") {
      return {
        ok: true,
        kind: "response",
        message: `I did not recognize that as one of my supported operations.\n\n${supportNotes()}`,
        timeline: [event("SYSTEM", "Unsupported request", "Intent outside the supported MVP scope.")],
      };
    }

    const required = requiredForOp(intent.op);
    if (required.symbol && !intent.symbol) {
      return {
        ok: true,
        kind: "clarify",
        question: clarifyQuestion(intent.op, intent.side, true, false),
        timeline: [event("SYSTEM", "Clarification", "Missing market symbol.")],
      };
    }
    if (required.amount && (intent.amount === null || intent.amountType === null)) {
      return {
        ok: true,
        kind: "clarify",
        question: clarifyQuestion(intent.op, intent.side, false, true),
        timeline: [event("SYSTEM", "Clarification", "Missing order amount.")],
      };
    }

    if (required.symbol && intent.symbol) {
      const market = await resolveMarket(ctx.mode, intent.symbol);
      if (!market) {
        return {
          ok: false,
          message: "RiskLens could not verify this Binance trading pair.",
          detail: `The requested market "${intent.symbol}" is not listed as a trading pair on the Binance spot catalog. RiskLens never fabricates a market.`,
          timeline: [event("BLOCKED", "Action blocked", `Unverifiable trading pair: ${intent.symbol}.`)],
        };
      }
      intent.symbol = market.symbol;
    }

    if (intent.op === "analyze" && intent.symbol) {
      const evidence = await buildEvidence(ctx.mode, ctx.scenario, intent.symbol, "analyze");
      const market = (await resolveMarket(ctx.mode, intent.symbol)) ?? emptyMarket(intent.symbol);
      const safety = safetyFor(intent, evidence, "analyze", ctx.mode, market, null);
      const message = explainDecision(intent, evidence.market, evidence.account, evidence.derived, safety);
      return {
        ok: true,
        kind: "response",
        message,
        evidence,
        timeline: [
          event(
            "ANALYSIS",
            `${intent.symbol} market check completed`,
            `Safety: ${safety.status}. Market data age: ${formatAgeText(evidence.market.ageSeconds)}.`
          ),
        ],
      };
    }

    if (intent.op === "propose" && intent.symbol && intent.amount !== null && intent.side) {
      const evidence = await buildEvidence(ctx.mode, ctx.scenario, intent.symbol, "propose");
      const market = (await resolveMarket(ctx.mode, intent.symbol)) ?? emptyMarket(intent.symbol);
      const amountType = intent.amountType ?? "quote";
      const amounts = deriveAmounts(amountType, intent.amount, market, evidence);
      if (!amounts) {
        return {
          ok: false,
          message: "RiskLens could not verify the order value.",
          detail:
            "A current market price is required to convert a base quantity into an order value, and the evidence did not include one. Nothing was proposed.",
          timeline: [event("BLOCKED", "Action blocked", "Could not derive an order value from the evidence.")],
        };
      }
      const safety = safetyFor(intent, evidence, "propose", ctx.mode, market, amounts);
      const proposal = buildProposal(ctx.mode, intent, evidence, safety, market, amounts, null);
      const quote = evidence.market.lastPrice;
      const message =
        quote !== null
          ? `${explainDecision(intent, evidence.market, evidence.account, evidence.derived, safety)}\n\n${decisionSummary(safety)}`
          : decisionSummary(safety);
      return {
        ok: true,
        kind: "response",
        message,
        evidence,
        proposal,
        timeline: [
          event("ANALYSIS", `${intent.symbol} market check completed`, `Market data age: ${formatAgeText(evidence.market.ageSeconds)}.`),
          event(
            "PROPOSAL",
            `${formatAmount(amounts.quoteAmount)} ${intent.side.toUpperCase()} ${intent.symbol} prepared`,
            `Safety: ${safety.status}. Approval required before execution.`
          ),
        ],
      };
    }

    if (intent.op === "balance") {
      const adapter = getAdapter(ctx.mode, ctx.scenario);
      const account = await adapter.accountEvidence("analyze");
      const balanceText =
        account.available && account.quoteBalance !== null
          ? `Available balance: ${formatAmount(account.quoteBalance)} USDT.`
          : "Balance unavailable from the current Agent OS permission.";
      const sample = account.sample
        ? "\n(DEMO PORTFOLIO — a deterministic simulation. No live account was queried.)"
        : "";
      return {
        ok: true,
        kind: "response",
        message: `Account check completed.\n\n${balanceText}${sample}\n\nThe maximum safe allocation is limited by the requested amount and the safety checks on the proposal you prepare. RiskLens never moves funds on its own.`,
        timeline: [event("BALANCE", "Account balance checked", account.available ? "Balance retrieved from the enabled account read." : "Account read not available.")],
      };
    }

    return {
      ok: false,
      message: "I could not interpret that request.",
      timeline: [event("SYSTEM", "Request failed", "Intent could not be mapped to a supported operation.")],
    };
  } catch (err) {
    const { message, detail } = userMessageForError(err);
    return {
      ok: false,
      message,
      detail,
      timeline: [event("PAUSED", "Action paused", "RiskLens did not execute anything.")],
    };
  }
}

// ---------------------------------------------------------------------------
// handleExecute
// ---------------------------------------------------------------------------

export async function handleExecute(
  ctx: ExecuteContext,
  deps: ExecuteDeps = {}
): Promise<ExecuteOutcome> {
  if (!ctx.approve) {
    return {
      ok: false,
      blocked: true,
      safety: null,
      message: "Explicit user approval is required before any execution.",
      timeline: [event("PROPOSAL", "Awaiting approval", "No approval was provided.")],
    };
  }

  if (!Number.isFinite(ctx.amount) || ctx.amount <= 0) {
    return {
      ok: false,
      blocked: true,
      safety: null,
      message: "Invalid order amount. RiskLens will not execute.",
      timeline: [event("BLOCKED", "Action blocked", "Invalid amount.")],
    };
  }

  try {
    // Re-verify the pair against the server-side catalog. The client can
    // never dictate the execution path.
    const catalog = deps.catalog ?? (await createMarketCatalog(ctx.mode));
    const market = catalog.resolve(ctx.symbol, DEFAULT_QUOTE_ASSET);
    if (!market) {
      return {
        ok: false,
        blocked: true,
        safety: null,
        message: "RiskLens could not verify this Binance trading pair.",
        detail: `The market ${ctx.symbol} is not in the Binance spot catalog. Nothing was executed.`,
        timeline: [event("BLOCKED", "Action blocked", "Unverifiable Binance trading pair.")],
      };
    }
    const symbol = market.symbol;

    // Re-verify on the server with FRESH evidence.
    const evidence = await buildEvidence(ctx.mode, ctx.scenario, symbol, "propose", deps.adapter ?? undefined);
    const amountType = ctx.amountType ?? "quote";
    const amounts = deriveAmounts(amountType, ctx.amount, market, evidence);
    if (!amounts) {
      return {
        ok: false,
        blocked: true,
        safety: null,
        message: "RiskLens could not verify the order value from fresh evidence.",
        detail: "A current market price is required, or the evidence was unavailable. Nothing was executed.",
        timeline: [event("BLOCKED", "Action blocked", "Could not derive an order value from fresh evidence.")],
      };
    }

    const intent: Intent = {
      raw: ctx.requestText,
      op: "propose",
      side: ctx.side,
      symbol,
      amount: ctx.amount,
      amountType,
      quote: ctx.quote,
    };
    const safety = safetyFor(intent, evidence, "propose", ctx.mode, market, amounts);

    if (safety.status === "BLOCK") {
      const why = explainDecision(intent, evidence.market, evidence.account, evidence.derived, safety);
      return {
        ok: false,
        blocked: true,
        safety,
        message: `The action is blocked by the deterministic safety engine.\n\n${why}`,
        timeline: [event("BLOCKED", "Action blocked", "Resource must not proceed.")],
      };
    }

    const adapter = deps.adapter ?? getAdapter(ctx.mode, ctx.scenario);

    let result: ExecutionResult;
    try {
      result = await adapter.executeOrder({
        symbol,
        side: ctx.side,
        amountQuote: amounts.quoteAmount,
        quote: ctx.quote,
        amountType,
        amount: ctx.amount,
        baseQuantity: amounts.baseQuantity,
        market,
        evidence: evidence.market,
      });
    } catch (err) {
      const { message, detail } = userMessageForError(err);
      return {
        ok: false,
        blocked: false,
        safety,
        message,
        detail,
        timeline: [event("PAUSED", "Action paused", "RiskLens did not execute anything.")],
      };
    }

    let proposal: Proposal;
    try {
      proposal = buildProposal(ctx.mode, intent, evidence, safety, market, amounts, result);
    } catch {
      proposal = {
        id: crypto.randomUUID(),
        mode: ctx.mode,
        op: "propose",
        side: ctx.side,
        symbol,
        amount: amounts.quoteAmount,
        quote: ctx.quote,
        requestText: ctx.requestText,
        evidence,
        safety,
        phase: result.simulated ? "SIMULATED" : "EXECUTED",
        createdAtMs: Date.now(),
        result,
      };
    }

    let postError: unknown = null;
    if (deps.afterExecutionStep) {
      try {
        await deps.afterExecutionStep(result);
      } catch (err) {
        postError = err;
      }
    }

    const timeline = buildExecutionTimeline(ctx, symbol, amounts.quoteAmount, result, postError);

    return {
      ok: true,
      result,
      proposal,
      safety,
      timeline,
    };
  } catch (err) {
    const { message, detail } = userMessageForError(err);
    return {
      ok: false,
      blocked: false,
      safety: null,
      message,
      detail,
      timeline: [event("PAUSED", "Action paused", "RiskLens did not execute anything.")],
    };
  }
}

function buildExecutionTimeline(
  ctx: ExecuteContext,
  symbol: string,
  quoteAmount: number,
  result: ExecutionResult,
  postError: unknown
): TimelineEvent[] {
  const timeline: TimelineEvent[] = [
    event("APPROVED", "User approved action", `Approved ${ctx.side.toUpperCase()} ${formatAmount(quoteAmount)} ${symbol}.`),
  ];
  if (result.steps && result.steps.length > 0) {
    for (const step of result.steps) {
      timeline.push(event(sideKind(result), step.label, step.detail));
    }
  } else if (result.simulated) {
    timeline.push(event("SIMULATED", "Simulated execution", result.message));
  } else {
    timeline.push(event("EXECUTED", "Order submitted through Agent OS", result.message));
  }
  if (postError !== null) {
    timeline.push(
      event(
        "SYSTEM",
        "Confirmation pending",
        "The order was submitted, but the final confirmation could not be recorded."
      )
    );
  }
  return timeline;
}

function sideKind(result: ExecutionResult): TimelineKind {
  return result.simulated ? "SIMULATED" : "EXECUTED";
}

function buildProposal(
  mode: Mode,
  intent: Intent,
  evidence: EvidenceBundle,
  safety: SafetyResult,
  market: MarketInfo,
  amounts: Amounts,
  result: ExecutionResult | null
): Proposal {
  const phase: Proposal["phase"] = result
    ? result.simulated
      ? "SIMULATED"
      : "EXECUTED"
    : safety.status === "BLOCK"
      ? "BLOCKED"
      : "PROPOSED";
  const amountType = intent.amountType ?? "quote";
  const order: OrderPreview = {
    baseAsset: market.baseAsset,
    quoteAsset: market.quoteAsset,
    amountType,
    amount: amountType === "base" ? (intent.amount ?? amounts.baseQuantity ?? 0) : intent.amount ?? amounts.quoteAmount,
    quoteAmount: amounts.quoteAmount,
    estimatedQuantity: amounts.baseQuantity,
    marketPrice: amounts.marketPrice,
  };

  const portfolio: PortfolioSnapshot | null = result?.portfolio ?? null;

  return {
    id: crypto.randomUUID(),
    mode,
    op: "propose",
    side: intent.side ?? "buy",
    symbol: market.symbol,
    amount: amounts.quoteAmount,
    quote: market.quoteAsset,
    requestText: intent.raw,
    evidence,
    safety,
    phase,
    createdAtMs: Date.now(),
    order,
    portfolio,
    result: result ?? null,
  };
}

function emptyMarket(symbol: string): MarketInfo {
  return {
    symbol,
    baseAsset: symbol.replace(/USDT$/, ""),
    quoteAsset: "USDT",
    status: "UNKNOWN",
    baseAssetPrecision: 8,
    quoteAssetPrecision: 8,
    minQty: null,
    maxQty: null,
    stepSize: null,
    minNotional: null,
    tickSize: null,
  };
}

function formatAgeText(seconds: number | null): string {
  if (seconds === null) return "unknown";
  if (seconds <= 1) return "< 1 second";
  return `${Math.round(seconds)} seconds`;
}

export { formatAmount };
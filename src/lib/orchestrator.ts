import type {
  AgentResponse,
  DerivedSignals,
  EvidenceBundle,
  Intent,
  Mode,
  Proposal,
  SafetyResult,
  TimelineEvent,
  TimelineKind,
  ExecutionResult,
} from "@/lib/types";
import { parseIntent, requiredForOp, clarifyQuestion, supportNotes } from "@/lib/agent/intent";
import { evaluateSafety, formatAmount } from "@/lib/safety/engine";
import { explainDecision, decisionSummary } from "@/lib/agent/explain";
import { getAdapter } from "@/lib/agentos";
import { userMessageForError, type AgentOSAdapter } from "@/lib/agentos/adapter";
import { deriveSignalsFromMarket } from "@/lib/demo/data";
import type { DemoScenario } from "@/lib/demo/data";
import { normalizeSymbol } from "@/lib/demo/data";

export const FRESHNESS_TARGET_SECONDS = 30;

export interface CommandContext {
  mode: Mode;
  scenario: DemoScenario;
  command: string;
}

export interface ExecuteContext {
  mode: Mode;
  scenario: DemoScenario;
  symbol: string;
  side: "buy" | "sell";
  amount: number;
  quote: string;
  requestText: string;
  approve: boolean;
}

/**
 * Dependency seam for handleExecute. Real callers pass nothing; tests
 * inject a fake adapter / a hook that runs after a successful order
 * submission so the "success + late failure" path can be verified.
 */
export interface ExecuteDeps {
  adapter?: AgentOSAdapter | null;
  afterExecutionStep?: (result: ExecutionResult) => Promise<void> | void;
}

export type ExecuteOutcome =
  | { ok: true; result: ExecutionResult; proposal: Proposal; safety: SafetyResult; timeline: TimelineEvent[] }
  | { ok: false; blocked: boolean; safety: SafetyResult | null; message: string; detail?: string; timeline: TimelineEvent[] };

function event(kind: TimelineKind, label: string, detail: string): TimelineEvent {
  return { id: crypto.randomUUID(), kind, label, detail, atMs: Date.now() };
}

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

function safetyFor(
  intent: Intent,
  evidence: EvidenceBundle,
  op: "analyze" | "propose",
  mode: Mode
): SafetyResult {
  const propose = op === "propose";
  return evaluateSafety({
    amount: propose ? intent.amount : null,
    marketDataAgeSeconds: evidence.market.ageSeconds,
    freshnessTargetSeconds: FRESHNESS_TARGET_SECONDS,
    volatility: evidence.derived.volatility,
    liquidity: evidence.derived.liquidity,
    balanceAvailable: evidence.account.available,
    balanceQuote: evidence.account.quoteBalance,
    permissionGranted: propose ? (evidence.account.permission?.granted ?? null) : null,
    permissionRequired: propose,
    // A live execution must have real funds confirmed; a demo proposal is
    // a deterministic simulation and does not need it.
    balanceRequired: propose && mode === "live",
  });
}

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
    if (required.amount && intent.amount === null) {
      return {
        ok: true,
        kind: "clarify",
        question: clarifyQuestion(intent.op, intent.side, false, true),
        timeline: [event("SYSTEM", "Clarification", "Missing order amount.")],
      };
    }

    if (intent.op === "analyze" && intent.symbol) {
      const evidence = await buildEvidence(ctx.mode, ctx.scenario, intent.symbol, "analyze");
      const safety = safetyFor(intent, evidence, "analyze", ctx.mode);
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
      const safety = safetyFor(intent, evidence, "propose", ctx.mode);
      const proposal = buildProposal(ctx.mode, intent, evidence, safety);
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
            `${formatAmount(intent.amount)} ${intent.side.toUpperCase()} ${intent.symbol} prepared`,
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
      const sample = account.sample ? "\n(Simulated demo balance — no live account was queried.)" : "";
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

  const symbol = normalizeSymbol(ctx.symbol);
  if (!symbol) {
    return {
      ok: false,
      blocked: true,
      safety: null,
      message: "That market is not supported by RiskLens.",
      timeline: [event("BLOCKED", "Action blocked", "Unsupported market.")],
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
    // Re-verify on the server with FRESH evidence. The client may never
    // dictate the safety decision or the execution path.
    const evidence = await buildEvidence(ctx.mode, ctx.scenario, symbol, "propose", deps.adapter ?? undefined);
    const intent: Intent = {
      raw: ctx.requestText,
      op: "propose",
      side: ctx.side,
      symbol,
      amount: ctx.amount,
      quote: ctx.quote,
    };
    const safety = safetyFor(intent, evidence, "propose", ctx.mode);

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
        amountQuote: ctx.amount,
        quote: ctx.quote,
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

    // Post-processing (proposal building, hooks) must NEVER change the
    // fact that an order was already submitted. If it fails, the outcome
    // still reports the submission honestly, flagged as unconfirmed.
    let proposal: Proposal;
    try {
      proposal = buildProposal(ctx.mode, intent, evidence, safety, result);
    } catch {
      proposal = {
        id: crypto.randomUUID(),
        mode: ctx.mode,
        op: "propose",
        side: ctx.side,
        symbol,
        amount: ctx.amount,
        quote: ctx.quote,
        requestText: ctx.requestText,
        evidence,
        safety,
        phase: result.simulated ? "SIMULATED" : "EXECUTED",
        createdAtMs: Date.now(),
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

    const kind: TimelineKind = result.simulated ? "SIMULATED" : "EXECUTED";
    const label = result.simulated
      ? "Simulated execution"
      : "Order submitted through Agent OS";
    const timeline: TimelineEvent[] = [
      event("APPROVED", "User approved action", `Approved ${ctx.side.toUpperCase()} ${formatAmount(ctx.amount)} ${symbol}.`),
      event(kind, label, result.message),
    ];
    if (postError !== null) {
      timeline.push(
        event(
          "SYSTEM",
          "Confirmation pending",
          "The order was submitted, but the final confirmation could not be recorded."
        )
      );
    }

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

function buildProposal(
  mode: Mode,
  intent: Intent,
  evidence: EvidenceBundle,
  safety: SafetyResult,
  result?: ExecutionResult
): Proposal {
  const phase: Proposal["phase"] = result
    ? result.simulated
      ? "SIMULATED"
      : "EXECUTED"
    : safety.status === "BLOCK"
      ? "BLOCKED"
      : "PROPOSED";
  return {
    id: crypto.randomUUID(),
    mode,
    op: "propose",
    side: intent.side ?? "buy",
    symbol: intent.symbol ?? "BTCUSDT",
    amount: intent.amount ?? 0,
    quote: intent.quote,
    requestText: intent.raw,
    evidence,
    safety,
    phase,
    createdAtMs: Date.now(),
  };
}

function formatAgeText(seconds: number | null): string {
  if (seconds === null) return "unknown";
  if (seconds <= 1) return "< 1 second";
  return `${Math.round(seconds)} seconds`;
}

export { formatAmount };
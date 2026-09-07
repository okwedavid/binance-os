export type SafetyStatus = "PASS" | "CAUTION" | "BLOCK";

export type Mode = "demo" | "live";

export type OpKind = "analyze" | "propose" | "balance";

export type Side = "buy" | "sell";

export type AmountType = "quote" | "base";

export type VolatilityLevel = "low" | "elevated" | "unknown";

export type LiquidityLevel = "healthy" | "weak" | "unknown";

export type CheckStatus = "ok" | "warn" | "fail" | "skip";

/**
 * One Binance trading pair as resolved from Binance market/instrument
 * metadata. RiskLens never hardcodes a supported-asset list: pairs come
 * from the market catalog, which is built from Binance metadata.
 */
export interface MarketInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
  baseAssetPrecision: number;
  quoteAssetPrecision: number;
  minQty: number | null;
  maxQty: number | null;
  stepSize: number | null;
  minNotional: number | null;
  tickSize: number | null;
}

/** Resolved order preview shown on the Action Card. */
export interface OrderPreview {
  baseAsset: string;
  quoteAsset: string;
  amountType: AmountType;
  /** Amount exactly as the user requested (base or quote units). */
  amount: number;
  /** Amount in quote units used for risk/balance/notional checks. */
  quoteAmount: number;
  /** Estimated base quantity at the current market price. */
  estimatedQuantity: number | null;
  /** Market price used for the estimate. */
  marketPrice: number | null;
}

/** In-memory demo portfolio snapshot. Never represents a live account. */
export interface PortfolioSnapshot {
  quoteAsset: string;
  quoteBalance: number;
  balances: Record<string, number>;
  averageCosts: Record<string, number>;
  realizedPnl: number;
}

export interface MarketEvidence {
  symbol: string;
  lastPrice: number | null;
  priceChangePercent24h: number | null;
  high24h: number | null;
  low24h: number | null;
  quoteVolume24h: number | null;
  bidPrice: number | null;
  askPrice: number | null;
  spreadPercent: number | null;
  capturedAtMs: number;
  ageSeconds: number | null;
  source: "demo" | "agent-os";
  provider: string;
  unavailable: string[];
}

export interface PermissionInfo {
  id: string;
  label: string;
  granted: boolean | null;
  scopeSource: string;
}

export interface AccountEvidence {
  available: boolean;
  sample: boolean;
  quoteBalance: number | null;
  permission: PermissionInfo | null;
  unavailable: string[];
  /** Base-asset holdings indexed by base asset (demo portfolio only). */
  holdings?: Record<string, number>;
}

export interface DerivedSignals {
  volatilityScore: number | null;
  volatility: VolatilityLevel;
  liquidity: LiquidityLevel;
  notes: string[];
}

export interface EvidenceBundle {
  market: MarketEvidence;
  account: AccountEvidence;
  derived: DerivedSignals;
}

export interface SafetyCheckItem {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface SafetyResult {
  status: SafetyStatus;
  checks: SafetyCheckItem[];
  reasons: string[];
}

export type ProposalPhase =
  | "PROPOSED"
  | "APPROVED"
  | "EXECUTED"
  | "SIMULATED"
  | "BLOCKED";

export interface Proposal {
  id: string;
  mode: Mode;
  op: OpKind;
  side: Side;
  symbol: string;
  amount: number;
  quote: string;
  requestText: string;
  evidence: EvidenceBundle;
  safety: SafetyResult;
  phase: ProposalPhase;
  createdAtMs: number;
  /** Generic order preview used by the Action Card. */
  order?: OrderPreview | null;
  /** Fill/result once executed (Demo simulated or Live Agent OS). */
  result?: ExecutionResult | null;
  /** DEMO PORTFOLIO snapshot after a simulated fill (Demo Mode only). */
  portfolio?: PortfolioSnapshot | null;
}

export interface Intent {
  raw: string;
  op: OpKind | "unknown";
  side: Side | null;
  /** Best-guess market token (base asset or full symbol) from the prompt. */
  symbol: string | null;
  /** Amount exactly as the user requested. */
  amount: number | null;
  /** Whether `amount` is quote units or base units. */
  amountType: AmountType | null;
  quote: string;
}

export type ExecutionStatus = "SUBMITTED" | "FILLED" | "REJECTED" | "FAILED";

export type ExecutionResult = {
  ok: boolean;
  simulated: boolean;
  orderId: string | null;
  message: string;
  status?: ExecutionStatus;
  side?: Side;
  symbol?: string;
  baseAsset?: string;
  quoteAsset?: string;
  /** Requested order size in quote units. */
  amount?: number;
  /** Base quantity actually filled. */
  filledQuantity?: number | null;
  /** Effective execution price. */
  executionPrice?: number | null;
  fee?: number | null;
  feeAsset?: string;
  /** Simulated slippage applied (demo only) — always clearly identified. */
  slippagePct?: number | null;
  /** Honest provenance: "DEMO SIMULATION" or "BINANCE AGENT OS". */
  sourceLabel?: "DEMO SIMULATION" | "BINANCE AGENT OS";
  portfolio?: PortfolioSnapshot;
  submittedAtMs?: number;
  filledAtMs?: number;
  /** Deterministic lifecycle steps (Demo simulation). */
  steps?: Array<{ label: string; detail: string; atMs: number }>;
  /** Realized P&L on a sell (Quote asset units; Demo simulation). */
  realizedPnl?: number | null;
};

export type TimelineKind =
  | "SYSTEM"
  | "ANALYSIS"
  | "PROPOSAL"
  | "APPROVED"
  | "EXECUTED"
  | "SIMULATED"
  | "BLOCKED"
  | "PAUSED"
  | "BALANCE"
  | "CONNECT"
  | "DISCONNECT"
  | "CANCELLED";

export interface TimelineEvent {
  id: string;
  kind: TimelineKind;
  label: string;
  detail: string;
  atMs: number;
}

export interface ConnectionState {
  mode: Mode;
  connected: boolean;
  statusText: string;
  detail: string;
  permissions: PermissionInfo[];
  supportsTrading: boolean | null;
  withdrawalsExposed: boolean;
}

/**
 * Server-reported Agent OS OAuth capability for this deployment. The
 * browser uses this to decide between "Agent OS Setup Required",
 * "Connect Agent OS", and "Agent OS Connected" — connected is only ever
 * true after a server-verified session.
 */
export interface AuthCapability {
  supported: boolean;
  mechanism: "pre_registered" | "cimd" | "dcr" | "none";
  configured: boolean;
  detail?: string;
}

export interface AgentOSStatusResponse {
  ok: boolean;
  state: ConnectionState;
  auth: AuthCapability;
}

export type AgentResponse =
  | {
      ok: true;
      kind: "response";
      message: string;
      evidence?: EvidenceBundle;
      proposal?: Proposal;
      timeline: TimelineEvent[];
    }
  | {
      ok: true;
      kind: "clarify";
      question: string;
      timeline: TimelineEvent[];
    }
  | {
      ok: false;
      message: string;
      detail?: string;
      timeline: TimelineEvent[];
    };
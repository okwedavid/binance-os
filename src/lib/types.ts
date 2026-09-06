export type SafetyStatus = "PASS" | "CAUTION" | "BLOCK";

export type Mode = "demo" | "live";

export type OpKind = "analyze" | "propose" | "balance";

export type Side = "buy" | "sell";

export type VolatilityLevel = "low" | "elevated" | "unknown";

export type LiquidityLevel = "healthy" | "weak" | "unknown";

export type CheckStatus = "ok" | "warn" | "fail" | "skip";

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
}

export interface Intent {
  raw: string;
  op: OpKind | "unknown";
  side: Side | null;
  symbol: string | null;
  amount: number | null;
  quote: string;
}

export type ExecutionResult = {
  ok: boolean;
  simulated: boolean;
  orderId: string | null;
  message: string;
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
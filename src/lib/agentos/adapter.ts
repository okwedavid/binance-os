import type {
  AccountEvidence,
  ConnectionState,
  ExecutionResult,
  MarketEvidence,
  Side,
} from "@/lib/types";

/**
 * AgentOSAdapter is the boundary between the RiskLens core and the
 * underlying Binance Agent OS capability layer.
 *
 * The rest of the application only knows this interface. It never knows
 * whether the implementation is the deterministic demo or the live
 * server-side MCP client. That keeps the application honest: a live
 * failure can never be converted into a fabricated success.
 */

export interface OrderRequest {
  symbol: string;
  side: Side;
  amountQuote: number;
  quote: string;
}

export interface AgentOSAdapter {
  readonly kind: "demo" | "live";
  connectionState(): Promise<ConnectionState>;
  marketEvidence(symbol: string): Promise<MarketEvidence>;
  accountEvidence(op: "analyze" | "propose", symbol: string, side: Side | null): Promise<AccountEvidence>;
  executeOrder(request: OrderRequest): Promise<ExecutionResult>;
}

export type AgentOSErrorCode =
  | "NO_AUTHORIZATION"
  | "AUTHORIZATION_REQUIRED"
  | "INVALID_REQUEST"
  | "CAPABILITY_UNAVAILABLE"
  | "NETWORK"
  | "STALE_DATA";

export class AgentOSError extends Error {
  readonly code: AgentOSErrorCode;

  constructor(code: AgentOSErrorCode, message: string) {
    super(message);
    this.name = "AgentOSError";
    this.code = code;
  }
}

export function userMessageForError(err: unknown): { message: string; detail?: string } {
  if (err instanceof AgentOSError) {
    switch (err.code) {
      case "NO_AUTHORIZATION":
      case "AUTHORIZATION_REQUIRED":
        return {
          message: "Agent OS authorization is required for live data.",
          detail:
            "Connect the Agentic sub-account from the connection panel first. RiskLens has paused the action and will not execute anything.",
        };
      case "CAPABILITY_UNAVAILABLE":
        return {
          message: "Agent OS could not provide this capability.",
          detail:
            "Your current Agent OS permission does not include this capability.",
        };
      case "STALE_DATA":
        return {
          message: "Agent OS returned stale market data.",
          detail: "RiskLens has paused the action and will not execute anything.",
        };
      case "NETWORK":
        return {
          message: "Agent OS is temporarily unavailable.",
          detail:
            "RiskLens has paused the action and will not execute anything. Your connection may have expired — reconnect to continue.",
        };
      default:
        return {
          message: "Agent OS could not complete the request.",
          detail:
            "Your current connection does not include this capability. RiskLens has paused the action.",
        };
    }
  }
  return {
    message: "RiskLens could not complete the request.",
    detail: "Please try again. RiskLens has paused the action and will not execute anything.",
  };
}
import type { Mode } from "@/lib/types";
import type { DemoScenario } from "@/lib/demo/data";

/**
 * Authoritative server-side mode resolution.
 *
 * The request body "mode" may express user intent but never establishes
 * authority. Only the server decides which capability layer is used:
 *
 * - "demo" always resolves to the deterministic demo adapter (and can
 *   never reach a live execution path).
 * - "live" requires a valid Agent OS session on the server. Without one
 *   the command is rejected ("authorization-required") instead of being
 *   silently downgraded to demo or upgraded to live.
 */

export type ResolvedServerMode =
  | { kind: "demo"; mode: Mode; scenario: DemoScenario }
  | { kind: "live"; mode: Mode; scenario: DemoScenario }
  | { kind: "error"; message: string; detail: string };

/**
 * Pure decision helper (testable without cookies): given the client's
 * requested mode and whether a valid Agent OS session exists server-side,
 * returns the authorized mode decision.
 */
export function resolveServerMode(
  requestedMode: string | null,
  hasValidAgentOsSession: boolean
): ResolvedServerMode {
  if (requestedMode === "live") {
    if (!hasValidAgentOsSession) {
      return {
        kind: "error",
        message: "Live mode requires a valid Agent OS connection.",
        detail:
          "Connect the Agentic sub-account from the connection panel first. RiskLens will not pretend live data exists without a server-verified session.",
      };
    }
    return { kind: "live", mode: "live", scenario: "healthy" };
  }
  return { kind: "demo", mode: "demo", scenario: "healthy" };
}

export function parseRequestedScenario(scenario: unknown): DemoScenario {
  if (scenario === "volatile" || scenario === "blocked") return scenario;
  return "healthy";
}

/**
 * Cross-origin guard for state-changing API routes.
 *
 * Browsers include an Origin header on fetch. If the Origin does not match
 * the request's Host it is rejected. Same-origin server-to-server calls
 * that omit Origin are permitted.
 */
export function isCrossOriginRequest(origin: string | null, host: string | null): boolean {
  if (!origin) return false;
  if (!host) return true;
  try {
    const originUrl = new URL(origin);
    const hostUrl = new URL(`http://${host}`);
    const defaultPort = originUrl.protocol === "https:" ? "443" : "80";
    const originPort = originUrl.port || defaultPort;
    const hostPort = hostUrl.port || defaultPort;
    return originUrl.hostname !== hostUrl.hostname || originPort !== hostPort;
  } catch {
    return true;
  }
}
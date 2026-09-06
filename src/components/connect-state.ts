import type { AuthCapability } from "@/lib/types";

/**
 * Pure UI state logic for the Agent OS connect control.
 *
 * Kept free of React/DOM so it is testable in the node vitest environment.
 * The logic mirrors the server contract: `connected` only ever reflects a
 * server-verified session; `authReady` reflects the server-reported OAuth
 * capability of this deployment. Neither is ever inferred from a click.
 */

export interface ConnectActionState {
  authReady: boolean;
  connected: boolean;
  connecting: boolean;
  error: boolean;
}

export type ConnectActionLabel =
  | "Agent OS Setup Required"
  | "Connect Agent OS"
  | "Connecting…"
  | "Agent OS Connected"
  | "Try Again";

/** Whether this deployment has a working OAuth client mechanism. */
export function authReadyCapability(auth: AuthCapability | null | undefined): boolean {
  return Boolean(auth && auth.supported === true && auth.configured === true);
}

export function connectActionLabel(state: ConnectActionState): ConnectActionLabel {
  if (state.connecting) return "Connecting…";
  if (state.connected) return "Agent OS Connected";
  if (state.error) return "Try Again";
  if (!state.authReady) return "Agent OS Setup Required";
  return "Connect Agent OS";
}

/**
 * The control is only ever disabled while a connection attempt is in
 * flight. "Setup required" stays clickable so the server's recoverable
 * error can surface; connected stays clickable to disconnect.
 */
export function connectIsActionable(state: ConnectActionState): boolean {
  return !state.connecting;
}
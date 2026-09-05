import type { Mode } from "@/lib/types";
import type { AgentOSAdapter } from "@/lib/agentos/adapter";
import { DemoAgentOSAdapter } from "@/lib/agentos/demo-adapter";
import { BinanceAgentOSAdapter } from "@/lib/agentos/binance";
import type { DemoScenario } from "@/lib/demo/data";

/**
 * Picks the capability adapter for the selected mode.
 *
 * - demo: the deterministic DemoAgentOSAdapter (always available, never
 *   touches a live execution path).
 * - live: the BinanceAgentOSAdapter (server-side MCP client behind the
 *   official OAuth flow).
 */
export function getAdapter(mode: Mode, scenario: DemoScenario): AgentOSAdapter {
  if (mode === "demo") {
    return new DemoAgentOSAdapter(scenario);
  }
  return new BinanceAgentOSAdapter();
}
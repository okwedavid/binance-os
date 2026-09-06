import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/agentos";
import type { DemoScenario } from "@/lib/demo/data";
import type { Mode } from "@/lib/types";
import { authCapability } from "@/lib/agentos/binance/oauth";

export const dynamic = "force-dynamic";

/**
 * Status endpoint.
 *
 * Reports two, separately honest facts:
 *  - `state`  — the connection state of the requested mode (demo/live).
 *    `connected` is only ever true when the server actually verified the
 *    Agent OS session; clicking a button can never set it.
 *  - `auth`   — whether this deployment has a working OAuth client
 *    mechanism (`cimd` / `pre_registered` / `dcr`) so the UI can show
 *    "Setup required" vs "Connect Agent OS" instead of a dead button.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode");
  const scenario = url.searchParams.get("scenario");

  const safeMode: Mode = mode === "live" ? "live" : "demo";
  const safeScenario: DemoScenario =
    scenario === "volatile" || scenario === "blocked" ? scenario : "healthy";

  const auth = await authCapability();

  try {
    const adapter = getAdapter(safeMode, safeScenario);
    const state = await adapter.connectionState();
    return NextResponse.json({ ok: true, state, auth });
  } catch {
    return NextResponse.json(
      {
        ok: true,
        state: {
          mode: safeMode,
          connected: false,
          statusText: "Agent OS unreachable",
          detail: "RiskLens could not verify the Agent OS connection.",
          permissions: [],
          supportsTrading: null,
          withdrawalsExposed: false,
        },
        auth,
      },
      { status: 200 }
    );
  }
}

export async function POST() {
  return NextResponse.json({ ok: false, message: "Method not allowed." }, { status: 405 });
}
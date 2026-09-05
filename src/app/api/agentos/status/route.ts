import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/agentos";
import type { DemoScenario } from "@/lib/demo/data";
import type { Mode } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode");
  const scenario = url.searchParams.get("scenario");

  const safeMode: Mode = mode === "live" ? "live" : "demo";
  const safeScenario: DemoScenario =
    scenario === "volatile" || scenario === "blocked" ? scenario : "healthy";

  try {
    const adapter = getAdapter(safeMode, safeScenario);
    const state = await adapter.connectionState();
    return NextResponse.json({ ok: true, state });
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
      },
      { status: 200 }
    );
  }
}
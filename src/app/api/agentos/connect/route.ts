import { NextRequest, NextResponse } from "next/server";
import { beginAuthorization } from "@/lib/agentos/binance/oauth";
import { AgentOSError } from "@/lib/agentos/adapter";

/**
 * Begins the Binance Agent OS OAuth flow (browser authorization).
 * Returns the authorization URL for the browser to follow.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  try {
    const authorizationUrl = await beginAuthorization(origin);
    return NextResponse.json({ ok: true, authorizationUrl: authorizationUrl.toString() });
  } catch (err) {
    if (err instanceof AgentOSError) {
      return NextResponse.json(
        {
          ok: false,
          message:
            err.code === "AUTHORIZATION_REQUIRED"
              ? "Agent OS authorization is not available for this deployment."
              : "Could not start the Agent OS connection.",
          detail: err.message,
        },
        { status: 200 }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        message: "Could not start the Agent OS connection.",
        detail: "Please try again. RiskLens stays in Demo Mode until a connection is established.",
      },
      { status: 200 }
    );
  }
}
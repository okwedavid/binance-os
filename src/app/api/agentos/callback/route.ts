import { NextRequest, NextResponse } from "next/server";
import { completeAuthorization } from "@/lib/agentos/binance/oauth";
import { AgentOSError } from "@/lib/agentos/adapter";

/**
 * OAuth redirect target after the user authorizes the Agentic sub-account
 * on Binance. Stores the access token in an httpOnly cookie and returns
 * to the application.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");

  try {
    await completeAuthorization(code, state, req.nextUrl.origin);
    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  } catch (err) {
    if (err instanceof AgentOSError) {
      return NextResponse.redirect(new URL("/?agentos_state=error", req.nextUrl.origin));
    }
    return NextResponse.redirect(new URL("/?agentos_state=error", req.nextUrl.origin));
  }
}
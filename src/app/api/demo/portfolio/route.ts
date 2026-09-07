import { NextRequest, NextResponse } from "next/server";
import { getDemoPortfolio, DEMO_PORTFOLIO_LABEL } from "@/lib/demo/portfolio";
import { isCrossOriginRequest } from "@/lib/server-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only snapshot of the in-memory DEMO PORTFOLIO. Demo Mode only; the
 * ledger is never persisted and never represents a live Binance account.
 */
export async function GET(req: NextRequest) {
  if (isCrossOriginRequest(req.headers.get("origin"), req.headers.get("host"))) {
    return NextResponse.json({ ok: false, message: "Cross-origin request rejected." }, { status: 403 });
  }
  return NextResponse.json(
    { ok: true, label: DEMO_PORTFOLIO_LABEL, portfolio: getDemoPortfolio() },
    { status: 200 }
  );
}
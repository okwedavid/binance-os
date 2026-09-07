import { NextRequest, NextResponse } from "next/server";
import { resetDemoPortfolio, DEMO_PORTFOLIO_LABEL } from "@/lib/demo/portfolio";
import { isCrossOriginRequest } from "@/lib/server-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resets the in-memory DEMO PORTFOLIO to its initial 10,000 USDT state.
 * Demo Mode only — this can never touch a live Binance account.
 */
export async function POST(req: NextRequest) {
  if (isCrossOriginRequest(req.headers.get("origin"), req.headers.get("host"))) {
    return NextResponse.json(
      { ok: false, message: "Cross-origin request rejected." },
      { status: 403 }
    );
  }
  const portfolio = resetDemoPortfolio();
  return NextResponse.json(
    { ok: true, label: DEMO_PORTFOLIO_LABEL, portfolio },
    { status: 200 }
  );
}

export async function GET() {
  return NextResponse.json({ ok: false, message: "Method not allowed." }, { status: 405 });
}
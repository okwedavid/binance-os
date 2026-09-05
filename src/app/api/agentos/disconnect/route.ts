import { NextRequest, NextResponse } from "next/server";
import { clearSession } from "@/lib/agentos/binance/oauth";
import { isCrossOriginRequest } from "@/lib/server-mode";

/** Revokes the in-browser Agent OS session (tokens live only in httpOnly cookies). */
export async function POST(req: NextRequest) {
  if (isCrossOriginRequest(req.headers.get("origin"), req.headers.get("host"))) {
    return NextResponse.json({ ok: false, message: "Cross-origin request rejected." }, { status: 403 });
  }
  await clearSession();
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: false, message: "Method not allowed." }, { status: 405 });
}
import { NextRequest, NextResponse } from "next/server";
import { handleExecute } from "@/lib/orchestrator";
import type { DemoScenario } from "@/lib/demo/data";
import type { Mode, Side } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AMOUNT = 1_000_000_000;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, blocked: true, safety: null, message: "RiskLens could not read the request.", timeline: [] },
      { status: 200 }
    );
  }

  const mode = parseMode(body);
  const scenario = parseScenario(body);
  const side = parseSide(body);
  const symbol = parseSymbol(body);
  const amount = parseAmount(body);
  const quote = "USDT";
  const requestText = parseText(body);
  const approve = parseApprove(body);

  if (!symbol || !side || amount === null) {
    return NextResponse.json(
      {
        ok: false,
        blocked: true,
        safety: null,
        message: "Invalid order details. RiskLens will not execute.",
        timeline: [],
      },
      { status: 200 }
    );
  }

  const outcome = await handleExecute({
    mode,
    scenario,
    symbol,
    side,
    amount,
    quote,
    requestText,
    approve,
  });

  return NextResponse.json(outcome, { status: 200 });
}

function parseMode(body: unknown): Mode {
  if (body && typeof body === "object" && "mode" in body && (body as { mode: unknown }).mode === "live") {
    return "live";
  }
  return "demo";
}

function parseScenario(body: unknown): DemoScenario {
  if (body && typeof body === "object" && "scenario" in body) {
    const s = (body as { scenario: unknown }).scenario;
    if (s === "volatile" || s === "blocked") return s;
  }
  return "healthy";
}

function parseSide(body: unknown): Side | null {
  if (body && typeof body === "object" && "side" in body) {
    const s = (body as { side: unknown }).side;
    if (s === "buy" || s === "sell") return s;
  }
  return null;
}

function parseSymbol(body: unknown): string | null {
  if (body && typeof body === "object" && "symbol" in body) {
    const s = (body as { symbol: unknown }).symbol;
    if (typeof s === "string" && /^[A-Z0-9]{2,16}$/i.test(s)) {
      return s.toUpperCase();
    }
  }
  return null;
}

function parseAmount(body: unknown): number | null {
  if (body && typeof body === "object" && "amount" in body) {
    const a = (body as { amount: unknown }).amount;
    if (typeof a === "number" && Number.isFinite(a) && a > 0 && a <= MAX_AMOUNT) {
      return a;
    }
  }
  return null;
}

function parseText(body: unknown): string {
  if (body && typeof body === "object" && "requestText" in body) {
    const t = (body as { requestText: unknown }).requestText;
    if (typeof t === "string") return t.slice(0, 400);
  }
  return "";
}

function parseApprove(body: unknown): boolean {
  return (
    body !== null &&
    typeof body === "object" &&
    "approve" in body &&
    (body as { approve: unknown }).approve === true
  );
}
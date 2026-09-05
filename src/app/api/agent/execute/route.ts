import { NextRequest, NextResponse } from "next/server";
import { handleExecute } from "@/lib/orchestrator";
import type { Side } from "@/lib/types";
import { readStoredSession, sessionFingerprint } from "@/lib/agentos/binance/oauth";
import { parseRequestedScenario, isCrossOriginRequest } from "@/lib/server-mode";
import { authorizeExecution } from "@/lib/exec-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AMOUNT = 1_000_000_000;

/**
 * Execute endpoint.
 *
 * Execution is only possible with a server-issued, one-shot, signed
 * execution authorization produced by the `/api/agent` route for the
 * EXACT same order. The client may not invent, widen, or reuse one; and
 * "live" still requires a server-verified Agent OS session.
 */
export async function POST(req: NextRequest) {
  if (isCrossOriginRequest(req.headers.get("origin"), req.headers.get("host"))) {
    return NextResponse.json(
      { ok: false, blocked: true, safety: null, message: "Cross-origin request rejected.", timeline: [] },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, blocked: true, safety: null, message: "RiskLens could not read the request.", timeline: [] },
      { status: 200 }
    );
  }

  const requestedMode =
    body && typeof body === "object" && (body as { mode: unknown }).mode === "live"
      ? "live"
      : "demo";
  if (requestedMode === "live" && (await readStoredSession()) === null) {
    return NextResponse.json(
      {
        ok: false,
        blocked: true,
        safety: null,
        message: "Live mode requires a valid Agent OS connection.",
        detail: "RiskLens will not execute. Reconnect from the connection panel.",
        timeline: [],
      },
      { status: 200 }
    );
  }

  const scenario = parseRequestedScenario(
    body && typeof body === "object" ? (body as { scenario: unknown }).scenario : undefined
  );
  const side = parseSide(body);
  const symbol = parseSymbol(body);
  const amount = parseAmount(body);
  const quote = "USDT";
  const requestText = parseText(body);
  const approve = parseApprove(body);
  const token = parseExecutionToken(body);

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

  // One-time execution authorization gate (A2): every execution requires
  // a fresh server-issued token bound to the exact order. No token, or a
  // token that does not match, is a hard block.
  const bind = requestedMode === "live" ? await sessionFingerprint() : "";
  const authorization = authorizeExecution({
    token,
    order: { mode: requestedMode, symbol, side, amount, requestText },
    bind,
  });
  if (!authorization.ok) {
    const reasonText =
      authorization.reason === "missing"
        ? "No execution authorization was provided."
        : authorization.reason === "reused"
          ? "That execution authorization was already used."
          : authorization.reason === "expired"
            ? "That execution authorization has expired. Ask RiskLens to prepare the order again."
            : authorization.reason === "binding-mismatch"
              ? "The execution authorization does not belong to this Agent OS session."
              : "The execution authorization is invalid.";
    return NextResponse.json(
      {
        ok: false,
        blocked: true,
        safety: null,
        message: "The action was not executed.",
        detail: reasonText,
        timeline: [{ id: "blocked", kind: "BLOCKED", label: "Action blocked", detail: reasonText, atMs: Date.now() }],
      },
      { status: 200 }
    );
  }

  const outcome = await handleExecute({
    mode: requestedMode as "demo" | "live",
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

export async function GET() {
  return NextResponse.json({ ok: false, message: "Method not allowed." }, { status: 405 });
}

function parseExecutionToken(body: unknown): string {
  if (body && typeof body === "object" && "executionAuthorization" in body) {
    const auth = (body as { executionAuthorization: unknown }).executionAuthorization;
    if (auth && typeof auth === "object" && "token" in auth) {
      const t = (auth as { token: unknown }).token;
      if (typeof t === "string") return t.slice(0, 4096);
    }
  }
  return "";
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
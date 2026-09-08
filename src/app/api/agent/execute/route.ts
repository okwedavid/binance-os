import { NextRequest, NextResponse } from "next/server";
import { handleExecute } from "@/lib/orchestrator";
import type { AmountType, Mode, Side } from "@/lib/types";
import { readStoredSession, sessionFingerprint } from "@/lib/agentos/binance/oauth";
import { parseRequestedScenario, isCrossOriginRequest } from "@/lib/server-mode";
import { authorizeExecution } from "@/lib/exec-authorization";
import { DemoAgentOSAdapter } from "@/lib/agentos/demo-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AMOUNT = 1_000_000_000;

/**
 * Execute endpoint.
 *
 * The server resolves the authoritative execution mode FIRST:
 *
 *   DEMO  → demo idempotency gate (never Agent OS) → demo execution adapter
 *   LIVE  → Agent OS session check → trade permission → one-shot execution
 *           authorization → live execution adapter
 *
 * Demo execution never consults Agent OS status, OAuth session, trade
 * permission, or the Binance order tool. It must work even when the user
 * is not connected to Agent OS and no authorization exists. Demo only
 * requires the RiskLens safety checks: valid market, valid evidence, valid
 * order, valid amount/notional, sufficient Demo balance, user approval,
 * and one-time idempotency.
 *
 * The one-shot execution authorization is a RiskLens anti-replay guard.
 * For demo it is never bound to an Agent OS session; for live it is bound
 * to the browser's Agent OS session fingerprint.
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

  // Authoritative mode resolution. The client "mode" is intent only: the
  // server only ever enters live execution with a verified Agent OS
  // session. Demo is the default and never requires Agent OS.
  const requestedMode =
    body && typeof body === "object" && (body as { mode: unknown }).mode === "live"
      ? "live"
      : "demo";
  const executionMode: Mode =
    requestedMode === "live" && (await readStoredSession()) !== null ? "live" : "demo";

  const scenario = parseRequestedScenario(
    body && typeof body === "object" ? (body as { scenario: unknown }).scenario : undefined
  );
  const side = parseSide(body);
  const symbol = parseSymbol(body);
  const amount = parseAmount(body);
  const amountType = parseAmountType(body);
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

  // ---------------------------------------------------------------------
  // LIVE branch — Agent OS authorization checks run ONLY here, never for
  // demo. Mode resolution happens above, before any authorization gate.
  // ---------------------------------------------------------------------
  if (executionMode === "live") {
    if ((await readStoredSession()) === null) {
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

    const token = parseExecutionToken(body);
    const bind = await sessionFingerprint();
    const authorization = authorizeExecution({
      token,
      order: { mode: "live", symbol, side, amount, amountType, requestText },
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
      mode: "live",
      scenario,
      symbol,
      side,
      amount,
      amountType,
      quote,
      requestText,
      approve,
    });
    return NextResponse.json(outcome, { status: 200 });
  }

  // ---------------------------------------------------------------------
  // DEMO branch — never touches Agent OS. Only the demo idempotency gate
  // (bound to nothing) plus user approval guard the demo execution.
  // ---------------------------------------------------------------------
  const token = parseExecutionToken(body);
  const authorization = authorizeExecution({
    token,
    order: { mode: "demo", symbol, side, amount, amountType, requestText },
    bind: "",
  });
  if (!authorization.ok) {
    const reasonText =
      authorization.reason === "missing"
        ? "No demo execution token was provided. Prepare the order again."
        : authorization.reason === "reused"
          ? "That demo execution token was already used. Prepare the order again."
          : authorization.reason === "expired"
            ? "That demo execution token has expired. Prepare the order again."
            : "The demo execution token is invalid.";
    return NextResponse.json(
      {
        ok: false,
        blocked: true,
        safety: null,
        message: "The demo action was not executed.",
        detail: reasonText,
        timeline: [{ id: "blocked", kind: "BLOCKED", label: "Action blocked", detail: reasonText, atMs: Date.now() }],
      },
      { status: 200 }
    );
  }

  // The demo adapter is resolved explicitly so demo execution can never
  // be routed through the live Binance Agent OS adapter.
  const demoAdapter = new DemoAgentOSAdapter(scenario);
  const outcome = await handleExecute(
    {
      mode: "demo",
      scenario,
      symbol,
      side,
      amount,
      amountType,
      quote,
      requestText,
      approve,
    },
    { adapter: demoAdapter }
  );
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

function parseAmountType(body: unknown): AmountType {
  if (
    body &&
    typeof body === "object" &&
    "amountType" in body &&
    ((body as { amountType: unknown }).amountType === "base" ||
      (body as { amountType: unknown }).amountType === "quote")
  ) {
    return (body as { amountType: AmountType }).amountType;
  }
  return "quote";
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

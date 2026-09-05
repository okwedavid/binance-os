import { NextRequest, NextResponse } from "next/server";
import { handleCommand } from "@/lib/orchestrator";
import { readStoredSession, sessionFingerprint } from "@/lib/agentos/binance/oauth";
import { resolveServerMode, parseRequestedScenario, isCrossOriginRequest } from "@/lib/server-mode";
import { issueExecutionAuthorization } from "@/lib/exec-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_COMMAND_LENGTH = 400;

/**
 * Command endpoint (proposals are created here).
 *
 * The request body "mode" is treated as intent only. The server resolves
 * the authoritative mode: "live" without a valid Agent OS session is a
 * hard failure — never a silent demo fallback and never a fabricated live
 * run. Every proposal that leaves this route carries a signed, one-shot
 * execution authorization that the execute endpoint verifies.
 */
export async function POST(req: NextRequest) {
  if (isCrossOriginRequest(req.headers.get("origin"), req.headers.get("host"))) {
    return NextResponse.json(
      { ok: false, message: "Cross-origin request rejected.", timeline: [] },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "RiskLens could not read the request.", timeline: [] },
      { status: 200 }
    );
  }

  const requestedMode =
    body && typeof body === "object" && (body as { mode: unknown }).mode === "live"
      ? "live"
      : "demo";
  const scenario = parseRequestedScenario(
    body && typeof body === "object" ? (body as { scenario: unknown }).scenario : undefined
  );
  const command = parseCommand(body);
  if (!command) {
    return NextResponse.json(
      { ok: false, message: "RiskLens could not read the request.", timeline: [] },
      { status: 200 }
    );
  }

  const hasSession = (await readStoredSession()) !== null;
  const resolved = resolveServerMode(requestedMode, hasSession);
  if (resolved.kind === "error") {
    return NextResponse.json(
      {
        ok: false,
        message: resolved.message,
        detail: resolved.detail,
        timeline: [{ id: "system", kind: "CANCELLED", label: "Live mode unavailable", detail: resolved.detail, atMs: Date.now() }],
      },
      { status: 200 }
    );
  }
  const mode = resolved.mode;

  const response = await handleCommand({ mode, scenario, command });

  let executionAuthorization: { token: string; expiresAtMs: number } | undefined;
  if (response.ok && response.kind === "response" && response.proposal) {
    const bind = mode === "live" ? await sessionFingerprint() : "";
    const order = {
      mode,
      symbol: response.proposal.symbol,
      side: response.proposal.side,
      amount: response.proposal.amount,
      requestText: response.proposal.requestText,
    };
    executionAuthorization = issueExecutionAuthorization({ order, bind });
  }

  return NextResponse.json(
    { ...response, ...(executionAuthorization ? { executionAuthorization } : {}) },
    { status: 200 }
  );
}

export async function GET() {
  return NextResponse.json({ ok: false, message: "Method not allowed." }, { status: 405 });
}

function parseCommand(body: unknown): string {
  if (body && typeof body === "object" && "command" in body) {
    const c = (body as { command: unknown }).command;
    if (typeof c === "string") {
      return c.trim().slice(0, MAX_COMMAND_LENGTH);
    }
  }
  return "";
}
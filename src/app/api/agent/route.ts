import { NextRequest, NextResponse } from "next/server";
import { handleCommand } from "@/lib/orchestrator";
import type { DemoScenario } from "@/lib/demo/data";
import type { Mode } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_COMMAND_LENGTH = 400;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "RiskLens could not read the request.", timeline: [] },
      { status: 200 }
    );
  }

  const mode = parseMode(body);
  const scenario = parseScenario(body);
  const command = parseCommand(body);

  const response = await handleCommand({ mode, scenario, command });
  return NextResponse.json(response, { status: 200 });
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

function parseCommand(body: unknown): string {
  if (body && typeof body === "object" && "command" in body) {
    const c = (body as { command: unknown }).command;
    if (typeof c === "string") {
      return c.trim().slice(0, MAX_COMMAND_LENGTH);
    }
  }
  return "";
}
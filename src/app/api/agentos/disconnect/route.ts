import { NextResponse } from "next/server";
import { clearSession } from "@/lib/agentos/binance/oauth";

/** Revokes the in-browser Agent OS session (tokens live only in httpOnly cookies). */
export async function POST() {
  await clearSession();
  return NextResponse.json({ ok: true });
}
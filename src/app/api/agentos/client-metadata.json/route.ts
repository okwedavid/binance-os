import { NextRequest, NextResponse } from "next/server";
import {
  assertSecureOrigin,
  clientMetadataDocument,
} from "@/lib/agentos/binance/oauth";

/**
 * Client ID Metadata Document (CIMD) for Binance Agent OS.
 *
 * Binance does not run Dynamic Client Registration. Instead it supports
 * Client ID Metadata Documents: the OAuth client identity IS the exact
 * public HTTPS URL of this JSON document. Binance fetches this document
 * before authorizing, so it must be served at the same HTTPS origin that
 * hosts the redirect callback and the exact `client_id` string must match.
 *
 * The document is derived from the server request origin on every call —
 * the Render hostname is never hardcoded. Non-HTTPS origins are rejected
 * in production.
 */
export async function GET(req: NextRequest) {
  let origin: string;
  try {
    origin = req.nextUrl.origin;
    assertSecureOrigin(origin);
  } catch {
    return NextResponse.json(
      { error: "Agent OS client metadata requires an HTTPS deployment origin." },
      { status: 400 }
    );
  }

  return NextResponse.json(clientMetadataDocument(origin), {
    headers: {
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      "Content-Type": "application/json",
    },
  });
}

export async function POST() {
  return NextResponse.json({ ok: false, message: "Method not allowed." }, { status: 405 });
}
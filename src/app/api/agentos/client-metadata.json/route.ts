import { NextRequest, NextResponse } from "next/server";
import {
  assertSecureOrigin,
  clientMetadataDocument,
  publicOrigin,
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
 * The document origin is resolved from `AGENT_OS_PUBLIC_BASE_URL` (the
 * canonical public base URL) and only falls back to the request origin when
 * that override is unset. Behind proxy/tunnel deployments the request
 * origin can be an internal address (observed in production as
 * `https://localhost:10000`), which would make Binance dereference an
 * unreachable document — that configuration is rejected in production.
 */
export async function GET(req: NextRequest) {
  let origin: string;
  try {
    origin = publicOrigin(req.nextUrl.origin);
    assertSecureOrigin(origin);
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Agent OS client metadata requires a public HTTPS deployment origin.";
    return NextResponse.json({ error: message }, { status: 400 });
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
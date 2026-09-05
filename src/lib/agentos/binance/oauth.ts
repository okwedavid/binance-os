import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { AgentOSError } from "@/lib/agentos/adapter";

/**
 * OAuth 2.0 authorization for the Binance Agent OS MCP server.
 *
 * Binance documents the agentic MCP endpoint at
 * https://agent.binance.com/mcp/agentic and expects MCP clients to use
 * the standard MCP-over-Streamable-HTTP + OAuth authorization flow
 * (no API keys). This module implements that flow with the official MCP
 * TypeScript SDK on the server side, using signed httpOnly cookies to
 * carry the per-session OAuth state. The browser never holds access
 * tokens.
 *
 * Cookie integrity: every security-sensitive cookie payload is HMAC
 * signed with `RL_COOKIE_SECRET` (fallback: a per-process random key,
 * which forces a reconnect after an instance restart and is therefore
 * safe, not brittle against attackers). Set `RL_COOKIE_SECRET` in
 * production for a stable key across restarts.
 */

export const AGENT_OS_MCP_URL =
  process.env.AGENT_OS_MCP_URL ?? "https://agent.binance.com/mcp/agentic";

const STATE_COOKIE = "rl_oauth_state";
const VERIFIER_COOKIE = "rl_oauth_verifier";
const CLIENT_COOKIE = "rl_oauth_client";
const SESSION_COOKIE = "rl_agentos_session";

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FLOW_TTL_SECONDS = 600;

export interface StoredSession {
  access_token: string;
  refresh_token?: string;
  scope?: string;
  expires_at?: number;
  token_type?: string;
}

// ---------------------------------------------------------------------------
// Cookie value signing (HMAC-SHA256, no extra dependencies)
// ---------------------------------------------------------------------------

function cookieKey(): string {
  const configured = process.env.RL_COOKIE_SECRET;
  if (configured && configured.length >= 16) return configured;
  const g = globalThis as Record<string, unknown>;
  if (!g.__RL_COOKIE_KEY) {
    g.__RL_COOKIE_KEY = randomBytes(32).toString("hex");
  }
  return g.__RL_COOKIE_KEY as string;
}

function packCookieValue(raw: string): string {
  const encoded = Buffer.from(raw, "utf8").toString("base64url");
  const sig = createHmac("sha256", cookieKey()).update(encoded).digest("base64url");
  return `v1.${encoded}.${sig}`;
}

function unpackCookieValue(packed: string | undefined): string | null {
  if (!packed) return null;
  const parts = packed.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const [, encoded, sig] = parts;
  const expected = createHmac("sha256", cookieKey()).update(encoded).digest("base64url");
  if (!safeEqual(expected, sig)) return null;
  try {
    return Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

function readCookie(store: ReadonlyRequestCookies, name: string): string | undefined {
  const raw = unpackCookieValue(store.get(name)?.value);
  return raw ?? undefined;
}

export async function readStoredSession(): Promise<StoredSession | null> {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  return readStoredSessionFrom(store);
}

export function readStoredSessionFrom(
  store: ReadonlyRequestCookies
): StoredSession | null {
  const raw = readCookie(store, SESSION_COOKIE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed || typeof parsed.access_token !== "string") return null;
    // An expired session without a refresh token is not valid: requiring a
    // reconnect is safer than treating an expired session as authorized.
    if (
      typeof parsed.expires_at === "number" &&
      parsed.expires_at <= Date.now() &&
      typeof parsed.refresh_token !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function saveSession(session: StoredSession): Promise<void> {
  const { cookies } = await import("next/headers");
  (await cookies()).set(
    SESSION_COOKIE,
    packCookieValue(JSON.stringify(session)),
    cookieOptions(Math.floor(TOKEN_TTL_MS / 1000))
  );
}

export async function clearSession(): Promise<void> {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { ...cookieOptions(0), maxAge: 0 });
  store.set(CLIENT_COOKIE, "", { ...cookieOptions(0), maxAge: 0 });
  store.set(STATE_COOKIE, "", { ...cookieOptions(0), maxAge: 0 });
  store.set(VERIFIER_COOKIE, "", { ...cookieOptions(0), maxAge: 0 });
}

export async function sessionFingerprint(): Promise<string> {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  const raw = unpackCookieValue(store.get(SESSION_COOKIE)?.value);
  if (!raw) return "";
  return createHmac("sha256", cookieKey()).update(raw).digest("hex");
}

async function readClientInfo(): Promise<OAuthClientInformationMixed | null> {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  const raw = readCookie(store, CLIENT_COOKIE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OAuthClientInformationMixed;
  } catch {
    return null;
  }
}

async function persistClientInfo(clientInformation: OAuthClientInformationMixed): Promise<void> {
  const { cookies } = await import("next/headers");
  (await cookies()).set(
    CLIENT_COOKIE,
    packCookieValue(JSON.stringify(clientInformation)),
    cookieOptions(Math.floor(TOKEN_TTL_MS / 1000))
  );
}

function makeFetch(): typeof fetch {
  return (input, init) =>
    fetch(input, { ...init, signal: AbortSignal.timeout(20_000) });
}

function sessionFromTokens(tokens: OAuthTokens): StoredSession {
  const session: StoredSession = {
    access_token: tokens.access_token,
    token_type: tokens.token_type,
  };
  if (tokens.refresh_token) session.refresh_token = tokens.refresh_token;
  if (tokens.scope) session.scope = tokens.scope;
  if (typeof tokens.expires_in === "number") {
    session.expires_at = Date.now() + tokens.expires_in * 1000;
  }
  return session;
}

/**
 * Starts the OAuth authorization flow:
 * discover the authorization server, register (or reuse) the OAuth
 * client, persist PKCE verifier + CSRF state in httpOnly cookies, and
 * return the URL the browser should be redirected to.
 */
export async function beginAuthorization(origin: string): Promise<URL> {
  const { discoverOAuthServerInfo, registerClient, startAuthorization } = await import(
    "@modelcontextprotocol/sdk/client/auth.js"
  );

  const fetchFn = makeFetch();
  const serverInfo = await discoverOAuthServerInfo(AGENT_OS_MCP_URL, { fetchFn });
  const authorizationServerUrl = new URL(serverInfo.authorizationServerUrl);
  const metadata = serverInfo.authorizationServerMetadata;

  const callbackUrl = new URL("/api/agentos/callback", origin).toString();

  let clientInformation: OAuthClientInformationMixed | null = null;

  const configuredClientId = process.env.AGENT_OS_CLIENT_ID;
  if (configuredClientId) {
    // Pre-registered client: build from configuration.
    clientInformation = {
      client_id: configuredClientId,
      ...(process.env.AGENT_OS_CLIENT_SECRET
        ? { client_secret: process.env.AGENT_OS_CLIENT_SECRET }
        : {}),
    };
  } else {
    clientInformation = await readClientInfo();
  }

  if (!clientInformation) {
    if (!metadata?.registration_endpoint) {
      throw new AgentOSError(
        "AUTHORIZATION_REQUIRED",
        "The Binance Agent OS server does not advertise dynamic client registration for this web origin. RiskLens keeps Demo Mode fully functional."
      );
    }
    const clientMetadata: OAuthClientMetadata = {
      client_name: "RiskLens",
      redirect_uris: [callbackUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
    clientInformation = await registerClient(authorizationServerUrl, {
      metadata,
      clientMetadata,
      fetchFn,
    });
  }

  // Persist the client information BEFORE starting authorization so the
  // callback (and later token refreshes) can retrieve the exact same
  // client regardless of whether it came from DCR or from the
  // pre-registered AGENT_OS_CLIENT_ID configuration.
  await persistClientInfo(clientInformation);

  const state = randomToken();
  const { authorizationUrl, codeVerifier } = await startAuthorization(
    authorizationServerUrl,
    {
      metadata,
      clientInformation,
      redirectUrl: callbackUrl,
      state,
      resource: new URL(AGENT_OS_MCP_URL),
    }
  );

  const { cookies } = await import("next/headers");
  const store = await cookies();
  store.set(STATE_COOKIE, packCookieValue(state), cookieOptions(FLOW_TTL_SECONDS));
  store.set(VERIFIER_COOKIE, packCookieValue(codeVerifier), cookieOptions(FLOW_TTL_SECONDS));

  return authorizationUrl;
}

/**
 * Completes the OAuth flow at the redirect callback: validates state,
 * exchanges the authorization code for tokens, and stores the tokens in
 * an httpOnly cookie.
 */
export async function completeAuthorization(
  code: string | null,
  state: string | null,
  origin: string
): Promise<{ scope: string | undefined }> {
  const { discoverOAuthServerInfo, exchangeAuthorization } = await import(
    "@modelcontextprotocol/sdk/client/auth.js"
  );
  const { cookies } = await import("next/headers");
  const store = await cookies();

  const clearFlowCookies = () => {
    store.set(STATE_COOKIE, "", { ...cookieOptions(0), maxAge: 0 });
    store.set(VERIFIER_COOKIE, "", { ...cookieOptions(0), maxAge: 0 });
  };

  try {
    if (!code || !state) {
      throw new AgentOSError("AUTHORIZATION_REQUIRED", "Agent OS authorization was not completed.");
    }

    const expectedState = readCookie(store, STATE_COOKIE);
    if (!expectedState || expectedState !== state) {
      throw new AgentOSError("AUTHORIZATION_REQUIRED", "Agent OS authorization state did not match. Try connecting again.");
    }

    const verifier = readCookie(store, VERIFIER_COOKIE);
    const clientInformation = JSON.parse(readCookie(store, CLIENT_COOKIE) ?? "null") as OAuthClientInformationMixed | null;
    if (!verifier || !clientInformation) {
      throw new AgentOSError("AUTHORIZATION_REQUIRED", "The Agent OS authorization flow expired. Try connecting again.");
    }

    const callbackUrl = new URL("/api/agentos/callback", origin).toString();
    const fetchFn = makeFetch();
    const serverInfo = await discoverOAuthServerInfo(AGENT_OS_MCP_URL, { fetchFn });

    const tokens = await exchangeAuthorization(
      new URL(serverInfo.authorizationServerUrl),
      {
        metadata: serverInfo.authorizationServerMetadata,
        clientInformation,
        authorizationCode: code,
        codeVerifier: verifier,
        redirectUri: callbackUrl,
        resource: new URL(AGENT_OS_MCP_URL),
        fetchFn,
      }
    );

    clearFlowCookies();
    await saveSession(sessionFromTokens(tokens));
    return { scope: tokens.scope };
  } finally {
    clearFlowCookies();
  }
}

export async function refreshStoredSession(): Promise<StoredSession | null> {
  const { discoverOAuthServerInfo, refreshAuthorization } = await import(
    "@modelcontextprotocol/sdk/client/auth.js"
  );
  const existing = await readStoredSession();
  if (!existing?.refresh_token) return null;

  const clientInformation = await readClientInfo();
  if (!clientInformation) return null;

  const fetchFn = makeFetch();
  const serverInfo = await discoverOAuthServerInfo(AGENT_OS_MCP_URL, { fetchFn });

  const tokens = await refreshAuthorization(
    new URL(serverInfo.authorizationServerUrl),
    {
      metadata: serverInfo.authorizationServerMetadata,
      clientInformation,
      refreshToken: existing.refresh_token,
      resource: new URL(AGENT_OS_MCP_URL),
      fetchFn,
    }
  );

  const next = sessionFromTokens(tokens);
  if (!next.refresh_token) next.refresh_token = existing.refresh_token;
  await saveSession(next);
  return next;
}

export function scopeList(session: StoredSession | null): string[] {
  if (!session?.scope) return [];
  return session.scope.split(/\s+/).filter(Boolean);
}

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
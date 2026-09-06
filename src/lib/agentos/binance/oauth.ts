import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { AgentOSError } from "@/lib/agentos/adapter";
import type { AuthCapability } from "@/lib/types";

/**
 * OAuth 2.1 authorization for the Binance Agent OS MCP server.
 *
 * Binance documents the agentic MCP endpoint at
 * https://agent.binance.com/mcp/agentic and expects MCP clients to use
 * the standard MCP-over-Streamable-HTTP + OAuth authorization flow
 * (no API keys). This module implements that flow with the official MCP
 * TypeScript SDK on the server side, using signed httpOnly cookies to
 * carry the per-session OAuth state. The browser never holds access
 * tokens.
 *
 * Federation with Binance is automatic: Binance does not run Dynamic
 * Client Registration. Instead it supports Client ID Metadata Documents
 * (`client_id_metadata_document_supported: true`), where the client
 * identity IS the public HTTPS URL of a JSON metadata document served by
 * this deployment (`/api/agentos/client-metadata.json`). That document is
 * used as `client_id`; it must be reachable by Binance at the exact same
 * URL, and the redirect URI is the exact, server-derived
 * `/api/agentos/callback`. The CIMD path is a public client with PKCE-S256
 * (`token_endpoint_auth_method: "none"`), so no client secret is ever
 * involved.
 *
 * Cookie integrity: every security-sensitive cookie payload is HMAC
 * signed with `RL_COOKIE_SECRET` (fallback: a per-process random key,
 * which forces a reconnect after an instance restart and is therefore
 * safe, not brittle against attackers). Set `RL_COOKIE_SECRET` in
 * production for a stable key across restarts.
 */

export const AGENT_OS_MCP_URL =
  process.env.AGENT_OS_MCP_URL ?? "https://agent.binance.com/mcp/agentic";

/** URL of the CIMD metadata endpoint on this deployment. */
export const CLIENT_METADATA_PATH = "/api/agentos/client-metadata.json";
/** URL of the OAuth redirect callback on this deployment. */
export const CALLBACK_PATH = "/api/agentos/callback";
/** Default OAuth scope requested from Binance Agent OS. */
export const DEFAULT_SCOPE = "market_data account trade";

const STATE_COOKIE = "rl_oauth_state";
const VERIFIER_COOKIE = "rl_oauth_verifier";
const CLIENT_COOKIE = "rl_oauth_client";
const SESSION_COOKIE = "rl_agentos_session";

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FLOW_TTL_SECONDS = 600;
const CAPABILITY_TTL_MS = 60_000;

export interface StoredSession {
  access_token: string;
  refresh_token?: string;
  scope?: string;
  expires_at?: number;
  token_type?: string;
}

export type ClientMechanism = "pre_registered" | "cimd" | "dcr" | "none";

/** Public JSON document served at `/api/agentos/client-metadata.json`. */
export interface ClientMetadataDocument {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  scope: string;
}

export interface ClientResolution {
  mechanism: ClientMechanism;
  clientInformation: OAuthClientInformationMixed | null;
  error: string | null;
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

function readClientInfoFrom(store: ReadonlyRequestCookies): OAuthClientInformationMixed | null {
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

// ---------------------------------------------------------------------------
// Pure, testable OAuth client resolution
// ---------------------------------------------------------------------------

/** Exact URL of the CIMD metadata document for a deployment origin. */
export function clientMetadataUrl(origin: string): string {
  return new URL(CLIENT_METADATA_PATH, `${origin}/`).toString();
}

/** Exact server-derived OAuth redirect callback URL for a deployment origin. */
export function callbackUrl(origin: string): string {
  return new URL(CALLBACK_PATH, `${origin}/`).toString();
}

/** OAuth scope actually requested from Binance Agent OS. */
export function requestedScope(): string {
  const configured = process.env.AGENT_OS_SCOPE?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_SCOPE;
}

/** The CIMD document this deployment advertises as its OAuth client identity. */
export function clientMetadataDocument(origin: string): ClientMetadataDocument {
  return {
    client_id: clientMetadataUrl(origin),
    client_name: "RiskLens",
    redirect_uris: [callbackUrl(origin)],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: requestedScope(),
  };
}

/**
 * Rejects insecure origins. In production only HTTPS origins may start or
 * complete an OAuth flow — the CIMD `client_id` must be a public HTTPS URL.
 */
export function assertSecureOrigin(origin: string): void {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new AgentOSError(
      "AUTHORIZATION_REQUIRED",
      "Invalid web origin for Agent OS authorization."
    );
  }
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new AgentOSError(
      "AUTHORIZATION_REQUIRED",
      "Agent OS authorization requires an HTTPS deployment origin on production. The Client ID Metadata Document must be served over HTTPS for Binance to accept it."
    );
  }
}

/**
 * Preconfigured client from environment (`AGENT_OS_CLIENT_ID` / optional
 * `AGENT_OS_CLIENT_SECRET`). Never stored in cookies; only ever resolved
 * inside server code.
 */
export function configuredClientInformation(): OAuthClientInformationMixed | null {
  const clientId = process.env.AGENT_OS_CLIENT_ID;
  if (!clientId || clientId.trim().length === 0) return null;
  const info: OAuthClientInformationMixed = { client_id: clientId.trim() };
  const secret = process.env.AGENT_OS_CLIENT_SECRET;
  if (secret && secret.trim().length > 0) info.client_secret = secret.trim();
  return info;
}

/** CIMD client: the client identity is the exact metadata document URL. */
export function cimdClientInformation(origin: string): OAuthClientInformationMixed {
  return { client_id: clientMetadataUrl(origin) };
}

/**
 * Reduces a client to its PUBLIC identity. `client_secret` must never be
 * persisted (cookies) nor returned to the browser.
 */
export function publicClientInformation(
  clientInformation: OAuthClientInformationMixed
): OAuthClientInformationMixed {
  return { client_id: clientInformation.client_id };
}

/**
 * Detects which client mechanism a discovered authorization server
 * supports: CIMD > DCR > none. Preferring CIMD matches Binance, which
 * advertises `client_id_metadata_document_supported` but no
 * `registration_endpoint`.
 */
export function detectMechanism(
  metadata: AuthorizationServerMetadata | null | undefined
): ClientMechanism {
  if (metadata?.client_id_metadata_document_supported === true) return "cimd";
  if (metadata?.registration_endpoint) return "dcr";
  return "none";
}

/**
 * The single source of truth for how a flow obtains its OAuth client:
 *
 *  A. `AGENT_OS_CLIENT_ID` configured -> pre-registered client.
 *  B. Otherwise, CIMD supported -> client identity is the metadata URL.
 *  C. Otherwise, DCR (only if `registration_endpoint` is advertised).
 *  D. Otherwise fail closed.
 *
 * Never fabricates credentials, never touches the network.
 */
export function selectClientMechanism(opts: {
  metadata: AuthorizationServerMetadata | null | undefined;
  origin: string;
  configured: OAuthClientInformationMixed | null;
}): ClientResolution {
  const { metadata, origin, configured } = opts;
  if (configured) {
    return { mechanism: "pre_registered", clientInformation: configured, error: null };
  }
  const mechanism = detectMechanism(metadata);
  if (mechanism === "cimd") {
    return {
      mechanism,
      clientInformation: cimdClientInformation(origin),
      error: null,
    };
  }
  if (mechanism === "dcr") {
    return { mechanism, clientInformation: null, error: null };
  }
  return {
    mechanism: "none",
    clientInformation: null,
    error:
      "The Binance Agent OS server does not advertise dynamic client registration for this web origin, and it does not enable Client ID Metadata Documents for it. RiskLens keeps Demo Mode fully functional.",
  };
}

/**
 * Resolves the client used for token exchange / refresh:
 * environment configuration first, persisted (public) client as fallback.
 * The callback and refresh paths never depend exclusively on the cookie.
 */
export function resolveAuthClient(
  configured: OAuthClientInformationMixed | null,
  persisted: OAuthClientInformationMixed | null
): OAuthClientInformationMixed | null {
  if (configured) return configured;
  return persisted;
}

/** Constant-time check of the OAuth `state` CSRF value. */
export function stateMatches(
  expected: string | null | undefined,
  provided: string | null | undefined
): boolean {
  if (!expected || !provided) return false;
  return safeEqual(expected, provided);
}

/**
 * Honest capability report for `/api/agentos/status`: does this deployment
 * have a working OAuth client mechanism for Binance Agent OS? Cached
 * briefly so the drawer can poll without hammering discovery.
 */
export async function authCapability(): Promise<AuthCapability> {
  const g = globalThis as Record<string, unknown>;
  const cacheName = "__RL_AUTH_CAPABILITY__";
  const cached = g[cacheName] as { at: number; cap: AuthCapability } | undefined;
  if (cached && Date.now() - cached.at < CAPABILITY_TTL_MS) return cached.cap;

  const configured = configuredClientInformation();
  if (configured) {
    const cap: AuthCapability = {
      supported: true,
      mechanism: "pre_registered",
      configured: true,
    };
    g[cacheName] = { at: Date.now(), cap };
    return cap;
  }

  try {
    const { discoverOAuthServerInfo } = await import(
      "@modelcontextprotocol/sdk/client/auth.js"
    );
    const serverInfo = await discoverOAuthServerInfo(AGENT_OS_MCP_URL, {
      fetchFn: makeFetch(),
    });
    const mechanism = detectMechanism(serverInfo.authorizationServerMetadata);
    let cap: AuthCapability;
    if (mechanism === "cimd") {
      cap = { supported: true, mechanism, configured: true };
    } else if (mechanism === "dcr") {
      cap = {
        supported: true,
        mechanism,
        configured: true,
        detail:
          "Binance supports OAuth via Dynamic Client Registration for this deployment.",
      };
    } else {
      cap = {
        supported: false,
        mechanism: "none",
        configured: false,
        detail:
          "The Binance Agent OS server does not advertise a supported OAuth client mechanism for this deployment. RiskLens stays in Demo Mode.",
      };
    }
    g[cacheName] = { at: Date.now(), cap };
    return cap;
  } catch {
    const cap: AuthCapability = {
      supported: false,
      mechanism: "none",
      configured: false,
      detail:
        "RiskLens could not reach the Binance Agent OS authorization server to determine OAuth capability. It stays in Demo Mode.",
    };
    g[cacheName] = { at: Date.now(), cap };
    return cap;
  }
}

// ---------------------------------------------------------------------------
// OAuth flow
// ---------------------------------------------------------------------------

/**
 * Starts the OAuth authorization flow: discover the authorization server,
 * resolve the OAuth client (pre-registered, CIMD, or DCR), persist only
 * the PUBLIC client identity, then persist PKCE verifier + CSRF state in
 * httpOnly cookies and return the URL the browser should be redirected to.
 */
export async function beginAuthorization(origin: string): Promise<URL> {
  assertSecureOrigin(origin);

  const { discoverOAuthServerInfo, registerClient, startAuthorization } = await import(
    "@modelcontextprotocol/sdk/client/auth.js"
  );

  const fetchFn = makeFetch();
  const serverInfo = await discoverOAuthServerInfo(AGENT_OS_MCP_URL, { fetchFn });
  const authorizationServerUrl = new URL(serverInfo.authorizationServerUrl);
  const metadata = serverInfo.authorizationServerMetadata;

  const config = configuredClientInformation();
  const resolution = selectClientMechanism({ metadata, origin, configured: config });

  let clientInformation: OAuthClientInformationMixed;
  if (resolution.clientInformation) {
    clientInformation = resolution.clientInformation;
  } else if (resolution.mechanism === "dcr") {
    if (!metadata?.registration_endpoint) {
      throw new AgentOSError(
        "AUTHORIZATION_REQUIRED",
        "The Binance Agent OS server does not advertise dynamic client registration for this web origin."
      );
    }
    const clientMetadata: OAuthClientMetadata = {
      client_name: "RiskLens",
      redirect_uris: [callbackUrl(origin)],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: requestedScope(),
    };
    clientInformation = await registerClient(authorizationServerUrl, {
      metadata,
      clientMetadata,
      fetchFn,
    });
  } else {
    throw new AgentOSError("AUTHORIZATION_REQUIRED", resolution.error ?? "");
  }

  // Persist the PUBLIC client identity BEFORE starting authorization so the
  // callback (and later token refreshes) can retrieve the exact same client
  // regardless of mechanism. Pre-registered clients re-resolve from the
  // environment instead, so a client secret never reaches a cookie.
  await persistClientInfo(publicClientInformation(clientInformation));

  const state = randomToken();
  const { authorizationUrl, codeVerifier } = await startAuthorization(
    authorizationServerUrl,
    {
      metadata,
      clientInformation,
      redirectUrl: callbackUrl(origin),
      scope: requestedScope(),
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
 * Completes the OAuth flow at the redirect callback: validates the CSRF
 * state, exchanges the authorization code for tokens, and stores the
 * tokens in an httpOnly cookie.
 */
export async function completeAuthorization(
  code: string | null,
  state: string | null,
  origin: string
): Promise<{ scope: string | undefined }> {
  assertSecureOrigin(origin);

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
    if (!stateMatches(expectedState, state)) {
      throw new AgentOSError("AUTHORIZATION_REQUIRED", "Agent OS authorization state did not match. Try connecting again.");
    }

    const verifier = readCookie(store, VERIFIER_COOKIE);
    const configured = configuredClientInformation();
    const persisted = readClientInfoFrom(store);
    const clientInformation = resolveAuthClient(configured, persisted);
    if (!verifier || !clientInformation) {
      throw new AgentOSError("AUTHORIZATION_REQUIRED", "The Agent OS authorization flow expired. Try connecting again.");
    }

    const redirectUri = callbackUrl(origin);
    const fetchFn = makeFetch();
    const serverInfo = await discoverOAuthServerInfo(AGENT_OS_MCP_URL, { fetchFn });

    const tokens = await exchangeAuthorization(
      new URL(serverInfo.authorizationServerUrl),
      {
        metadata: serverInfo.authorizationServerMetadata,
        clientInformation,
        authorizationCode: code,
        codeVerifier: verifier,
        redirectUri,
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

  const { cookies } = await import("next/headers");
  const store = await cookies();
  const configured = configuredClientInformation();
  const persisted = readClientInfoFrom(store);
  const clientInformation = resolveAuthClient(configured, persisted);
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
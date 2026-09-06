import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";
import type { AuthorizationServerMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  assertSecureOrigin,
  assertWellFormedAuthorizationUrl,
  callbackUrl,
  cimdClientInformation,
  clientMetadataDocument,
  clientMetadataUrl,
  configuredClientInformation,
  DEFAULT_SCOPE,
  detectMechanism,
  publicClientInformation,
  publicOrigin,
  readStoredSessionFrom,
  requestedScope,
  resolveAuthClient,
  selectClientMechanism,
  stateMatches,
  summarizeAuthorizationUrl,
} from "./oauth";
import { resolveServerMode } from "@/lib/server-mode";
import {
  issueExecutionAuthorization,
  authorizeExecution,
} from "@/lib/exec-authorization";

const PROD_ORIGIN = "https://binance-risklens.onrender.com";
const SECRET = "test-secret-0123456789abcdef";

const CIMD_METADATA = {
  client_id_metadata_document_supported: true,
} as AuthorizationServerMetadata;

const DCR_METADATA = {
  registration_endpoint: "https://accounts.binance.com/agentic-oauth/register",
} as AuthorizationServerMetadata;

const NO_MECHANISM_METADATA = {} as AuthorizationServerMetadata;

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function signedCookie(raw: string): string {
  const encoded = Buffer.from(raw, "utf8").toString("base64url");
  const sig = createHmac("sha256", SECRET).update(encoded).digest("base64url");
  return `v1.${encoded}.${sig}`;
}

function cookieStore(sessionCookieValue: string | undefined): ReadonlyRequestCookies {
  return {
    get: (name: string) =>
      sessionCookieValue === undefined ? undefined : { name, value: sessionCookieValue },
  } as unknown as ReadonlyRequestCookies;
}

describe("CIMD metadata document", () => {
  it("generates the exact production metadata URL as client_id", () => {
    expect(clientMetadataUrl(PROD_ORIGIN)).toBe(
      "https://binance-risklens.onrender.com/api/agentos/client-metadata.json"
    );
  });

  it("never introduces a trailing slash or double slash", () => {
    const url = clientMetadataUrl(PROD_ORIGIN);
    expect(url.endsWith("client-metadata.json")).toBe(true);
    expect(url).not.toMatch(/\/\/api/);
  });

  it("derives the exact redirect callback URI", () => {
    expect(callbackUrl(PROD_ORIGIN)).toBe(
      "https://binance-risklens.onrender.com/api/agentos/callback"
    );
  });

  it("serves the exact CIMD document contents", () => {
    const doc = clientMetadataDocument(PROD_ORIGIN);
    expect(doc).toEqual({
      client_id: "https://binance-risklens.onrender.com/api/agentos/client-metadata.json",
      client_name: "RiskLens",
      redirect_uris: [
        "https://binance-risklens.onrender.com/api/agentos/callback",
      ],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: DEFAULT_SCOPE,
    });
  });

  it("keeps the CIMD client_id aligned with the document URL", () => {
    expect(cimdClientInformation(PROD_ORIGIN).client_id).toBe(
      clientMetadataDocument(PROD_ORIGIN).client_id
    );
  });
});

describe("OAuth scope", () => {
  it("defaults to market_data account trade", () => {
    withEnv({ AGENT_OS_SCOPE: undefined }, () => {
      expect(requestedScope()).toBe("market_data account trade");
    });
  });

  it("honors AGENT_OS_SCOPE when set", () => {
    withEnv({ AGENT_OS_SCOPE: "market_data account" }, () => {
      expect(requestedScope()).toBe("market_data account");
    });
  });

  it("falls back to the default when AGENT_OS_SCOPE is empty", () => {
    withEnv({ AGENT_OS_SCOPE: "   " }, () => {
      expect(requestedScope()).toBe("market_data account trade");
    });
  });
});

describe("client resolution (mechanism priority A > B > C, fail closed on D)", () => {
  it("uses a pre-registered client when AGENT_OS_CLIENT_ID is configured", () => {
    withEnv(
      { AGENT_OS_CLIENT_ID: "risklens-app", AGENT_OS_CLIENT_SECRET: "s3cret" },
      () => {
        const resolution = selectClientMechanism({
          metadata: CIMD_METADATA,
          origin: PROD_ORIGIN,
          configured: configuredClientInformation(),
        });
        expect(resolution.mechanism).toBe("pre_registered");
        expect(resolution.clientInformation).toEqual({
          client_id: "risklens-app",
          client_secret: "s3cret",
        });
      }
    );
  });

  it("uses CIMD when no client is configured and the AS supports it", () => {
    withEnv({ AGENT_OS_CLIENT_ID: undefined }, () => {
      const resolution = selectClientMechanism({
        metadata: CIMD_METADATA,
        origin: PROD_ORIGIN,
        configured: null,
      });
      expect(resolution.mechanism).toBe("cimd");
      expect(resolution.error).toBeNull();
      expect(resolution.clientInformation?.client_id).toBe(
        clientMetadataUrl(PROD_ORIGIN)
      );
      // The CIMD path carries no secret.
      expect("client_secret" in (resolution.clientInformation ?? {})).toBe(false);
    });
  });

  it("uses DCR only when registration_endpoint is advertised and CIMD is not", () => {
    withEnv({ AGENT_OS_CLIENT_ID: undefined }, () => {
      const resolution = selectClientMechanism({
        metadata: DCR_METADATA,
        origin: PROD_ORIGIN,
        configured: null,
      });
      expect(resolution.mechanism).toBe("dcr");
      expect(resolution.clientInformation).toBeNull();
    });
  });

  it("fails closed when no client is configured, CIMD is unsupported, and DCR is unavailable", () => {
    withEnv({ AGENT_OS_CLIENT_ID: undefined }, () => {
      const resolution = selectClientMechanism({
        metadata: NO_MECHANISM_METADATA,
        origin: PROD_ORIGIN,
        configured: null,
      });
      expect(resolution.mechanism).toBe("none");
      expect(resolution.clientInformation).toBeNull();
      expect(resolution.error).toBeTruthy();

      expect(detectMechanism(NO_MECHANISM_METADATA)).toBe("none");
    });
  });

  it("detectMechanism prefers CIMD over DCR when both advertise", () => {
    expect(
      detectMechanism({
        ...NO_MECHANISM_METADATA,
        client_id_metadata_document_supported: true,
        registration_endpoint: "https://accounts.binance.com/register",
      } as AuthorizationServerMetadata)
    ).toBe("cimd");
  });

  it("never fabricates credentials for an unknown server", () => {
    withEnv({ AGENT_OS_CLIENT_ID: undefined }, () => {
      const resolution = selectClientMechanism({
        metadata: undefined,
        origin: PROD_ORIGIN,
        configured: null,
      });
      expect(resolution.mechanism).toBe("none");
      expect(resolution.clientInformation).toBeNull();
    });
  });
});

describe("preconfigured client", () => {
  it("returns null when nothing is configured", () => {
    withEnv(
      { AGENT_OS_CLIENT_ID: undefined, AGENT_OS_CLIENT_SECRET: undefined },
      () => {
        expect(configuredClientInformation()).toBeNull();
      }
    );
  });

  it("builds a client with a secret only when both are configured", () => {
    withEnv(
      { AGENT_OS_CLIENT_ID: "risklens-app", AGENT_OS_CLIENT_SECRET: "s3cret" },
      () => {
        expect(configuredClientInformation()).toEqual({
          client_id: "risklens-app",
          client_secret: "s3cret",
        });
      }
    );
  });
});

describe("client secret is never persisted or exposed", () => {
  it("strips the secret from anything that can be persisted as a cookie", () => {
    const persistable = publicClientInformation({
      client_id: "risklens-app",
      client_secret: "s3cret",
      client_id_issued_at: 1700000000,
    });
    expect("client_secret" in persistable).toBe(false);
    expect(persistable).toEqual({ client_id: "risklens-app" });
  });

  it("the serialized persisted value does not contain the secret", () => {
    const json = JSON.stringify(
      publicClientInformation({ client_id: "risklens-app", client_secret: "s3cret" })
    );
    expect(json).not.toContain("s3cret");
    expect(json).not.toContain("client_secret");
  });

  it("the CIMD document never contains a client_secret field", () => {
    expect("client_secret" in clientMetadataDocument(PROD_ORIGIN)).toBe(false);
    expect(JSON.stringify(clientMetadataDocument(PROD_ORIGIN))).not.toContain(
      "client_secret"
    );
  });
});

describe("callback / refresh client resolution is configuration-first", () => {
  it("token exchange uses the env-configured client (with its secret) when present", () => {
    const configured = { client_id: "risklens-app", client_secret: "s3cret" };
    const persisted = { client_id: clientMetadataUrl(PROD_ORIGIN) };
    const used = resolveAuthClient(configured, persisted);
    expect(used).toEqual(configured);
  });

  it("refresh uses the env-configured client when present", () => {
    const configured = { client_id: "risklens-app", client_secret: "s3cret" };
    const used = resolveAuthClient(configured, persistedPublicClient());
    expect(used).toBe(configured);
  });

  it("falls back to the persisted public client when not configured", () => {
    const persisted = persistedPublicClient();
    const used = resolveAuthClient(null, persisted);
    expect(used).toEqual(persisted);
  });

  it("fails closed (null) when neither configured nor persisted", () => {
    expect(resolveAuthClient(null, null)).toBeNull();
  });

  function persistedPublicClient() {
    return { client_id: clientMetadataUrl(PROD_ORIGIN) };
  }
});

describe("HTTPS enforcement", () => {
  it("rejects non-HTTPS origins in production", () => {
    withEnv({ NODE_ENV: "production" }, () => {
      expect(() => assertSecureOrigin("http://binance-risklens.onrender.com")).toThrow();
    });
  });

  it("accepts HTTPS origins in production", () => {
    withEnv({ NODE_ENV: "production" }, () => {
      expect(() => assertSecureOrigin(PROD_ORIGIN)).not.toThrow();
    });
  });

  it("allows plain HTTP origins outside production (local development)", () => {
    withEnv({ NODE_ENV: "test" }, () => {
      expect(() => assertSecureOrigin("http://localhost:3000")).not.toThrow();
    });
  });

  it("rejects origins that are not valid URLs", () => {
    withEnv({ NODE_ENV: "test" }, () => {
      expect(() => assertSecureOrigin("not-a-url")).toThrow();
    });
  });
});

describe("OAuth state validation (CSRF)", () => {
  it("accepts a callback with valid state", () => {
    expect(stateMatches("abc123", "abc123")).toBe(true);
  });

  it("rejects a callback with invalid state", () => {
    expect(stateMatches("abc123", "abc124")).toBe(false);
  });

  it("rejects a callback with mismatched or missing state", () => {
    expect(stateMatches("abc123", null)).toBe(false);
    expect(stateMatches(null, "abc123")).toBe(false);
    expect(stateMatches(undefined, "abc123")).toBe(false);
    expect(stateMatches("abc123", "")).toBe(false);
  });
});

describe("session validation", () => {
  const originalSecret = process.env.RL_COOKIE_SECRET;

  beforeEach(() => {
    process.env.RL_COOKIE_SECRET = SECRET;
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.RL_COOKIE_SECRET;
    else process.env.RL_COOKIE_SECRET = originalSecret;
  });

  it("returns null for a disconnected session (no cookie)", () => {
    expect(readStoredSessionFrom(cookieStore(undefined))).toBeNull();
  });

  it("returns null for a tampered/expired-signed cookie", () => {
    expect(readStoredSessionFrom(cookieStore("v1.Zm9vLmJhcg==.sig"))).toBeNull();
  });

  it("returns null for an expired session without a refresh token", () => {
    const raw = JSON.stringify({
      access_token: "at",
      expires_at: Date.now() - 1000,
    });
    expect(readStoredSessionFrom(cookieStore(signedCookie(raw)))).toBeNull();
  });

  it("keeps an expired session valid when a refresh token exists", () => {
    const raw = JSON.stringify({
      access_token: "at",
      refresh_token: "rt",
      expires_at: Date.now() - 1000,
    });
    const session = readStoredSessionFrom(cookieStore(signedCookie(raw)));
    expect(session?.refresh_token).toBe("rt");
  });

  it("accepts a valid signed session", () => {
    const raw = JSON.stringify({ access_token: "at", refresh_token: "rt" });
    const session = readStoredSessionFrom(cookieStore(signedCookie(raw)));
    expect(session?.access_token).toBe("at");
  });
});

describe("demo/live separation and execution guards", () => {
  it("Demo Mode remains independent without a session", () => {
    expect(resolveServerMode("demo", false).kind).toBe("demo");
  });

  it("rejects forced-live requests without an authenticated session", () => {
    const result = resolveServerMode("live", false);
    expect(result.kind).toBe("error");
  });

  it("allows live only when the server has a valid session", () => {
    expect(resolveServerMode("live", true).kind).toBe("live");
  });

  it("live execution is one-shot — a double submit is rejected", () => {
    const order = {
      mode: "live",
      symbol: "BTCUSDT",
      side: "buy",
      amount: 20,
      requestText: "Buy $20 of BTCUSDT.",
    };
    const { token } = issueExecutionAuthorization({ order, bind: "session-fp" });
    expect(authorizeExecution({ token, order, bind: "session-fp" }).ok).toBe(true);
    expect(authorizeExecution({ token, order, bind: "session-fp" }).reason).toBe(
      "reused"
    );
  });

  it("live execution guard rejects a token bound to the wrong session", () => {
    const order = {
      mode: "live",
      symbol: "BTCUSDT",
      side: "buy",
      amount: 20,
      requestText: "Buy $20 of BTCUSDT.",
    };
    const { token } = issueExecutionAuthorization({ order, bind: "session-a" });
    const result = authorizeExecution({ token, order, bind: "session-b" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("binding-mismatch");
  });
});

function buildAuthorizationUrl(
  overrides: {
    clientId?: string | null;
    redirectUri?: string | null;
    responseType?: string | null;
    scope?: string | null;
    state?: string | null;
    challenge?: string | null;
    challengeMethod?: string | null;
  } = {}
): URL {
  const url = new URL("https://accounts.binance.com/agentic-oauth/authorize");
  const params = url.searchParams;
  if (overrides.clientId !== null) {
    params.set("client_id", overrides.clientId ?? clientMetadataUrl(PROD_ORIGIN));
  }
  if (overrides.redirectUri !== null) {
    params.set("redirect_uri", overrides.redirectUri ?? callbackUrl(PROD_ORIGIN));
  }
  if (overrides.responseType !== null) {
    params.set("response_type", overrides.responseType ?? "code");
  }
  if (overrides.scope !== null) {
    params.set("scope", overrides.scope ?? "market_data account trade");
  }
  if (overrides.state !== null) {
    params.set("state", overrides.state ?? "abc123");
  }
  if (overrides.challenge !== null) {
    params.set("code_challenge", overrides.challenge ?? "challenge");
  }
  if (overrides.challengeMethod !== null) {
    params.set("code_challenge_method", overrides.challengeMethod ?? "S256");
  }
  return url;
}

describe("authorization URL construction", () => {
  it("accepts a well-formed URL with the discovered Binance authorization endpoint", () => {
    const url = buildAuthorizationUrl();
    expect(() =>
      assertWellFormedAuthorizationUrl(url, callbackUrl(PROD_ORIGIN))
    ).not.toThrow();
    expect(url.hostname).toBe("accounts.binance.com");
    expect(url.pathname).toBe("/agentic-oauth/authorize");
  });

  it("keeps the exact CIMD client_id and redirect URI in the URL", () => {
    const url = buildAuthorizationUrl();
    expect(url.searchParams.get("client_id")).toBe(clientMetadataUrl(PROD_ORIGIN));
    expect(url.searchParams.get("redirect_uri")).toBe(callbackUrl(PROD_ORIGIN));
    expect(url.searchParams.get("scope")).toBe("market_data account trade");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.has("state")).toBe(true);
    expect(url.searchParams.has("code_challenge")).toBe(true);
  });

  it("rejects a URL whose client_id points at a different origin (the localhost production bug)", () => {
    const url = buildAuthorizationUrl({
      clientId: "https://localhost:10000/api/agentos/client-metadata.json",
    });
    expect(() =>
      assertWellFormedAuthorizationUrl(url, callbackUrl(PROD_ORIGIN))
    ).toThrow(/client_id does not match this deployment's public origin/);
  });

  it("rejects a URL missing the PKCE challenge", () => {
    const url = buildAuthorizationUrl({ challenge: null });
    expect(() =>
      assertWellFormedAuthorizationUrl(url, callbackUrl(PROD_ORIGIN))
    ).toThrow(/PKCE code_challenge is missing/);
  });

  it("rejects a URL with a non-S256 PKCE method", () => {
    const url = buildAuthorizationUrl({ challengeMethod: "plain" });
    expect(() =>
      assertWellFormedAuthorizationUrl(url, callbackUrl(PROD_ORIGIN))
    ).toThrow(/PKCE method is not S256/);
  });

  it("rejects a URL missing the OAuth state", () => {
    const url = buildAuthorizationUrl({ state: null });
    expect(() =>
      assertWellFormedAuthorizationUrl(url, callbackUrl(PROD_ORIGIN))
    ).toThrow(/OAuth state is missing/);
  });

  it("rejects a URL missing the scope", () => {
    const url = buildAuthorizationUrl({ scope: null });
    expect(() =>
      assertWellFormedAuthorizationUrl(url, callbackUrl(PROD_ORIGIN))
    ).toThrow(/OAuth scope is missing/);
  });

  it("rejects a URL whose redirect URI does not match the deployment callback", () => {
    const url = buildAuthorizationUrl({ redirectUri: "https://evil.example/callback" });
    expect(() =>
      assertWellFormedAuthorizationUrl(url, callbackUrl(PROD_ORIGIN))
    ).toThrow(/redirect_uri does not match/);
  });

  it("rejects a non-HTTPS authorization URL", () => {
    const url = buildAuthorizationUrl();
    const httpUrl = new URL(`http:${url.href.slice(url.href.indexOf("//"))}`);
    expect(() =>
      assertWellFormedAuthorizationUrl(httpUrl, callbackUrl(PROD_ORIGIN))
    ).toThrow(/not HTTPS/);
  });
});

describe("authorization URL diagnostics never leak secrets", () => {
  it("reduces state and code_challenge to presence booleans", () => {
    const url = buildAuthorizationUrl({ state: "TOPSECRETSTATE", challenge: "TOPSECRETCHALLENGE" });
    const diagnostics = summarizeAuthorizationUrl(url);
    expect(diagnostics.hasState).toBe(true);
    expect(diagnostics.hasPkceChallenge).toBe(true);
    expect("state" in diagnostics).toBe(false);
    expect("code_challenge" in diagnostics).toBe(false);
    expect(JSON.stringify(diagnostics)).not.toContain("TOPSECRETSTATE");
    expect(JSON.stringify(diagnostics)).not.toContain("TOPSECRETCHALLENGE");
  });

  it("reports exact expression fields and never a secret", () => {
    const url = buildAuthorizationUrl();
    const diagnostics = summarizeAuthorizationUrl(url);
    expect(diagnostics.hostname).toBe("accounts.binance.com");
    expect(diagnostics.pathname).toBe("/agentic-oauth/authorize");
    expect(diagnostics.client_id).toBe(clientMetadataUrl(PROD_ORIGIN));
    expect(diagnostics.redirect_uri).toBe(callbackUrl(PROD_ORIGIN));
    expect(diagnostics.response_type).toBe("code");
    expect(diagnostics.scope).toBe("market_data account trade");
    expect(diagnostics.code_challenge_method).toBe("S256");
    expect(JSON.stringify(diagnostics)).not.toContain("client_secret");
  });
});

describe("AGENT_OS_PUBLIC_BASE_URL (canonical public origin)", () => {
  it("uses the configured public base URL even when the request origin is internal", () => {
    withEnv(
      {
        AGENT_OS_PUBLIC_BASE_URL: "https://binance-risklens.onrender.com",
        NODE_ENV: "production",
      },
      () => {
        expect(publicOrigin("https://localhost:10000")).toBe(
          "https://binance-risklens.onrender.com"
        );
      }
    );
  });

  it("normalizes a configured base URL that carries a path or trailing slash", () => {
    withEnv({ AGENT_OS_PUBLIC_BASE_URL: "https://binance-risklens.onrender.com/xyz/" }, () => {
      expect(publicOrigin("https://localhost:10000")).toBe(
        "https://binance-risklens.onrender.com"
      );
    });
  });

  it("falls back to the request origin outside production (local development)", () => {
    withEnv(
      { AGENT_OS_PUBLIC_BASE_URL: undefined, NODE_ENV: "test" },
      () => {
        expect(publicOrigin("https://localhost:10000")).toBe("https://localhost:10000");
      }
    );
  });

  it("rejects a loopback/private request origin in production when not configured", () => {
    withEnv(
      { AGENT_OS_PUBLIC_BASE_URL: undefined, NODE_ENV: "production" },
      () => {
        expect(() => publicOrigin("https://localhost:10000")).toThrow(
          /AGENT_OS_PUBLIC_BASE_URL/
        );
        expect(() => publicOrigin("http://192.168.0.5:3000")).toThrow(
          /AGENT_OS_PUBLIC_BASE_URL/
        );
      }
    );
  });

  it("rejects plain HTTP in production", () => {
    withEnv(
      { AGENT_OS_PUBLIC_BASE_URL: undefined, NODE_ENV: "production" },
      () => {
        expect(() => publicOrigin("http://binance-risklens.onrender.com")).toThrow(
          /AGENT_OS_PUBLIC_BASE_URL/
        );
      }
    );
  });

  it("allows a public HTTPS origin in production", () => {
    withEnv({ NODE_ENV: "production" }, () => {
      expect(() =>
        publicOrigin("https://binance-risklens.onrender.com")
      ).not.toThrow();
    });
  });
});
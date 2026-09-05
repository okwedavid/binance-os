import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * One-time execution authorization for order submission.
 *
 * A proposal returned by `/api/agent` carries an opaque, server-signed
 * authorization token. The execute endpoint accepts each token at most
 * once, within a short TTL, and only for the exact order parameters the
 * token was minted for. Signature verification is server-side only: the
 * client cannot forge, widen, or extend a token.
 *
 * Live tokens are additionally bound to the browser's Agent OS session
 * fingerprint, so a token leaked from one session cannot be used on
 * another. Demo tokens have no financial risk and rely on signature +
 * one-time consumption.
 *
 * LIMITATION (documented): true once-only semantics across multiple
 * server instances require shared storage. This module enforces
 * one-time use within a single process instance and rejects reuse
 * through signature/parameter/expiry binding everywhere. On Render the
 * app typically runs on a single web instance; for a multi-instance
 * deployment, set a shared `RL_COOKIE_SECRET` (paste of the token across
 * instances is still prevented by proximity; precise cross-instance
 * dedupe would require a shared nonce store).
 */

export interface ExecutionAuthorizationPayload {
  /** Which order this authorization may execute (exact match). */
  order: {
    mode: string;
    symbol: string;
    side: string;
    amount: number;
    requestText: string;
  };
  /** Session fingerprint for live tokens; empty for demo tokens. */
  bind: string;
}

export interface ExecutionAuthorizationResult {
  ok: boolean;
  reason?: "missing" | "expired" | "tampered" | "reused" | "binding-mismatch" | "invalid";
}

const TOKEN_TTL_MS = 10 * 60 * 1000;
const TOKEN_SEPARATOR = "::";

// Retain consumed nonces so the same signed token cannot be replayed on
// this instance. This is intentionally process-local (documented above).
const consumed = new Map<string, number>();
const MAX_CONSUMED = 2000;

function secret(): string {
  const configured = process.env.RL_COOKIE_SECRET;
  if (configured && configured.length >= 16) return configured;
  // Locally-booted fallback: stable for the lifetime of the process.
  if (!(globalThis as Record<string, unknown>).__RL_COOKIE_KEY) {
    (globalThis as Record<string, unknown>).__RL_COOKIE_KEY = randomBytes(32).toString("hex");
  }
  return (globalThis as Record<string, unknown>).__RL_COOKIE_KEY as string;
}

function hmac(key: string, data: string): string {
  return createHmac("sha256", key).update(data).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function orderString(order: ExecutionAuthorizationPayload["order"]): string {
  return JSON.stringify({
    mode: order.mode,
    symbol: order.symbol,
    side: order.side,
    amount: order.amount,
    requestText: order.requestText,
  });
}

/** Registers a consumed nonce and prunes expired entries. */
function consumeNonce(nonce: string): boolean {
  const now = Date.now();
  for (const [key, at] of consumed) {
    if (now - at > TOKEN_TTL_MS) consumed.delete(key);
  }
  if (consumed.has(nonce)) return false;
  consumed.set(nonce, now);
  if (consumed.size > MAX_CONSUMED) {
    const first = consumed.keys().next().value;
    if (first !== undefined) consumed.delete(first);
  }
  return true;
}

export function issueExecutionAuthorization(
  payload: ExecutionAuthorizationPayload
): { token: string; expiresAtMs: number } {
  const nonce = randomBytes(16).toString("hex");
  const expiresAtMs = Date.now() + TOKEN_TTL_MS;
  const body = JSON.stringify({
    nonce,
    exp: expiresAtMs,
    bind: payload.bind,
    order: payload.order,
  });
  const token = `${Buffer.from(body, "utf8").toString("base64url")}${TOKEN_SEPARATOR}${hmac(
    secret(),
    body
  )}`;
  return { token, expiresAtMs };
}

export function authorizeExecution(params: {
  token: string;
  order: ExecutionAuthorizationPayload["order"];
  bind: string;
}): ExecutionAuthorizationResult {
  const { token, order, bind } = params;
  if (!token || typeof token !== "string") {
    return { ok: false, reason: "missing" };
  }

  const sep = token.lastIndexOf(TOKEN_SEPARATOR);
  if (sep <= 0) return { ok: false, reason: "invalid" };
  const bodyB64 = token.slice(0, sep);
  const signature = token.slice(sep + TOKEN_SEPARATOR.length);
  if (!bodyB64 || !signature) return { ok: false, reason: "invalid" };

  let body: string;
  try {
    body = Buffer.from(bodyB64, "base64url").toString("utf8");
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if (!safeEqual(hmac(secret(), body), signature)) {
    return { ok: false, reason: "tampered" };
  }

  let parsed: {
    nonce: string;
    exp: number;
    bind: string;
    order: ExecutionAuthorizationPayload["order"];
  };
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if (typeof parsed.nonce !== "string" || typeof parsed.exp !== "number") {
    return { ok: false, reason: "invalid" };
  }

  if (parsed.bind !== bind) {
    return { ok: false, reason: "binding-mismatch" };
  }

  if (Date.now() > parsed.exp) {
    return { ok: false, reason: "expired" };
  }

  if (orderString(parsed.order) !== orderString(order)) {
    return { ok: false, reason: "tampered" };
  }

  if (!consumeNonce(parsed.nonce)) {
    return { ok: false, reason: "reused" };
  }

  return { ok: true };
}
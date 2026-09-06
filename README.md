# RiskLens

Ask. Verify. Act.

RiskLens turns a natural-language Binance request into an evidence-backed
Action Card. Every request is checked against observable data by a
deterministic safety engine (PASS / CAUTION / BLOCK), nothing executes
without explicit human approval, and every check is written to an audit
trail. Built for the Binance Agent OS / MCP (Agentic sub-account) integration.

## Status

- **Demo Mode works out of the box.** `npm install && npm run dev`, open
  http://localhost:3000, and run any request. Three deterministic scenarios
  reproduce PASS, CAUTION, and BLOCK.
- **Live Mode** talks to the official Binance Agent OS MCP endpoint
  (`https://agent.binance.com/mcp/agentic`) through a server-side MCP client
  behind the official OAuth browser flow. It is enabled only when the user
  completes authorization in the connection panel.

## Quick demo (90 seconds)

1. `npm install && npm run dev`
2. Open http://localhost:3000 — the app loads in **Demo Mode** (red banner:
   "No real order will be submitted").
3. Click **CONNECTION** (top-right) → pick a demo scenario:
   - **Healthy market** → PASS
   - **Elevated volatility** → CAUTION
   - **Insufficient balance** → BLOCK
4. Send: `Prepare a $20 BTC spot buy if all safety checks pass.`
5. Read the **Action Card**: checks, status badge, and WHY.
6. In Demo Mode click **SIMULATE ACTION** — you get a simulated execution with
   the audit trail updated. In Live Mode it would be **APPROVE & EXECUTE**.
7. Try `Analyze ETHUSDT` and `Check my available Binance balance.`
8. Refresh — the app returns to Demo Mode on every load.

## How it works

```
User request ─▶ Intent parser ─▶ Evidence (market + account) ─▶ Derived signals
                                                        │
                                                        ▼
                                        Deterministic safety engine
                                        (amount · freshness · balance ·
                                         volatility · liquidity · permission)
                                                        │
                              PASS / CAUTION / BLOCK ─▶ Action Card
                                                        │
                                  approval required ─▶ execution
                                        (demo: simulate / live: Agent OS)
```

- The **intent parser** recognizes a deliberately small MVP command set
  (analyze, propose buy/sell with amount, check balance) and otherwise asks
  for clarification.
- The **safety engine** is pure and deterministic. A failed check is
  **BLOCK**. An unverifiable signal is **CAUTION** (never silently ignored).
  A permission that cannot be confirmed **fails closed** to BLOCK. A BLOCK
  can never execute.
- **Evidence is observable only.** The app displays exactly what the current
  Agent OS permission returns. Anything unavailable is shown as unavailable,
  never estimated.
- **No LLM in the loop.** Intent parsing, signal derivation, safety checks,
  and explanations are all deterministic code. Nothing in the product relies
  on a model that could be prompted, and nothing ever executes without the
  deterministic safety engine approving it.
- **Approval is never bypassed.** In Live Mode the execution endpoint
  re-fetches evidence server-side and re-runs the safety engine; the browser
  can never dictate the decision.
- **Execution needs a server-issued key.** Every proposal carries a signed,
  one-shot authorization that is bound to the exact order and (in Live Mode)
  to your session. The execute endpoint verifies it before anything runs.
- The **audit trail** records every check, approval, and result.

## Live Agent OS connection

Live Mode uses a server-side MCP client (`@modelcontextprotocol/sdk`) over
Streamable HTTP. Browsers cannot hold Auth0/Streamable-HTTP MCP sessions, so
all MCP traffic happens in Next.js route handlers (serverless-safe: one fresh
session per request, no long-lived in-memory state).

- **OAuth only, no API keys.** The authorization server is discovered from
  the MCP endpoint. Binance does not run Dynamic Client Registration; it
  supports **Client ID Metadata Documents (CIMD)**. RiskLens serves its
  metadata document at `GET /api/agentos/client-metadata.json` and uses the
  document's exact HTTPS URL as the OAuth `client_id`. The redirect callback
  is the exact, server-derived `/api/agentos/callback` and the client is
  public (`token_endpoint_auth_method: "none"`, PKCE-S256), so **no client
  secret and no registration step are involved**. `AGENT_OS_CLIENT_ID` /
  `AGENT_OS_CLIENT_SECRET` remain optional environment-only overrides for
  pre-registered clients — the secret is resolved at exchange/refresh time
  and never stored in a cookie. The requested scope defaults to
  `market_data account trade` (`AGENT_OS_SCOPE`).
- Tokens live only in **httpOnly cookies** (`rl_agentos_session` and friends)
  — never in client JS or localStorage. Cookie values are HMAC-signed; set
  `RL_COOKIE_SECRET` so the key is stable across restarts (a per-process
  random fallback is used otherwise). Only the **public** client identity is
  ever persisted in a cookie.
- **Server-authoritative mode.** The request body may only express intent:
  "live" without a server-verified Agent OS session is a hard, typed failure,
  never a silent demo downgrade.
- **Honest connect states.** `/api/agentos/status` reports the deployment's
  OAuth capability (`auth`): when the CIMD document can be served over HTTPS
  the UI shows "Connect Agent OS"; otherwise "Agent OS Setup Required" with
  the server's reason. The button is never permanently disabled, and
  `connected: true` is only ever set by a server-verified session — clicking
  "Connect" alone never claims connectivity.
- **Tool names are never hardcoded.** Tools are discovered at runtime from
  the server's own `tools/list` response and matched to capabilities by
  strict schema heuristics; a create-order tool is only trusted when the
  granted OAuth scopes corroborate trading access.
- If authorization is missing or not available for the deployment origin,
  Live Mode reports an honest typed failure and the app stays functional in
  Demo Mode (no fabricated live data).
- **Withdrawals are never exposed**, and RiskLens never moves funds on its
  own. The Agentic sub-account is isolated from the main Binance account.
- OAuth presence cannot be fully verified without a live Binance account;
  see Known limitations.

## Commands

```
Prepare a $20 BTC spot buy if all safety checks pass.
Buy $50 of ETHUSDT.
Sell my BTC position.
Analyze BTCUSDT.
Check my available Binance balance.
```

Suggested chips for these are shown under the input.

## Development

```bash
npm install
npm run dev        # http://localhost:3000
npm run lint       # eslint
npm test           # vitest (safety engine + execution guard)
npm run build      # production build
```

## Project layout

```
src/lib/types.ts                       domain types
src/lib/safety/engine.ts               deterministic PASS/CAUTION/BLOCK engine
src/lib/safety/engine.test.ts          safety engine tests
src/lib/demo/data.ts                   deterministic demo scenarios + thresholds
src/lib/agent/intent.ts                intent parser
src/lib/agent/intent.test.ts           amount/intent parsing tests
src/lib/agent/explain.ts               evidence-backed explanations
src/lib/orchestrator.ts                command + execution guards
src/lib/orchestrator.test.ts           execution-guard tests
src/lib/exec-authorization.ts          signed one-shot execution authorizations
src/lib/exec-authorization.test.ts     authorization lifecycle tests
src/lib/server-mode.ts                 server-authoritative mode + origin checks
src/lib/server-mode.test.ts            mode resolution tests
src/lib/agentos/adapter.ts             capability boundary
src/lib/agentos/demo-adapter.ts        deterministic demo adapter
src/lib/agentos/tool-discovery.ts      schema-driven tool discovery + order args
src/lib/agentos/tool-discovery.test.ts tool discovery tests
src/lib/agentos/binance/oauth.ts       OAuth (PKCE) flow, signed httpOnly cookies
src/lib/agentos/binance/mcp-session.ts server-side MCP client session
src/lib/agentos/binance/index.ts       live Agent OS adapter (tool discovery)
src/app/api/agent|execute|agentos/…    API routes
src/components/…                       UI (console, Action Card, evidence, trail)
```

## Config

See `.env.example`. All values optional; defaults target the official
Binance Agent OS MCP endpoint and scope (`market_data account trade`).
`RL_COOKIE_SECRET` is recommended in production (cookie signature stability).
`AGENT_OS_CLIENT_ID` / `AGENT_OS_CLIENT_SECRET` are optional pre-registered
client overrides — RiskLens normally uses the CIMD flow automatically.

### Deploying to Render

On Render (HTTPS) the CIMD flow works without any Binance client registration
or API key:

1. Set `RL_COOKIE_SECRET` to a 16+ character value in the Render environment.
2. **Required:** set `AGENT_OS_PUBLIC_BASE_URL` to the deployment's public
   HTTPS URL, e.g. `https://binance-risklens.onrender.com`. This is the
   canonical public origin. Render (or a proxy/tunnel) rewrites the upstream
   request host to an internal address (observed as `https://localhost:10000`),
   so the server cannot reliably infer the public URL on its own. Without this
   variable, production fails closed with an actionable error because Binance
   could not dereference the client metadata document or return to the
   callback.
3. After deploy, verify the metadata document is served correctly:

   ```
   GET https://binance-risklens.onrender.com/api/agentos/client-metadata.json
   ```

   The response should contain a JSON object whose `client_id` field is the
   exact request URL, and whose `redirect_uris` contains the callback URL
   `https://binance-risklens.onrender.com/api/agentos/callback`.
4. The "Connect Agent OS" button in the settings panel becomes available
   automatically once the server can reach Binance's authorization discovery
   endpoint — no further configuration is needed.

## Known limitations

- **Live execution is unverified.** The OAuth + MCP path compiles, type-checks
  and is built exactly per the Binance Agent OS Developer Guide, but it needs
  a real Binance account (and a reachable `agent.binance.com` origin) to be
  exercised end-to-end. RiskLens never fabricates live success.
- **Execution authorization is single-instance.** The one-shot, signed
  execution tokens enforce exact-order replay protection within one server
  process. On Render the app typically runs on a single web instance, which
  is fully covered. A multi-instance deployment would need shared storage for
  the consumed-nonce set; parameter/signature/session binding still holds
  across instances either way. Set `RL_COOKIE_SECRET` so cookies stay valid
  across restarts.
- Live mode configured in the browser is **not persisted** — refresh returns
  to Demo Mode (OAuth session cookie aside). Scenario selection is persisted,
  and Live Mode only engages when the server confirms an active Agent OS
  connection.
- Only BTCUSDT/ETHUSDT (USDT quote) are supported; amounts are quote-amounts
  (USDT) as specified.
- The project uses the standard `src/` layout from `create-next-app` rather
  than the root `app/` folder mentioned in the brief.
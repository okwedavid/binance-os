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
- **Approval is never bypassed.** In Live Mode the execution endpoint
  re-fetches evidence server-side and re-runs the safety engine; the browser
  can never dictate the decision.
- The **audit trail** records every check, approval, and result.

## Live Agent OS connection

Live Mode uses a server-side MCP client (`@modelcontextprotocol/sdk`) over
Streamable HTTP. Browsers cannot hold Auth0/Streamable-HTTP MCP sessions, so
all MCP traffic happens in Next.js route handlers (serverless-safe: one fresh
session per request, no long-lived in-memory state).

- **OAuth only, no API keys.** The authorization server is discovered from
  the MCP endpoint. RiskLens tries Dynamic Client Registration for this web
  origin and otherwise reuses credentials from `AGENT_OS_CLIENT_ID`.
- Tokens live only in **httpOnly cookies** (`rl_agentos_session` and friends)
  — never in client JS or localStorage.
- **Tool names are never hardcoded.** Tools are discovered at runtime from
  the server's own `tools/list` response and matched to capabilities by
  keyword heuristics; outputs are normalized by key matching.
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
src/lib/demo/data.ts                   deterministic demo scenarios + thresholds
src/lib/agent/intent.ts                intent parser
src/lib/agent/explain.ts               evidence-backed explanations
src/lib/orchestrator.ts                command + execution guards
src/lib/agentos/adapter.ts             capability boundary
src/lib/agentos/demo-adapter.ts        deterministic demo adapter
src/lib/agentos/binance/oauth.ts       OAuth (PKCE) flow, httpOnly cookies
src/lib/agentos/binance/mcp-session.ts server-side MCP client session
src/lib/agentos/binance/index.ts       live Agent OS adapter (tool discovery)
src/app/api/agent|execute|agentos/…    API routes
src/components/…                       UI (console, Action Card, evidence, trail)
src/lib/safety/engine.test.ts          safety engine tests
src/lib/orchestrator.test.ts           execution-guard tests
```

## Config

See `.env.example`. All values optional; defaults target the official
Binance Agent OS MCP endpoint.

## Known limitations

- **Live execution is unverified.** The OAuth + MCP path compiles, type-checks
  and is built exactly per the Binance Agent OS Developer Guide, but it needs
  a real Binance account (and a reachable `agent.binance.com` origin) to be
  exercised end-to-end. RiskLens never fabricates live success.
- Live mode configured in the browser is **not persisted** — refresh returns
  to Demo Mode (OAuth session cookie aside). Scenario selection is persisted.
- Only BTCUSDT/ETHUSDT (USDT quote) are supported; amounts are quote-amounts
  (USDT) as specified.
- The project uses the standard `src/` layout from `create-next-app` rather
  than the root `app/` folder mentioned in the brief.
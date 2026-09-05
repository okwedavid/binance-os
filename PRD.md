# Binance Agent OS Mini Hackathon --- Track A PRD

## Project: RiskLens

### Tagline: **Ask. Verify. Act.**

### One-line pitch

RiskLens is an AI trading-action copilot that turns a natural-language
Binance request into an **evidence-backed Action Card**, checks the
request against live market conditions and account constraints through
Binance Agent OS, and only proceeds when the action passes a visible
safety gate.

> **This is not another trading chatbot. It is the verification layer
> between an AI's intention and a financial action.**

------------------------------------------------------------------------

# 1. Hackathon Objective

Build a polished, deployable AI agent for **Binance Agent OS Track A**
that demonstrates a meaningful use of Binance Agent OS rather than
merely mentioning it.

The official hackathon offers a \$20,000 USDC pool for Track A. Entries
require a video/demo and GitHub repository, with the published deadline
of **September 8, 2026 at 23:59 UTC**.

Binance Agent OS provides a unified way for compatible AI agents to
access supported Binance capabilities through user-controlled
permissions. Its MCP layer can expose market data, account information,
and---when authorized and eligible---supported trading actions.

RiskLens will use Agent OS as the capability layer and place a
distinctive product experience around it:

**INTENT → EVIDENCE → RISK CHECKS → ACTION/APPROVAL → AUDIT TRAIL**

------------------------------------------------------------------------

# 2. Product Vision

Most AI trading demos focus on one question:

> "Can the AI place a trade?"

RiskLens asks a more useful question:

> **"Can the AI prove that the requested action makes sense before it
> acts?"**

A user can type:

> "Check BTC. If conditions are favorable, prepare a \$20 spot buy."

RiskLens should:

1.  Understand the user's intent.
2.  Query relevant Binance Agent OS market/account tools.
3.  Collect a small set of objective signals.
4.  Run deterministic safety checks.
5.  Generate a concise explanation.
6.  Present an **Action Card**:
    -   What it wants to do
    -   Why
    -   Evidence
    -   Risk flags
    -   Estimated amount
    -   Required permission
7.  Require explicit approval before any live trade.
8.  If approved and the required Agent OS permission exists, execute the
    action.
9.  Record the result in an in-session activity timeline.

The product should feel like an AI "flight-control system", not a
generic chatbot.

------------------------------------------------------------------------

# 3. Why This Can Stand Out

## Core differentiator

RiskLens does not compete on having the smartest market prediction.

It competes on **trustworthy agent behavior**.

The visual product loop is:

**INTENT → CHECK → EVIDENCE → DECISION → APPROVE → ACT → LOG**

Every proposed action has an explanation.

Example:

### ACTION CARD

**BTCUSDT · BUY · \$20**

**Decision:** WAIT

**Why** - 24h momentum is positive - Short-term volatility is elevated -
Order-book liquidity check did not meet the configured threshold

**Agent recommendation** Wait for a cleaner setup.

**Agent OS** Connected · Market Data ✓ · Trading ⏸

This makes the agent's reasoning observable without pretending that AI
can predict markets.

------------------------------------------------------------------------

# 4. Target User

A crypto user who wants AI assistance but does not want an AI to
silently make financial decisions.

Secondary audience: - AI-agent developers - Binance users curious about
Agent OS - Hackathon judges evaluating agent safety and usefulness

------------------------------------------------------------------------

# 5. Primary User Story

> As a Binance user, I want to tell an AI agent what I want to
> accomplish, have it inspect the current Binance environment, and
> receive a clear explanation of whether the requested action should
> proceed before anything happens.

------------------------------------------------------------------------

# 6. MVP Scope

The MVP MUST be intentionally small.

## A. Agent Console

A single responsive web page.

Layout:

### Header

-   RiskLens logo/name
-   `Agent OS: Connected / Demo`
-   connection status
-   compact settings icon

### Main area

Left/center: - conversational command interface

Right: - live Action Card - agent status - evidence - risk checks

Mobile: - stacked layout

------------------------------------------------------------------------

## B. Natural-Language Intent

Support a small set of commands.

Examples:

``` text
Analyze BTCUSDT
```

``` text
Should I buy $20 of BTC right now?
```

``` text
Prepare a $20 BTC spot buy if the safety checks pass.
```

``` text
Check my Binance balance and tell me what I can safely allocate.
```

The agent should NOT attempt arbitrary workflows outside the supported
scope.

------------------------------------------------------------------------

# 7. Agent Workflow

## Step 1 --- Parse intent

Extract:

-   symbol
-   action
-   amount
-   quote/base asset
-   requested time horizon
-   whether the user asked for analysis or execution

If information is missing, ask ONE concise clarification question.

Example:

> "What amount should I use for the BTC buy?"

Do not build a complicated multi-turn planning system.

------------------------------------------------------------------------

## Step 2 --- Gather evidence through Binance Agent OS

Use Agent OS/MCP capabilities where available.

Priority:

1.  Market ticker/current price
2.  Recent candle/price information
3.  Order-book information where available
4.  Account balance when authorized
5.  Existing position/order information when authorized
6.  Trading action only after explicit approval

Do not duplicate Binance API infrastructure unless absolutely necessary.

Agent OS should remain the core external capability.

------------------------------------------------------------------------

# 8. Deterministic Safety Engine

Do NOT let the LLM invent the final safety decision.

The LLM interprets the user request and explains evidence.

A small deterministic TypeScript safety module evaluates the evidence.

Example checks:

### Check 1 --- Amount

Is requested amount valid and positive?

### Check 2 --- Balance

If account access is available: - Is sufficient balance available?

If not available: - show `Balance unavailable` - do not pretend to know
the balance.

### Check 3 --- Market freshness

Reject stale data.

Example:

``` text
marketDataAge <= 30 seconds
```

### Check 4 --- Volatility

Flag unusually high short-term volatility.

### Check 5 --- Liquidity

Flag weak order-book liquidity when order-book data is available.

### Check 6 --- Permission

Confirm the requested operation is allowed by the Agent OS connection.

### Check 7 --- Human approval

Every live trade requires explicit approval.

The safety engine returns:

``` ts
type SafetyResult = {
  status: "PASS" | "CAUTION" | "BLOCK";
  checks: SafetyCheck[];
  reasons: string[];
};
```

------------------------------------------------------------------------

# 9. Action Card

The Action Card is the signature UI component.

It must be visually dominant and extremely easy to understand.

Example:

``` text
┌──────────────────────────────────────┐
│ ACTION PROPOSAL                      │
│                                      │
│ BUY BTCUSDT                          │
│ $20 USDT                             │
│                                      │
│ SAFETY STATUS       CAUTION          │
│                                      │
│ ✓ Market data fresh                  │
│ ✓ Balance available                  │
│ ✓ Agent permission available         │
│ ! Volatility elevated                │
│                                      │
│ WHY                                  │
│ Current momentum is positive, but    │
│ short-term volatility is elevated.  │
│                                      │
│ [ APPROVE & EXECUTE ]  [ CANCEL ]    │
└──────────────────────────────────────┘
```

The button MUST NOT execute anything without an explicit click.

For Demo Mode:

``` text
[ SIMULATE ACTION ]
```

instead of live execution.

------------------------------------------------------------------------

# 10. Explainability

Every decision must expose a compact "Why?" section.

Example:

``` text
WHY THIS DECISION?

1. BTCUSDT is currently trading at $...
2. 24h change: +...
3. Short-term volatility: elevated
4. Order-book liquidity: healthy
5. Requested amount: $20
6. Agent OS permission: trading unavailable

Decision:
CAUTION — analysis only.
```

Never fabricate numerical evidence.

If a tool is unavailable, say:

> "Not available from the current Agent OS permission."

------------------------------------------------------------------------

# 11. Three Decision States

Use exactly three top-level states:

## PASS

The request passed the configured safety checks.

## CAUTION

The action is technically possible but has notable risk/context
warnings.

## BLOCK

The action must not proceed.

Examples:

-   Missing permission → BLOCK
-   Insufficient balance → BLOCK
-   Stale market data → BLOCK
-   High volatility → CAUTION
-   Healthy evidence + valid request → PASS

------------------------------------------------------------------------

# 12. Demo Mode

This is essential for reliable judging.

The application MUST work without requiring a judge to connect a Binance
account.

Demo Mode should use clearly labelled deterministic sample market data.

The UI must display:

``` text
DEMO MODE
No real order will be submitted.
```

Demo Mode should demonstrate the complete product loop:

``` text
user request
→ agent interpretation
→ market evidence
→ safety checks
→ action card
→ approval
→ simulated execution
→ activity log
```

Do not hide that the data is simulated.

------------------------------------------------------------------------

# 13. Live Agent OS Mode

Optional but strongly preferred for the final demo.

When Agent OS is connected:

``` text
AGENT OS
Connected

Market Data ✓
Account Read ✓
Trading Permission ✓/—
```

Use the official Binance Agent OS/MCP authorization flow.

Do not store Binance credentials, API keys, access tokens, or secrets in
the repository.

Never hardcode credentials.

------------------------------------------------------------------------

# 14. Activity Timeline

Keep a lightweight in-session timeline.

Example:

``` text
00:41  ANALYSIS
BTCUSDT market check completed

00:43  PROPOSAL
$20 BTC buy prepared

00:44  APPROVED
User approved action

00:44  EXECUTED
Order submitted through Agent OS
```

For Demo Mode:

``` text
00:44  SIMULATED
No live order submitted
```

No database is required for MVP.

Use client-side session state.

------------------------------------------------------------------------

# 15. UI / UX Direction

## Visual identity

Dark, premium, financial-infrastructure aesthetic.

Avoid: - excessive gradients - meme-coin aesthetics - clutter - huge
dashboards - unnecessary charts

Think:

**Binance × Linear × modern AI control room**

## Design principles

-   One primary action per screen
-   Strong typography
-   Large whitespace
-   Clear status indicators
-   Minimal animations
-   Responsive mobile layout
-   Keyboard friendly
-   Accessible contrast
-   No decorative elements that compete with the Action Card

------------------------------------------------------------------------

# 16. Required Screens

Only build these:

### Screen 1 --- Main Console

Contains: - header - command input - example prompts - Action Card -
evidence - activity timeline

### Screen 2 --- Connection Drawer

Contains: - Demo Mode - Agent OS connection status - available
permissions - short explanation of permissions

No separate settings application.

------------------------------------------------------------------------

# 17. Example Prompts

Display three clickable examples:

### Market Check

> Analyze BTCUSDT and tell me whether the current conditions pass the
> RiskLens safety checks.

### Trade Proposal

> Prepare a \$20 BTC spot buy if all safety checks pass.

### Account Check

> Check my available Binance balance and tell me how much of this
> request can be fulfilled.

These prompts make the demo immediately understandable.

------------------------------------------------------------------------

# 18. Technical Architecture

## Principle

**Keep the stack boring.**

### Frontend

-   Next.js
-   TypeScript
-   React
-   Tailwind CSS

### Backend

Use Next.js server-side route handlers/server actions where appropriate.

Avoid a separate Express server unless Agent OS integration requires it.

### Agent integration

-   Binance Agent OS
-   Binance MCP endpoint / supported Agent OS interfaces
-   MCP-compatible agent workflow

### Validation

-   Native TypeScript validation where practical
-   Use Zod only if it materially simplifies structured tool/LLM output

### State

-   React state / lightweight context

### Persistence

-   None required for MVP

### Database

-   NONE

### Redis

-   NONE

### Prisma

-   NONE

### Authentication

-   NONE for MVP

### Background workers

-   NONE

### Queue

-   NONE

### Docker

-   NONE unless deployment platform requires it

### Analytics

-   NONE

### CMS

-   NONE

### External charting library

-   NONE

A tiny inline SVG/HTML sparkline may be used if useful.

------------------------------------------------------------------------

# 19. Dependency Policy

Every dependency must justify its existence.

Preferred dependency set:

``` text
next
react
react-dom
typescript
tailwindcss
```

Optional:

``` text
zod
```

Only add an MCP/Agent OS SDK/package if the official integration
requires it.

Do not install: - Redux - Zustand - Prisma - Axios - Express - MongoDB -
PostgreSQL - Redis - BullMQ - Framer Motion - charting frameworks -
authentication packages - analytics packages

unless implementation proves one is genuinely required.

Prefer native `fetch`.

------------------------------------------------------------------------

# 20. Repository Structure

Keep the repository understandable:

``` text
/
├── app/
│   ├── page.tsx
│   ├── api/
│   │   └── agent/
│   │       └── route.ts
│   ├── layout.tsx
│   └── globals.css
│
├── components/
│   ├── AgentConsole.tsx
│   ├── ActionCard.tsx
│   ├── EvidencePanel.tsx
│   ├── AgentStatus.tsx
│   ├── ActivityTimeline.tsx
│   └── ConnectionDrawer.tsx
│
├── lib/
│   ├── agent/
│   │   ├── intent.ts
│   │   ├── tools.ts
│   │   └── prompts.ts
│   ├── safety/
│   │   └── engine.ts
│   └── demo/
│       └── data.ts
│
├── public/
│   └── ...
│
├── README.md
├── PRD.md
├── .env.example
├── package.json
└── tsconfig.json
```

Adjust the structure if the official Agent OS integration requires a
different arrangement, but preserve the separation between UI, agent
integration, safety logic, and demo data.

------------------------------------------------------------------------

# 21. Environment Variables

Only include variables that are genuinely required.

Use:

``` text
.env.local
```

Never commit secrets.

Provide:

``` text
.env.example
```

with placeholder values only.

The application MUST remain usable in Demo Mode without secrets.

------------------------------------------------------------------------

# 22. Agent Prompt Design

The agent system prompt should enforce these rules:

``` text
You are RiskLens, a cautious Binance action copilot.

Your job is to translate user intent into an evidence-backed action proposal.

Never invent market data, account balances, permissions, order status, or execution results.

Use available Binance Agent OS capabilities when connected.

Separate:
1. observed facts
2. derived signals
3. recommendation
4. proposed action

Never claim that a trade is guaranteed to profit.

Never execute a live trade without explicit user approval.

If required information is unavailable, say so.

The deterministic RiskLens safety engine is authoritative for PASS,
CAUTION, and BLOCK.

Your explanation must be concise and understandable to a non-expert.
```

------------------------------------------------------------------------

# 23. Agent Tool Strategy

Do not expose every possible Binance capability.

Expose only the minimum tools needed for the demo.

Preferred logical capabilities:

``` text
get_market_snapshot
get_order_book
get_account_balance
get_open_positions_or_orders
prepare_trade
execute_trade
```

If the official Agent OS interface exposes different tool names, map
them internally rather than forcing these names.

The application must gracefully handle unavailable capabilities.

------------------------------------------------------------------------

# 24. Trade Execution Rule

This is non-negotiable.

The agent may:

1.  analyze
2.  prepare
3.  explain

But it must not silently execute.

Execution requires:

``` text
User intent
+
Safety PASS/CAUTION policy
+
Agent OS trading permission
+
Explicit user approval
```

The UI must clearly distinguish:

``` text
PROPOSED
```

from:

``` text
EXECUTED
```

------------------------------------------------------------------------

# 25. Demo Data

Create deterministic demo scenarios.

## Scenario A --- Healthy

BTCUSDT: - fresh market data - reasonable volatility - healthy
liquidity - sufficient simulated balance

Expected:

``` text
PASS
```

## Scenario B --- Volatile

BTCUSDT: - fresh data - elevated volatility - healthy liquidity

Expected:

``` text
CAUTION
```

## Scenario C --- Blocked

BTCUSDT: - stale market data OR insufficient simulated balance

Expected:

``` text
BLOCK
```

The evaluator should be able to experience all three states quickly.

------------------------------------------------------------------------

# 26. Error Handling

The UI must never show raw technical errors to the user.

Bad:

``` text
TypeError: Cannot read properties of undefined
```

Good:

``` text
Agent OS could not provide account balance.

Your current permission does not include account access.
```

For network failures:

``` text
Agent OS is temporarily unavailable.

RiskLens has paused the action and will not execute anything.
```

Always fail closed for live financial actions.

------------------------------------------------------------------------

# 27. Deployment

Primary target:

**Vercel**

Requirements:

-   production build succeeds
-   no server process required
-   no database required
-   Demo Mode works immediately
-   environment variables documented
-   mobile responsive

The deployed URL must be usable without authentication.

------------------------------------------------------------------------

# 28. README Requirements

README must contain:

## 1. What is RiskLens?

One paragraph.

## 2. Why it exists

Explain the intent-verification problem.

## 3. Architecture

Small ASCII diagram:

``` text
User
 ↓
RiskLens Agent
 ↓
Binance Agent OS
 ↓
Market / Account / Trading Capabilities
 ↓
Risk Engine
 ↓
Action Card
 ↓
Human Approval
 ↓
Execution
```

## 4. Agent OS integration

Explain exactly where Agent OS is used.

## 5. Demo Mode

Explain that no real trade occurs.

## 6. Live Mode

Explain required authorization and permissions.

## 7. Local development

Give copy/paste commands.

## 8. Deployment

Give Vercel steps.

## 9. Security

Explicitly state: - no secrets committed - no hardcoded credentials -
explicit approval before live execution - fail-closed behavior

## 10. Hackathon demo

Include the exact 90-second demo flow.

------------------------------------------------------------------------

# 29. 90-Second Judge Demo

The application must be optimized for this exact sequence.

## 0--10 seconds

Open RiskLens.

Say:

> "Most AI trading demos ask whether an agent can trade. RiskLens asks
> whether an agent can prove an action is safe enough to execute."

Show the Agent OS connection indicator.

------------------------------------------------------------------------

## 10--25 seconds

Type:

> "Analyze BTCUSDT."

Agent retrieves market evidence.

Action Card appears.

Say:

> "RiskLens separates observed Binance data from the agent's
> recommendation."

------------------------------------------------------------------------

## 25--45 seconds

Type:

> "Prepare a \$20 BTC spot buy if all safety checks pass."

Show:

-   market freshness
-   volatility
-   liquidity
-   balance
-   permission

Say:

> "Before the agent can act, RiskLens runs deterministic safety checks."

------------------------------------------------------------------------

## 45--60 seconds

Show:

``` text
CAUTION
```

because volatility is elevated.

Say:

> "The agent doesn't pretend to know the future. It exposes the reason
> it is cautious."

------------------------------------------------------------------------

## 60--75 seconds

Switch to a healthy demo scenario or use a safe test request.

Action Card:

``` text
PASS
```

Click:

``` text
APPROVE & EXECUTE
```

If live Agent OS execution is enabled, show the resulting status.

Otherwise use:

``` text
SIMULATED EXECUTION
```

------------------------------------------------------------------------

## 75--90 seconds

Show the activity timeline.

Say:

> "Every action has a visible chain: intent, evidence, decision,
> approval, and result. That's RiskLens --- a trust layer for agentic
> finance."

Stop.

------------------------------------------------------------------------

# 30. Demo Reliability Requirements

The hackathon demo is more important than feature count.

Therefore:

-   Demo Mode must always work.
-   All three safety states must be deterministic.
-   Agent OS failure must not crash the UI.
-   Missing permissions must be handled gracefully.
-   No loading screen should last indefinitely.
-   No blank screen.
-   No uncaught React errors.
-   No raw API errors.
-   Refresh must restore Demo Mode.
-   Mobile layout must remain usable.

------------------------------------------------------------------------

# 31. Testing Requirements

Minimum automated coverage:

### Unit tests

Test:

``` text
valid amount → PASS/CHECK
invalid amount → BLOCK
stale market data → BLOCK
high volatility → CAUTION
missing permission → BLOCK
insufficient balance → BLOCK
healthy scenario → PASS
```

### Production smoke test

Verify:

``` text
npm install
npm run build
npm run start
```

No TypeScript errors.

No lint errors if linting is configured.

------------------------------------------------------------------------

# 32. Definition of Done

The project is complete only when ALL are true:

-   [ ] Application launches successfully.
-   [ ] Main console is responsive.
-   [ ] Demo Mode works without secrets.
-   [ ] User can enter natural-language commands.
-   [ ] Agent interprets intent.
-   [ ] Agent OS integration exists and is documented.
-   [ ] Market evidence is shown.
-   [ ] Safety engine is deterministic.
-   [ ] PASS/CAUTION/BLOCK states work.
-   [ ] Action Card is polished.
-   [ ] Live actions require explicit approval.
-   [ ] Errors fail safely.
-   [ ] Activity timeline works.
-   [ ] README is complete.
-   [ ] `.env.example` exists.
-   [ ] No secrets are committed.
-   [ ] Production build succeeds.
-   [ ] Vercel deployment works.
-   [ ] 90-second demo can be completed without improvisation.

------------------------------------------------------------------------

# 33. Explicit Non-Goals

Do NOT build:

-   portfolio management
-   copy trading
-   social feeds
-   news aggregation
-   complex technical analysis
-   autonomous trading bots
-   custom trading strategies
-   backtesting
-   database accounts
-   payment systems
-   token launches
-   multi-exchange support
-   mobile native application
-   browser extension
-   advanced charts
-   notification infrastructure
-   admin dashboard

These features reduce the chance of shipping a stable hackathon
submission.

------------------------------------------------------------------------

# 34. Three-Day Execution Plan

## DAY 1 --- Functional Core

### Goal

Working agent + Agent OS integration + safety engine.

Tasks:

1.  Initialize project.
2.  Build basic console.
3.  Implement Demo Mode.
4.  Implement intent parser.
5.  Implement Agent OS connection layer.
6.  Implement market/account tool calls.
7.  Implement deterministic safety engine.
8.  Implement Action Card.
9.  Test PASS/CAUTION/BLOCK.

End of Day 1:

> The full workflow works even if the UI is ugly.

------------------------------------------------------------------------

# DAY 2 --- Product Quality

### Goal

Make it judge-ready.

Tasks:

1.  Premium UI.
2.  Responsive mobile layout.
3.  Agent status indicators.
4.  Evidence panel.
5.  Activity timeline.
6.  Connection drawer.
7.  Error states.
8.  Loading states.
9.  Demo scenario switcher.
10. README.
11. `.env.example`.
12. Unit tests.

End of Day 2:

> The application looks like a finished product.

------------------------------------------------------------------------

# DAY 3 --- Ship + Demo

### Goal

Zero surprises.

Tasks:

1.  Production build.
2.  Deploy to Vercel.
3.  Test deployed URL.
4.  Test Demo Mode from a clean browser.
5.  Test Agent OS integration.
6.  Test mobile.
7.  Record 90-second demo.
8.  Clean repository.
9.  Review README.
10. Verify GitHub repository.
11. Prepare X submission.
12. Submit before deadline.

Do NOT add new major features on Day 3.

------------------------------------------------------------------------

# 35. Judge-Oriented Positioning

The project should be presented around five qualities:

## 1. Agent-native

RiskLens uses Binance Agent OS as the capability layer rather than
building a fake Binance integration.

## 2. Useful

The product solves a real problem:

> Users want AI assistance without surrendering control.

## 3. Safe

The agent cannot silently execute a trade.

## 4. Explainable

Every proposed action shows evidence and reasons.

## 5. Simple

A judge understands the product in seconds.

------------------------------------------------------------------------

# 36. Submission Pitch

Use this as the project description:

> **RiskLens is an AI action copilot for Binance Agent OS. Instead of
> blindly letting an agent act on financial intent, RiskLens creates an
> evidence-backed Action Card, runs deterministic safety checks against
> live Binance context, explains the decision, and requires explicit
> human approval before execution. It turns agentic finance from "AI can
> trade" into "AI can explain why it wants to act."**

------------------------------------------------------------------------

# 37. Critical Implementation Rule

Do not over-engineer.

If an implementation choice increases: - setup time, - dependency
count, - deployment complexity, - authentication complexity, - debugging
surface,

choose the simpler option.

The winning implementation is not the one with the most code.

It is the one where a judge can immediately understand:

``` text
USER INTENT
    ↓
BINANCE AGENT OS
    ↓
EVIDENCE
    ↓
RISK CHECK
    ↓
ACTION CARD
    ↓
HUMAN APPROVAL
    ↓
RESULT
```

------------------------------------------------------------------------

# 38. Final Instruction to the Coding Agent

You are implementing the product described in this PRD.

Do not reinterpret the product into a generic crypto chatbot.

Do not add unrelated features.

Do not replace Binance Agent OS with a mock integration in the main
architecture.

Demo Mode may use deterministic mock data solely to guarantee judge
reliability.

Build the smallest production-quality implementation that satisfies
every Definition of Done item.

Before finishing:

1.  inspect the complete repository;
2.  implement the product;
3.  run tests;
4.  run the production build;
5.  fix all errors;
6.  verify Demo Mode;
7.  verify Agent OS integration;
8.  verify responsive UI;
9.  update README;
10. leave the repository in a deployable state.

The final result must be something a judge can understand and use in
less than 30 seconds.

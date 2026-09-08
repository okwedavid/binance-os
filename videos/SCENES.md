# RiskLens — Binance Agent OS · Demo Video (78s)

- File: `risklens-binance-agent-os-demo.mp4` (1920×1080, h264, yuv420p, 25 fps)
- Thumbnail: `risklens-binance-agent-os-demo-thumbnail.png`
- Source: real rendered frames of the deployed app `https://binance-risklens.onrender.com`
  (Demo Mode simulated trade only; no real Binance order was ever submitted).
- Transitions: fade to/from black (0.4–0.5 s) between scenes; caption band
  (black@55% box, white bold text) at the bottom of each scene.

| # | Time (s) | Source frame | On-screen captions |
|---|----------|--------------|--------------------|
| 1 | 0–8 | app open (header: ASK · VERIFY · ACT) | Title: **RiskLens** · Ask. Verify. Act. · A Binance Agent OS companion |
| 2 | 8–15 | app open | One prompt — every action checked against observable evidence · Nothing executes without your explicit approval |
| 3 | 15–22 | “Buy $100 of SOL” typed | ASK · Demo Mode — this is a simulation · “Buy $100 of SOL” → resolved to SOLUSDT |
| 4 | 22–30 | action card | VERIFY · SOLUSDT last price $172.00 — PASS · Evidence-backed action card · approval required |
| 5 | 30–36 | SIMULATE ACTION ready | ACT · Approve with SIMULATE ACTION |
| 6 | 36–45 | execution result | SIMULATED ORDER FILLED — 0.5808 SOL @ 172.18 · Order DEMO-48b5b5d0 · fee 0.09999985 USDT · NO LIVE ORDER |
| 7 | 45–54 | audit trail + demo panel | Portfolio settled — DEMO PORTFOLIO ledger updated (0.10% fee) · Audit trail: queued → accepted → filled → settled |
| 8 | 54–62 | DOGE proposal | DYNAMIC ASSETS — Buy $50 of DOGE → DOGEUSDT $0.14 PASS · Any asset listed & trading on Binance, not just BTC/ETH |
| 9 | 62–70 | Agent OS connection panel | LIVE AGENT OS MODE — connect the Agentic sub-account · Execution still requires explicit approval · withdrawals never exposed |
| 10 | 70–78 | final overview | ASK · VERIFY · ACT · Demo-ledger fix + dynamic-asset support — verified: 188 tests passing · binance-risklens.onrender.com |

## Verification notes

- The full Demo trade lifecycle was exercised against the deployed app:
  SOLUSDT resolved, safety checks PASS, `SIMULATE ACTION` produced a
  `SIMULATED ORDER` with status FILLED, order `DEMO-48b5b5d0`, filled
  `0.5808 SOL @ 172.18 USDT`, fee `0.09999985 USDT`, and the audit-trail
  step “Demo portfolio updated. Fee … (0.10%) applied.”
- DOGE resolves dynamically: `Buy $50 of DOGE` → `DOGEUSDT`, last price
  `$0.14`, PASS — any listed/tradeable Binance asset is supported.
- Captions quote the app’s own labels (“SIMULATED — NO LIVE ORDER WAS
  SUBMITTED.”, “Demo Mode — no real order will be submitted.”).
- Where fixes were verified: the demo-ledger bug (fills were never committed
  to the shared portfolio store) and dynamic-asset support were verified in
  CI — `typecheck` clean, `eslint` clean, **188 tests passing**
  (`src/lib/demo/portfolio.test.ts`, `src/lib/demo/simulation.test.ts`,
  `src/lib/agentos/demo-adapter` regression test).

## Deployed-build caveat (honesty)

During capture the deployed render service was multi-instance; each instance
kept its own in-memory portfolio, so the standalone DEMO PORTFOLIO panel can
display the starting `$10,000` in some frames. The execution result and audit
trail (rendered from the authoritative execute response) always show the
fill and settlement. The root cause (fills never written back to the shared
ledger + panel reading a possibly-different instance) is fixed in main
(`db13a4a`, `be434f5`) and verified by 188 passing tests; the video frames
capture the deployed app as-is.
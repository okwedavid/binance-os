"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentOSStatusResponse,
  AgentResponse,
  AuthCapability,
  ConnectionState,
  EvidenceBundle,
  Mode,
  Proposal,
  TimelineEvent,
} from "@/lib/types";
import type { DemoScenario } from "@/lib/demo/data";
import { ActionCard } from "@/components/ActionCard";
import { EvidencePanel } from "@/components/EvidencePanel";
import { ActivityTimeline } from "@/components/ActivityTimeline";
import { ConnectionDrawer } from "@/components/ConnectionDrawer";
import { TradingResult } from "@/components/TradingResult";
import { DemoPortfolioPanel } from "@/components/DemoPortfolioPanel";
import { StatusDot } from "@/components/ui";

type ConsoleMessage =
  | { role: "user"; text: string; id: string }
  | { role: "agent"; text: string; id: string; tone: "default" | "error" | "clarify" };

const GREETING: ConsoleMessage = {
  role: "agent",
  id: "greeting",
  text: "Hi — I'm RiskLens. Ask me to check a market, prepare a buy or sell with a size, or look at your account balance. I verify every action against observable data before proposing anything — and nothing executes without your explicit approval.",
  tone: "default",
};

const SUGGESTIONS = [
  "Analyze BTCUSDT and tell me whether the current conditions pass the RiskLens safety checks.",
  "Prepare a $20 BTC spot buy if all safety checks pass.",
  "Check my available Binance balance.",
];

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function AgentConsole() {
  const [mode, setMode] = useState<Mode>("demo");
  const [scenario, setScenario] = useState<DemoScenario>("healthy");
  const [demoState, setDemoState] = useState<ConnectionState | null>(null);
  const [liveState, setLiveState] = useState<ConnectionState | null>(null);
  const [auth, setAuth] = useState<AuthCapability | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [messages, setMessages] = useState<ConsoleMessage[]>([GREETING]);
  const [input, setInput] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [evidence, setEvidence] = useState<EvidenceBundle | null>(null);
  const [busy, setBusy] = useState(false);
  const [executing, setExecuting] = useState(false);
  // One-shot double-submit guard (A2): the ref is synchronous and cannot
  // be raced by React's batched state updates.
  const executingRef = useRef(false);
  const [execAuth, setExecAuth] = useState<{ token: string; expiresAtMs: number } | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Bumped after each successful execution so the Demo portfolio panel
  // re-reads the in-memory ledger.
  const [portfolioKey, setPortfolioKey] = useState(0);
  const consoleRef = useRef<HTMLDivElement>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const [demoRes, liveRes] = await Promise.all([
        fetch("/api/agentos/status?mode=demo&scenario=healthy"),
        fetch("/api/agentos/status?mode=live"),
      ]);
      const demo = (await demoRes.json()) as AgentOSStatusResponse;
      const live = (await liveRes.json()) as AgentOSStatusResponse;
      return {
        demo: demo.state,
        live: live.state,
        auth: live.auth ?? demo.auth,
      };
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    refreshStatus().then((states) => {
      if (states) {
        setDemoState(states.demo);
        setLiveState(states.live);
        setAuth(states.auth ?? null);
      }
    });
    let storedScenario: string | null = null;
    try {
      storedScenario = window.localStorage.getItem("rl_scenario");
    } catch {
      // localStorage may be unavailable; Demo Mode is the safe default.
    }
    if (storedScenario === "volatile" || storedScenario === "blocked") {
      Promise.resolve().then(() => setScenario(storedScenario));
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get("agentos_state") === "error") {
      window.history.replaceState({}, "", window.location.pathname);
      Promise.resolve().then(() =>
        setNotice(
          "The Agent OS authorization did not complete. RiskLens stays in Demo Mode — nothing was executed."
        )
      );
    }
  }, [refreshStatus]);

  useEffect(() => {
    try {
      window.localStorage.setItem("rl_scenario", scenario);
    } catch {
      // non-critical
    }
  }, [scenario]);

  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [messages, busy]);

  const appendEvents = useCallback((next: TimelineEvent[] | undefined) => {
    if (!next || next.length === 0) return;
    setEvents((prev) => {
      const seen = new Set(prev.map((e) => e.id));
      const fresh = next.filter((e) => !seen.has(e.id));
      return fresh.length ? [...prev, ...fresh] : prev;
    });
  }, []);

  async function sendCommand(raw: string) {
    const command = raw.trim();
    if (!command || busy) return;
    setInput("");
    setMessages((prev) => [
      ...prev,
      { role: "user", text: command, id: uid() },
    ]);
    setBusy(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, scenario, command }),
      });
      const data = (await res.json()) as AgentResponse & {
        ok: boolean;
        timeline?: TimelineEvent[];
        executionAuthorization?: { token: string; expiresAtMs: number };
      };
      appendEvents(data.timeline);
      if (!data.ok) {
        setMessages((prev) => [
          ...prev,
          {
            role: "agent",
            id: uid(),
            text: data.message + (data.detail ? `\n\n${data.detail}` : ""),
            tone: "error",
          },
        ]);
        return;
      }
      if (data.kind === "clarify") {
        setMessages((prev) => [
          ...prev,
          { role: "agent", id: uid(), text: data.question, tone: "clarify" },
        ]);
        return;
      }
      setMessages((prev) => [
        ...prev,
        { role: "agent", id: uid(), text: data.message, tone: "default" },
      ]);
      if (data.proposal) {
        setProposal(data.proposal);
        setEvidence(data.evidence ?? null);
        setExecAuth(data.executionAuthorization ?? null);
      } else {
        setEvidence(data.evidence ?? null);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "agent",
          id: uid(),
          text: "RiskLens could not reach its command API. Try again.",
          tone: "error",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!proposal || executingRef.current) return;
    if (!execAuth) {
      setMessages((prev) => [
        ...prev,
        {
          role: "agent",
          id: uid(),
          text: "This proposal is missing a valid execution authorization. Ask RiskLens to prepare the order again.",
          tone: "error",
        },
      ]);
      return;
    }
    executingRef.current = true;
    setExecuting(true);
    try {
      const res = await fetch("/api/agent/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: proposal.mode,
          scenario,
          symbol: proposal.symbol,
          side: proposal.side,
          amount: proposal.amount,
          amountType: proposal.order?.amountType ?? "quote",
          quote: proposal.quote,
          requestText: proposal.requestText,
          approve: true,
          executionAuthorization: execAuth.token,
        }),
      });
      const data = await res.json();
      appendEvents(data.timeline);
      if (data.ok && data.proposal) {
        setProposal(data.proposal);
        setExecAuth(null);
        setPortfolioKey((k) => k + 1);
        setMessages((prev) => [
          ...prev,
          { role: "agent", id: uid(), text: data.message, tone: "default" },
        ]);
      } else {
        if (data.blocked && data.safety) {
          setProposal((cur) =>
            cur
              ? { ...cur, phase: "BLOCKED", safety: data.safety }
              : cur
          );
        }
        setMessages((prev) => [
          ...prev,
          {
            role: "agent",
            id: uid(),
            text: data.message + (data.detail ? `\n\n${data.detail}` : ""),
            tone: "error",
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "agent",
          id: uid(),
          text: "RiskLens could not complete the action. Nothing was executed.",
          tone: "error",
        },
      ]);
    } finally {
      executingRef.current = false;
      setExecuting(false);
    }
  }

  function cancel() {
    setProposal(null);
    setEvidence(null);
    setExecAuth(null);
    appendEvents([
      {
        id: uid(),
        kind: "SYSTEM",
        label: "Proposal cancelled",
        detail: "The user cancelled the pending action. Nothing was executed.",
        atMs: Date.now(),
      },
    ]);
  }

  async function resetDemo() {
    try {
      const res = await fetch("/api/demo/reset", { method: "POST" });
      const data = (await res.json()) as { ok: boolean };
      if (data.ok) {
        setPortfolioKey((k) => k + 1);
        appendEvents([
          {
            id: uid(),
            kind: "SYSTEM",
            label: "Demo portfolio reset",
            detail: "The in-memory DEMO PORTFOLIO returned to 10,000 USDT. No live account was touched.",
            atMs: Date.now(),
          },
        ]);
      }
    } catch {
      // best-effort
    }
  }

  async function connect() {
    if (connecting) return;
    setConnecting(true);
    setConnectError(null);
    try {
      const res = await fetch("/api/agentos/connect");
      const data = await res.json();
      if (data.ok && data.authorizationUrl) {
        window.location.href = data.authorizationUrl;
        return;
      }
      const message = data.message + (data.detail ? `\n\n${data.detail}` : "");
      setConnectError(message);
      setMessages((prev) => [
        ...prev,
        {
          role: "agent",
          id: uid(),
          text: message,
          tone: "error",
        },
      ]);
    } catch {
      const message = "Could not start the Agent OS connection.";
      setConnectError(message);
      setMessages((prev) => [
        ...prev,
        {
          role: "agent",
          id: uid(),
          text: message,
          tone: "error",
        },
      ]);
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    try {
      await fetch("/api/agentos/disconnect", { method: "POST" });
    } catch {
      // best-effort
    }
    setConnectError(null);
    setLiveState((cur) =>
      cur
        ? {
            ...cur,
            connected: false,
            statusText: "Not connected",
            detail: "Agent OS session removed from this browser.",
            permissions: [],
            supportsTrading: null,
            withdrawalsExposed: false,
          }
        : cur
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-acc font-mono text-sm font-bold text-black">
              RL
            </span>
            <div>
              <div className="text-sm font-bold tracking-tight text-text">
                RiskLens
              </div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted">
                Ask&nbsp;·&nbsp;Verify&nbsp;·&nbsp;Act
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] font-semibold ${
                mode === "demo"
                  ? "border-danger/40 bg-danger/10 text-danger"
                  : "border-ok/40 bg-ok/10 text-ok"
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
              {mode === "demo" ? "DEMO" : "LIVE"}
            </span>
            <button
              onClick={() => {
                setDrawerOpen(true);
                void refreshStatus().then((states) => {
                  if (states) {
                    setDemoState(states.demo);
                    setLiveState(states.live);
                    setAuth(states.auth ?? null);
                  }
                });
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-line2 hover:text-text"
            >
              <StatusDot
                tone={
                  mode === "demo"
                    ? "warn"
                    : liveState?.connected
                      ? "ok"
                      : "muted"
                }
              />
              <span className="hidden sm:inline">
                {mode === "demo"
                  ? "Agent OS · Demo"
                  : liveState?.connected
                    ? "Agent OS · Connected"
                    : "Agent OS · Auth required"}
              </span>
              <span className="sm:hidden">Connection</span>
            </button>
          </div>
        </div>
      </header>

      {mode === "demo" ? (
        <div className="border-b border-danger/25 bg-danger/10 px-4 py-1.5 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-danger">
          Demo Mode — no real order will be submitted.
        </div>
      ) : (
        <div className="border-b border-ok/25 bg-ok/10 px-4 py-1.5 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-ok">
          Live Mode — action executes only after explicit approval.
        </div>
      )}

      {notice && (
        <div className="border-b border-warn/30 bg-warn/10 px-4 py-2 text-center text-[12px] text-warn">
          {notice}
        </div>
      )}

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-6">
        <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
          <section className="flex min-h-[420px] flex-col lg:sticky lg:top-5 lg:self-start">
            <div
              ref={consoleRef}
              className="flex-1 space-y-4 overflow-y-auto rounded-xl border border-line bg-panel p-4 lg:h-[calc(100vh-4.5rem)] lg:min-h-[540px]"
            >
              {messages.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-xl rounded-br-sm bg-panel3 px-3.5 py-2.5 text-[13px] text-text">
                      {m.text}
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="flex justify-start">
                    <div
                      className={`max-w-[92%] whitespace-pre-wrap rounded-xl rounded-bl-sm px-3.5 py-2.5 text-[13px] leading-relaxed ${
                        m.tone === "error"
                          ? "border border-danger/30 bg-danger/10 text-danger"
                          : m.tone === "clarify"
                            ? "border border-warn/30 bg-warn/10 text-text"
                            : "border border-line bg-panel2 text-text"
                      }`}
                    >
                      {m.text}
                    </div>
                  </div>
                )
              )}
              {busy && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-xl border border-line bg-panel2 px-3.5 py-2.5 text-[13px] text-muted">
                    <span className="rl-pulse">●</span> RiskLens is verifying
                    evidence…
                  </div>
                </div>
              )}
            </div>

            <form
              className="mt-3 flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                sendCommand(input);
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  mode === "demo"
                    ? "Try “Prepare a $20 BTC spot buy…”"
                    : "Ask RiskLens in plain English…"
                }
                className="flex-1 rounded-lg border border-line bg-panel px-3.5 py-2.5 text-sm text-text placeholder:text-muted focus:border-acc focus:outline-none"
                disabled={busy}
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="rounded-lg bg-acc px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-accdim disabled:cursor-not-allowed disabled:opacity-40"
              >
                Send
              </button>
            </form>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => sendCommand(s)}
                  disabled={busy}
                  className="rounded-full border border-line bg-panel px-3 py-1.5 text-left text-[11px] text-muted transition-colors hover:border-line2 hover:text-text disabled:opacity-40"
                >
                  {s}
                </button>
              ))}
            </div>
          </section>

          <aside className="space-y-5">
            <ActionCard
              proposal={proposal}
              executing={executing}
              onApprove={approve}
              onCancel={cancel}
            />
            {proposal?.result ? <TradingResult result={proposal.result} /> : null}
            {mode === "demo" ? <DemoPortfolioPanel refreshKey={portfolioKey} /> : null}
            <EvidencePanel evidence={evidence} />
            <ActivityTimeline events={events} />
          </aside>
        </div>
      </main>

      <footer className="border-t border-line px-4 py-3 text-center text-[11px] text-muted">
        RiskLens verifies every action against observable evidence — approvals
        are never bypassed, and withdrawals are never exposed.
      </footer>

      <ConnectionDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        mode={mode}
        onModeChange={(m) => {
          if (m === "live") {
            // C9: only enter Live mode when the server confirms a real
            // Agent OS connection. Never blind-switch into a dead mode.
            setNotice(null);
            void refreshStatus().then((states) => {
              if (states && states.live.connected) {
                setMode("live");
                setProposal(null);
                setEvidence(null);
                setExecAuth(null);
                setDemoState(states.demo);
                setLiveState(states.live);
                setAuth(states.auth ?? null);
              } else {
                setNotice(
                  "Live mode requires a verified Agent OS connection first. Connect from this panel."
                );
              }
            });
            return;
          }
          setMode(m);
          setProposal(null);
          setEvidence(null);
          setExecAuth(null);
          void refreshStatus().then((states) => {
            if (states) {
              setDemoState(states.demo);
              setLiveState(states.live);
              setAuth(states.auth ?? null);
            }
          });
        }}
        scenario={scenario}
        onScenarioChange={(s) => {
          setScenario(s);
          void refreshStatus().then((states) => {
            if (states) {
              setDemoState(states.demo);
              setLiveState(states.live);
              setAuth(states.auth ?? null);
            }
          });
        }}
        demoState={demoState}
        liveState={liveState}
        auth={auth}
        connectError={connectError}
        onConnect={connect}
        connecting={connecting}
        onDisconnect={disconnect}
        onResetDemo={resetDemo}
      />
    </div>
  );
}